#!/usr/bin/env python3
"""Hermes local media pipeline: LTX-2.3 Image-to-Video via ComfyUI."""

from __future__ import annotations

import argparse
import copy
import json
import os
import random
import subprocess
import sys
import time
import uuid
from pathlib import Path
from typing import Any

from generate_video import (
    IMAGE_EXTENSIONS,
    VIDEO_EXTENSIONS,
    PipelineError,
    cfg,
    download_comfy_file,
    endpoint,
    find_output_ref,
    http_json,
    iter_nodes,
    load_env_file,
    load_workflow,
    object_options,
    poll_comfy,
    queue_comfy,
    set_node_input,
    slugify,
    upload_image,
    validate_workflow_node_classes,
)

PROJECT_DIR = Path("/workspace/projects/media-pipeline")
DEFAULT_ENV_FILE = "/opt/data/hermes/media-pipeline.env"
DEFAULT_LTX_WORKFLOW = str(PROJECT_DIR / "workflows/ltx_2_3_i2v_api.json")
DEFAULT_IMAGE_DIR = "/opt/data/hermes/generated-images"
DEFAULT_VIDEO_DIR = "/opt/data/hermes/generated-videos"
DEFAULT_KEYFRAME_SCRIPT = str(PROJECT_DIR / "generate_video.py")

# Realistic keyframe is rendered larger than the LTX output (AR-matched 1.5:1)
# so faces retain detail after downscale into the I2V input. Both divisible by 64.
KEYFRAME_WIDTH = 1152
KEYFRAME_HEIGHT = 768
KEYFRAME_FLUX_STEPS = 28

LTX_CHECKPOINT = "ltx-2.3-22b-dev-fp8.safetensors"
LTX_DISTILLED_LORA = "ltx_2.3_22b_distilled_1.1_lora_dynamic_fro09_avg_rank_111_bf16.safetensors"
LTX_GEMMA_LORA = "gemma-3-12b-it-abliterated_lora_rank64_bf16.safetensors"
LTX_TEXT_ENCODER = "gemma_3_12B_it_fp4_mixed.safetensors"

LTX_NEGATIVE_PROMPT = (
    "text, watermark, logo, captions, subtitles, low quality, blurry, noisy, "
    "distorted motion, warped hands, deformed face, flicker, bad anatomy"
)

# RIFE frame interpolation: LTX renders natively at low fps (8) to fit the 3090
# VRAM envelope; a post-decode RIFE pass multiplies frames so motion looks smooth
# and faces read sharper during action without re-rendering. Runs in-graph after
# VAE decode, so the proven render resolution/fps is unchanged (no OOM risk).
DEFAULT_INTERP_MODEL = "rife_v4.26.safetensors"

# Tier 2 face restoration (CodeFormer). RIFE smooths motion but cannot un-blur an
# already-smeared frame; CodeFormer reconstructs facial detail per-frame. Runs
# in-graph right after VAE decode (before RIFE, so fewer frames are restored and
# RIFE dampens per-frame identity flicker). Requires the facerestore_cf custom
# node + codeformer model in the ComfyUI container; gated OFF by default via the
# LTX_FACE_RESTORE env so renders never break when the node is absent.
DEFAULT_FACE_RESTORE_MODEL = "codeformer.pth"

# Anime detail restoration. CodeFormer only works on real human faces, so it is
# disabled for anime/cartoon content — leaving motion-blurred anime faces with no
# restorer (the "cat face melts during the leap" problem). RealESRGAN
# AnimeVideo-v3 is an anime-specialised per-frame upscaler that re-injects
# line/detail; run it right after VAE decode (before RIFE) so interpolation works
# on already-sharpened frames. Gated on the model being installed in ComfyUI so
# renders never break when it is absent (auto-falls back to no restore).
DEFAULT_ANIME_UPSCALE_MODEL = "realesr-animevideov3.pth"
DEFAULT_FACE_DETECTION = "retinaface_resnet50"
# CodeFormer fidelity: 0=max restoration (sharper, may drift identity),
# 1=max fidelity to input. 0.5 balances sharpness vs identity for video.
DEFAULT_FACE_FIDELITY = 0.5
FACE_RESTORE_LOADER_CLASS = "FaceRestoreModelLoader"
FACE_RESTORE_CLASS = "FaceRestoreCFWithModel"

