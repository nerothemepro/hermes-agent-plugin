#!/usr/bin/env python3
"""Generate a multi-shot local video sequence with ComfyUI + Wan2.1.

The sequence path builds action-oriented storyboard shots, renders Flux
keyframes, runs Wan I2V/FLF2V shots, stitches them, and optionally normalizes the
final FPS with ffmpeg.
"""

from __future__ import annotations

import argparse
import json
import math
import random
import shutil
import shlex
import subprocess
import sys
import time
import uuid
import mimetypes
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import Request, urlopen
from typing import Any

try:
    import imageio_ffmpeg
except Exception as exc:  # pragma: no cover - surfaced as a runtime setup error
    imageio_ffmpeg = None
    IMAGEIO_FFMPEG_IMPORT_ERROR = exc
else:
    IMAGEIO_FFMPEG_IMPORT_ERROR = None

PROJECT_DIR = Path('/workspace/projects/media-pipeline')
PIPELINE_SCRIPT = PROJECT_DIR / 'generate_video.py'
DEFAULT_ENV_FILE = '/opt/data/hermes/media-pipeline.env'
DEFAULT_VIDEO_DIR = Path('/opt/data/hermes/generated-videos')
DEFAULT_IMAGE_DIR = Path('/opt/data/hermes/generated-images')
SEQUENCE_WORK_DIR = Path('/opt/data/hermes/media-sequences')
DEFAULT_WAN_FLF_WORKFLOW = PROJECT_DIR / 'workflows/wan_flf2v_api.json'
IMAGE_EXTENSIONS = {'.png', '.jpg', '.jpeg', '.webp'}
VIDEO_EXTENSIONS = {'.mp4', '.webm', '.mov', '.mkv'}
BASE_SOURCE_FPS = 8
DEFAULT_COMFYUI_BASE_URL = 'http://host.docker.internal:8188'
ANIME_ACTION_DEFAULT_CHARACTER_NOTE = (
    'Fighter A: black hair, deep indigo robe, white sash, water-blue katana trail. '
    'Fighter B: white hair, charcoal robe, red scarf, fire-red katana trail. '
    'Only these two original adult anime swordfighters appear in every shot. '
    'Same faces, robes, katanas, colors across all shots. No logos.'
)



class SequenceError(RuntimeError):
    pass


def eprint(message: str) -> None:
    print(message, file=sys.stderr, flush=True)


def load_env_file(path: str) -> dict[str, str]:
    env_path = Path(path)
    if not env_path.exists():
        return {}
    result: dict[str, str] = {}
    for raw_line in env_path.read_text(encoding='utf-8').splitlines():
        line = raw_line.strip()
        if not line or line.startswith('#'):
            continue
        if line.startswith('export '):
            line = line[len('export '):].strip()
        if '=' not in line:
            continue
        key, value = line.split('=', 1)
        result[key.strip()] = value.strip().strip('"').strip("'")
    return result


def slugify(text: str, limit: int = 52) -> str:
    import re

    text = re.sub(r'[^a-z0-9]+', '-', text.lower()).strip('-')
    return (text or 'sequence')[:limit].strip('-') or 'sequence'


def coerce_duration(value: int) -> int:
    return max(8, min(30, value))


def clamp_int(value: int, low: int, high: int) -> int:
    return max(low, min(high, value))


def odd_frame_count(value: int) -> int:
    frames = clamp_int(value, 5, 33)
    if frames % 2 == 0:
        frames += 1 if frames < 33 else -1
    return frames


def shot_count_for_duration(duration_seconds: int, mode: str, style_preset: str = 'default', motion_profile: str = 'balanced', shot_duration_seconds: float = 0.0) -> int:
    if style_preset == 'anime_action':
        if shot_duration_seconds > 0:
            return clamp_int(max(3, int(round(duration_seconds / shot_duration_seconds))), 3, 15)
        if duration_seconds <= 8:
            return 4
        if duration_seconds <= 12:
            return 6
        if duration_seconds <= 16:
            return 8
        if duration_seconds <= 20:
            return 10
        target = 1.75 if motion_profile == 'rapid' else 2.0
        return clamp_int(int(math.ceil(duration_seconds / target)), 12, 15)

    if mode == 'test':
        return 2 if duration_seconds <= 15 else 3
    if duration_seconds <= 15:
        return 4
    if duration_seconds <= 22:
        return 5
    return 8


def frames_per_shot_for_plan(style_preset: str, mode: str, motion_profile: str, shot_duration_seconds: float, requested_frames: int) -> int:
    if requested_frames > 0:
        return odd_frame_count(requested_frames)
    if shot_duration_seconds > 0:
        return odd_frame_count(int(round(shot_duration_seconds * BASE_SOURCE_FPS)))
    if style_preset != 'anime_action':
        return 5 if mode == 'test' else 33
    if mode == 'test':
        return 17
    profile_frames = {
        'rapid': 13,
        'balanced': 17,
        'dramatic': 21,
        'impact': 17,
    }
    return profile_frames.get(motion_profile, 17)


def wan_steps_for_plan(style_preset: str, mode: str, motion_profile: str, requested_steps: int) -> int:
    if requested_steps > 0:
        return clamp_int(requested_steps, 1, 30)
    if style_preset != 'anime_action':
        return 1 if mode == 'test' else 20
    if mode == 'test':
        return 2
    profile_steps = {
        'rapid': 16,
        'balanced': 18,
        'dramatic': 20,
        'impact': 20,
    }
    return profile_steps.get(motion_profile, 18)


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
            if not line.startswith('{'):
                continue
            try:
                payload = json.loads(line)
            except json.JSONDecodeError:
                continue
            if isinstance(payload, dict):
                return payload

        for index, char in enumerate(text):
            if char != '{':
                continue
            try:
                payload, end = decoder.raw_decode(text[index:])
            except json.JSONDecodeError:
                continue
            if isinstance(payload, dict) and text[index + end:].strip() == '':
                return payload
    raise SequenceError(f'Child pipeline did not return JSON; stdout={stdout[-1000:]!r}; stderr={stderr[-1000:]!r}')


def ffmpeg_exe() -> str:
    if imageio_ffmpeg is not None:
        exe = imageio_ffmpeg.get_ffmpeg_exe()
        if exe and Path(exe).exists():
            return exe
    exe = shutil.which('ffmpeg')
    if exe:
        return exe
    raise SequenceError(f'imageio-ffmpeg is not installed and system ffmpeg was not found: {IMAGEIO_FFMPEG_IMPORT_ERROR}')


def run_command(cmd: list[str], timeout: int) -> subprocess.CompletedProcess[str]:
    return subprocess.run(cmd, cwd=str(PROJECT_DIR), text=True, capture_output=True, timeout=timeout, check=False)


def recover_recent_output(prompt: str, directory: Path, suffixes: set[str], since: float, label: str) -> Path | None:
    prefix = slugify(prompt)
    candidates: list[Path] = []
    if not directory.exists():
        return None
    for item in directory.iterdir():
        if not item.is_file() or item.suffix.lower() not in suffixes:
            continue
        if not item.name.startswith(prefix):
            continue
        try:
            stat = item.stat()
        except OSError:
            continue
        if stat.st_size > 0 and stat.st_mtime >= since - 5:
            candidates.append(item)
    if not candidates:
        return None
    recovered = max(candidates, key=lambda path: path.stat().st_mtime).resolve()
    eprint(f'[recover] {label}={recovered}')
    return recovered


def require_file(path: str | Path | None, suffixes: set[str], label: str) -> Path:
    if not path:
        raise SequenceError(f'{label} path is missing')
    resolved = Path(path).expanduser().resolve()
    if resolved.suffix.lower() not in suffixes:
        raise SequenceError(f'{label} has unsupported extension: {resolved}')
    if not resolved.exists() or not resolved.is_file():
        raise SequenceError(f'{label} does not exist: {resolved}')
    if resolved.stat().st_size <= 0:
        raise SequenceError(f'{label} is empty: {resolved}')
    return resolved


def extract_tail_frame(video_path: Path, output_path: Path, ffmpeg: str) -> Path:
    output_path.parent.mkdir(parents=True, exist_ok=True)
    cmd = [ffmpeg, '-y', '-sseof', '-0.15', '-i', str(video_path), '-frames:v', '1', '-q:v', '2', str(output_path)]
    proc = run_command(cmd, timeout=120)
    if proc.returncode != 0 or not output_path.exists() or output_path.stat().st_size <= 0:
        fallback_cmd = [ffmpeg, '-y', '-i', str(video_path), '-vf', 'select=eq(n\\,0)', '-frames:v', '1', '-q:v', '2', str(output_path)]
        proc = run_command(fallback_cmd, timeout=120)
    if proc.returncode != 0 or not output_path.exists() or output_path.stat().st_size <= 0:
        raise SequenceError(f'Failed to extract tail frame from {video_path}: {proc.stderr[-1200:]}')
    return output_path.resolve()


