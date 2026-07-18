#!/usr/bin/env python3
"""Hermes local media pipeline: multi-shot LTX-2.3 video sequence.

Phase 2 controller. Renders N short LTX-2.3 I2V shots by repeatedly invoking
``generate_ltx_video.py``, chains visual continuity by feeding each shot's tail
frame into the next shot as its start keyframe, then concatenates every shot
into a single long video with ffmpeg.

Design notes:
- Single-shot LTX logic is NOT duplicated here. Each shot is a subprocess call
  to the already-tested ``generate_ltx_video.py`` so the ComfyUI workflow,
  upload/poll/download, and OOM handling stay in one place.
- All shots share width/height/fps/codec so the final concat can use the fast
  ``-c copy`` demuxer; a filter_complex concat is the fallback.
- For a 60-75s target at ~5s/shot this means 12-15 sequential renders, so the
  default timeouts are generous.
"""

from __future__ import annotations

import argparse
import json
import math
import shlex
import shutil
import subprocess
import sys
import time
import uuid
from pathlib import Path
from typing import Any

from generate_video import cfg, endpoint, http_json, load_env_file, slugify
from generate_ltx_video import bool_arg, is_animation_prompt

PROJECT_DIR = Path("/workspace/projects/media-pipeline")
DEFAULT_ENV_FILE = "/opt/data/hermes/media-pipeline.env"
DEFAULT_VIDEO_DIR = "/opt/data/hermes/generated-videos"
DEFAULT_WORK_ROOT = "/opt/data/hermes/media-sequences"
SINGLE_SHOT_SCRIPT = str(PROJECT_DIR / "generate_ltx_video.py")
DEFAULT_LTX_WORKFLOW = str(PROJECT_DIR / "workflows/ltx_2_3_i2v_api.json")
DEFAULT_COMFY_URL = "http://host.docker.internal:8188"
# Seconds to let the GPU settle after freeing models between shots.
INTER_SHOT_COOLDOWN_SECONDS = 6

IMAGE_SUFFIXES = {".png", ".jpg", ".jpeg", ".webp"}
VIDEO_SUFFIXES = {".mp4", ".webm", ".mkv", ".mov"}


class SequenceError(Exception):
    pass


def eprint(message: str) -> None:
    print(message, file=sys.stderr, flush=True)


def free_comfy_vram(comfy_url: str) -> None:
    """Unload all ComfyUI models and free VRAM between shots.

    Without this, the previous shot's resident LTX-2.3 models stay in VRAM while
    the next shot generates its keyframe (Flux) and reloads LTX, which can push
    peak VRAM past the RTX 3090's 24GB and crash the shot (especially in quality
    mode). Best-effort: never fatal on its own.
    """
    try:
        http_json(
            "POST",
            endpoint(comfy_url, "/free"),
            {"unload_models": True, "free_memory": True},
            timeout=30,
        )
        time.sleep(INTER_SHOT_COOLDOWN_SECONDS)
    except Exception as exc:  # noqa: BLE001 - cooldown is best-effort
        eprint(f"[sequence] warning: inter-shot ComfyUI /free failed (continuing): {exc}")


def clamp_int(value: int, low: int, high: int) -> int:
    return max(low, min(high, int(value)))


def ffmpeg_exe() -> str:
    exe = shutil.which("ffmpeg")
    if not exe:
        raise SequenceError("ffmpeg not found on PATH")
    return exe


def run_command(cmd: list[str], timeout: int) -> subprocess.CompletedProcess[str]:
    return subprocess.run(cmd, cwd=str(PROJECT_DIR), text=True, capture_output=True, timeout=timeout, check=False)


def parse_pipeline_json(stdout: str, stderr: str) -> dict[str, Any]:
    decoder = json.JSONDecoder()
    for raw in (stdout, stderr):
        text = raw.strip()
        if not text:
            continue
        try:
            payload = json.loads(text)
            if isinstance(payload, dict):
                return payload
        except json.JSONDecodeError:
            pass
        for line in reversed(text.splitlines()):
            line = line.strip()
            if not line.startswith("{"):
                continue
            try:
                payload = json.loads(line)
            except json.JSONDecodeError:
                continue
            if isinstance(payload, dict):
                return payload
        for index, char in enumerate(text):
            if char != "{":
                continue
            try:
                payload, end = decoder.raw_decode(text[index:])
            except json.JSONDecodeError:
                continue
            if isinstance(payload, dict) and text[index + end:].strip() == "":
                return payload
    raise SequenceError(f"shot pipeline did not return JSON; stdout={stdout[-800:]!r}; stderr={stderr[-800:]!r}")


