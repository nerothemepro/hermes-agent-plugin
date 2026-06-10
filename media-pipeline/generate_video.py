#!/usr/bin/env python3
"""Hermes local media pipeline: Flux keyframe + ComfyUI Wan2.1 I2V."""

from __future__ import annotations

import argparse
import copy
import json
import mimetypes
import os
import random
import re
import struct
import sys
import time
import uuid
import zlib
from http.client import RemoteDisconnected
from pathlib import Path
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import Request, urlopen

TRANSIENT_HTTP_ERRORS = (URLError, RemoteDisconnected, TimeoutError, ConnectionResetError, ConnectionAbortedError)


def error_reason(exc: BaseException) -> str:
    return str(getattr(exc, "reason", exc))


PROJECT_DIR = Path("/workspace/projects/media-pipeline")
DEFAULT_ENV_FILE = "/opt/data/hermes/media-pipeline.env"
DEFAULT_FLUX_WORKFLOW = str(PROJECT_DIR / "workflows/flux_keyframe_api.json")
DEFAULT_ANIMAGINE_WORKFLOW = str(PROJECT_DIR / "workflows/animagine_keyframe_api.json")
DEFAULT_WAN_WORKFLOW = str(PROJECT_DIR / "workflows/wan_i2v_api.json")
DEFAULT_WAN_FLF_WORKFLOW = str(PROJECT_DIR / "workflows/wan_flf2v_api.json")
DEFAULT_IMAGE_DIR = "/opt/data/hermes/generated-images"
DEFAULT_VIDEO_DIR = "/opt/data/hermes/generated-videos"
ANIMAGINE_CHECKPOINT = "animagine-xl-3.1.safetensors"
ANIMAGINE_TAG_PREFIX = (
    "masterpiece, best quality, very aesthetic, absurdres, safe, newest, "
    "2boys, original characters, samurai, katana, moonlit bamboo forest, "
    "cinematic anime action, clean cel shading, sharp lineart"
)
IMAGE_EXTENSIONS = {".png", ".jpg", ".jpeg", ".webp"}
VIDEO_EXTENSIONS = {".mp4", ".webm", ".mov", ".mkv"}
ANIME_ACTION_STYLE_PROMPT = (
    "original Japanese shonen anime action, Japanese 2D anime action frame, clean line art, "
    "cel shading, sakuga-style motion cues, sharp silhouette, readable sword pose, "
    "dramatic compositing, elemental water and fire trails, expressive anime faces, "
    "dynamic katana choreography, high contrast moonlit atmosphere, no copyrighted characters, "
    "no text, no watermark"
)
ANIME_ACTION_KEYFRAME_V2_PROMPT = (
    "anime keyframe design sheet quality, strong pose silhouette, clear foreground midground background, "
    "visible katana geometry, readable hands and face, clean cel-shaded line art, crisp ink contours, "
    "controlled elemental trail placement, dramatic but uncluttered composition, no text, no watermark"
)
ANIME_ACTION_DEFAULT_CHARACTER_NOTE = (
    "Fighter A: black hair, deep indigo robe, white sash, water-blue katana trail. "
    "Fighter B: white hair, charcoal robe, red scarf, fire-red katana trail. "
    "Only these two original adult anime swordfighters appear in every shot. "
    "Same faces, robes, katanas, colors across all shots. No logos."
)
ANIME_COMPOSITION_PROMPTS = {
    "establishing": "wide establishing composition, both fighters fully visible, moonlit bamboo background separated from foreground leaves, clear two-character spacing",
    "closeup": "tight close-up composition, expressive anime eyes or hand on katana hilt in the foreground, readable blade edge, background simplified",
    "action": "dynamic action composition, full-body readable sword pose, diagonal motion path, stable character spacing, sharp silhouette against the background",
    "impact": "cinematic impact composition, blade contact point centered, sparks and water fire arcs placed around silhouettes, readable crossed swords, high contrast hold",
    "auto": "balanced anime action composition with readable pose, clean foreground, separated background, and stable character placement",
}
ANIME_ACTION_VIDEO_PROMPT = (
    "smooth anime action video, coherent 2D character motion, readable sword choreography, "
    "strong pose-to-pose transition, dynamic camera movement, stable character designs, "
    "sharp faces and swords, no cuts, no subtitles"
)
ANIME_ACTION_NEGATIVE_PROMPT = (
    "text, watermark, logo, captions, subtitles, blurry, low quality, distorted anatomy, "
    "melted sword, extra limbs, gore, copied copyrighted character, "
    "3d render"
)
ANIMAGINE_ACTION_NEGATIVE_PROMPT = (
    "nsfw, lowres, bad anatomy, bad hands, extra fingers, missing fingers, "
    "extra limbs, deformed sword, melted sword, blurry, text, watermark, "
    "logo, signature, jpeg artifacts, worst quality, low quality, 3d render"
)
ANIMAGINE_SINGLE_SCENE_FRAME_PROMPT = (
    "single uninterrupted full-frame anime film still, one continuous scene, "
    "one unified camera shot, continuous moonlit bamboo forest background, "
    "cinematic 16:9 composition, two fighters in one shared physical space, "
    "readable full-body action pose, visible hands, clear katana geometry, "
    "controlled effects"
)
ANIMAGINE_SINGLE_SCENE_RETRY_PROMPT = (
    "seamless single-canvas anime film still, uninterrupted continuous background from edge to edge, "
    "shared ground plane, shared vanishing point, unified lighting across both fighters, "
    "full-width cinematic composition, centered action flow, clear silhouettes in one physical space"
)
ANIMAGINE_SINGLE_SCENE_NEGATIVE_PROMPT = (
    "(manga panel:1.4), (comic panel:1.4), (split screen:1.4), "
    "(collage:1.4), (panel border:1.4), (multi-view layout:1.3), "
    "(multiple panels:1.4), (black border:1.3), character sheet, design sheet, "
    "poster layout, montage, abstract slash lines, unreadable body, hidden hands, "
    "hidden sword, duplicated character, extra face, extra eyes"
)
ANIMAGINE_SINGLE_SCENE_RETRY_NEGATIVE_PROMPT = (
    "(manga panel:1.7), (comic panel:1.7), (split screen:1.7), "
    "(collage:1.7), (panel border:1.7), (black border:1.6), "
    "(frame border:1.6), (multi-view layout:1.6), (multiple panels:1.7), "
    "(poster layout:1.5), (character sheet:1.5), (two-panel composition:1.7), (vertical gutter:1.7), (divider line:1.6)"
)


class PipelineError(RuntimeError):
    pass


def load_env_file(path: str) -> dict[str, str]:
    env_path = Path(path)
    if not env_path.exists():
        return {}
    result: dict[str, str] = {}
    for raw_line in env_path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#"):
            continue
        if line.startswith("export "):
            line = line[len("export ") :].strip()
        if "=" not in line:
            continue
        key, value = line.split("=", 1)
        result[key.strip()] = value.strip().strip('"').strip("'")
    return result


def cfg(env: dict[str, str], key: str, default: str) -> str:
    return os.environ.get(key) or env.get(key) or default


def endpoint(base_url: str, path: str) -> str:
    return base_url.rstrip("/") + "/" + path.lstrip("/")