# Animation detection. For cartoon/anime/Pixar content we (1) skip CodeFormer
# face restoration — it is trained on real human faces and either distorts a
# stylized face or sharpens a wrong human that drifted in — and (2) add human
# blocking negatives so a vaguely-described shot (e.g. "a forest full of
# fireflies") does not render real people instead of the cartoon character.
ANIMATION_KEYWORDS = (
    "pixar", "cartoon", "animation", "animated", "anime", "claymation",
    "stop motion", "stop-motion", "3d animated", "cgi animation", "hoạt hình",
    "disney", "dreamworks", "cel shaded", "cel-shaded", "toon",
)
ANIMATION_EXTRA_NEGATIVE = (
    "human, person, people, realistic human, real person, man, woman, boy, girl, "
    "photorealistic face, live action"
)

# interp = RIFE frame multiplier (1 = off). 8fps x 3 = 24fps cinematic output.
MODE_PRESETS: dict[str, dict[str, Any]] = {
    # test: enough steps/interp for visual quality evaluation; not for production
    "test": {"width": 512, "height": 320, "duration": 2, "fps": 8, "steps": 8, "prompt_enhance": False, "interp": 3},
    "standard": {"width": 512, "height": 320, "duration": 3, "fps": 8, "steps": 12, "prompt_enhance": False, "interp": 3},
    # quality envelope proven on RTX 3090: 768x512 @ 8fps native, then RIFE x3 ->
    # 24fps in post. Steps raised 20->26 for sharper in-motion facial detail.
    # Single-shot keeps 5s; the sequence controller uses 3s shots (see its
    # --shot-duration-seconds default) to limit per-shot keyframe drift, which is
    # what softens/morphs faces late in a long single-anchor shot.
    "quality": {"width": 768, "height": 512, "duration": 5, "fps": 8, "steps": 26, "prompt_enhance": False, "interp": 3},
}