def extract_tail_frame(video_path: Path, output_path: Path, ffmpeg: str) -> Path:
    output_path.parent.mkdir(parents=True, exist_ok=True)
    cmd = [ffmpeg, "-y", "-sseof", "-0.15", "-i", str(video_path), "-frames:v", "1", "-q:v", "2", str(output_path)]
    proc = run_command(cmd, timeout=120)
    if proc.returncode != 0 or not output_path.exists() or output_path.stat().st_size <= 0:
        fallback = [ffmpeg, "-y", "-sseof", "-0.5", "-i", str(video_path), "-update", "1", "-frames:v", "1", "-q:v", "2", str(output_path)]
        proc = run_command(fallback, timeout=120)
    if proc.returncode != 0 or not output_path.exists() or output_path.stat().st_size <= 0:
        raise SequenceError(f"failed to extract tail frame from {video_path}: {proc.stderr[-1000:]}")
    return output_path.resolve()


def concat_videos(video_paths: list[Path], output_path: Path, work_dir: Path, ffmpeg: str) -> Path:
    output_path.parent.mkdir(parents=True, exist_ok=True)
    list_path = work_dir / "concat.txt"
    list_path.write_text("".join(f"file {shlex.quote(str(p))}\n" for p in video_paths), encoding="utf-8")
    cmd = [ffmpeg, "-y", "-f", "concat", "-safe", "0", "-i", str(list_path), "-c", "copy", "-movflags", "+faststart", str(output_path)]
    proc = run_command(cmd, timeout=600)
    if proc.returncode != 0 or not output_path.exists() or output_path.stat().st_size <= 0:
        # Fallback: re-encode through the concat filter (handles minor param drift).
        cmd = [ffmpeg, "-y"]
        inputs: list[str] = []
        for path in video_paths:
            cmd.extend(["-i", str(path)])
            inputs.append(f"[{len(inputs)}:v:0]")
        filter_complex = "".join(inputs) + f"concat=n={len(video_paths)}:v=1:a=0[v]"
        cmd.extend(["-filter_complex", filter_complex, "-map", "[v]", "-pix_fmt", "yuv420p", "-movflags", "+faststart", str(output_path)])
        proc = run_command(cmd, timeout=1800)
    if proc.returncode != 0 or not output_path.exists() or output_path.stat().st_size <= 0:
        raise SequenceError(f"failed to concatenate shots: {proc.stderr[-1400:]}")
    return output_path.resolve()


def load_shot_prompts(args: argparse.Namespace) -> list[str]:
    raw: Any = None
    if args.shots_file:
        path = Path(args.shots_file)
        if not path.exists():
            raise SequenceError(f"shots-file not found: {path}")
        raw = json.loads(path.read_text(encoding="utf-8"))
    elif args.shots:
        raw = json.loads(args.shots)
    if raw is not None:
        if not isinstance(raw, list) or not raw:
            raise SequenceError("shots must be a non-empty JSON array of prompt strings")
        prompts = [" ".join(str(item).strip().split()) for item in raw if str(item).strip()]
        if not prompts:
            raise SequenceError("shots contained no usable prompt strings")
        return prompts
    # No explicit storyboard: replicate the base prompt across the computed
    # number of shots. A light per-shot beat hint keeps consecutive shots from
    # feeling like one frozen loop, but explicit `shots` always gives better
    # narratives.
    base = " ".join(args.prompt.strip().split())
    if not base:
        raise SequenceError("prompt is empty and no shots were provided")
    total = clamp_int(args.total_duration_seconds, 6, 90)
    shot_dur = clamp_int(args.shot_duration_seconds, 1, 5)
    count = clamp_int(int(math.ceil(total / shot_dur)), 1, 20)
    beats = ["opening action", "rising action", "mid-fight exchange", "intense clash", "climactic strike", "final standoff"]
    prompts = []
    for i in range(count):
        beat = beats[min(i, len(beats) - 1)] if count > 1 else ""
        prompts.append(f"{base} Continuous shot {i + 1} of {count}, {beat}." if beat else base)
    return prompts