def http_json(method: str, url: str, payload: dict[str, Any] | None = None, timeout: int = 30) -> dict[str, Any]:
    data = None
    headers = {"Accept": "application/json"}
    if payload is not None:
        data = json.dumps(payload).encode("utf-8")
        headers["Content-Type"] = "application/json"

    last_error: BaseException | None = None
    for attempt in range(6):
        request = Request(url, data=data, headers=headers, method=method)
        try:
            with urlopen(request, timeout=timeout) as response:
                body = response.read()
            break
        except HTTPError as exc:
            detail = exc.read().decode("utf-8", errors="replace")
            raise PipelineError(f"HTTP {exc.code} from {url}: {detail}") from exc
        except TRANSIENT_HTTP_ERRORS as exc:
            last_error = exc
            if attempt == 5:
                raise PipelineError(f"Cannot reach {url} after retries: {error_reason(exc)}") from exc
            time.sleep(min(2 + attempt * 2, 12))
    else:
        reason = error_reason(last_error) if last_error else "unknown error"
        raise PipelineError(f"Cannot reach {url}: {reason}")

    if not body:
        return {}
    try:
        return json.loads(body.decode("utf-8"))
    except json.JSONDecodeError as exc:
        raise PipelineError(f"Expected JSON from {url}, got {body[:120]!r}") from exc

def http_bytes(url: str, timeout: int = 300) -> tuple[bytes, str]:
    last_error: BaseException | None = None
    for attempt in range(6):
        request = Request(url, headers={"Accept": "*/*"}, method="GET")
        try:
            with urlopen(request, timeout=timeout) as response:
                return response.read(), response.headers.get("Content-Type", "")
        except HTTPError as exc:
            detail = exc.read().decode("utf-8", errors="replace")
            raise PipelineError(f"HTTP {exc.code} from {url}: {detail}") from exc
        except TRANSIENT_HTTP_ERRORS as exc:
            last_error = exc
            if attempt == 5:
                raise PipelineError(f"Cannot reach {url} after retries: {error_reason(exc)}") from exc
            time.sleep(min(2 + attempt * 2, 12))
    reason = error_reason(last_error) if last_error else "unknown error"
    raise PipelineError(f"Cannot reach {url}: {reason}")

def slugify(text: str, limit: int = 52) -> str:
    text = re.sub(r"[^a-z0-9]+", "-", text.lower()).strip("-")
    return (text or "video")[:limit].strip("-") or "video"


def prompt_to_english(
    prompt: str,
    style_preset: str = "default",
    keyframe_quality_preset: str = "flux_default",
    composition_profile: str = "auto",
    shot_prompt_strength: str = "balanced",
    character_consistency_note: str = "",
) -> str:
    clean = " ".join(prompt.strip().split())
    if not clean:
        raise PipelineError("Prompt is empty")
    if style_preset == "anime_action":
        parts = [clean, ANIME_ACTION_STYLE_PROMPT]
        if keyframe_quality_preset == "anime_action_v2":
            profile = composition_profile if composition_profile in ANIME_COMPOSITION_PROMPTS else "auto"
            parts.append(ANIME_ACTION_KEYFRAME_V2_PROMPT)
            parts.append(ANIME_COMPOSITION_PROMPTS[profile])
            if shot_prompt_strength == "strong":
                parts.append("extra strict pose readability, no ambiguous limbs, no tangled swords, no crowded effects")
            elif shot_prompt_strength == "light":
                parts.append("restrained effects, simple readable pose")
            else:
                parts.append("balanced action detail, pose clarity prioritized over dense effects")
            if character_consistency_note.strip():
                parts.append("character consistency: " + " ".join(character_consistency_note.strip().split()))
        return ", ".join(parts)
    lowered = clean.lower()
    replacements = {
        "một": "a", "mot": "a", "chú": "", "chu": "",
        "đại bàng": "eagle", "dai bang": "eagle",
        "lao xuống": "diving down toward", "lao xuong": "diving down toward",
        "mặt hồ": "lake surface", "mat ho": "lake surface",
        "bắt cá": "catching a fish", "bat ca": "catching a fish",
        "con cá": "fish", "rừng": "forest", "biển": "ocean", "núi": "mountain",
        "thành phố": "city", "mưa": "rain", "đêm": "night",
        "bình minh": "sunrise", "hoàng hôn": "sunset",
    }
    scene = lowered
    for source, target in sorted(replacements.items(), key=lambda item: -len(item[0])):
        scene = re.sub(r"(?<!\w)" + re.escape(source) + r"(?!\w)", target, scene)
    scene = re.sub(r"\s+", " ", scene).strip(" ,")
    scene = re.sub(r"\ba eagle\b", "an eagle", scene)
    if any(ord(ch) > 127 for ch in clean) and scene == lowered:
        scene = f"a cinematic interpretation of this Vietnamese scene: {clean}"
    return (
        f"{scene}, cinematic keyframe, photorealistic, dynamic composition, "
        "dramatic natural lighting, sharp subject, detailed environment, 35mm lens, "
        "high quality, no text, no watermark"
    )


def prompt_to_video_prompt(image_prompt: str) -> str:
    return (
        f"{image_prompt}, smooth short video, coherent subject motion, natural camera "
        "movement, realistic physics, stable temporal consistency, no cuts, no subtitles"
    )


def prompt_to_video_prompt_for_style(image_prompt: str, style_preset: str) -> str:
    if style_preset == "anime_action":
        return f"{image_prompt}, {ANIME_ACTION_VIDEO_PROMPT}"
    return prompt_to_video_prompt(image_prompt)


def negative_prompt_for_style(env: dict[str, str], style_preset: str) -> str:
    if style_preset == "anime_action":
        return cfg(env, "ANIME_ACTION_NEGATIVE_PROMPT", ANIME_ACTION_NEGATIVE_PROMPT)
    return cfg(env, "NEGATIVE_PROMPT", "text, watermark, logo, blurry, low quality, distorted motion")


def note_has_concrete_visual_traits(note: str) -> bool:
    lowered = note.lower()
    trait_terms = (
        "hair",
        "robe",
        "sash",
        "scarf",
        "katana",
        "sword",
        "color",
        "blue",
        "red",
        "white",
        "black",
        "charcoal",
        "indigo",
        "fire",
        "water",
        "face",
    )
    return sum(1 for term in trait_terms if term in lowered) >= 3


def effective_character_consistency_note(user_note: str) -> str:
    note = " ".join((user_note or "").strip().split())
    if not note:
        return ANIME_ACTION_DEFAULT_CHARACTER_NOTE
    if len(note) < 80 or not note_has_concrete_visual_traits(note):
        return f"{note} {ANIME_ACTION_DEFAULT_CHARACTER_NOTE}"
    return note


def resolve_keyframe_frame_mode(requested_mode: str, style_preset: str, keyframe_engine: str) -> str:
    requested = str(requested_mode or "").strip().lower()
    if requested in {"single_scene", "stylized_panel"}:
        return requested
    if style_preset == "anime_action" and keyframe_engine == "animagine":
        return "single_scene"
    return "stylized_panel"


def animagine_negative_prompt_for_mode(env: dict[str, str], frame_mode: str) -> str:
    base = cfg(env, "ANIMAGINE_ACTION_NEGATIVE_PROMPT", ANIMAGINE_ACTION_NEGATIVE_PROMPT)
    if frame_mode == "single_scene":
        extra = cfg(env, "ANIMAGINE_SINGLE_SCENE_NEGATIVE_PROMPT", ANIMAGINE_SINGLE_SCENE_NEGATIVE_PROMPT)
        return f"{base}, {extra}"
    return base