def concat_videos(video_paths: list[Path], output_path: Path, work_dir: Path, ffmpeg: str) -> Path:
    output_path.parent.mkdir(parents=True, exist_ok=True)
    list_path = work_dir / 'concat.txt'
    list_path.write_text(''.join(f"file {shlex.quote(str(path))}\n" for path in video_paths), encoding='utf-8')
    cmd = [ffmpeg, '-y', '-f', 'concat', '-safe', '0', '-i', str(list_path), '-c', 'copy', '-movflags', '+faststart', str(output_path)]
    proc = run_command(cmd, timeout=300)
    if proc.returncode != 0 or not output_path.exists() or output_path.stat().st_size <= 0:
        filter_inputs: list[str] = []
        cmd = [ffmpeg, '-y']
        for path in video_paths:
            cmd.extend(['-i', str(path)])
            filter_inputs.append(f'[{len(filter_inputs)}:v:0]')
        filter_complex = ''.join(filter_inputs) + f'concat=n={len(video_paths)}:v=1:a=0[v]'
        cmd.extend(['-filter_complex', filter_complex, '-map', '[v]', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', str(output_path)])
        proc = run_command(cmd, timeout=900)
    if proc.returncode != 0 or not output_path.exists() or output_path.stat().st_size <= 0:
        raise SequenceError(f'Failed to concatenate videos: {proc.stderr[-1600:]}')
    return output_path.resolve()


def frame_interpolation_model_present(env: dict[str, str]) -> bool:
    candidates = [
        env.get('FRAME_INTERPOLATION_MODEL_DIR', ''),
        '/opt/ComfyUI/models/frame_interpolation',
        '/opt/comfyui/models/frame_interpolation',
        '/workspace/ComfyUI/models/frame_interpolation',
    ]
    extensions = {'.safetensors', '.pth', '.pt', '.ckpt', '.bin'}
    for raw in candidates:
        if not raw:
            continue
        path = Path(raw)
        if path.exists() and any(item.is_file() and item.suffix.lower() in extensions for item in path.rglob('*')):
            return True
    return False


def cfg(env: dict[str, str], key: str, default: str) -> str:
    return env.get(key) or default


def endpoint(base_url: str, path: str) -> str:
    return base_url.rstrip('/') + '/' + path.lstrip('/')


def http_json(method: str, url: str, payload: dict[str, Any] | None = None, timeout: int = 30) -> dict[str, Any]:
    data = None
    headers = {'Accept': 'application/json'}
    if payload is not None:
        data = json.dumps(payload).encode('utf-8')
        headers['Content-Type'] = 'application/json'
    req = Request(url, data=data, headers=headers, method=method)
    try:
        with urlopen(req, timeout=timeout) as response:
            body = response.read()
    except HTTPError as exc:
        detail = exc.read().decode('utf-8', errors='replace')
        raise SequenceError(f'HTTP {exc.code} from {url}: {detail}') from exc
    except (URLError, TimeoutError, ConnectionError) as exc:
        raise SequenceError(f'Cannot reach {url}: {getattr(exc, "reason", exc)}') from exc
    if not body:
        return {}
    try:
        return json.loads(body.decode('utf-8'))
    except json.JSONDecodeError as exc:
        raise SequenceError(f'Expected JSON from {url}, got {body[:120]!r}') from exc


def http_bytes(url: str, timeout: int = 300) -> tuple[bytes, str]:
    req = Request(url, headers={'Accept': '*/*'}, method='GET')
    try:
        with urlopen(req, timeout=timeout) as response:
            return response.read(), response.headers.get('Content-Type', '')
    except HTTPError as exc:
        detail = exc.read().decode('utf-8', errors='replace')
        raise SequenceError(f'HTTP {exc.code} from {url}: {detail}') from exc
    except (URLError, TimeoutError, ConnectionError) as exc:
        raise SequenceError(f'Cannot reach {url}: {getattr(exc, "reason", exc)}') from exc


def queue_comfy(comfy_url: str, workflow: dict[str, Any], timeout: int = 30) -> str:
    response = http_json('POST', endpoint(comfy_url, '/prompt'), {'prompt': workflow, 'client_id': str(uuid.uuid4())}, timeout=timeout)
    node_errors = response.get('node_errors') or {}
    if node_errors:
        raise SequenceError(f'ComfyUI rejected interpolation workflow: {node_errors}')
    prompt_id = response.get('prompt_id')
    if not prompt_id:
        raise SequenceError(f'ComfyUI did not return prompt_id: {response}')
    return str(prompt_id)


def poll_comfy(comfy_url: str, prompt_id: str, timeout_seconds: int = 900, poll_seconds: float = 2.0) -> dict[str, Any]:
    deadline = time.time() + timeout_seconds
    last_queue = None
    last_error = None
    while time.time() < deadline:
        try:
            history = http_json('GET', endpoint(comfy_url, f'/history/{prompt_id}'), timeout=30)
        except SequenceError as exc:
            last_error = str(exc)
            time.sleep(min(poll_seconds * 2, 20))
            continue
        item = history.get(prompt_id)
        if item:
            status = item.get('status', {})
            if status.get('status_str') == 'error':
                raise SequenceError(f'ComfyUI interpolation job failed: {json.dumps(status, ensure_ascii=False)}')
            if status.get('completed') is True or item.get('outputs'):
                return item
        try:
            last_queue = http_json('GET', endpoint(comfy_url, '/queue'), timeout=10)
        except SequenceError as exc:
            last_error = str(exc)
        time.sleep(poll_seconds)
    raise SequenceError(f'Timed out waiting for ComfyUI interpolation prompt {prompt_id}; queue={last_queue}; last_error={last_error}')


def upload_video_to_comfy(comfy_url: str, video_path: Path, name: str) -> str:
    boundary = '----hermes-video-' + uuid.uuid4().hex
    mime = mimetypes.guess_type(video_path.name)[0] or 'video/mp4'
    fields: list[tuple[str, str | tuple[str, bytes, str]]] = [
        ('type', 'input'),
        ('overwrite', 'true'),
        ('image', (name, video_path.read_bytes(), mime)),
    ]
    body = bytearray()
    for field_name, value in fields:
        body.extend(f'--{boundary}\r\n'.encode('utf-8'))
        if isinstance(value, tuple):
            filename, data, content_type = value
            body.extend((f'Content-Disposition: form-data; name="{field_name}"; filename="{filename}"\r\nContent-Type: {content_type}\r\n\r\n').encode('utf-8'))
            body.extend(data)
            body.extend(b'\r\n')
        else:
            body.extend(f'Content-Disposition: form-data; name="{field_name}"\r\n\r\n'.encode('utf-8'))
            body.extend(value.encode('utf-8'))
            body.extend(b'\r\n')
    body.extend(f'--{boundary}--\r\n'.encode('utf-8'))
    req = Request(endpoint(comfy_url, '/upload/image'), data=bytes(body), headers={'Content-Type': f'multipart/form-data; boundary={boundary}'}, method='POST')
    try:
        with urlopen(req, timeout=300) as response:
            payload = json.loads(response.read().decode('utf-8'))
    except HTTPError as exc:
        detail = exc.read().decode('utf-8', errors='replace')
        raise SequenceError(f'Video upload failed HTTP {exc.code}: {detail}') from exc
    except (URLError, TimeoutError, ConnectionError) as exc:
        raise SequenceError(f'Video upload failed: {getattr(exc, "reason", exc)}') from exc
    return str(payload.get('name') or name)


def find_output_ref(history_item: dict[str, Any], extensions: set[str]) -> dict[str, str]:
    for output in (history_item.get('outputs') or {}).values():
        candidates = []
        candidates.extend(output.get('images') or [])
        candidates.extend(output.get('videos') or [])
        for item in candidates:
            filename = item.get('filename')
            if filename and Path(filename).suffix.lower() in extensions:
                return {'filename': filename, 'subfolder': item.get('subfolder', ''), 'type': item.get('type', 'output')}
    raise SequenceError(f'No ComfyUI output file with extensions {sorted(extensions)} found')


def download_comfy_file(comfy_url: str, ref: dict[str, str], output_path: Path) -> Path:
    params = urlencode({'filename': ref['filename'], 'subfolder': ref.get('subfolder', ''), 'type': ref.get('type', 'output')})
    body, _ = http_bytes(endpoint(comfy_url, f'/view?{params}'), timeout=600)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_bytes(body)
    if not output_path.exists() or output_path.stat().st_size <= 0:
        raise SequenceError(f'Downloaded ComfyUI output is empty: {output_path}')
    return output_path.resolve()


def frame_interpolation_options(comfy_url: str) -> list[str]:
    data = http_json('GET', endpoint(comfy_url, '/object_info/FrameInterpolationModelLoader'), timeout=30)
    node = data.get('FrameInterpolationModelLoader') or {}
    spec = node.get('input', {}).get('required', {}).get('model_name')
    if not spec:
        return []
    if isinstance(spec, list):
        if spec and isinstance(spec[0], list):
            return [str(item) for item in spec[0]]
        if len(spec) > 1 and isinstance(spec[1], dict):
            return [str(item) for item in spec[1].get('options', [])]
    return []


def select_interpolation_model(env: dict[str, str], comfy_url: str) -> str | None:
    options = frame_interpolation_options(comfy_url)
    preferred = env.get('FRAME_INTERPOLATION_MODEL_NAME', '').strip()
    if preferred and preferred in options:
        return preferred
    preferred_order = ['rife_v4.26.safetensors', 'rife_v4.25.safetensors', 'rife_v4.25_lite.safetensors', 'film_net_fp16.safetensors']
    for name in preferred_order:
        if name in options:
            return name
    return options[0] if options else None


def build_frame_interpolation_workflow(video_name: str, model_name: str, target_fps: int, multiplier: int, filename_prefix: str) -> dict[str, Any]:
    return {
        '1': {'class_type': 'LoadVideo', 'inputs': {'file': video_name}},
        '2': {'class_type': 'GetVideoComponents', 'inputs': {'video': ['1', 0]}},
        '3': {'class_type': 'FrameInterpolationModelLoader', 'inputs': {'model_name': model_name}},
        '4': {'class_type': 'FrameInterpolate', 'inputs': {'interp_model': ['3', 0], 'images': ['2', 0], 'multiplier': multiplier}},
        '5': {'class_type': 'CreateVideo', 'inputs': {'images': ['4', 0], 'fps': float(target_fps)}},
        '6': {'class_type': 'SaveVideo', 'inputs': {'video': ['5', 0], 'filename_prefix': filename_prefix, 'format': 'mp4', 'codec': 'h264'}},
    }


def parse_fps(value: str | None) -> float | None:
    if not value:
        return None
    if '/' in value:
        numerator, denominator = value.split('/', 1)
        try:
            den = float(denominator)
            return float(numerator) / den if den else None
        except ValueError:
            return None
    try:
        return float(value)
    except ValueError:
        return None


def probe_video_info(video_path: Path, ffmpeg: str) -> dict[str, Any]:
    ffprobe = shutil.which('ffprobe')
    sibling = Path(ffmpeg).with_name('ffprobe')
    if sibling.exists():
        ffprobe = str(sibling)
    if not ffprobe:
        return {}
    cmd = [
        ffprobe,
        '-v', 'error',
        '-select_streams', 'v:0',
        '-show_entries', 'stream=avg_frame_rate,r_frame_rate,nb_frames',
        '-show_entries', 'format=duration',
        '-of', 'json',
        str(video_path),
    ]
    proc = run_command(cmd, timeout=60)
    if proc.returncode != 0:
        return {}
    try:
        payload = json.loads(proc.stdout)
    except json.JSONDecodeError:
        return {}
    streams = payload.get('streams') or []
    stream = streams[0] if streams else {}
    duration = None
    try:
        duration = float((payload.get('format') or {}).get('duration'))
    except (TypeError, ValueError):
        duration = None
    fps = parse_fps(stream.get('avg_frame_rate')) or parse_fps(stream.get('r_frame_rate'))
    frame_count = None
    try:
        frame_count = int(stream.get('nb_frames'))
    except (TypeError, ValueError):
        frame_count = None
    return {'duration_seconds': duration, 'fps': fps, 'frame_count': frame_count}


def postprocess_video(video_path: Path, output_path: Path, mode: str, target_fps: int, ffmpeg: str, env: dict[str, str], warnings: list[str], source_fps: int = BASE_SOURCE_FPS) -> tuple[Path, str | None, str | None]:
    if mode == 'none':
        return video_path, None, None
    effective_mode = mode
    interpolation_model_name: str | None = None
    if mode == 'frame_interpolate':
        comfy_url = cfg(env, 'COMFYUI_BASE_URL', DEFAULT_COMFYUI_BASE_URL)
        try:
            interpolation_model_name = select_interpolation_model(env, comfy_url)
        except SequenceError as exc:
            warnings.append(f'frame interpolation model check failed; fell back to ffmpeg_fps: {exc}')
            interpolation_model_name = None
        if interpolation_model_name:
            if target_fps % source_fps != 0 or target_fps <= source_fps:
                warnings.append(f'frame interpolation target_fps={target_fps} is not an integer multiple above source_fps={source_fps}; fell back to ffmpeg_fps')
                effective_mode = 'ffmpeg_fps'
            else:
                multiplier = max(2, min(16, target_fps // source_fps))
                try:
                    upload_name = f'hermes_interp_{int(time.time())}_{uuid.uuid4().hex[:8]}{video_path.suffix.lower()}'
                    eprint(f'[interpolate] uploading source video to ComfyUI input as {upload_name}')
                    video_name = upload_video_to_comfy(comfy_url, video_path, upload_name)
                    prefix = f'hermes_video/{output_path.stem}'
                    workflow = build_frame_interpolation_workflow(video_name, interpolation_model_name, target_fps, multiplier, prefix)
                    eprint(f'[interpolate] model={interpolation_model_name} multiplier={multiplier}')
                    prompt_id = queue_comfy(comfy_url, workflow, timeout=30)
                    history = poll_comfy(comfy_url, prompt_id, timeout_seconds=900, poll_seconds=2.0)
                    ref = find_output_ref(history, VIDEO_EXTENSIONS)
                    final_path = download_comfy_file(comfy_url, ref, output_path)
                    return final_path, 'frame_interpolate', interpolation_model_name
                except SequenceError as exc:
                    warnings.append(f'frame interpolation failed with model {interpolation_model_name}; fell back to ffmpeg_fps: {exc}')
                    effective_mode = 'ffmpeg_fps'
        else:
            warnings.append('frame interpolation model missing; fell back to ffmpeg_fps')
            effective_mode = 'ffmpeg_fps'

    output_path.parent.mkdir(parents=True, exist_ok=True)
    cmd = [
        ffmpeg,
        '-y',
        '-i', str(video_path),
        '-vf', f'fps={target_fps}',
        '-r', str(target_fps),
        '-pix_fmt', 'yuv420p',
        '-movflags', '+faststart',
        str(output_path),
    ]
    proc = run_command(cmd, timeout=600)
    if proc.returncode != 0 or not output_path.exists() or output_path.stat().st_size <= 0:
        raise SequenceError(f'Failed to post-process video FPS: {proc.stderr[-1600:]}')
    return output_path.resolve(), effective_mode, interpolation_model_name


def workflow_has_node(path: Path, class_type: str) -> bool:
    if not path.exists():
        return False
    try:
        data = json.loads(path.read_text(encoding='utf-8'))
    except Exception:
        return False
    workflow = data.get('prompt') if isinstance(data, dict) and isinstance(data.get('prompt'), dict) else data
    if not isinstance(workflow, dict):
        return False
    return any(isinstance(node, dict) and node.get('class_type') == class_type for node in workflow.values())


def note_has_concrete_visual_traits(note: str) -> bool:
    lowered = note.lower()
    trait_terms = (
        'hair',
        'robe',
        'sash',
        'scarf',
        'katana',
        'sword',
        'color',
        'blue',
        'red',
        'white',
        'black',
        'charcoal',
        'indigo',
        'fire',
        'water',
        'face',
    )
    return sum(1 for term in trait_terms if term in lowered) >= 3


def default_character_consistency_note(user_note: str) -> str:
    note = " ".join((user_note or "").strip().split())
    if not note:
        return ANIME_ACTION_DEFAULT_CHARACTER_NOTE
    if len(note) < 80 or not note_has_concrete_visual_traits(note):
        return f'{note} {ANIME_ACTION_DEFAULT_CHARACTER_NOTE}'
    return note


def resolve_keyframe_frame_mode(requested_mode: str, style_preset: str, keyframe_engine: str) -> str:
    requested = str(requested_mode or '').strip().lower()
    if requested in {'single_scene', 'stylized_panel'}:
        return requested
    if style_preset == 'anime_action' and keyframe_engine == 'animagine':
        return 'single_scene'
    return ''


def composition_for_title(title: str, requested_profile: str) -> str:
    if requested_profile and requested_profile != 'auto':
        return requested_profile
    lowered = title.lower()
    if any(term in lowered for term in ('eyes', 'hand', 'draw')):
        return 'closeup'
    if any(term in lowered for term in ('clash', 'impact', 'slash')):
        return 'impact'
    if any(term in lowered for term in ('stance', 'aftermath')):
        return 'establishing'
    return 'action'


def keyframe_phase3_suffix(composition_profile: str, shot_prompt_strength: str, character_note: str) -> str:
    profile_words = {
        'establishing': 'wide composition with foreground leaves, midground fighters, moonlit bamboo background, clear two-character spacing',
        'closeup': 'close-up composition with eyes, hands, and katana hilt readable, simplified background, sharp focal silhouette',
        'action': 'dynamic action composition with full-body readable sword pose, diagonal motion path, separated foreground and background',
        'impact': 'cinematic impact composition with blade contact point, sparks, water and fire arcs, silhouettes readable before effects',
        'auto': 'balanced composition with clear foreground, midground action, separated background, readable sword pose',
    }.get(composition_profile, 'balanced composition with readable sword pose')
    strength_words = {
        'light': 'restrained effects, clean pose, no clutter',
        'balanced': 'pose clarity prioritized, effects controlled around the silhouette',
        'strong': 'extra strict anatomy, no tangled limbs, no melted swords, strong graphic silhouette, impact clarity',
    }.get(shot_prompt_strength, 'pose clarity prioritized')
    return (
        f'{profile_words}. {strength_words}. Anime production keyframe, clean cel-shaded line art, crisp ink contour, '
        f'visible katana geometry, readable hands and face, strong silhouette, foreground/midground/background separation. '
        f'Character consistency: {character_note}. Flat 2D anime illustration only, no text, no watermark, no logo, no gore, no 3D render'
    )


ACTION_STORYBOARD_KEYWORDS = (
    'fight', 'fighting', 'clash', 'battle', 'slash', 'counter', 'dodge', 'katana', 'sword', 'duel'
)


def detect_action_keywords(prompt: str) -> list[str]:
    lowered = prompt.lower()
    return [keyword for keyword in ACTION_STORYBOARD_KEYWORDS if keyword in lowered]


def resolve_storyboard_mode(style_preset: str, requested_mode: str, shot_count: int, action_keywords: list[str]) -> str:
    requested = (requested_mode or 'auto').strip().lower()
    if requested in {'intro_action', 'action_core', 'full_arc'}:
        return requested
    if style_preset != 'anime_action':
        return 'auto'
    if not action_keywords:
        return 'intro_action'
    if shot_count >= 8:
        return 'full_arc'
    return 'action_core'


def select_anime_templates(templates_by_title: dict[str, tuple[str, str, str]], shot_count: int, storyboard_mode: str) -> list[tuple[str, str, str]]:
    intro_sequence = [
        'establishing stance',
        'close-up eyes',
        'hand katana draw',
        'dash',
        'blade clash',
        'dodge counter',
        'elemental slash',
        'aftermath pose',
    ]
    action_core_4 = ['close-up eyes', 'dash', 'blade clash', 'dodge counter']
    action_core_6 = ['close-up eyes', 'hand katana draw', 'dash', 'blade clash', 'dodge counter', 'elemental slash']
    full_arc = ['close-up eyes', 'hand katana draw', 'dash', 'blade clash', 'dodge counter', 'counter slash', 'elemental slash', 'aftermath pose']

    if storyboard_mode == 'action_core':
        sequence = action_core_4 if shot_count <= 4 else action_core_6 if shot_count <= 6 else full_arc
    elif storyboard_mode == 'full_arc':
        sequence = full_arc
    else:
        sequence = intro_sequence

    titles: list[str] = []
    while len(titles) < shot_count:
        titles.extend(sequence)
    return [templates_by_title[title] for title in titles[:shot_count]]


def build_storyboard(prompt: str, duration_seconds: int, shot_count: int, style_preset: str, shot_duration_seconds: float, keyframe_quality_preset: str = 'flux_default', shot_prompt_strength: str = 'balanced', character_consistency_note: str = '', composition_profile: str = 'auto', storyboard_mode: str = 'auto') -> list[dict[str, Any]]:
    user_idea = prompt.strip()
    shot_duration = round(shot_duration_seconds, 2)
    if style_preset == 'anime_action':
        action_base = 'two original animated samurai warriors with distinct non-copyrighted robes and katanas in a moonlit bamboo forest'
        templates_by_title = {
            'establishing stance': ('establishing stance', 'wide establishing stance in moonlit bamboo, both original samurai squared off on wet leaves, clear full-body silhouettes', 'both fighters settle into opposing guards as bamboo leaves drift through the frame'),
            'close-up eyes': ('close-up eyes', 'single camera close-up of intense anime eyes under moonlight, one or two faces in one continuous frame, reflected blade edge visible, unified close-up framing', 'the eyes snap toward the opponent in the same continuous close-up frame with a sharp glint and a brief action hold'),
            'hand katana draw': ('hand katana draw', 'single camera close-up hand and katana draw, thumb pushing the guard, fingers tight on the wrapped hilt, unified close-up framing', 'the blade slides out of the scabbard with a clean arc of water and fire light in one continuous frame'),
            'dash': ('dash', 'wide medium-wide side view dash between bamboo trunks, both fighters visible, clear ground plane, robes and hair trailing, feet kicking wet leaves', 'both fighters launch toward each other in one continuous scene and enter the clash line with controlled motion cues'),
            'blade clash': ('blade clash', 'medium-wide cinematic blade clash, both fighters visible in one shared physical space, crossed katanas centered, sparks controlled at the contact point, silhouettes readable', 'the blades lock in one continuous frame with controlled sparks and water and fire trails around the silhouettes'),
            'dodge counter': ('dodge counter', 'low-angle full-body dodge under a sweeping cut, attacker and dodging fighter both visible, counter blade ready, clear body pose', 'the dodging fighter slips under the slash and counters upward from hip level while both fighters remain visible'),
            'counter slash': ('counter slash', 'low-angle counter slash follow-through, foreground katana arc crossing the frame, opponent recoiling but readable', 'the counter slash finishes with a sharp silhouette and controlled water and fire energy trails'),
            'elemental slash': ('elemental slash', 'elemental slash burst, one katana carving a bright water trail and the other a fire trail', 'the slash arcs across the frame in a readable pose-to-pose motion with dramatic compositing'),
            'aftermath pose': ('aftermath pose', 'aftermath pose in low mist, both fighters sliding apart with glowing blades and sharp silhouettes', 'both fighters freeze after the exchange, leaves suspended, eyes still locked'),
        }
        selected = select_anime_templates(templates_by_title, shot_count, storyboard_mode)
        storyboard = []
        character_note = default_character_consistency_note(character_consistency_note)
        for index, (title, start_action, end_action) in enumerate(selected, start=1):
            shot_composition = composition_for_title(title, composition_profile)
            base = f'{action_base}. User idea: {user_idea}. Shot {index}/{shot_count}: '
            style = 'original Japanese shonen anime action only, clean line art, cel shading, sakuga-style motion cues, sharp silhouettes, readable sword pose, dramatic compositing, no gore, no captions, no logo'
            phase3 = keyframe_phase3_suffix(shot_composition, shot_prompt_strength, character_note) if keyframe_quality_preset == 'anime_action_v2' else ''
            suffix = f'{style}. {phase3}' if phase3 else style
            storyboard.append({
                'index': index,
                'title': title,
                'storyboard_mode': storyboard_mode,
                'composition_profile': shot_composition,
                'duration_seconds': shot_duration,
                'start_prompt': f'{base}{start_action}. {suffix}',
                'end_prompt': f'{base}{end_action}. {suffix}',
                'video_prompt': f'{base}transition from {start_action} to {end_action}, coherent sword choreography, elemental water and fire trails, stable original character designs. {style}',
                'prompt': f'{base}{start_action}; then {end_action}. {suffix}',
            })
        return storyboard

    templates = [
        ('establishing shot', 'wide establishing shot with clear subject placement and slow camera move'),
        ('close-up detail', 'close-up insert showing the most important subject detail and tension'),
        ('main action', 'dynamic action beat with clear motion and stable subject identity'),
        ('reaction', 'secondary angle showing the result of the movement'),
        ('ending pose', 'final readable pose with a satisfying visual endpoint'),
    ]
    storyboard = []
    for index, (title, action) in enumerate(templates[:shot_count], start=1):
        prompt_text = f'{user_idea}. Shot {index}/{shot_count}: {action}, coherent motion, no text, no watermark.'
        storyboard.append({'index': index, 'title': title, 'duration_seconds': shot_duration, 'start_prompt': prompt_text, 'end_prompt': prompt_text, 'video_prompt': prompt_text, 'prompt': prompt_text})
    return storyboard

def is_transient_shot_error(detail: str) -> bool:
    lowered = detail.lower()
    needles = (
        'remote end closed connection',
        'remote disconnected',
        'connection reset',
        'connection aborted',
        'network is unreachable',
        'temporarily unavailable',
        'cannot reach http://host.docker.internal:8188',
    )
    return any(item in lowered for item in needles)


def run_single_shot(prompt: str, mode: str, seed: int, input_image: Path | None, end_image: Path | None, style_preset: str, control_mode: str, shot_prompt_type: str, keyframe_only: bool, frames_per_shot: int, wan_steps_per_shot: int, keyframe_quality_preset: str, composition_profile: str, shot_prompt_strength: str, character_consistency_note: str, keyframe_engine: str, keyframe_frame_mode: str, timeout: int) -> dict[str, Any]:
    cmd = [sys.executable, str(PIPELINE_SCRIPT), '--prompt', prompt, '--mode', mode, '--seed', str(seed), '--style-preset', style_preset, '--shot-prompt-type', shot_prompt_type, '--keyframe-engine', keyframe_engine]
    if keyframe_frame_mode:
        cmd.extend(['--keyframe-frame-mode', keyframe_frame_mode])
    if Path(DEFAULT_ENV_FILE).exists():
        cmd.extend(['--env-file', DEFAULT_ENV_FILE])
    if frames_per_shot > 0:
        cmd.extend(['--frames', str(frames_per_shot)])
    if wan_steps_per_shot > 0:
        cmd.extend(['--wan-steps', str(wan_steps_per_shot)])
    cmd.extend(['--keyframe-quality-preset', keyframe_quality_preset, '--composition-profile', composition_profile, '--shot-prompt-strength', shot_prompt_strength])
    if character_consistency_note:
        cmd.extend(['--character-consistency-note', character_consistency_note])
    if keyframe_only:
        cmd.append('--keyframe-only')
    else:
        cmd.extend(['--control-mode', control_mode])
    if input_image:
        cmd.extend(['--input-image', str(input_image)])
    if end_image:
        cmd.extend(['--end-image', str(end_image)])

    last_detail = ''
    max_attempts = 4
    for attempt in range(max_attempts):
        attempt_started = time.time()
        try:
            proc = run_command(cmd, timeout=timeout)
        except subprocess.TimeoutExpired:
            last_detail = f'child pipeline timed out after {timeout} seconds'
            recovered = recover_recent_output(prompt, DEFAULT_IMAGE_DIR if keyframe_only else DEFAULT_VIDEO_DIR, IMAGE_EXTENSIONS if keyframe_only else VIDEO_EXTENSIONS, attempt_started, 'keyframe' if keyframe_only else 'shot video')
            if recovered:
                return {
                    'status': 'completed',
                    'image_path': str(recovered) if keyframe_only else (str(input_image) if input_image else None),
                    'video_path': None if keyframe_only else str(recovered),
                    'start_keyframe_path': str(recovered) if keyframe_only else (str(input_image) if input_image else None),
                    'end_keyframe_path': str(end_image) if end_image else None,
                    'keyframe_prompt': prompt,
                    'negative_prompt': None,
                    'comfyui': {'recovered_after': last_detail},
                }
            if attempt < max_attempts - 1:
                time.sleep(20)
                continue
            break
        payload = parse_pipeline_json(proc.stdout, proc.stderr)
        if proc.returncode == 0 and payload.get('status') == 'completed':
            image_path = payload.get('image_path')
            if image_path:
                payload['image_path'] = str(require_file(image_path, IMAGE_EXTENSIONS, 'shot image'))
            if not keyframe_only:
                payload['video_path'] = str(require_file(payload.get('video_path'), VIDEO_EXTENSIONS, 'shot video'))
            return payload

        errors = payload.get('errors') if isinstance(payload.get('errors'), list) else []
        detail = '; '.join(str(item) for item in errors) or proc.stderr[-1600:] or proc.stdout[-1600:]
        last_detail = detail
        if is_transient_shot_error(detail) or 'timed out waiting for comfyui prompt' in detail.lower() or 'empty_queue_seconds' in detail.lower():
            recovered = recover_recent_output(prompt, DEFAULT_IMAGE_DIR if keyframe_only else DEFAULT_VIDEO_DIR, IMAGE_EXTENSIONS if keyframe_only else VIDEO_EXTENSIONS, attempt_started, 'keyframe' if keyframe_only else 'shot video')
            if recovered:
                return {
                    'status': 'completed',
                    'image_path': str(recovered) if keyframe_only else (str(input_image) if input_image else None),
                    'video_path': None if keyframe_only else str(recovered),
                    'start_keyframe_path': str(recovered) if keyframe_only else (str(input_image) if input_image else None),
                    'end_keyframe_path': str(end_image) if end_image else None,
                    'keyframe_prompt': prompt,
                    'negative_prompt': None,
                    'comfyui': {'recovered_after': detail},
                }
        retryable_detail = is_transient_shot_error(detail) or 'timed out waiting for comfyui prompt' in detail.lower() or 'empty_queue_seconds' in detail.lower()
        if attempt < max_attempts - 1 and retryable_detail:
            eprint(f'[retry] retryable child pipeline error on attempt {attempt + 1}/{max_attempts}: {detail[:500]}')
            time.sleep(20 + attempt * 10)
            continue
        break
    raise SequenceError(f'shot generation failed: {last_detail}')


def run(args: argparse.Namespace) -> dict[str, Any]:
    started_at = time.time()
    if not PIPELINE_SCRIPT.exists():
        raise SequenceError(f'generate_video.py not found: {PIPELINE_SCRIPT}')
    env = load_env_file(DEFAULT_ENV_FILE)
    duration = coerce_duration(int(args.duration_seconds))
    mode = args.mode
    style_preset = args.style_preset or ('anime_action' if args.style in {'original_japanese_anime_action', 'anime_action', ''} else 'default')
    motion_profile = str(args.motion_profile or 'balanced').strip().lower()
    keyframe_quality_preset = str(args.keyframe_quality_preset or 'flux_default').strip().lower()
    shot_prompt_strength = str(args.shot_prompt_strength or 'balanced').strip().lower()
    requested_composition_profile = str(args.composition_profile or 'auto').strip().lower()
    requested_storyboard_mode = str(args.storyboard_mode or 'auto').strip().lower()
    keyframe_engine = str(args.keyframe_engine or 'auto').strip().lower()
    keyframe_frame_mode = resolve_keyframe_frame_mode(args.keyframe_frame_mode, style_preset, keyframe_engine)
    character_consistency_note = default_character_consistency_note(args.character_consistency_note) if style_preset == 'anime_action' else " ".join((args.character_consistency_note or '').strip().split())
    requested_shot_duration = max(0.0, float(args.shot_duration_seconds or 0.0))
    requested_control_mode = args.control_mode
    effective_control_mode = requested_control_mode
    warnings: list[str] = []
    existing_keyframe_dir = Path(args.existing_keyframe_dir).resolve() if args.existing_keyframe_dir else None
    if existing_keyframe_dir is not None:
        if not existing_keyframe_dir.exists() or not existing_keyframe_dir.is_dir():
            raise SequenceError(f'existing_keyframe_dir not found or not a directory: {existing_keyframe_dir}')
        if effective_control_mode != 'flf2v':
            warnings.append('existing_keyframe_dir requires flf2v; using flf2v')
            effective_control_mode = 'flf2v'
    if args.keyframe_only_sequence and effective_control_mode != 'flf2v':
        warnings.append('keyframe_only_sequence requires start/end keyframes; using flf2v keyframe planning without Wan render')
        effective_control_mode = 'flf2v'
    if not args.keyframe_only_sequence and effective_control_mode == 'flf2v' and not workflow_has_node(DEFAULT_WAN_FLF_WORKFLOW, 'WanFirstLastFrameToVideo'):
        warnings.append(f'wan_flf2v_api.json missing or has no WanFirstLastFrameToVideo node; falling back to i2v_last_frame')
        effective_control_mode = 'i2v_last_frame'
    auto_shot_count = shot_count_for_duration(duration, mode, style_preset, motion_profile, requested_shot_duration)
    if style_preset == 'anime_action':
        if int(args.shot_count or 0) > 0:
            shot_count = clamp_int(int(args.shot_count), 1, 15)
        else:
            shot_count = clamp_int(auto_shot_count, 3, 15)
    else:
        shot_count = int(args.shot_count or auto_shot_count)
        shot_count = max(2, min(8, shot_count)) if mode == 'quality' else max(1, min(3, shot_count))
    frames_per_shot = frames_per_shot_for_plan(style_preset, mode, motion_profile, requested_shot_duration, int(args.frames_per_shot or 0))
    wan_steps_per_shot = wan_steps_for_plan(style_preset, mode, motion_profile, int(args.wan_steps_per_shot or 0))
    effective_shot_duration = frames_per_shot / BASE_SOURCE_FPS
    planned_source_duration = round(shot_count * effective_shot_duration, 3)
    duration_delta = round(planned_source_duration - duration, 3)
    if abs(duration_delta) > 0.75:
        warnings.append(f'planned source duration {planned_source_duration:.2f}s differs from requested {duration}s by {duration_delta:+.2f}s because shot_count={shot_count} and frames_per_shot={frames_per_shot} at {BASE_SOURCE_FPS}fps')
    seed = args.seed if args.seed is not None else random.randint(0, 2**31 - 1)
    run_id = f'{int(time.time())}-{uuid.uuid4().hex[:8]}'
    slug = slugify(args.prompt)
    work_dir = SEQUENCE_WORK_DIR / f'{slug}-{run_id}'
    frame_dir = work_dir / 'frames'
    keyframe_dir = work_dir / 'keyframes'
    work_dir.mkdir(parents=True, exist_ok=True)
    frame_dir.mkdir(parents=True, exist_ok=True)
    keyframe_dir.mkdir(parents=True, exist_ok=True)
    if args.keyframe_only_sequence:
        try:
            ffmpeg = ffmpeg_exe()
        except SequenceError as exc:
            ffmpeg = ''
            warnings.append(f'contact sheet disabled because ffmpeg is unavailable: {exc}')
    else:
        ffmpeg = ffmpeg_exe()
    target_fps = max(8, min(24, int(args.target_fps)))
    action_keywords_detected = detect_action_keywords(args.prompt) if style_preset == 'anime_action' else []
    storyboard_mode = resolve_storyboard_mode(style_preset, requested_storyboard_mode, shot_count, action_keywords_detected)
    action_core_selected = style_preset == 'anime_action' and storyboard_mode == 'action_core'
    storyboard = build_storyboard(args.prompt, duration, shot_count, style_preset, effective_shot_duration, keyframe_quality_preset, shot_prompt_strength, character_consistency_note, requested_composition_profile, storyboard_mode)
    selected_shot_titles = [str(shot.get('title')) for shot in storyboard]
    shot_prompt_type = 'anime_action_storyboard' if style_preset == 'anime_action' else 'storyboard'

    shot_results: list[dict[str, Any]] = []
    shot_videos: list[Path] = []
    next_input: Path | None = None
    next_start_keyframe: Path | None = None

    def append_child_warnings(payload: dict[str, Any], label: str) -> None:
        child_warnings = payload.get('warnings') if isinstance(payload.get('warnings'), list) else []
        for warning in child_warnings:
            warnings.append(f'{label}: {warning}')

    def keyframe_value(*payloads: dict[str, Any] | None, key: str) -> Any:
        for payload in payloads:
            if isinstance(payload, dict) and payload.get(key) is not None:
                return payload.get(key)
        return None

    def copy_keyframe(path: Path, shot_index: int, role: str) -> Path:
        source = require_file(path, {'.png'}, f'shot {shot_index} {role} keyframe')
        target = keyframe_dir / f'shot_{shot_index:02d}_{role}.png'
        if source.resolve() != target.resolve():
            shutil.copy2(source, target)
        if target.stat().st_size <= 0:
            raise SequenceError(f'copied keyframe is empty: {target}')
        return target.resolve()

    def existing_keyframe_path(shot_index: int, role: str) -> Path:
        if existing_keyframe_dir is None:
            raise SequenceError('existing_keyframe_dir is not set')
        return require_file(existing_keyframe_dir / f'shot_{shot_index:02d}_{role}.png', {'.png'}, f'existing shot {shot_index} {role} keyframe')

    def build_contact_sheet(image_paths: list[Path]) -> Path | None:
        if not image_paths or not ffmpeg:
            return None
        sheet_inputs = keyframe_dir / 'sheet_inputs'
        sheet_inputs.mkdir(parents=True, exist_ok=True)
        for idx, image_path in enumerate(image_paths, start=1):
            shutil.copy2(image_path, sheet_inputs / f'{idx:03d}.png')
        rows = max(1, math.ceil(len(image_paths) / 2))
        output_path = keyframe_dir / 'contact_sheet.jpg'
        vf = f'scale=416:240:force_original_aspect_ratio=decrease,pad=416:240:(ow-iw)/2:(oh-ih)/2,tile=2x{rows}'
        cmd = [ffmpeg, '-y', '-framerate', '1', '-i', str(sheet_inputs / '%03d.png'), '-vf', vf, '-frames:v', '1', str(output_path)]
        proc = run_command(cmd, timeout=120)
        if proc.returncode != 0 or not output_path.exists() or output_path.stat().st_size <= 0:
            warnings.append(f'contact sheet generation failed: {proc.stderr[-800:]}')
            return None
        return output_path.resolve()

    def write_partial_manifest(errors: list[str]) -> Path:
        partial_path = work_dir / 'partial_manifest.json'
        partial = {
            'status': 'partial_error',
            'prompt': args.prompt,
            'style_preset': style_preset,
            'mode': mode,
            'duration_seconds_requested': duration,
            'duration_seconds_planned_source': planned_source_duration,
            'shot_count': shot_count,
            'shot_duration_seconds': effective_shot_duration,
            'frames_per_shot': frames_per_shot,
            'wan_steps_per_shot': wan_steps_per_shot,
            'motion_profile': motion_profile,
            'storyboard_mode_requested': requested_storyboard_mode,
            'storyboard_mode': storyboard_mode,
            'selected_shot_titles': selected_shot_titles,
            'action_keywords_detected': action_keywords_detected,
            'action_core_selected': action_core_selected,
            'keyframe_quality_preset': keyframe_quality_preset,
            'keyframe_engine_requested': keyframe_engine,
            'keyframe_frame_mode': keyframe_frame_mode or None,
            'shot_prompt_strength': shot_prompt_strength,
            'composition_profile': requested_composition_profile,
            'character_consistency_note': character_consistency_note,
            'source_fps': BASE_SOURCE_FPS,
            'target_fps': target_fps if 'target_fps' in locals() else None,
            'requested_control_mode': requested_control_mode,
            'control_mode': effective_control_mode,
            'work_dir': str(work_dir),
            'keyframe_dir': str(keyframe_dir),
            'existing_keyframe_dir': str(existing_keyframe_dir) if existing_keyframe_dir else None,
            'storyboard': storyboard,
            'shots': shot_results,
            'shot_videos': [str(path) for path in shot_videos],
            'warnings': warnings,
            'errors': errors,
            'runtime_seconds': round(time.time() - started_at, 3),
        }
        partial_path.write_text(json.dumps(partial, ensure_ascii=False, indent=2), encoding='utf-8')
        eprint(f'[partial] manifest={partial_path}')
        return partial_path

    try:
        for shot in storyboard:
            shot_index = int(shot['index'])
            shot_seed = seed + shot_index - 1
            start_keyframe: Path | None = None
            end_keyframe: Path | None = None
            start_payload: dict[str, Any] | None = None
            end_payload: dict[str, Any] | None = None
            shot_payload: dict[str, Any] | None = None
            tail_frame = frame_dir / f'shot_{shot_index:02d}_tail.png'

            if effective_control_mode == 'flf2v':
                if existing_keyframe_dir is not None:
                    eprint(f'[shot {shot_index}/{shot_count}] {shot["title"]}: using existing keyframes')
                    start_keyframe = copy_keyframe(existing_keyframe_path(shot_index, 'start'), shot_index, 'start')
                    end_keyframe = copy_keyframe(existing_keyframe_path(shot_index, 'end'), shot_index, 'end')
                elif next_start_keyframe is None:
                    eprint(f'[shot {shot_index}/{shot_count}] {shot["title"]}: start keyframe')
                    try:
                        start_payload = run_single_shot(shot['start_prompt'], mode, shot_seed * 10 + 1, None, None, style_preset, 'i2v_last_frame', shot_prompt_type, True, frames_per_shot, wan_steps_per_shot, keyframe_quality_preset, shot.get('composition_profile', requested_composition_profile), shot_prompt_strength, character_consistency_note, keyframe_engine, keyframe_frame_mode, args.per_shot_timeout_seconds)
                        append_child_warnings(start_payload, f'shot {shot_index} start keyframe')
                        start_keyframe = Path(start_payload['image_path']).resolve()
                    except SequenceError as exc:
                        if args.keyframe_only_sequence:
                            raise
                        if mode == 'test' and style_preset == 'anime_action' and next_input is not None:
                            warnings.append(f'shot {shot_index} start keyframe failed in test mode; reusing previous tail frame: {exc}')
                            start_keyframe = next_input
                        else:
                            raise
                else:
                    start_keyframe = next_start_keyframe
                    eprint(f'[shot {shot_index}/{shot_count}] {shot["title"]}: reusing previous end keyframe as start')

                if existing_keyframe_dir is None:
                    eprint(f'[shot {shot_index}/{shot_count}] {shot["title"]}: end keyframe')
                    try:
                        end_payload = run_single_shot(shot['end_prompt'], mode, shot_seed * 10 + 2, None, None, style_preset, 'i2v_last_frame', shot_prompt_type, True, frames_per_shot, wan_steps_per_shot, keyframe_quality_preset, shot.get('composition_profile', requested_composition_profile), shot_prompt_strength, character_consistency_note, keyframe_engine, keyframe_frame_mode, args.per_shot_timeout_seconds)
                        append_child_warnings(end_payload, f'shot {shot_index} end keyframe')
                        end_keyframe = Path(end_payload['image_path']).resolve()
                    except SequenceError as exc:
                        if args.keyframe_only_sequence:
                            raise
                        if mode == 'test' and style_preset == 'anime_action' and start_keyframe is not None:
                            warnings.append(f'shot {shot_index} end keyframe failed in test mode; reusing start keyframe for plumbing: {exc}')
                            end_keyframe = start_keyframe
                        else:
                            raise

                if args.keyframe_only_sequence:
                    copied_start = copy_keyframe(start_keyframe, shot_index, 'start')
                    copied_end = copy_keyframe(end_keyframe, shot_index, 'end')
                    next_start_keyframe = end_keyframe
                    shot_results.append({
                        'index': shot_index,
                        'title': shot['title'],
                        'composition_profile': shot.get('composition_profile'),
                        'prompt': shot['prompt'],
                        'start_prompt': shot['start_prompt'],
                        'end_prompt': shot['end_prompt'],
                        'video_prompt': shot['video_prompt'],
                        'start_keyframe_prompt': shot['start_prompt'],
                        'end_keyframe_prompt': shot['end_prompt'],
                        'seed': shot_seed,
                        'control_mode': 'keyframe_only_sequence',
                        'duration_seconds': effective_shot_duration,
                        'frames_per_shot': frames_per_shot,
                        'wan_steps_per_shot': wan_steps_per_shot,
                        'video_path': None,
                        'image_path': str(copied_start),
                        'start_keyframe_path': str(copied_start),
                        'end_keyframe_path': str(copied_end),
                        'tail_frame_path': None,
                        'keyframe_engine': keyframe_value(start_payload, end_payload, key='keyframe_engine'),
                        'keyframe_frame_mode': keyframe_value(start_payload, end_payload, key='keyframe_frame_mode') or keyframe_frame_mode,
                        'keyframe_checkpoint': keyframe_value(start_payload, end_payload, key='keyframe_checkpoint'),
                        'keyframe_workflow': keyframe_value(start_payload, end_payload, key='keyframe_workflow'),
                        'keyframe_sampler': keyframe_value(start_payload, end_payload, key='keyframe_sampler'),
                        'keyframe_steps': keyframe_value(start_payload, end_payload, key='keyframe_steps'),
                        'keyframe_cfg': keyframe_value(start_payload, end_payload, key='keyframe_cfg'),
                        'keyframe_resolution': keyframe_value(start_payload, end_payload, key='keyframe_resolution'),
                        'keyframe_prompt': keyframe_value(start_payload, end_payload, key='keyframe_prompt'),
                        'negative_prompt': keyframe_value(start_payload, end_payload, key='negative_prompt'),
                        'keyframe_validation': {'start': keyframe_value(start_payload, key='keyframe_validation'), 'end': keyframe_value(end_payload, key='keyframe_validation')},
                        'comfyui': {'start': start_payload.get('comfyui') if start_payload else None, 'end': end_payload.get('comfyui') if end_payload else None},
                    })
                    eprint(f'[shot {shot_index}/{shot_count}] keyframes start={copied_start} end={copied_end}')
                    continue

                try:
                    eprint(f'[shot {shot_index}/{shot_count}] {shot["title"]}: video render ({effective_control_mode})')
                    shot_payload = run_single_shot(shot['video_prompt'], mode, shot_seed, start_keyframe, end_keyframe, style_preset, 'flf2v', shot_prompt_type, False, frames_per_shot, wan_steps_per_shot, keyframe_quality_preset, shot.get('composition_profile', requested_composition_profile), shot_prompt_strength, character_consistency_note, keyframe_engine, keyframe_frame_mode, args.per_shot_timeout_seconds)
                    append_child_warnings(shot_payload, f'shot {shot_index} video')
                except SequenceError as exc:
                    if mode == 'test' and style_preset == 'anime_action' and shot_videos:
                        warnings.append(f'shot {shot_index} video render failed in test mode; reusing previous shot video for plumbing: {exc}')
                        shot_payload = {
                            'status': 'completed',
                            'video_path': str(shot_videos[-1]),
                            'image_path': str(start_keyframe) if start_keyframe else None,
                            'start_keyframe_path': str(start_keyframe) if start_keyframe else None,
                            'end_keyframe_path': str(end_keyframe) if end_keyframe else None,
                            'keyframe_prompt': shot['start_prompt'],
                            'negative_prompt': None,
                            'comfyui': {'reused_previous_shot_video': True},
                        }
                    else:
                        if 'WanFirstLastFrameToVideo' not in str(exc) and 'wan_flf2v' not in str(exc) and 'flf' not in str(exc).lower():
                            raise
                        warnings.append(f'FLF2V failed on shot {shot_index}; falling back to i2v_last_frame: {exc}')
                        effective_control_mode = 'i2v_last_frame'
                        shot_payload = run_single_shot(shot['video_prompt'], mode, shot_seed, start_keyframe, None, style_preset, 'i2v_last_frame', shot_prompt_type, False, frames_per_shot, wan_steps_per_shot, keyframe_quality_preset, shot.get('composition_profile', requested_composition_profile), shot_prompt_strength, character_consistency_note, keyframe_engine, keyframe_frame_mode, args.per_shot_timeout_seconds)
                        append_child_warnings(shot_payload, f'shot {shot_index} fallback video')
                        end_keyframe = None
                next_start_keyframe = end_keyframe if effective_control_mode == 'flf2v' else None
            else:
                input_image = next_input if args.continuity == 'last_frame' else None
                eprint(f'[shot {shot_index}/{shot_count}] {shot["title"]}: video render ({effective_control_mode})')
                try:
                    shot_payload = run_single_shot(shot['prompt'], mode, shot_seed, input_image, None, style_preset, 'i2v_last_frame', shot_prompt_type, False, frames_per_shot, wan_steps_per_shot, keyframe_quality_preset, shot.get('composition_profile', requested_composition_profile), shot_prompt_strength, character_consistency_note, keyframe_engine, keyframe_frame_mode, args.per_shot_timeout_seconds)
                    append_child_warnings(shot_payload, f'shot {shot_index} i2v video')
                except SequenceError as exc:
                    if mode == 'test' and style_preset == 'anime_action' and shot_videos:
                        warnings.append(f'shot {shot_index} i2v render failed in test mode; reusing previous shot video for plumbing: {exc}')
                        shot_payload = {'status': 'completed', 'video_path': str(shot_videos[-1]), 'image_path': str(input_image) if input_image else None, 'comfyui': {'reused_previous_shot_video': True}}
                    else:
                        raise
                start_keyframe = Path(shot_payload['image_path']).resolve() if shot_payload.get('image_path') else input_image

            video_path = Path(shot_payload['video_path']).resolve()
            eprint(f'[shot {shot_index}/{shot_count}] complete video={video_path}')
            shot_videos.append(video_path)
            if args.continuity == 'last_frame' and shot_index < shot_count:
                next_input = extract_tail_frame(video_path, tail_frame, ffmpeg)
            shot_results.append({
                'index': shot_index,
                'title': shot['title'],
                'composition_profile': shot.get('composition_profile'),
                'prompt': shot['prompt'],
                'start_prompt': shot['start_prompt'],
                'end_prompt': shot['end_prompt'],
                'video_prompt': shot['video_prompt'],
                'start_keyframe_prompt': shot['start_prompt'],
                'end_keyframe_prompt': shot['end_prompt'],
                'seed': shot_seed,
                'control_mode': effective_control_mode,
                'duration_seconds': effective_shot_duration,
                'frames_per_shot': frames_per_shot,
                'wan_steps_per_shot': wan_steps_per_shot,
                'video_path': str(video_path),
                'image_path': shot_payload.get('image_path'),
                'start_keyframe_path': str(start_keyframe) if start_keyframe else shot_payload.get('start_keyframe_path'),
                'end_keyframe_path': str(end_keyframe) if end_keyframe else shot_payload.get('end_keyframe_path'),
                'tail_frame_path': str(tail_frame.resolve()) if tail_frame.exists() else None,
                'keyframe_engine': keyframe_value(start_payload, end_payload, shot_payload, key='keyframe_engine'),
                'keyframe_frame_mode': keyframe_value(start_payload, end_payload, shot_payload, key='keyframe_frame_mode') or keyframe_frame_mode,
                'keyframe_checkpoint': keyframe_value(start_payload, end_payload, shot_payload, key='keyframe_checkpoint'),
                'keyframe_workflow': keyframe_value(start_payload, end_payload, shot_payload, key='keyframe_workflow'),
                'keyframe_sampler': keyframe_value(start_payload, end_payload, shot_payload, key='keyframe_sampler'),
                'keyframe_steps': keyframe_value(start_payload, end_payload, shot_payload, key='keyframe_steps'),
                'keyframe_cfg': keyframe_value(start_payload, end_payload, shot_payload, key='keyframe_cfg'),
                'keyframe_resolution': keyframe_value(start_payload, end_payload, shot_payload, key='keyframe_resolution'),
                'keyframe_prompt': shot_payload.get('keyframe_prompt'),
                'negative_prompt': shot_payload.get('negative_prompt'),
                'keyframe_validation': keyframe_value(start_payload, end_payload, shot_payload, key='keyframe_validation'),
                'comfyui': shot_payload.get('comfyui'),
            })

    except Exception as exc:
        partial_path = write_partial_manifest([str(exc)])
        raise SequenceError(f'{exc}; partial_manifest_path={partial_path}') from exc

    if args.keyframe_only_sequence:
        keyframe_paths = []
        for shot in shot_results:
            for key in ('start_keyframe_path', 'end_keyframe_path'):
                raw = shot.get(key)
                if raw:
                    keyframe_paths.append(Path(raw))
        contact_sheet = build_contact_sheet(keyframe_paths)
        first_shot = shot_results[0] if shot_results else {}
        runtime_seconds = round(time.time() - started_at, 3)
        manifest = {
            'status': 'completed',
            'prompt': args.prompt,
            'style': args.style,
            'style_preset': style_preset,
            'shot_prompt_type': shot_prompt_type,
            'keyframe_prompt': storyboard[0]['start_prompt'] if storyboard else None,
            'video_prompt': None,
            'negative_prompt': first_shot.get('negative_prompt'),
            'mode': mode,
            'duration_seconds_requested': duration,
            'duration_seconds_planned_source': planned_source_duration,
            'duration_seconds_actual': None,
            'duration_delta_seconds': duration_delta,
            'shot_count': shot_count,
            'shot_duration_seconds': effective_shot_duration,
            'shot_duration_seconds_requested': requested_shot_duration or None,
            'frames_per_shot': frames_per_shot,
            'wan_steps_per_shot': wan_steps_per_shot,
            'motion_profile': motion_profile,
            'storyboard_mode_requested': requested_storyboard_mode,
            'storyboard_mode': storyboard_mode,
            'selected_shot_titles': selected_shot_titles,
            'action_keywords_detected': action_keywords_detected,
            'action_core_selected': action_core_selected,
            'keyframe_quality_preset': keyframe_quality_preset,
            'keyframe_engine_requested': keyframe_engine,
            'keyframe_engine': first_shot.get('keyframe_engine'),
            'keyframe_frame_mode': first_shot.get('keyframe_frame_mode') or keyframe_frame_mode or None,
            'keyframe_checkpoint': first_shot.get('keyframe_checkpoint'),
            'keyframe_workflow': first_shot.get('keyframe_workflow'),
            'keyframe_sampler': first_shot.get('keyframe_sampler'),
            'keyframe_steps': first_shot.get('keyframe_steps'),
            'keyframe_cfg': first_shot.get('keyframe_cfg'),
            'keyframe_resolution': first_shot.get('keyframe_resolution'),
            'shot_prompt_strength': shot_prompt_strength,
            'composition_profile': requested_composition_profile,
            'character_consistency_note': character_consistency_note,
            'runtime_seconds': runtime_seconds,
            'continuity': args.continuity,
            'requested_control_mode': requested_control_mode,
            'control_mode': 'keyframe_only_sequence',
            'postprocess_requested': args.postprocess,
            'postprocess_mode': 'none',
            'effective_postprocess_mode': 'none',
            'interpolation_model_name': None,
            'source_fps': BASE_SOURCE_FPS,
            'target_fps': target_fps,
            'actual_fps': None,
            'actual_frame_count': None,
            'stitched_video_path': None,
            'postprocessed_video_path': None,
            'seed': seed,
            'video_path': None,
            'media': None,
            'work_dir': str(work_dir),
            'keyframe_dir': str(keyframe_dir),
            'existing_keyframe_dir': str(existing_keyframe_dir) if existing_keyframe_dir else None,
            'keyframe_paths': [str(path) for path in keyframe_paths],
            'keyframe_contact_sheet_path': str(contact_sheet) if contact_sheet else None,
            'storyboard': storyboard,
            'shots': shot_results,
            'warnings': warnings,
            'errors': [],
        }
        manifest_path = work_dir / 'manifest.json'
        manifest['manifest_path'] = str(manifest_path)
        manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding='utf-8')
        eprint(f'[sequence] keyframe-only manifest={manifest_path}')
        if contact_sheet:
            eprint(f'[sequence] keyframe contact sheet={contact_sheet}')
        return manifest

    eprint(f'[sequence] stitching {len(shot_videos)} shot videos')
    stitched_path = DEFAULT_VIDEO_DIR / f'{slug}-sequence-{run_id}.mp4'
    stitched_video = concat_videos(shot_videos, stitched_path, work_dir, ffmpeg)
    final_video = stitched_video
    postprocessed_video_path = None
    requested_postprocess_mode = args.postprocess
    effective_postprocess_mode = args.postprocess
    interpolation_model_name = None
    if args.postprocess != 'none':
        post_path = DEFAULT_VIDEO_DIR / f'{slug}-sequence-{run_id}-{target_fps}fps.mp4'
        eprint(f'[sequence] postprocess {args.postprocess} target_fps={target_fps}')
        final_video, effective_postprocess_mode, interpolation_model_name = postprocess_video(stitched_video, post_path, args.postprocess, target_fps, ffmpeg, env, warnings, BASE_SOURCE_FPS)
        postprocessed_video_path = str(final_video)

    video_info = probe_video_info(final_video, ffmpeg)
    actual_duration = video_info.get('duration_seconds')
    actual_fps = video_info.get('fps')
    runtime_seconds = round(time.time() - started_at, 3)

    manifest = {
        'status': 'completed',
        'prompt': args.prompt,
        'style': args.style,
        'style_preset': style_preset,
        'shot_prompt_type': shot_prompt_type,
        'keyframe_prompt': storyboard[0]['start_prompt'] if storyboard else None,
        'video_prompt': storyboard[0]['video_prompt'] if storyboard else None,
        'negative_prompt': shot_results[0].get('negative_prompt') if shot_results else None,
        'mode': mode,
        'duration_seconds_requested': duration,
        'duration_seconds_planned_source': planned_source_duration,
        'duration_seconds_actual': actual_duration,
        'duration_delta_seconds': duration_delta,
        'shot_count': shot_count,
        'shot_duration_seconds': effective_shot_duration,
        'shot_duration_seconds_requested': requested_shot_duration or None,
        'frames_per_shot': frames_per_shot,
        'wan_steps_per_shot': wan_steps_per_shot,
        'motion_profile': motion_profile,
        'storyboard_mode_requested': requested_storyboard_mode,
        'storyboard_mode': storyboard_mode,
        'selected_shot_titles': selected_shot_titles,
        'action_keywords_detected': action_keywords_detected,
        'action_core_selected': action_core_selected,
        'keyframe_quality_preset': keyframe_quality_preset,
        'keyframe_engine_requested': keyframe_engine,
        'keyframe_engine': shot_results[0].get('keyframe_engine') if shot_results else None,
        'keyframe_frame_mode': shot_results[0].get('keyframe_frame_mode') if shot_results else (keyframe_frame_mode or None),
        'keyframe_checkpoint': shot_results[0].get('keyframe_checkpoint') if shot_results else None,
        'keyframe_workflow': shot_results[0].get('keyframe_workflow') if shot_results else None,
        'keyframe_sampler': shot_results[0].get('keyframe_sampler') if shot_results else None,
        'keyframe_steps': shot_results[0].get('keyframe_steps') if shot_results else None,
        'keyframe_cfg': shot_results[0].get('keyframe_cfg') if shot_results else None,
        'keyframe_resolution': shot_results[0].get('keyframe_resolution') if shot_results else None,
        'shot_prompt_strength': shot_prompt_strength,
        'composition_profile': requested_composition_profile,
        'character_consistency_note': character_consistency_note,
        'runtime_seconds': runtime_seconds,
        'continuity': args.continuity,
        'requested_control_mode': requested_control_mode,
        'control_mode': effective_control_mode,
        'postprocess_requested': requested_postprocess_mode,
        'postprocess_mode': effective_postprocess_mode,
        'effective_postprocess_mode': effective_postprocess_mode,
        'interpolation_model_name': interpolation_model_name,
        'source_fps': BASE_SOURCE_FPS,
        'target_fps': target_fps,
        'actual_fps': actual_fps,
        'actual_frame_count': video_info.get('frame_count'),
        'stitched_video_path': str(stitched_video),
        'postprocessed_video_path': postprocessed_video_path,
        'seed': seed,
        'video_path': str(final_video),
        'media': f'MEDIA:{final_video}',
        'work_dir': str(work_dir),
        'keyframe_dir': str(keyframe_dir),
        'existing_keyframe_dir': str(existing_keyframe_dir) if existing_keyframe_dir else None,
        'storyboard': storyboard,
        'shots': shot_results,
        'warnings': warnings,
        'errors': [],
    }
    manifest_path = work_dir / 'manifest.json'
    manifest['manifest_path'] = str(manifest_path)
    manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding='utf-8')
    eprint(f'[sequence] final video={final_video}')
    eprint(f'[sequence] manifest={manifest_path}')
    return manifest


def main() -> int:
    parser = argparse.ArgumentParser(description='Generate a multi-shot Hermes video through ComfyUI + Wan2.1.')
    parser.add_argument('--prompt', required=True)
    parser.add_argument('--duration-seconds', type=int, default=20)
    parser.add_argument('--shot-count', type=int, default=0)
    parser.add_argument('--shot-duration-seconds', type=float, default=0.0)
    parser.add_argument('--frames-per-shot', type=int, default=0)
    parser.add_argument('--wan-steps-per-shot', type=int, default=0)
    parser.add_argument('--motion-profile', choices=['rapid', 'balanced', 'dramatic', 'impact'], default='balanced')
    parser.add_argument('--storyboard-mode', choices=['auto', 'intro_action', 'action_core', 'full_arc'], default='auto')
    parser.add_argument('--keyframe-quality-preset', choices=['flux_default', 'anime_action_v2'], default='flux_default')
    parser.add_argument('--keyframe-engine', choices=['auto', 'flux', 'animagine'], default='auto')
    parser.add_argument('--keyframe-frame-mode', choices=['single_scene', 'stylized_panel'], default='')
    parser.add_argument('--keyframe-only-sequence', action='store_true')
    parser.add_argument('--existing-keyframe-dir', default='', help='Optional directory containing approved shot_XX_start.png and shot_XX_end.png keyframes. Skips keyframe generation and renders Wan from these images.')
    parser.add_argument('--shot-prompt-strength', choices=['light', 'balanced', 'strong'], default='balanced')
    parser.add_argument('--composition-profile', choices=['auto', 'establishing', 'closeup', 'action', 'impact'], default='auto')
    parser.add_argument('--character-consistency-note', default='')
    parser.add_argument('--mode', choices=['test', 'quality'], default='quality')
    parser.add_argument('--style', default='original_japanese_anime_action')
    parser.add_argument('--style-preset', choices=['default', 'anime_action'], default='anime_action')
    parser.add_argument('--control-mode', choices=['i2v_last_frame', 'flf2v'], default='flf2v')
    parser.add_argument('--continuity', choices=['last_frame', 'independent'], default='last_frame')
    parser.add_argument('--postprocess', choices=['none', 'ffmpeg_fps', 'frame_interpolate'], default='ffmpeg_fps')
    parser.add_argument('--target-fps', type=int, default=16)
    parser.add_argument('--seed', type=int, default=None)
    parser.add_argument('--per-shot-timeout-seconds', type=int, default=2400)
    args = parser.parse_args()
    try:
        print(json.dumps(run(args), ensure_ascii=False, indent=2))
        return 0
    except Exception as exc:
        print(json.dumps({'status': 'error', 'video_path': None, 'manifest_path': None, 'errors': [str(exc)]}, ensure_ascii=False, indent=2), file=sys.stderr)
        return 1


if __name__ == '__main__':
    raise SystemExit(main())