def render_shot(args: argparse.Namespace, prompt: str, index: int, total: int, input_image: str | None, seed: int) -> dict[str, Any]:
    shot_dur = clamp_int(args.shot_duration_seconds, 1, 5)
    # Anchor character/style identity: append the shared character note so every
    # shot's keyframe (and the LTX text conditioning) describes the same subjects.
    # This is what keeps independent per-shot keyframes from drifting apart.
    effective_prompt = prompt
    if args.character_note:
        note = " ".join(args.character_note.strip().split())
        if note:
            effective_prompt = f"{prompt} {note}"
    cmd = [
        sys.executable,
        SINGLE_SHOT_SCRIPT,
        "--prompt", effective_prompt,
        "--mode", args.mode,
        "--style", args.style,
        "--keyframe-engine", args.keyframe_engine,
        "--duration", str(shot_dur),
        "--seed", str(seed),
        "--output-dir", args.output_dir,
        "--workflow", args.workflow,
        "--env-file", args.env_file,
        "--timeout-seconds", str(args.per_shot_timeout_seconds),
    ]
    for cli_name, value in (("--width", args.width), ("--height", args.height), ("--fps", args.fps), ("--steps", args.steps), ("--interp-multiplier", args.interp_multiplier)):
        if value is not None:
            cmd.extend([cli_name, str(value)])
    # Decide animation mode ONCE from the overall sequence prompt and force the
    # same on/off on every shot, so a vaguely-worded middle shot can't silently
    # flip to realistic humans / re-enable CodeFormer mid-sequence.
    anim_mode = getattr(args, "animation", "auto")
    if anim_mode == "auto":
        anim_mode = "on" if is_animation_prompt(args.prompt) else "off"
    cmd.extend(["--animation", anim_mode])
    # A fixed keyframe seed keeps the auto-generated keyframes visually
    # consistent across independent shots.
    if input_image is None and args.keyframe_seed is not None:
        cmd.extend(["--keyframe-seed", str(args.keyframe_seed)])
    if input_image:
        cmd.extend(["--input-image", input_image])
    elif args.input_image:
        # This shot generates its own keyframe: condition it on the approved
        # sequence keyframe via FLUX.1-Redux so the character stays consistent.
        cmd.extend(["--redux-reference", args.input_image])
    proc = subprocess.run(cmd, cwd=str(PROJECT_DIR), text=True, capture_output=True, timeout=args.per_shot_timeout_seconds, check=False)
    payload = parse_pipeline_json(proc.stdout, proc.stderr)
    if proc.returncode != 0 or payload.get("status") != "completed":
        errors = payload.get("errors") if isinstance(payload.get("errors"), list) else []
        detail = "; ".join(str(e) for e in errors) or proc.stderr[-1200:] or proc.stdout[-1200:]
        raise SequenceError(f"shot {index + 1}/{total} failed: {detail}")
    video_path = payload.get("video_path")
    if not video_path or not Path(video_path).exists():
        raise SequenceError(f"shot {index + 1}/{total} reported success but produced no video file")
    return payload