def animagine_prompt_from_shot(
    prompt: str,
    composition_profile: str = "auto",
    shot_prompt_strength: str = "balanced",
    character_consistency_note: str = "",
    frame_mode: str = "stylized_panel",
) -> str:
    clean = " ".join(prompt.strip().split())
    shot_match = re.search(r"\bShot\s+\d+/\d+:\s*(.*)", clean)
    shot_phrase = shot_match.group(1) if shot_match else clean
    shot_phrase = re.split(r"\. original Japanese|\. Anime production|\. Flat 2D|\. Character consistency", shot_phrase, maxsplit=1, flags=re.IGNORECASE)[0]
    lowered = shot_phrase.lower()
    tags = [cfg({}, "ANIMAGINE_TAG_PREFIX", ANIMAGINE_TAG_PREFIX)]
    if "close-up eyes" in lowered or "eyes" in lowered:
        if frame_mode == "single_scene":
            tags.extend(["single camera close-up", "unified close-up framing", "one or two faces in one continuous frame", "intense gaze", "reflected blade edge"])
        else:
            tags.extend(["close-up eyes", "intense gaze", "reflected blade edge"])
    if "hand" in lowered or "hilt" in lowered or "draw" in lowered:
        tags.extend(["hands gripping katana", "wrapped sword hilt", "clean fingers"])
    if "dash" in lowered:
        if frame_mode == "single_scene":
            tags.extend(["wide or medium-wide side view", "both fighters visible", "clear ground plane", "side tracking dash", "trailing robes"])
        else:
            tags.extend(["side tracking dash", "speed lines", "trailing robes"])
    if "clash" in lowered or "impact" in lowered:
        if frame_mode == "single_scene":
            tags.extend(["medium-wide cinematic impact moment", "both fighters visible", "crossed katanas centered", "sparks controlled", "readable impact pose"])
        else:
            tags.extend(["diagonal blade clash", "crossed katanas", "sparks", "readable impact pose"])
    if "dodge" in lowered or "counter" in lowered:
        if frame_mode == "single_scene":
            tags.extend(["low-angle full-body action pose", "attacker and dodging fighter both visible", "low angle dodge", "counter slash"])
        else:
            tags.extend(["low angle dodge", "counter slash", "full body action pose"])
    if "elemental" in lowered or "water" in lowered or "fire" in lowered:
        tags.extend(["water energy trail", "fire energy trail", "controlled effects"])

    if frame_mode == "single_scene":
        tags.append(ANIMAGINE_SINGLE_SCENE_FRAME_PROMPT)

    profile = composition_profile if composition_profile in ANIME_COMPOSITION_PROMPTS else "auto"
    profile_tags = {
        "establishing": ["wide shot", "full body", "clear two character spacing"],
        "closeup": ["close-up", "simplified background", "sharp focal silhouette"],
        "action": ["dynamic pose", "strong silhouette", "readable choreography"],
        "impact": ["cinematic impact moment", "centered blade contact", "high contrast"],
        "auto": ["balanced composition", "foreground midground background separation"],
    }[profile]
    tags.extend(profile_tags)
    if shot_prompt_strength == "strong":
        tags.extend(["strict anatomy", "untangled limbs", "straight katana geometry"])
    elif shot_prompt_strength == "light":
        tags.extend(["restrained effects", "simple pose"])
    else:
        tags.extend(["pose clarity", "clean action staging"])
    if character_consistency_note.strip():
        tags.append("consistent original character design: " + " ".join(character_consistency_note.strip().split()))

    shot_phrase = re.sub(r"[^a-zA-Z0-9, -]+", " ", shot_phrase)
    shot_phrase = " ".join(shot_phrase.split())[:180].strip(" ,")
    if shot_phrase:
        tags.append(shot_phrase)
    return ", ".join(tag for tag in tags if tag)


def stricter_single_scene_prompt(prompt: str) -> str:
    return f"{prompt}, {ANIMAGINE_SINGLE_SCENE_RETRY_PROMPT}"


def stricter_single_scene_negative_prompt(negative_prompt: str) -> str:
    return f"{negative_prompt}, {ANIMAGINE_SINGLE_SCENE_RETRY_NEGATIVE_PROMPT}"


def _paeth_predictor(a: int, b: int, c: int) -> int:
    p = a + b - c
    pa = abs(p - a)
    pb = abs(p - b)
    pc = abs(p - c)
    if pa <= pb and pa <= pc:
        return a
    if pb <= pc:
        return b
    return c