def frame_count(duration: int, fps: int) -> int:
    # LTXVImgToVideo length uses step=8 and minimum=9. Keep length as 8n+1.
    target = max(9, int(duration) * int(fps) + 1)
    return ((target - 1 + 7) // 8) * 8 + 1


def bool_arg(value: str | bool | None) -> bool:
    if isinstance(value, bool):
        return value
    if value is None:
        return False
    return str(value).strip().lower() in {"1", "true", "yes", "y", "on"}


def is_animation_prompt(text: str) -> bool:
    low = (text or "").lower()
    return any(kw in low for kw in ANIMATION_KEYWORDS)


def resolve_animation(mode: str, prompt: str) -> bool:
    """mode is on/off/auto; auto detects animation keywords in the prompt."""
    if mode == "on":
        return True
    if mode == "off":
        return False
    return is_animation_prompt(prompt)


def validate_image_path(raw_path: str) -> Path:
    path = Path(raw_path).expanduser()
    if not path.exists() or not path.is_file():
        raise PipelineError(f"input image not found: {path}")
    if path.suffix.lower() not in IMAGE_EXTENSIONS:
        raise PipelineError(f"input image must be one of {sorted(IMAGE_EXTENSIONS)}: {path}")
    return path.resolve()


def run_keyframe_generator(args: argparse.Namespace, env: dict[str, str], base: str, timeout_seconds: int) -> str:
    script = Path(cfg(env, "MEDIA_KEYFRAME_SCRIPT", DEFAULT_KEYFRAME_SCRIPT))
    if not script.exists():
        raise PipelineError(f"keyframe generator script not found: {script}")
    mode = "test" if args.mode == "test" else "quality"
    cmd = [
        sys.executable,
        str(script),
        "--prompt",
        args.prompt,
        "--mode",
        mode,
        "--style-preset",
        # animation=True means Pixar/cartoon/3D-animated content — always use
        # Flux (style-preset=default) regardless of args.style. style=anime
        # would otherwise trigger animagine which generates 2D anime characters
        # (e.g. samurai) even for a bear-cub-in-forest prompt.
        "default" if getattr(args, "animation", False) else ("anime_action" if args.style == "anime" else "default"),
        "--keyframe-engine",
        args.keyframe_engine,
        "--keyframe-only",
    ]
    use_animagine_path = args.style == "anime" and not getattr(args, "animation", False)
    if use_animagine_path:
        cmd.extend(["--keyframe-frame-mode", "single_scene"])
    else:
        # Render the realistic keyframe larger than the LTX output (AR-matched
        # 1.5) so faces get ~2x the pixels and stay sharp after downscale; bump
        # Flux steps for finer facial detail. Anime/animagine keeps its own path.
        cmd.extend([
            "--keyframe-width", str(KEYFRAME_WIDTH),
            "--keyframe-height", str(KEYFRAME_HEIGHT),
            "--flux-steps", str(KEYFRAME_FLUX_STEPS),
        ])
    if getattr(args, "keyframe_seed", None) is not None:
        cmd.extend(["--seed", str(args.keyframe_seed)])
    # FLUX.1-Redux reference: condition this shot's fresh keyframe on the approved
    # keyframe so the character/style stays consistent across shots.
    if getattr(args, "redux_reference", "") and not use_animagine_path:
        cmd.extend(["--redux-reference", args.redux_reference])
    if Path(args.env_file).exists():
        cmd.extend(["--env-file", args.env_file])
    proc = subprocess.run(
        cmd,
        cwd=str(script.parent),
        text=True,
        capture_output=True,
        timeout=timeout_seconds,
        check=False,
    )
    payload: dict[str, Any] | None = None
    for raw in (proc.stdout, proc.stderr):
        text = raw.strip()
        if not text:
            continue
        try:
            parsed = json.loads(text)
        except json.JSONDecodeError:
            continue
        if isinstance(parsed, dict):
            payload = parsed
            break
    if proc.returncode != 0 or not payload or payload.get("status") != "completed":
        detail = ""
        if payload and isinstance(payload.get("errors"), list):
            detail = "; ".join(str(item) for item in payload["errors"])
        detail = detail or proc.stderr[-1200:] or proc.stdout[-1200:]
        raise PipelineError(f"keyframe generation failed: {detail}")
    image_path = payload.get("image_path") or payload.get("start_keyframe_path")
    if not image_path:
        raise PipelineError(f"keyframe generation completed without image path: {payload}")
    return str(validate_image_path(str(image_path)))


def ensure_model_available(object_info: dict[str, Any], class_type: str, input_name: str, value: str) -> None:
    options = object_options(object_info, class_type, input_name)
    if not options:
        raise PipelineError(f"ComfyUI exposes no options for {class_type}.{input_name}")
    if value not in options:
        raise PipelineError(f"{class_type}.{input_name}={value!r} is not exposed by ComfyUI")


def validate_ltx_models(object_info: dict[str, Any], env: dict[str, str]) -> None:
    ensure_model_available(object_info, "CheckpointLoaderSimple", "ckpt_name", cfg(env, "LTX_CHECKPOINT_NAME", LTX_CHECKPOINT))
    ensure_model_available(object_info, "LTXAVTextEncoderLoader", "ckpt_name", cfg(env, "LTX_CHECKPOINT_NAME", LTX_CHECKPOINT))
    ensure_model_available(object_info, "LTXAVTextEncoderLoader", "text_encoder", cfg(env, "LTX_TEXT_ENCODER_NAME", LTX_TEXT_ENCODER))
    ensure_model_available(object_info, "LoraLoader", "lora_name", cfg(env, "LTX_DISTILLED_LORA_NAME", LTX_DISTILLED_LORA))
    ensure_model_available(object_info, "LoraLoader", "lora_name", cfg(env, "LTX_GEMMA_LORA_NAME", LTX_GEMMA_LORA))


def patch_ltx_workflow(
    workflow: dict[str, Any],
    image_name: str,
    prompt: str,
    negative_prompt: str,
    width: int,
    height: int,
    frames: int,
    fps: int,
    steps: int,
    seed: int,
    filename_prefix: str,
    env: dict[str, str],
    interp_multiplier: int = 1,
    face_restore: bool = False,
    anime_upscale: bool = False,
) -> dict[str, Any]:
    patched = copy.deepcopy(workflow)
    checkpoint = cfg(env, "LTX_CHECKPOINT_NAME", LTX_CHECKPOINT)
    set_node_input(patched, "CheckpointLoaderSimple", "ckpt_name", checkpoint)
    set_node_input(patched, "LTXAVTextEncoderLoader", "ckpt_name", checkpoint)
    set_node_input(patched, "LTXAVTextEncoderLoader", "text_encoder", cfg(env, "LTX_TEXT_ENCODER_NAME", LTX_TEXT_ENCODER))
    set_node_input(patched, "LTXAVTextEncoderLoader", "device", cfg(env, "LTX_TEXT_ENCODER_DEVICE", "cpu"))
    set_node_input(patched, "LoraLoader", "lora_name", cfg(env, "LTX_DISTILLED_LORA_NAME", LTX_DISTILLED_LORA), 0)
    set_node_input(patched, "LoraLoader", "lora_name", cfg(env, "LTX_GEMMA_LORA_NAME", LTX_GEMMA_LORA), 1)
    set_node_input(patched, "CLIPTextEncode", "text", prompt, 0)
    set_node_input(patched, "CLIPTextEncode", "text", negative_prompt, 1)
    set_node_input(patched, "LTXVConditioning", "frame_rate", float(fps))
    if not set_node_input(patched, "LoadImage", "image", image_name):
        raise PipelineError("LTX workflow has no LoadImage node")
    set_node_input(patched, "LTXVImgToVideo", "width", width)
    set_node_input(patched, "LTXVImgToVideo", "height", height)
    set_node_input(patched, "LTXVImgToVideo", "length", frames)
    set_node_input(patched, "LTXVImgToVideo", "batch_size", 1)
    set_node_input(patched, "LTXVImgToVideo", "strength", float(cfg(env, "LTX_I2V_STRENGTH", "1.0")))
    set_node_input(patched, "ModelSamplingLTXV", "max_shift", float(cfg(env, "LTX_MAX_SHIFT", "2.05")))
    set_node_input(patched, "ModelSamplingLTXV", "base_shift", float(cfg(env, "LTX_BASE_SHIFT", "0.95")))
    set_node_input(patched, "KSampler", "seed", seed)
    set_node_input(patched, "KSampler", "steps", steps)
    set_node_input(patched, "KSampler", "cfg", float(cfg(env, "LTX_CFG", "1.0")))
    set_node_input(patched, "KSampler", "sampler_name", cfg(env, "LTX_SAMPLER_NAME", "euler"))
    set_node_input(patched, "KSampler", "scheduler", cfg(env, "LTX_SCHEDULER", "simple"))
    set_node_input(patched, "KSampler", "denoise", float(cfg(env, "LTX_DENOISE", "1.0")))
    set_node_input(patched, "VAEDecodeTiled", "tile_size", int(cfg(env, "LTX_VAE_TILE_SIZE", "512")))
    set_node_input(patched, "VAEDecodeTiled", "overlap", int(cfg(env, "LTX_VAE_OVERLAP", "64")))
    set_node_input(patched, "VAEDecodeTiled", "temporal_size", int(cfg(env, "LTX_VAE_TEMPORAL_SIZE", "32")))
    set_node_input(patched, "VAEDecodeTiled", "temporal_overlap", int(cfg(env, "LTX_VAE_TEMPORAL_OVERLAP", "8")))
    create_fps = float(fps)
    mult = int(interp_multiplier or 1)
    if mult > 1 or face_restore or anime_upscale:
        decode_id = next((nid for nid, _ in iter_nodes(patched, "VAEDecodeTiled")), None)
        create_id = next((nid for nid, _ in iter_nodes(patched, "CreateVideo")), None)
        if decode_id is None or create_id is None:
            raise PipelineError("LTX workflow missing VAEDecodeTiled/CreateVideo; cannot add post-decode nodes")
        # frames_source walks the post-decode chain: decode -> [anime upscale] ->
        # [face restore] -> [RIFE] -> CreateVideo. Each enabled stage consumes the
        # previous output.
        frames_source = decode_id
        if anime_upscale:
            # Anime detail restore: RealESRGAN AnimeVideo-v3 upscales 4x (re-drawing
            # sharp lines / un-blurring motion-softened anime faces), then scale back
            # to the target resolution so the sharpened detail is baked in without
            # changing the output size (LTX_ANIME_UPSCALE_FACTOR>1 keeps it larger).
            au_loader, au_up, au_scale = "anime_upscale_loader", "anime_upscale", "anime_downscale"
            patched[au_loader] = {
                "class_type": "UpscaleModelLoader",
                "inputs": {"model_name": cfg(env, "LTX_ANIME_UPSCALE_MODEL", DEFAULT_ANIME_UPSCALE_MODEL)},
            }
            patched[au_up] = {
                "class_type": "ImageUpscaleWithModel",
                "inputs": {"upscale_model": [au_loader, 0], "image": [frames_source, 0]},
            }
            back = float(cfg(env, "LTX_ANIME_UPSCALE_FACTOR", "1.0"))
            patched[au_scale] = {
                "class_type": "ImageScale",
                "inputs": {
                    "image": [au_up, 0],
                    "upscale_method": cfg(env, "LTX_ANIME_DOWNSCALE_METHOD", "bicubic"),
                    "width": int(width * back),
                    "height": int(height * back),
                    "crop": "disabled",
                },
            }
            frames_source = au_scale
        if face_restore:
            # Tier 2: per-frame CodeFormer face restoration (before RIFE so fewer
            # frames are processed and interpolation softens identity flicker).
            fr_loader_id, fr_id = "face_restore_loader", "face_restore"
            patched[fr_loader_id] = {
                "class_type": FACE_RESTORE_LOADER_CLASS,
                "inputs": {"model_name": cfg(env, "LTX_FACE_RESTORE_MODEL", DEFAULT_FACE_RESTORE_MODEL)},
            }
            patched[fr_id] = {
                "class_type": FACE_RESTORE_CLASS,
                "inputs": {
                    "facerestore_model": [fr_loader_id, 0],
                    "image": [frames_source, 0],
                    "facedetection": cfg(env, "LTX_FACE_DETECTION", DEFAULT_FACE_DETECTION),
                    "codeformer_fidelity": float(cfg(env, "LTX_FACE_FIDELITY", str(DEFAULT_FACE_FIDELITY))),
                },
            }
            frames_source = fr_id
        if mult > 1:
            loader_id, interp_id = "rife_loader", "rife_interp"
            patched[loader_id] = {
                "class_type": "FrameInterpolationModelLoader",
                "inputs": {"model_name": cfg(env, "LTX_INTERP_MODEL", DEFAULT_INTERP_MODEL)},
            }
            patched[interp_id] = {
                "class_type": "FrameInterpolate",
                "inputs": {"interp_model": [loader_id, 0], "images": [frames_source, 0], "multiplier": mult},
            }
            frames_source = interp_id
            create_fps = float(fps) * mult
        # Feed the final post-decode stage into CreateVideo.
        patched[create_id].setdefault("inputs", {})["images"] = [frames_source, 0]
    set_node_input(patched, "CreateVideo", "fps", create_fps)
    set_node_input(patched, "SaveVideo", "filename_prefix", filename_prefix)
    set_node_input(patched, "SaveVideo", "format", "mp4")
    set_node_input(patched, "SaveVideo", "codec", "h264")
    return patched


def resolve_settings(args: argparse.Namespace) -> dict[str, Any]:
    preset = dict(MODE_PRESETS[args.mode])
    for key in ("width", "height", "duration", "fps", "steps"):
        value = getattr(args, key)
        if value is not None:
            preset[key] = int(value)
    if args.prompt_enhance is not None:
        preset["prompt_enhance"] = bool_arg(args.prompt_enhance)
    preset["width"] = max(256, min(1280, int(preset["width"])))
    preset["height"] = max(256, min(720, int(preset["height"])))
    preset["duration"] = max(1, min(5, int(preset["duration"])))
    preset["fps"] = max(8, min(24, int(preset["fps"])))
    preset["steps"] = max(1, min(30, int(preset["steps"])))
    preset["frames"] = frame_count(preset["duration"], preset["fps"])
    interp = getattr(args, "interp_multiplier", None)
    if interp is None:
        interp = preset.get("interp", 1)
    preset["interp"] = max(1, min(8, int(interp)))
    preset["output_fps"] = preset["fps"] * preset["interp"]
    return preset


def eject_llm_vram(env: dict[str, str], comfy_url: str, http_timeout: int) -> list[str]:
    """Free the GPU of any resident LLM before rendering.

    The single 24GB RTX 3090 cannot hold the orchestrator LLM (LM Studio) and
    the LTX-2.3 22B render at the same time, so every loaded LM Studio model is
    unloaded here to reclaim VRAM. The gateway JIT-reloads its model on the next
    chat call once the render returns. Best-effort: a render must NEVER fail
    because the eject could not run. Controlled by env LTX_AUTO_EJECT_LLM (on by
    default); LM Studio location from LM_STUDIO_BASE_URL.
    """
    if not bool_arg(cfg(env, "LTX_AUTO_EJECT_LLM", "1")):
        return []
    base = cfg(env, "LM_STUDIO_BASE_URL", "http://host.docker.internal:1234")
    timeout = min(http_timeout, 15)
    ejected: list[str] = []
    try:
        info = http_json("GET", endpoint(base, "/api/v1/models"), timeout=min(http_timeout, 10))
    except Exception as exc:  # LM Studio down / unreachable -> nothing to eject
        print(f"[eject-llm] LM Studio query failed ({type(exc).__name__}); skipping eject", file=sys.stderr)
        info = None
    for model in (info.get("models", []) if isinstance(info, dict) else []):
        for inst in (model.get("loaded_instances") or []):
            iid = inst.get("id") if isinstance(inst, dict) else inst
            if not iid:
                continue
            try:
                http_json("POST", endpoint(base, "/api/v1/models/unload"), {"instance_id": iid}, timeout=timeout)
                ejected.append(iid)
            except Exception as exc:
                print(f"[eject-llm] failed to unload {iid} ({type(exc).__name__})", file=sys.stderr)
    # Also drop any models ComfyUI cached so the render starts on a clean GPU.
    try:
        http_json("POST", endpoint(comfy_url, "/free"), {"unload_models": True, "free_memory": True}, timeout=timeout)
    except Exception:
        pass
    if ejected:
        print(f"[eject-llm] freed VRAM by unloading {len(ejected)} LM Studio model(s): {', '.join(ejected)}", file=sys.stderr)
        time.sleep(2)  # let the driver reclaim VRAM before the keyframe load
    return ejected


def run(args: argparse.Namespace) -> dict[str, Any]:
    start_time = time.time()
    env = load_env_file(args.env_file)
    comfy_url = cfg(env, "COMFYUI_BASE_URL", "http://host.docker.internal:8188")
    poll_seconds = float(cfg(env, "MEDIA_POLL_SECONDS", "2"))
    timeout_seconds = int(args.timeout_seconds or cfg(env, "LTX_JOB_TIMEOUT_SECONDS", "1800"))
    http_timeout = int(cfg(env, "MEDIA_HTTP_TIMEOUT_SECONDS", "30"))
    empty_queue_timeout_seconds = int(cfg(env, "MEDIA_EMPTY_QUEUE_TIMEOUT_SECONDS", "120"))
    output_dir = args.output_dir or cfg(env, "MEDIA_OUTPUT_DIR", DEFAULT_VIDEO_DIR)
    image_dir = cfg(env, "MEDIA_IMAGE_OUTPUT_DIR", DEFAULT_IMAGE_DIR)
    workflow_path = args.workflow if args.workflow != DEFAULT_LTX_WORKFLOW else cfg(env, "LTX_I2V_WORKFLOW_PATH", DEFAULT_LTX_WORKFLOW)
    settings = resolve_settings(args)
    seed = args.seed if args.seed is not None else random.randint(0, 2**31 - 1)
    base = f"{slugify(args.prompt)}-{int(time.time())}-{uuid.uuid4().hex[:8]}"
    warnings: list[str] = []

    object_info = http_json("GET", endpoint(comfy_url, "/object_info"), timeout=http_timeout)
    workflow = load_workflow(workflow_path)
    node_errors = validate_workflow_node_classes(workflow, object_info, "ltx_2_3_i2v_api")
    if node_errors:
        raise PipelineError("; ".join(node_errors))
    validate_ltx_models(object_info, env)

    if args.validate_only:
        return {
            "status": "validated",
            "workflow": "ltx-2.3-i2v",
            "workflow_path": workflow_path,
            "settings": {
                "mode": args.mode,
                "width": settings["width"],
                "height": settings["height"],
                "duration": settings["duration"],
                "fps": settings["fps"],
                "frames": settings["frames"],
                "steps": settings["steps"],
                "prompt_enhance": settings["prompt_enhance"],
                "seed": seed,
            },
            "models": {
                "checkpoint": cfg(env, "LTX_CHECKPOINT_NAME", LTX_CHECKPOINT),
                "distilled_lora": cfg(env, "LTX_DISTILLED_LORA_NAME", LTX_DISTILLED_LORA),
                "gemma_lora": cfg(env, "LTX_GEMMA_LORA_NAME", LTX_GEMMA_LORA),
                "text_encoder": cfg(env, "LTX_TEXT_ENCODER_NAME", LTX_TEXT_ENCODER),
            },
            "warnings": warnings,
            "errors": [],
        }

    # Free the GPU of the orchestrator LLM before ANY GPU work (keyframe + LTX).
    # On the single 24GB 3090 a resident LM Studio model + LTX-22B = OOM, which
    # is exactly why the gateway render previously stalled with no video.
    ejected_models = eject_llm_vram(env, comfy_url, http_timeout)
    if ejected_models:
        warnings.append(f"ejected {len(ejected_models)} LM Studio model(s) from VRAM before render: {', '.join(ejected_models)}")

    if args.input_image:
        input_image = str(validate_image_path(args.input_image))
        keyframe_generated = False
    else:
        input_image = run_keyframe_generator(args, env, base, min(timeout_seconds, 1200))
        keyframe_generated = True
        warnings.append("input_image_path was omitted; generated a keyframe with the existing Hermes keyframe pipeline")
        # Unload the keyframe model (e.g. Flux) from VRAM before loading the
        # LTX-2.3 22B model. Otherwise both stay resident in ComfyUI and OOM the
        # RTX 3090 — this is the failure independent-mode sequences hit.
        try:
            http_json("POST", endpoint(comfy_url, "/free"), {"unload_models": True, "free_memory": True}, timeout=http_timeout)
            time.sleep(2)
        except Exception as exc:
            warnings.append(f"ComfyUI /free after keyframe failed (continuing): {exc}")

    upload_name = f"hermes_ltx_{base}{Path(input_image).suffix.lower()}"
    upload_result = upload_image(comfy_url, input_image, upload_name)
    image_name = str(upload_result.get("name") or upload_name)
    prompt = " ".join(args.prompt.strip().split())
    if not prompt:
        raise PipelineError("prompt is empty")
    negative = args.negative_prompt or cfg(env, "LTX_NEGATIVE_PROMPT", LTX_NEGATIVE_PROMPT)
    animation = resolve_animation(getattr(args, "animation", "auto"), prompt)
    if animation:
        # Fix 3: block human/realistic drift (a vague shot rendering real people).
        negative = f"{negative}, {ANIMATION_EXTRA_NEGATIVE}"
    # Fix 2: CodeFormer is for real human faces; never run it on animation.
    face_restore = bool_arg(cfg(env, "LTX_FACE_RESTORE", "0")) and not animation
    if animation:
        warnings.append("animation detected: CodeFormer face-restore disabled and human-blocking negatives added")
    # Anime detail restore replaces CodeFormer for animation content: only when the
    # RealESRGAN anime model is actually installed (auto-detected via object_info),
    # else fall back silently to no restore.
    anime_upscale = False
    if animation and bool_arg(cfg(env, "LTX_ANIME_UPSCALE", "1")):
        anime_model = cfg(env, "LTX_ANIME_UPSCALE_MODEL", DEFAULT_ANIME_UPSCALE_MODEL)
        if anime_model in object_options(object_info, "UpscaleModelLoader", "model_name"):
            anime_upscale = True
        else:
            warnings.append(f"anime upscaler '{anime_model}' not installed in ComfyUI (models/upscale_models) — skipping anime detail restore")
    patched = patch_ltx_workflow(
        workflow,
        image_name,
        prompt,
        negative,
        settings["width"],
        settings["height"],
        settings["frames"],
        settings["fps"],
        settings["steps"],
        seed,
        f"hermes_ltx/{base}",
        env,
        interp_multiplier=settings["interp"],
        face_restore=face_restore,
        anime_upscale=anime_upscale,
    )
    prompt_id = queue_comfy(comfy_url, patched, timeout=http_timeout)
    history = poll_comfy(comfy_url, prompt_id, poll_seconds, timeout_seconds, empty_queue_timeout_seconds)
    video_ref = find_output_ref(history, VIDEO_EXTENSIONS)
    video_path = download_comfy_file(comfy_url, video_ref, output_dir, base)
    return {
        "status": "completed",
        "workflow": "ltx-2.3-i2v",
        "video_path": video_path,
        "input_image_path": input_image,
        "keyframe_generated": keyframe_generated,
        "prompt": prompt,
        "negative_prompt": negative,
        "settings": {
            "mode": args.mode,
            "width": settings["width"],
            "height": settings["height"],
            "duration": settings["duration"],
            "fps": settings["fps"],
            "frames": settings["frames"],
            "steps": settings["steps"],
            "prompt_enhance": settings["prompt_enhance"],
            "interp_multiplier": settings["interp"],
            "output_fps": settings["output_fps"],
            "animation": animation,
            "face_restore": face_restore,
            "seed": seed,
        },
        "models": {
            "checkpoint": cfg(env, "LTX_CHECKPOINT_NAME", LTX_CHECKPOINT),
            "distilled_lora": cfg(env, "LTX_DISTILLED_LORA_NAME", LTX_DISTILLED_LORA),
            "gemma_lora": cfg(env, "LTX_GEMMA_LORA_NAME", LTX_GEMMA_LORA),
            "text_encoder": cfg(env, "LTX_TEXT_ENCODER_NAME", LTX_TEXT_ENCODER),
        },
        "comfyui": {"prompt_id": prompt_id, "output_ref": video_ref},
        "runtime_seconds": round(time.time() - start_time, 3),
        "warnings": warnings,
        "errors": [],
    }


def parse_args(argv: list[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Generate an LTX-2.3 I2V video via local ComfyUI")
    parser.add_argument("--prompt", required=True)
    parser.add_argument("--input-image", dest="input_image", default="")
    parser.add_argument("--redux-reference", dest="redux_reference", default="",
                        help="Approved keyframe passed to the keyframe generator as a FLUX.1-Redux reference so shots keep a consistent character/style. Only used when this shot generates its own keyframe (no --input-image).")
    parser.add_argument("--mode", choices=sorted(MODE_PRESETS), default="test")
    parser.add_argument("--style", choices=["realistic", "product", "travel", "social_ad", "anime"], default="realistic")
    parser.add_argument("--keyframe-engine", choices=["auto", "flux", "animagine"], default="auto")
    parser.add_argument("--width", type=int)
    parser.add_argument("--height", type=int)
    parser.add_argument("--duration", type=int)
    parser.add_argument("--fps", type=int)
    parser.add_argument("--steps", type=int)
    parser.add_argument("--interp-multiplier", dest="interp_multiplier", type=int, default=None,
                        help="RIFE frame interpolation multiplier (1=off). Multiplies decoded frames so 8fps motion plays smoothly (e.g. 3 -> 24fps). Defaults per mode preset.")
    parser.add_argument("--prompt-enhance", dest="prompt_enhance")
    parser.add_argument("--negative-prompt", default="")
    parser.add_argument("--timeout-seconds", type=int, default=1800)
    parser.add_argument("--output-dir", default=DEFAULT_VIDEO_DIR)
    parser.add_argument("--workflow", default=DEFAULT_LTX_WORKFLOW)
    parser.add_argument("--env-file", default=DEFAULT_ENV_FILE)
    parser.add_argument("--seed", type=int)
    parser.add_argument("--keyframe-seed", dest="keyframe_seed", type=int, help="Fixed seed for keyframe generation (used when no --input-image is given). Helps keep characters consistent across shots in a sequence.")
    parser.add_argument("--validate-only", action="store_true", help="Validate ComfyUI nodes/models/settings without queueing a render")
    parser.add_argument("--animation", choices=["auto", "on", "off"], default="auto",
                        help="Animation/cartoon mode. on/off force it; auto (default) detects animation keywords in the prompt. When on, CodeFormer face-restore is skipped (it is for real human faces) and human-blocking negatives are added to stop realistic people drifting into cartoon shots.")
    return parser.parse_args(argv)


def concise_error(exc: Exception) -> str:
    text = str(exc)
    if "Allocation on device" in text or "out of memory" in text.lower() or "torch.OutOfMemoryError" in text:
        return (
            "GPU OOM while running LTX-2.3. Use --width 512 --height 320 --duration 1 --fps 8 --steps 1 for smoke, "
            "or stop other GPU workloads such as LM Studio before retrying higher settings."
        )
    return f"{type(exc).__name__}: {text}"


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv or sys.argv[1:])
    try:
        payload = run(args)
        print(json.dumps(payload, ensure_ascii=False, indent=2))
        return 0
    except Exception as exc:
        payload = {
            "status": "error",
            "workflow": "ltx-2.3-i2v",
            "video_path": None,
            "warnings": [],
            "errors": [concise_error(exc)],
        }
        print(json.dumps(payload, ensure_ascii=False, indent=2), file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
