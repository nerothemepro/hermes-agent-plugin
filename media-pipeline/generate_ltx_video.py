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

LTX_CHECKPOINT = "ltx-2.3-22b-dev-fp8.safetensors"
LTX_DISTILLED_LORA = "ltx_2.3_22b_distilled_1.1_lora_dynamic_fro09_avg_rank_111_bf16.safetensors"
LTX_GEMMA_LORA = "gemma-3-12b-it-abliterated_lora_rank64_bf16.safetensors"
LTX_TEXT_ENCODER = "gemma_3_12B_it_fp4_mixed.safetensors"

LTX_NEGATIVE_PROMPT = (
    "text, watermark, logo, captions, subtitles, low quality, blurry, noisy, "
    "distorted motion, warped hands, deformed face, flicker, bad anatomy"
)

MODE_PRESETS: dict[str, dict[str, Any]] = {
    "test": {"width": 512, "height": 320, "duration": 1, "fps": 8, "steps": 1, "prompt_enhance": False},
    "standard": {"width": 512, "height": 320, "duration": 3, "fps": 8, "steps": 12, "prompt_enhance": False},
    # quality envelope proven on RTX 3090: 768x512, 41 frames (5s@8fps), 20 steps
    # completes in ~254s/shot with no OOM. Higher fps at 5s raises frame count and
    # VRAM, so quality stays at 8fps natively (smooth via post-interpolation later).
    "quality": {"width": 768, "height": 512, "duration": 5, "fps": 8, "steps": 20, "prompt_enhance": False},
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
        "anime_action" if args.style == "anime" else "default",
        "--keyframe-engine",
        args.keyframe_engine,
        "--keyframe-only",
    ]
    if args.style == "anime":
        cmd.extend(["--keyframe-frame-mode", "single_scene"])
    if getattr(args, "keyframe_seed", None) is not None:
        cmd.extend(["--seed", str(args.keyframe_seed)])
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
    set_node_input(patched, "CreateVideo", "fps", float(fps))
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
    return preset


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
    parser.add_argument("--mode", choices=sorted(MODE_PRESETS), default="test")
    parser.add_argument("--style", choices=["realistic", "product", "travel", "social_ad", "anime"], default="realistic")
    parser.add_argument("--keyframe-engine", choices=["auto", "flux", "animagine"], default="auto")
    parser.add_argument("--width", type=int)
    parser.add_argument("--height", type=int)
    parser.add_argument("--duration", type=int)
    parser.add_argument("--fps", type=int)
    parser.add_argument("--steps", type=int)
    parser.add_argument("--prompt-enhance", dest="prompt_enhance")
    parser.add_argument("--negative-prompt", default="")
    parser.add_argument("--timeout-seconds", type=int, default=1800)
    parser.add_argument("--output-dir", default=DEFAULT_VIDEO_DIR)
    parser.add_argument("--workflow", default=DEFAULT_LTX_WORKFLOW)
    parser.add_argument("--env-file", default=DEFAULT_ENV_FILE)
    parser.add_argument("--seed", type=int)
    parser.add_argument("--keyframe-seed", dest="keyframe_seed", type=int, help="Fixed seed for keyframe generation (used when no --input-image is given). Helps keep characters consistent across shots in a sequence.")
    parser.add_argument("--validate-only", action="store_true", help="Validate ComfyUI nodes/models/settings without queueing a render")
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