def run(args: argparse.Namespace) -> dict[str, Any]:
    start_time = time.time()
    env = load_env_file(args.env_file)
    args.output_dir = args.output_dir or cfg(env, "MEDIA_OUTPUT_DIR", DEFAULT_VIDEO_DIR)
    ffmpeg = ffmpeg_exe()
    shot_prompts = load_shot_prompts(args)
    shot_count = len(shot_prompts)
    base = f"{slugify(args.prompt)}-{int(time.time())}-{uuid.uuid4().hex[:8]}"
    work_dir = Path(cfg(env, "MEDIA_SEQUENCE_WORK_ROOT", DEFAULT_WORK_ROOT)) / base
    work_dir.mkdir(parents=True, exist_ok=True)
    base_seed = args.seed if args.seed is not None else int(time.time()) % (2**31 - 1)
    warnings: list[str] = []

    if args.validate_only:
        return {
            "status": "validated",
            "workflow": "ltx-2.3-sequence",
            "shot_count": shot_count,
            "shot_prompts": shot_prompts,
            "settings": {
                "mode": args.mode,
                "style": args.style,
                "continuity": args.continuity,
                "shot_duration_seconds": clamp_int(args.shot_duration_seconds, 1, 5),
                "estimated_total_seconds": clamp_int(args.shot_duration_seconds, 1, 5) * shot_count,
                "width": args.width,
                "height": args.height,
                "fps": args.fps,
                "steps": args.steps,
                "seed": base_seed,
            },
            "warnings": warnings,
            "errors": [],
        }

    comfy_url = cfg(env, "COMFYUI_BASE_URL", DEFAULT_COMFY_URL)

    shots: list[dict[str, Any]] = []
    video_paths: list[Path] = []
    next_input = args.input_image or None
    for index, prompt in enumerate(shot_prompts):
        if args.continuity == "independent":
            shot_input = args.input_image if index == 0 else None
            # Redux-first-shot: shot 1 also GENERATES its keyframe (Redux-
            # conditioned on the approved image) instead of starting verbatim
            # from it, so every shot belongs to the same Redux family and shot 1
            # stops being a lighting/framing outlier. Opt-in: the default HerVid
            # contract is that the video starts from the exact approved image.
            if index == 0 and args.input_image and (args.redux_first_shot or bool_arg(cfg(env, "LTX_REDUX_FIRST_SHOT", "0"))):
                shot_input = None
        else:
            shot_input = next_input
        seed = base_seed + index
        # Clear the previous shot's resident models from VRAM before this shot
        # generates its keyframe and reloads LTX. Prevents cross-shot VRAM
        # carryover that crashes later shots (notably in quality mode).
        if index > 0:
            free_comfy_vram(comfy_url)
        try:
            payload = render_shot(args, prompt, index, shot_count, shot_input, seed)
        except SequenceError as exc:
            # A shot can fail transiently (GPU left in a bad state by the prior
            # shot). Free VRAM and retry the shot once before giving up.
            eprint(f"[sequence] shot {index + 1}/{shot_count} failed, retrying once: {exc}")
            free_comfy_vram(comfy_url)
            payload = render_shot(args, prompt, index, shot_count, shot_input, seed)
        video_path = Path(payload["video_path"]).resolve()
        video_paths.append(video_path)
        shots.append({
            "index": index + 1,
            "prompt": prompt,
            "input_image_path": payload.get("input_image_path"),
            "video_path": str(video_path),
            "keyframe_generated": payload.get("keyframe_generated"),
            "settings": payload.get("settings"),
            "seed": seed,
        })
        eprint(f"[sequence] shot {index + 1}/{shot_count} done: {video_path.name}")
        if args.continuity == "last_frame" and index < shot_count - 1:
            tail = work_dir / f"shot-{index + 1:02d}-tail.png"
            next_input = str(extract_tail_frame(video_path, tail, ffmpeg))

    final_path = Path(args.output_dir) / f"{base}-final.mp4"
    concat_videos(video_paths, final_path, work_dir, ffmpeg)

    manifest_path = Path(args.output_dir) / f"{base}-manifest.json"
    manifest = {
        "status": "completed",
        "workflow": "ltx-2.3-sequence",
        "final_video_path": str(final_path),
        "shot_count": shot_count,
        "continuity": args.continuity,
        "shots": shots,
        "base_seed": base_seed,
    }
    manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")

    if not args.keep_work:
        shutil.rmtree(work_dir, ignore_errors=True)

    return {
        "status": "completed",
        "workflow": "ltx-2.3-sequence",
        "final_video_path": str(final_path),
        "manifest_path": str(manifest_path),
        "shot_count": shot_count,
        "continuity": args.continuity,
        "shots": shots,
        "settings": {
            "mode": args.mode,
            "style": args.style,
            "shot_duration_seconds": clamp_int(args.shot_duration_seconds, 1, 5),
            "base_seed": base_seed,
        },
        "runtime_seconds": round(time.time() - start_time, 3),
        "warnings": warnings,
        "errors": [],
    }