def _read_png_luma_rows(path: Path) -> tuple[int, int, list[bytes]]:
    data = path.read_bytes()
    if not data.startswith(b"\x89PNG\r\n\x1a\n"):
        raise ValueError("not a PNG file")
    pos = 8
    width = height = bit_depth = color_type = None
    idat = bytearray()
    while pos + 8 <= len(data):
        length = struct.unpack(">I", data[pos:pos + 4])[0]
        chunk_type = data[pos + 4:pos + 8]
        chunk_data = data[pos + 8:pos + 8 + length]
        pos += 12 + length
        if chunk_type == b"IHDR":
            width, height, bit_depth, color_type, compression, filter_method, interlace = struct.unpack(">IIBBBBB", chunk_data)
            if bit_depth != 8 or compression != 0 or filter_method != 0 or interlace != 0:
                raise ValueError("unsupported PNG encoding")
        elif chunk_type == b"IDAT":
            idat.extend(chunk_data)
        elif chunk_type == b"IEND":
            break
    if width is None or height is None:
        raise ValueError("PNG missing IHDR")
    channels_by_type = {0: 1, 2: 3, 4: 2, 6: 4}
    channels = channels_by_type.get(color_type)
    if channels is None:
        raise ValueError(f"unsupported PNG color type {color_type}")
    raw = zlib.decompress(bytes(idat))
    stride = width * channels
    rows: list[bytes] = []
    prev = bytearray(stride)
    offset = 0
    for _ in range(height):
        filter_type = raw[offset]
        offset += 1
        scan = bytearray(raw[offset:offset + stride])
        offset += stride
        for i in range(stride):
            left = scan[i - channels] if i >= channels else 0
            up = prev[i]
            up_left = prev[i - channels] if i >= channels else 0
            if filter_type == 1:
                scan[i] = (scan[i] + left) & 0xFF
            elif filter_type == 2:
                scan[i] = (scan[i] + up) & 0xFF
            elif filter_type == 3:
                scan[i] = (scan[i] + ((left + up) // 2)) & 0xFF
            elif filter_type == 4:
                scan[i] = (scan[i] + _paeth_predictor(left, up, up_left)) & 0xFF
            elif filter_type != 0:
                raise ValueError(f"unsupported PNG filter {filter_type}")
        luma = bytearray(width)
        for x in range(width):
            base = x * channels
            if color_type == 0:
                y = scan[base]
            elif color_type == 4:
                y = scan[base]
            else:
                r, g, b = scan[base], scan[base + 1], scan[base + 2]
                y = (299 * r + 587 * g + 114 * b) // 1000
            luma[x] = y
        rows.append(bytes(luma))
        prev = scan
    return width, height, rows


def _dark_band_runs(scores: list[float], min_ratio: float, min_width: int) -> list[dict[str, Any]]:
    runs: list[dict[str, Any]] = []
    start: int | None = None
    for idx, score in enumerate(scores + [0.0]):
        if score >= min_ratio:
            if start is None:
                start = idx
        elif start is not None:
            end = idx - 1
            if end - start + 1 >= min_width:
                segment = scores[start:idx]
                runs.append({
                    "start": start,
                    "end": end,
                    "width": end - start + 1,
                    "max_dark_ratio": round(max(segment), 4),
                    "avg_dark_ratio": round(sum(segment) / len(segment), 4),
                })
            start = None
    return runs


def detect_likely_panel_layout(image_path: str | Path) -> dict[str, Any]:
    path = Path(image_path)
    result: dict[str, Any] = {"checked": False, "flagged": False, "reason": "", "vertical_bands": [], "horizontal_bands": []}
    if path.suffix.lower() != ".png":
        result["reason"] = "unsupported_non_png"
        return result
    try:
        width, height, rows = _read_png_luma_rows(path)
    except Exception as exc:
        result["reason"] = f"decode_failed:{type(exc).__name__}"
        return result

    margin_x = max(24, int(width * 0.08))
    margin_y = max(18, int(height * 0.08))
    x0, x1 = margin_x, width - margin_x
    y0, y1 = margin_y, height - margin_y
    if x1 <= x0 or y1 <= y0:
        result["reason"] = "image_too_small"
        return result

    dark_threshold = 30
    col_scores: list[float] = []
    for x in range(x0, x1):
        dark = sum(1 for y in range(y0, y1) if rows[y][x] <= dark_threshold)
        col_scores.append(dark / (y1 - y0))
    row_scores: list[float] = []
    for y in range(y0, y1):
        row = rows[y]
        dark = sum(1 for x in range(x0, x1) if row[x] <= dark_threshold)
        row_scores.append(dark / (x1 - x0))

    min_vertical_width = max(4, int(width * 0.006))
    min_horizontal_width = max(4, int(height * 0.006))
    vertical = _dark_band_runs(col_scores, 0.82, min_vertical_width)
    horizontal = _dark_band_runs(row_scores, 0.82, min_horizontal_width)
    for band in vertical:
        band["start"] += x0
        band["end"] += x0
    for band in horizontal:
        band["start"] += y0
        band["end"] += y0

    result.update({
        "checked": True,
        "width": width,
        "height": height,
        "vertical_bands": vertical,
        "horizontal_bands": horizontal,
    })
    if vertical or horizontal:
        result["flagged"] = True
        result["reason"] = "internal_dark_band"
    return result


def load_workflow(path: str) -> dict[str, Any]:
    workflow_path = Path(path)
    if not workflow_path.exists():
        raise PipelineError(f"Workflow not found: {path}")
    data = json.loads(workflow_path.read_text(encoding="utf-8"))
    if "prompt" in data and isinstance(data["prompt"], dict):
        data = data["prompt"]
    if not isinstance(data, dict):
        raise PipelineError(f"Workflow must be a ComfyUI API JSON object: {path}")
    return data


def iter_nodes(workflow: dict[str, Any], class_type: str | None = None):
    for node_id, node in workflow.items():
        if not isinstance(node, dict):
            continue
        if class_type is None or node.get("class_type") == class_type:
            yield str(node_id), node


def set_node_input(workflow: dict[str, Any], class_type: str, key: str, value: Any, occurrence: int = 0) -> bool:
    seen = 0
    for _, node in iter_nodes(workflow, class_type):
        if seen == occurrence:
            node.setdefault("inputs", {})[key] = value
            return True
        seen += 1
    return False


def patch_all_node_input(workflow: dict[str, Any], class_type: str, values: dict[str, Any]) -> None:
    for _, node in iter_nodes(workflow, class_type):
        inputs = node.setdefault("inputs", {})
        for key, value in values.items():
            if key in inputs:
                inputs[key] = value


def object_options(object_info: dict[str, Any], class_type: str, input_name: str) -> list[str]:
    spec = object_info.get(class_type, {}).get("input", {}).get("required", {}).get(input_name)
    if not spec:
        return []
    first = spec[0] if isinstance(spec, list) and spec else []
    if isinstance(first, list):
        return [str(item) for item in first]
    if first == "COMBO" and len(spec) > 1 and isinstance(spec[1], dict):
        return [str(item) for item in spec[1].get("options", [])]
    return []


def validate_workflow_models(workflow: dict[str, Any], object_info: dict[str, Any], workflow_name: str) -> list[str]:
    errors: list[str] = []
    loader_fields = {
        "UNETLoader": ["unet_name"],
        "CheckpointLoaderSimple": ["ckpt_name"],
        "CLIPLoader": ["clip_name"],
        "DualCLIPLoader": ["clip_name1", "clip_name2"],
        "TripleCLIPLoader": ["clip_name1", "clip_name2", "clip_name3"],
        "VAELoader": ["vae_name"],
        "CLIPVisionLoader": ["clip_name"],
    }
    for node_id, node in iter_nodes(workflow):
        class_type = str(node.get("class_type", ""))
        inputs = node.get("inputs", {})
        for input_name in loader_fields.get(class_type, []):
            value = inputs.get(input_name)
            if not isinstance(value, str):
                continue
            if not value or "REPLACE_WITH" in value:
                errors.append(f"{workflow_name} node {node_id} {class_type}.{input_name} is still a placeholder")
                continue
            options = object_options(object_info, class_type, input_name)
            if not options:
                errors.append(
                    f"{workflow_name} node {node_id} {class_type}.{input_name}={value!r} cannot be validated because ComfyUI exposes no options for {class_type}.{input_name}"
                )
            elif value not in options:
                errors.append(
                    f"{workflow_name} node {node_id} {class_type}.{input_name}={value!r} is not exposed by ComfyUI"
                )
    return errors


def validate_workflow_node_classes(workflow: dict[str, Any], object_info: dict[str, Any], workflow_name: str) -> list[str]:
    errors: list[str] = []
    for node_id, node in iter_nodes(workflow):
        class_type = str(node.get("class_type", ""))
        if class_type and class_type not in object_info:
            errors.append(f"{workflow_name} node {node_id} class_type={class_type!r} is not exposed by ComfyUI")
    return errors


def first_node_input(workflow: dict[str, Any], class_type: str, key: str, default: Any = None) -> Any:
    for _, node in iter_nodes(workflow, class_type):
        return node.get("inputs", {}).get(key, default)
    return default


def ksampler_options(object_info: dict[str, Any], input_name: str) -> list[str]:
    return object_options(object_info, "KSampler", input_name)


def select_animagine_sampler(object_info: dict[str, Any]) -> str:
    options = ksampler_options(object_info, "sampler_name")
    if "euler_ancestral" in options:
        return "euler_ancestral"
    if "euler_a" in options:
        return "euler_a"
    if "euler" in options:
        return "euler"
    return options[0] if options else "euler"


def checkpoint_available(object_info: dict[str, Any], checkpoint_name: str) -> bool:
    return checkpoint_name in object_options(object_info, "CheckpointLoaderSimple", "ckpt_name")


def resolve_keyframe_engine(args: argparse.Namespace, env: dict[str, str], object_info: dict[str, Any], style_preset: str, warnings: list[str]) -> str:
    requested = str(args.keyframe_engine or "auto").strip().lower()
    checkpoint = cfg(env, "ANIMAGINE_CHECKPOINT_NAME", ANIMAGINE_CHECKPOINT)
    has_animagine = checkpoint_available(object_info, checkpoint)
    if requested == "animagine":
        if not has_animagine:
            raise PipelineError(f"Requested keyframe_engine=animagine but checkpoint is not exposed by ComfyUI: {checkpoint}")
        return "animagine"
    if requested == "flux":
        return "flux"
    if style_preset == "anime_action":
        if has_animagine:
            return "animagine"
        warnings.append(f"keyframe_engine auto fell back to flux because {checkpoint} is not exposed by ComfyUI")
    return "flux"


def patch_animagine_workflow(workflow: dict[str, Any], prompt: str, negative_prompt: str, width: int, height: int, steps: int, cfg_value: float, sampler_name: str, seed: int, filename_prefix: str, env: dict[str, str]) -> dict[str, Any]:
    patched = copy.deepcopy(workflow)
    set_node_input(patched, "CLIPTextEncode", "text", prompt, 0)
    set_node_input(patched, "CLIPTextEncode", "text", negative_prompt, 1)
    set_node_input(patched, "EmptyLatentImage", "width", width)
    set_node_input(patched, "EmptyLatentImage", "height", height)
    set_node_input(patched, "KSampler", "steps", steps)
    set_node_input(patched, "KSampler", "cfg", cfg_value)
    set_node_input(patched, "KSampler", "sampler_name", sampler_name)
    set_node_input(patched, "KSampler", "seed", seed)
    set_node_input(patched, "SaveImage", "filename_prefix", filename_prefix)
    patch_all_node_input(patched, "CheckpointLoaderSimple", {"ckpt_name": cfg(env, "ANIMAGINE_CHECKPOINT_NAME", ANIMAGINE_CHECKPOINT)})
    return patched


def keyframe_metadata(engine: str, workflow_path: str, workflow: dict[str, Any], width: int, height: int) -> dict[str, Any]:
    sampler = first_node_input(workflow, "KSampler", "sampler_name")
    steps = first_node_input(workflow, "KSampler", "steps")
    cfg_value = first_node_input(workflow, "KSampler", "cfg")
    checkpoint = first_node_input(workflow, "CheckpointLoaderSimple", "ckpt_name")
    return {
        "keyframe_engine": engine,
        "keyframe_checkpoint": checkpoint,
        "keyframe_workflow": workflow_path,
        "keyframe_sampler": sampler,
        "keyframe_steps": steps,
        "keyframe_cfg": cfg_value,
        "keyframe_resolution": {"width": width, "height": height},
    }


def queue_comfy(comfy_url: str, workflow: dict[str, Any], timeout: int) -> str:
    response = http_json("POST", endpoint(comfy_url, "/prompt"), {"prompt": workflow, "client_id": str(uuid.uuid4())}, timeout=timeout)
    node_errors = response.get("node_errors") or {}
    if node_errors:
        raise PipelineError(f"ComfyUI rejected workflow: {node_errors}")
    prompt_id = response.get("prompt_id")
    if not prompt_id:
        raise PipelineError(f"ComfyUI did not return prompt_id: {response}")
    return str(prompt_id)


def poll_comfy(comfy_url: str, prompt_id: str, poll_seconds: float, timeout_seconds: int, empty_queue_timeout_seconds: int = 180) -> dict[str, Any]:
    deadline = time.time() + timeout_seconds
    last_queue = None
    last_error = None
    empty_queue_since: float | None = None
    while time.time() < deadline:
        try:
            history = http_json("GET", endpoint(comfy_url, f"/history/{prompt_id}"), timeout=30)
        except PipelineError as exc:
            last_error = str(exc)
            time.sleep(min(poll_seconds * 2, 20))
            continue
        item = history.get(prompt_id)
        if item:
            status = item.get("status", {})
            if status.get("status_str") == "error":
                raise PipelineError(f"ComfyUI job failed: {json.dumps(status, ensure_ascii=False)}")
            if status.get("completed") is True or item.get("outputs"):
                return item
        try:
            last_queue = http_json("GET", endpoint(comfy_url, "/queue"), timeout=10)
        except PipelineError as exc:
            last_error = str(exc)
            last_queue = None
        if isinstance(last_queue, dict) and not last_queue.get("queue_running") and not last_queue.get("queue_pending"):
            if empty_queue_since is None:
                empty_queue_since = time.time()
            elif time.time() - empty_queue_since >= empty_queue_timeout_seconds:
                raise PipelineError(f"Timed out waiting for ComfyUI prompt {prompt_id}; queue={last_queue}; last_error={last_error}; empty_queue_seconds={int(time.time() - empty_queue_since)}")
        else:
            empty_queue_since = None
        time.sleep(poll_seconds)
    raise PipelineError(f"Timed out waiting for ComfyUI prompt {prompt_id}; queue={last_queue}; last_error={last_error}")

def find_output_ref(history_item: dict[str, Any], extensions: set[str]) -> dict[str, str]:
    for output in (history_item.get("outputs") or {}).values():
        candidates = []
        candidates.extend(output.get("images") or [])
        candidates.extend(output.get("videos") or [])
        for item in candidates:
            filename = item.get("filename")
            if filename and Path(filename).suffix.lower() in extensions:
                return {"filename": filename, "subfolder": item.get("subfolder", ""), "type": item.get("type", "output")}
    raise PipelineError(f"No output file with extensions {sorted(extensions)} found")


def download_comfy_file(comfy_url: str, ref: dict[str, str], output_dir: str, basename: str) -> str:
    params = urlencode({"filename": ref["filename"], "subfolder": ref.get("subfolder", ""), "type": ref.get("type", "output")})
    body, _ = http_bytes(endpoint(comfy_url, f"/view?{params}"), timeout=300)
    suffix = Path(ref["filename"]).suffix or ".bin"
    target_dir = Path(output_dir)
    target_dir.mkdir(parents=True, exist_ok=True)
    target = target_dir / f"{basename}{suffix}"
    target.write_bytes(body)
    return str(target)


def upload_image(comfy_url: str, image_path: str, name: str) -> dict[str, Any]:
    path = Path(image_path)
    boundary = "----hermes-" + uuid.uuid4().hex
    mime = mimetypes.guess_type(path.name)[0] or "application/octet-stream"
    fields: list[tuple[str, str | tuple[str, bytes, str]]] = [
        ("type", "input"),
        ("overwrite", "true"),
        ("image", (name, path.read_bytes(), mime)),
    ]
    body = bytearray()
    for field_name, value in fields:
        body.extend(f"--{boundary}\r\n".encode("utf-8"))
        if isinstance(value, tuple):
            filename, data, content_type = value
            body.extend((f'Content-Disposition: form-data; name="{field_name}"; filename="{filename}"\r\nContent-Type: {content_type}\r\n\r\n').encode("utf-8"))
            body.extend(data)
            body.extend(b"\r\n")
        else:
            body.extend(f'Content-Disposition: form-data; name="{field_name}"\r\n\r\n'.encode("utf-8"))
            body.extend(value.encode("utf-8"))
            body.extend(b"\r\n")
    body.extend(f"--{boundary}--\r\n".encode("utf-8"))
    request = Request(endpoint(comfy_url, "/upload/image"), data=bytes(body), headers={"Content-Type": f"multipart/form-data; boundary={boundary}"}, method="POST")
    try:
        with urlopen(request, timeout=120) as response:
            return json.loads(response.read().decode("utf-8"))
    except HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="replace")
        raise PipelineError(f"Image upload failed HTTP {exc.code}: {detail}") from exc
    except TRANSIENT_HTTP_ERRORS as exc:
        raise PipelineError(f"Image upload failed: {error_reason(exc)}") from exc


def patch_flux_workflow(workflow: dict[str, Any], prompt: str, negative_prompt: str, width: int, height: int, steps: int, seed: int, filename_prefix: str, env: dict[str, str]) -> dict[str, Any]:
    patched = copy.deepcopy(workflow)
    set_node_input(patched, "CLIPTextEncode", "text", prompt, 0)
    set_node_input(patched, "CLIPTextEncode", "text", negative_prompt, 1)
    set_node_input(patched, "EmptyLatentImage", "width", width)
    set_node_input(patched, "EmptyLatentImage", "height", height)
    set_node_input(patched, "KSampler", "steps", steps)
    set_node_input(patched, "KSampler", "seed", seed)
    set_node_input(patched, "SaveImage", "filename_prefix", filename_prefix)
    set_node_input(patched, "FluxGuidance", "guidance", float(cfg(env, "FLUX_GUIDANCE", "3.5")))
    if cfg(env, "FLUX_CHECKPOINT_NAME", ""):
        patch_all_node_input(patched, "CheckpointLoaderSimple", {"ckpt_name": cfg(env, "FLUX_CHECKPOINT_NAME", "")})
    if cfg(env, "FLUX_UNET_NAME", ""):
        patch_all_node_input(patched, "UNETLoader", {"unet_name": cfg(env, "FLUX_UNET_NAME", "")})
    if cfg(env, "FLUX_VAE_NAME", ""):
        patch_all_node_input(patched, "VAELoader", {"vae_name": cfg(env, "FLUX_VAE_NAME", "")})
    if cfg(env, "FLUX_CLIP_NAME", ""):
        patch_all_node_input(patched, "CLIPLoader", {"clip_name": cfg(env, "FLUX_CLIP_NAME", "")})
    if cfg(env, "FLUX_CLIP_NAME1", ""):
        patch_all_node_input(patched, "DualCLIPLoader", {"clip_name1": cfg(env, "FLUX_CLIP_NAME1", "")})
    if cfg(env, "FLUX_CLIP_NAME2", ""):
        patch_all_node_input(patched, "DualCLIPLoader", {"clip_name2": cfg(env, "FLUX_CLIP_NAME2", "")})
    return patched


def patch_wan_model_loaders(workflow: dict[str, Any], env: dict[str, str]) -> None:
    patch_all_node_input(workflow, "UNETLoader", {"unet_name": cfg(env, "WAN_UNET_NAME", "wan2.1_i2v_480p_14B_fp8_e4m3fn.safetensors")})
    patch_all_node_input(workflow, "CLIPLoader", {"clip_name": cfg(env, "WAN_CLIP_NAME", "umt5_xxl_fp8_e4m3fn_scaled.safetensors"), "type": "wan"})
    patch_all_node_input(workflow, "VAELoader", {"vae_name": cfg(env, "WAN_VAE_NAME", "wan_2.1_vae.safetensors")})
    patch_all_node_input(workflow, "CLIPVisionLoader", {"clip_name": cfg(env, "WAN_CLIP_VISION_NAME", "clip_vision_h.safetensors")})


def patch_wan_workflow(workflow: dict[str, Any], image_name: str, prompt: str, negative_prompt: str, width: int, height: int, frames: int, steps: int, seed: int, filename_prefix: str, env: dict[str, str]) -> dict[str, Any]:
    patched = copy.deepcopy(workflow)
    if not set_node_input(patched, "LoadImage", "image", image_name):
        raise PipelineError("Wan workflow has no LoadImage node to patch keyframe")
    set_node_input(patched, "CLIPTextEncode", "text", prompt, 0)
    set_node_input(patched, "CLIPTextEncode", "text", negative_prompt, 1)
    set_node_input(patched, "WanImageToVideo", "width", width)
    set_node_input(patched, "WanImageToVideo", "height", height)
    set_node_input(patched, "WanImageToVideo", "length", frames)
    set_node_input(patched, "KSampler", "steps", steps)
    set_node_input(patched, "KSampler", "seed", seed)
    set_node_input(patched, "SaveVideo", "filename_prefix", filename_prefix)
    patch_wan_model_loaders(patched, env)
    return patched


def patch_wan_flf_workflow(workflow: dict[str, Any], start_image_name: str, end_image_name: str, prompt: str, negative_prompt: str, width: int, height: int, frames: int, steps: int, seed: int, filename_prefix: str, env: dict[str, str]) -> dict[str, Any]:
    patched = copy.deepcopy(workflow)
    if not set_node_input(patched, "LoadImage", "image", start_image_name, 0):
        raise PipelineError("Wan FLF workflow has no first LoadImage node to patch start keyframe")
    if not set_node_input(patched, "LoadImage", "image", end_image_name, 1):
        raise PipelineError("Wan FLF workflow has no second LoadImage node to patch end keyframe")
    set_node_input(patched, "CLIPTextEncode", "text", prompt, 0)
    set_node_input(patched, "CLIPTextEncode", "text", negative_prompt, 1)
    if not set_node_input(patched, "WanFirstLastFrameToVideo", "width", width):
        raise PipelineError("Wan FLF workflow has no WanFirstLastFrameToVideo node")
    set_node_input(patched, "WanFirstLastFrameToVideo", "height", height)
    set_node_input(patched, "WanFirstLastFrameToVideo", "length", frames)
    set_node_input(patched, "KSampler", "steps", steps)
    set_node_input(patched, "KSampler", "seed", seed)
    set_node_input(patched, "SaveVideo", "filename_prefix", filename_prefix)
    patch_wan_model_loaders(patched, env)
    return patched


def run(args: argparse.Namespace) -> dict[str, Any]:
    env = load_env_file(args.env_file)
    comfy_url = cfg(env, "COMFYUI_BASE_URL", "http://host.docker.internal:8188")
    image_dir = cfg(env, "MEDIA_IMAGE_OUTPUT_DIR", DEFAULT_IMAGE_DIR)
    video_dir = cfg(env, "MEDIA_OUTPUT_DIR", DEFAULT_VIDEO_DIR)
    poll_seconds = float(cfg(env, "MEDIA_POLL_SECONDS", "2"))
    timeout_seconds = int(cfg(env, "MEDIA_JOB_TIMEOUT_SECONDS", "1800"))
    http_timeout = int(cfg(env, "MEDIA_HTTP_TIMEOUT_SECONDS", "30"))
    empty_queue_timeout_seconds = int(cfg(env, "MEDIA_EMPTY_QUEUE_TIMEOUT_SECONDS", "120"))
    seed = args.seed if args.seed is not None else random.randint(0, 2**31 - 1)
    style_preset = str(args.style_preset or "default").strip().lower() or "default"
    character_consistency_note = " ".join((args.character_consistency_note or "").strip().split())
    if style_preset == "anime_action":
        character_consistency_note = effective_character_consistency_note(character_consistency_note)
    control_mode = str(args.control_mode or "i2v_last_frame").strip().lower()
    mode_settings = {
        "test": {"frames": 5, "wan_steps": 1, "flux_steps": 4, "width": 832, "height": 480},
        "quality": {"frames": 33, "wan_steps": 20, "flux_steps": 20, "width": 832, "height": 480},
    }[args.mode]
    prompt_used = prompt_to_english(
        args.prompt,
        style_preset,
        args.keyframe_quality_preset,
        args.composition_profile,
        args.shot_prompt_strength,
        character_consistency_note,
    )
    video_prompt = prompt_to_video_prompt_for_style(prompt_used, style_preset)
    negative = negative_prompt_for_style(env, style_preset)
    run_id = f"{int(time.time())}-{uuid.uuid4().hex[:8]}"
    base = f"{slugify(args.prompt)}-{run_id}"

    warnings: list[str] = []
    flux_workflow_path = args.flux_workflow
    animagine_workflow_path = args.animagine_workflow
    wan_workflow_path = args.wan_workflow
    wan_flf_workflow_path = args.wan_flf_workflow
    if flux_workflow_path == DEFAULT_FLUX_WORKFLOW:
        flux_workflow_path = cfg(env, "FLUX_WORKFLOW_PATH", DEFAULT_FLUX_WORKFLOW)
    if animagine_workflow_path == DEFAULT_ANIMAGINE_WORKFLOW:
        animagine_workflow_path = cfg(env, "ANIMAGINE_WORKFLOW_PATH", DEFAULT_ANIMAGINE_WORKFLOW)
    if wan_workflow_path == DEFAULT_WAN_WORKFLOW:
        wan_workflow_path = cfg(env, "WAN_I2V_WORKFLOW_PATH", DEFAULT_WAN_WORKFLOW)
    if wan_flf_workflow_path == DEFAULT_WAN_FLF_WORKFLOW:
        wan_flf_workflow_path = cfg(env, "WAN_FLF2V_WORKFLOW_PATH", DEFAULT_WAN_FLF_WORKFLOW)

    object_info = http_json("GET", endpoint(comfy_url, "/object_info"), timeout=http_timeout)
    frames = min(max(1, int(args.frames or mode_settings["frames"])), 33)
    wan_steps = min(max(1, int(args.wan_steps or mode_settings["wan_steps"])), 30)
    keyframe_engine = resolve_keyframe_engine(args, env, object_info, style_preset, warnings)
    keyframe_frame_mode = resolve_keyframe_frame_mode(args.keyframe_frame_mode, style_preset, keyframe_engine)
    flux_steps = min(max(1, int(args.flux_steps or mode_settings["flux_steps"])), 30)
    keyframe_steps = min(max(1, int(args.flux_steps or (26 if keyframe_engine == "animagine" else mode_settings["flux_steps"]))), 30)
    keyframe_cfg = float(cfg(env, "ANIMAGINE_CFG", "6.0")) if keyframe_engine == "animagine" else 1.0
    width = int(mode_settings["width"])
    height = int(mode_settings["height"])

    def prompt_manifest() -> dict[str, str]:
        return {"image": prompt_used, "video": video_prompt, "negative": negative}

    def validate_image_arg(raw_path: str, label: str) -> Path:
        path = Path(raw_path)
        if not path.exists() or not path.is_file():
            raise PipelineError(f"{label} not found: {path}")
        if path.suffix.lower() not in IMAGE_EXTENSIONS:
            raise PipelineError(f"{label} must be one of {sorted(IMAGE_EXTENSIONS)}: {path}")
        return path.resolve()

    if args.input_image:
        start_image = validate_image_arg(args.input_image, "Input image")
        if control_mode == "flf2v":
            if not args.end_image:
                raise PipelineError("--end-image is required when --control-mode flf2v uses an existing start image")
            end_image = validate_image_arg(args.end_image, "End image")
            wan_workflow = load_workflow(wan_flf_workflow_path)
            errors = validate_workflow_node_classes(wan_workflow, object_info, "wan_flf2v_api") + validate_workflow_models(wan_workflow, object_info, "wan_flf2v_api")
            if errors:
                raise PipelineError("; ".join(errors))
            start_upload_name = f"hermes_{base}_start{start_image.suffix.lower()}"
            end_upload_name = f"hermes_{base}_end{end_image.suffix.lower()}"
            start_upload = upload_image(comfy_url, str(start_image), start_upload_name)
            end_upload = upload_image(comfy_url, str(end_image), end_upload_name)
            wan = patch_wan_flf_workflow(
                wan_workflow,
                str(start_upload.get("name") or start_upload_name),
                str(end_upload.get("name") or end_upload_name),
                video_prompt,
                negative,
                width,
                height,
                frames,
                wan_steps,
                seed,
                f"hermes_video/{base}",
                env,
            )
            flux_prompt_id = None
        else:
            wan_workflow = load_workflow(wan_workflow_path)
            errors = validate_workflow_node_classes(wan_workflow, object_info, "wan_i2v_api") + validate_workflow_models(wan_workflow, object_info, "wan_i2v_api")
            if errors:
                raise PipelineError("; ".join(errors))
            upload_name = f"hermes_{base}{start_image.suffix.lower()}"
            upload_result = upload_image(comfy_url, str(start_image), upload_name)
            wan = patch_wan_workflow(
                wan_workflow,
                str(upload_result.get("name") or upload_name),
                video_prompt,
                negative,
                width,
                height,
                frames,
                wan_steps,
                seed,
                f"hermes_video/{base}",
                env,
            )
            end_image = None
            flux_prompt_id = None

        wan_prompt_id = queue_comfy(comfy_url, wan, timeout=http_timeout)
        wan_history = poll_comfy(comfy_url, wan_prompt_id, poll_seconds, timeout_seconds, empty_queue_timeout_seconds)
        video_ref = find_output_ref(wan_history, VIDEO_EXTENSIONS)
        video_path = download_comfy_file(comfy_url, video_ref, video_dir, base)
        return {
            "status": "completed",
            "style_preset": style_preset,
            "keyframe_quality_preset": args.keyframe_quality_preset,
            "composition_profile": args.composition_profile,
            "shot_prompt_strength": args.shot_prompt_strength,
            "character_consistency_note": character_consistency_note,
            "shot_prompt_type": args.shot_prompt_type,
            "control_mode": control_mode,
            "image_path": str(start_image),
            "start_keyframe_path": str(start_image),
            "end_keyframe_path": str(end_image) if end_image else None,
            "video_path": video_path,
            "frames": frames,
            "wan_steps": wan_steps,
            "flux_steps": flux_steps,
            "keyframe_engine": "external",
            "keyframe_frame_mode": keyframe_frame_mode,
            "keyframe_checkpoint": None,
            "keyframe_workflow": None,
            "keyframe_sampler": None,
            "keyframe_steps": None,
            "keyframe_cfg": None,
            "keyframe_resolution": {"width": width, "height": height},
            "keyframe_prompt": prompt_used,
            "video_prompt": video_prompt,
            "negative_prompt": negative,
            "prompt_used": prompt_manifest(),
            "warnings": warnings,
            "errors": [],
            "comfyui": {"flux_prompt_id": flux_prompt_id, "wan_prompt_id": wan_prompt_id, "video_ref": video_ref},
        }

    if keyframe_engine == "animagine":
        keyframe_workflow_path = animagine_workflow_path
        keyframe_prompt = animagine_prompt_from_shot(
            args.prompt,
            args.composition_profile,
            args.shot_prompt_strength,
            character_consistency_note,
            keyframe_frame_mode,
        )
        keyframe_negative = animagine_negative_prompt_for_mode(env, keyframe_frame_mode)
        keyframe_workflow_template = load_workflow(keyframe_workflow_path)
        keyframe_sampler = select_animagine_sampler(object_info)
        keyframe_workflow = patch_animagine_workflow(
            keyframe_workflow_template,
            keyframe_prompt,
            keyframe_negative,
            width,
            height,
            keyframe_steps,
            keyframe_cfg,
            keyframe_sampler,
            seed,
            f"hermes_keyframe/{base}",
            env,
        )
        keyframe_workflow_name = "animagine_keyframe_api"
    else:
        keyframe_workflow_path = flux_workflow_path
        keyframe_prompt = prompt_used
        keyframe_negative = negative
        keyframe_workflow_template = load_workflow(keyframe_workflow_path)
        keyframe_workflow = patch_flux_workflow(keyframe_workflow_template, keyframe_prompt, keyframe_negative, width, height, flux_steps, seed, f"hermes_keyframe/{base}", env)
        keyframe_workflow_name = "flux_keyframe_api"
    keyframe_meta = keyframe_metadata(keyframe_engine, keyframe_workflow_path, keyframe_workflow, width, height)
    errors = validate_workflow_node_classes(keyframe_workflow, object_info, keyframe_workflow_name) + validate_workflow_models(keyframe_workflow, object_info, keyframe_workflow_name)
    if not args.keyframe_only:
        if control_mode == "flf2v":
            if not args.end_image:
                raise PipelineError("--end-image is required for generated-start FLF2V; generate the end keyframe first or use sequence mode")
            wan_for_validation = load_workflow(wan_flf_workflow_path)
            errors += validate_workflow_node_classes(wan_for_validation, object_info, "wan_flf2v_api") + validate_workflow_models(wan_for_validation, object_info, "wan_flf2v_api")
        else:
            wan_for_validation = load_workflow(wan_workflow_path)
            errors += validate_workflow_node_classes(wan_for_validation, object_info, "wan_i2v_api") + validate_workflow_models(wan_for_validation, object_info, "wan_i2v_api")
    if errors:
        raise PipelineError("; ".join(errors))

    keyframe_prompt_id = queue_comfy(comfy_url, keyframe_workflow, timeout=http_timeout)
    keyframe_history = poll_comfy(comfy_url, keyframe_prompt_id, poll_seconds, timeout_seconds, empty_queue_timeout_seconds)
    image_ref = find_output_ref(keyframe_history, IMAGE_EXTENSIONS)
    image_path = download_comfy_file(comfy_url, image_ref, image_dir, base + "-keyframe")
    keyframe_validation: dict[str, Any] | None = None

    if keyframe_engine == "animagine" and keyframe_frame_mode == "single_scene":
        validation = detect_likely_panel_layout(image_path)
        keyframe_validation = {"attempts": [validation], "accepted_after_retry": False}
        retry_prompt = stricter_single_scene_prompt(keyframe_prompt)
        retry_negative = stricter_single_scene_negative_prompt(keyframe_negative)
        for retry_index in range(1, 4):
            if not validation.get("flagged"):
                break
            retry_workflow = patch_animagine_workflow(
                keyframe_workflow_template,
                retry_prompt,
                retry_negative,
                width,
                height,
                keyframe_steps,
                keyframe_cfg,
                keyframe_sampler,
                seed + 1000003 * retry_index,
                f"hermes_keyframe/{base}-single-scene-retry-{retry_index}",
                env,
            )
            retry_prompt_id = queue_comfy(comfy_url, retry_workflow, timeout=http_timeout)
            retry_history = poll_comfy(comfy_url, retry_prompt_id, poll_seconds, timeout_seconds, empty_queue_timeout_seconds)
            retry_ref = find_output_ref(retry_history, IMAGE_EXTENSIONS)
            retry_path = download_comfy_file(comfy_url, retry_ref, image_dir, base + f"-keyframe-single-scene-retry-{retry_index}")
            validation = detect_likely_panel_layout(retry_path)
            keyframe_validation["attempts"].append(validation)
            if not validation.get("flagged"):
                keyframe_validation["accepted_after_retry"] = True
                keyframe_prompt = retry_prompt
                keyframe_negative = retry_negative
                keyframe_prompt_id = retry_prompt_id
                image_ref = retry_ref
                image_path = retry_path
                break
        if validation.get("flagged"):
            raise PipelineError(f"keyframe validator flagged likely panel layout after strict retries: {validation}")

    if args.keyframe_only:
        return {
            "status": "completed",
            "style_preset": style_preset,
            "keyframe_quality_preset": args.keyframe_quality_preset,
            "composition_profile": args.composition_profile,
            "shot_prompt_strength": args.shot_prompt_strength,
            "character_consistency_note": character_consistency_note,
            "shot_prompt_type": args.shot_prompt_type,
            "control_mode": "keyframe_only",
            "image_path": image_path,
            "start_keyframe_path": image_path,
            "end_keyframe_path": None,
            "video_path": None,
            "frames": frames,
            "wan_steps": wan_steps,
            "flux_steps": flux_steps,
            **keyframe_meta,
            "keyframe_frame_mode": keyframe_frame_mode,
            "keyframe_prompt": keyframe_prompt,
            "video_prompt": video_prompt,
            "negative_prompt": keyframe_negative,
            "keyframe_validation": keyframe_validation,
            "prompt_used": prompt_manifest(),
            "warnings": warnings,
            "errors": [],
            "comfyui": {"keyframe_prompt_id": keyframe_prompt_id, "flux_prompt_id": keyframe_prompt_id if keyframe_engine == "flux" else None, "wan_prompt_id": None, "image_ref": image_ref},
        }

    upload_name = f"hermes_{base}{Path(image_path).suffix}"
    upload_result = upload_image(comfy_url, image_path, upload_name)
    image_name = str(upload_result.get("name") or upload_name)

    if control_mode == "flf2v":
        end_image = validate_image_arg(args.end_image, "End image")
        end_upload_name = f"hermes_{base}_end{end_image.suffix.lower()}"
        end_upload = upload_image(comfy_url, str(end_image), end_upload_name)
        wan = patch_wan_flf_workflow(
            wan_for_validation,
            image_name,
            str(end_upload.get("name") or end_upload_name),
            video_prompt,
            negative,
            width,
            height,
            frames,
            wan_steps,
            seed,
            f"hermes_video/{base}",
            env,
        )
    else:
        end_image = None
        wan = patch_wan_workflow(wan_for_validation, image_name, video_prompt, negative, width, height, frames, wan_steps, seed, f"hermes_video/{base}", env)

    wan_prompt_id = queue_comfy(comfy_url, wan, timeout=http_timeout)
    wan_history = poll_comfy(comfy_url, wan_prompt_id, poll_seconds, timeout_seconds, empty_queue_timeout_seconds)
    video_ref = find_output_ref(wan_history, VIDEO_EXTENSIONS)
    video_path = download_comfy_file(comfy_url, video_ref, video_dir, base)
    return {
        "status": "completed",
        "style_preset": style_preset,
        "keyframe_quality_preset": args.keyframe_quality_preset,
        "composition_profile": args.composition_profile,
        "shot_prompt_strength": args.shot_prompt_strength,
        "character_consistency_note": character_consistency_note,
        "shot_prompt_type": args.shot_prompt_type,
        "control_mode": control_mode,
        "image_path": image_path,
        "start_keyframe_path": image_path,
        "end_keyframe_path": str(end_image) if end_image else None,
        "video_path": video_path,
        "frames": frames,
        "wan_steps": wan_steps,
        "flux_steps": flux_steps,
        **keyframe_meta,
        "keyframe_frame_mode": keyframe_frame_mode,
        "keyframe_prompt": keyframe_prompt,
        "video_prompt": video_prompt,
        "negative_prompt": keyframe_negative,
        "keyframe_validation": keyframe_validation,
        "prompt_used": prompt_manifest(),
        "warnings": warnings,
        "errors": [],
        "comfyui": {"keyframe_prompt_id": keyframe_prompt_id, "flux_prompt_id": keyframe_prompt_id if keyframe_engine == "flux" else None, "wan_prompt_id": wan_prompt_id, "video_ref": video_ref},
    }

def main() -> int:
    parser = argparse.ArgumentParser(description="Generate a local Hermes video through ComfyUI.")
    parser.add_argument("--prompt", required=True)
    parser.add_argument("--mode", choices=["test", "quality"], default="quality")
    parser.add_argument("--style-preset", choices=["default", "anime_action"], default="default")
    parser.add_argument("--shot-prompt-type", default="single")
    parser.add_argument("--keyframe-quality-preset", choices=["flux_default", "anime_action_v2"], default="flux_default")
    parser.add_argument("--composition-profile", choices=["auto", "establishing", "closeup", "action", "impact"], default="auto")
    parser.add_argument("--shot-prompt-strength", choices=["light", "balanced", "strong"], default="balanced")
    parser.add_argument("--character-consistency-note", default="")
    parser.add_argument("--control-mode", choices=["i2v_last_frame", "flf2v"], default="i2v_last_frame")
    parser.add_argument("--env-file", default=DEFAULT_ENV_FILE)
    parser.add_argument("--flux-workflow", default=DEFAULT_FLUX_WORKFLOW)
    parser.add_argument("--animagine-workflow", default=DEFAULT_ANIMAGINE_WORKFLOW)
    parser.add_argument("--wan-workflow", default=DEFAULT_WAN_WORKFLOW)
    parser.add_argument("--wan-flf-workflow", default=DEFAULT_WAN_FLF_WORKFLOW)
    parser.add_argument("--input-image", default="", help="Optional existing start keyframe image. When set, skip Flux for the start frame.")
    parser.add_argument("--end-image", default="", help="Optional end keyframe image for FLF2V.")
    parser.add_argument("--keyframe-only", action="store_true", help="Generate only a keyframe and skip Wan video generation.")
    parser.add_argument("--keyframe-engine", choices=["auto", "flux", "animagine"], default="auto", help="Keyframe renderer. auto uses Animagine for anime_action when the checkpoint is available.")
    parser.add_argument("--keyframe-frame-mode", choices=["single_scene", "stylized_panel"], default="", help="Animagine frame composition mode. Defaults to single_scene for anime_action+animagine, otherwise preserves existing stylized panel behavior.")
    parser.add_argument("--frames", type=int, default=0, help="Override Wan frame count for this shot.")
    parser.add_argument("--wan-steps", type=int, default=0, help="Override Wan KSampler steps for this shot.")
    parser.add_argument("--flux-steps", type=int, default=0, help="Override Flux keyframe KSampler steps.")
    parser.add_argument("--seed", type=int, default=None)
    args = parser.parse_args()
    try:
        print(json.dumps(run(args), ensure_ascii=False, indent=2))
        return 0
    except Exception as exc:
        print(json.dumps({"status": "error", "image_path": None, "video_path": None, "prompt_used": None, "errors": [str(exc)]}, ensure_ascii=False, indent=2), file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
