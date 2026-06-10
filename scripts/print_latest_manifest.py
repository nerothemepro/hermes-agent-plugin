#!/usr/bin/env python3
import json
import pathlib
import subprocess

out = subprocess.check_output(
    "find /opt/data/hermes/media-sequences -maxdepth 2 -type f -name manifest.json -printf '%T@ %p\n' | sort -nr | head -1",
    shell=True,
    text=True,
)
if not out.strip():
    raise SystemExit('No manifest found under /opt/data/hermes/media-sequences')
manifest = pathlib.Path(out.split(maxsplit=1)[1].strip())
data = json.loads(manifest.read_text())
print('manifest:', manifest)
for key in (
    'status',
    'video_path',
    'media',
    'contact_sheet_path',
    'keyframe_dir',
    'existing_keyframe_dir',
    'duration_seconds_actual',
    'actual_fps',
    'actual_frame_count',
    'effective_postprocess_mode',
    'interpolation_model_name',
    'warnings',
    'errors',
):
    if key in data:
        print(f'{key}: {data.get(key)}')