def parse_args(argv: list[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Generate a multi-shot LTX-2.3 video sequence via local ComfyUI")
    parser.add_argument("--prompt", required=True)
    parser.add_argument("--shots", default="", help="Inline JSON array of per-shot prompt strings")
    parser.add_argument("--shots-file", dest="shots_file", default="", help="Path to JSON file with an array of per-shot prompt strings")
    parser.add_argument("--total-duration-seconds", dest="total_duration_seconds", type=int, default=60)
    # 3s default: shorter shots limit per-shot keyframe drift (faces stay sharp;
    # a single-anchor I2V shot softens/morphs the face late in a long 5s take).
    parser.add_argument("--shot-duration-seconds", dest="shot_duration_seconds", type=int, default=3)
    parser.add_argument("--mode", choices=["test", "standard", "quality"], default="standard")
    parser.add_argument("--style", choices=["realistic", "product", "travel", "social_ad", "anime"], default="realistic")
    parser.add_argument("--keyframe-engine", dest="keyframe_engine", choices=["auto", "flux", "animagine"], default="auto")
    parser.add_argument("--continuity", choices=["last_frame", "independent"], default="independent",
                        help="independent (default) generates a fresh keyframe per shot to avoid cumulative drift over long sequences; last_frame chains each shot from the previous tail frame (smoother but drifts).")
    parser.add_argument("--character-note", dest="character_note", default="",
                        help="Shared character/style description appended to every shot prompt so independent shots keep the same subjects (e.g. 'the same two original anime samurai, one in black robe, one in red robe, consistent faces, cinematic anime style').")
    parser.add_argument("--keyframe-seed", dest="keyframe_seed", type=int, default=None,
                        help="Fixed seed for per-shot keyframe generation, for extra cross-shot consistency.")
    parser.add_argument("--animation", choices=["auto", "on", "off"], default="auto",
                        help="Animation/cartoon mode applied uniformly to every shot. auto (default) detects animation keywords in the overall prompt. When on, CodeFormer face-restore is skipped and human-blocking negatives are added on each shot.")
    parser.add_argument("--input-image", dest="input_image", default="")
    parser.add_argument("--redux-first-shot", dest="redux_first_shot", action="store_true",
                        help="Shot 1 also generates its keyframe Redux-conditioned on --input-image (instead of starting verbatim from it), so shot 1 matches shots 2+ visually. Env: LTX_REDUX_FIRST_SHOT=1.")
    parser.add_argument("--width", type=int)
    parser.add_argument("--height", type=int)
    parser.add_argument("--fps", type=int)
    parser.add_argument("--steps", type=int)
    parser.add_argument("--interp-multiplier", dest="interp_multiplier", type=int, default=None,
                        help="RIFE frame interpolation multiplier passed to each shot (1=off). Defaults per mode preset (quality -> x3 = 24fps).")
    parser.add_argument("--seed", type=int)
    parser.add_argument("--per-shot-timeout-seconds", dest="per_shot_timeout_seconds", type=int, default=1200)
    parser.add_argument("--output-dir", dest="output_dir", default=DEFAULT_VIDEO_DIR)
    parser.add_argument("--workflow", default=DEFAULT_LTX_WORKFLOW)
    parser.add_argument("--env-file", dest="env_file", default=DEFAULT_ENV_FILE)
    parser.add_argument("--keep-work", dest="keep_work", action="store_true", help="Keep the per-sequence work directory (tail frames, concat list)")
    parser.add_argument("--validate-only", dest="validate_only", action="store_true", help="Plan shots and validate inputs without rendering")
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv or sys.argv[1:])
    try:
        payload = run(args)
        print(json.dumps(payload, ensure_ascii=False, indent=2))
        return 0
    except Exception as exc:
        payload = {
            "status": "error",
            "workflow": "ltx-2.3-sequence",
            "final_video_path": None,
            "warnings": [],
            "errors": [f"{type(exc).__name__}: {exc}"],
        }
        # Emit the error payload on stdout (like the success path) so the caller
        # parses a clean JSON object. stderr carries the human progress log and
        # would otherwise be mixed with non-JSON lines.
        print(json.dumps(payload, ensure_ascii=False, indent=2))
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
