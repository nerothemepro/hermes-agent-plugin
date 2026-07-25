#!/usr/bin/env bash
set -euo pipefail
file_path=${1:?usage: video-probe.sh <video-file>}
[[ -f "$file_path" ]] || { echo "video probe: file missing" >&2; exit 2; }
dimensions=$(ffprobe -v error -select_streams v:0 -show_entries stream=width,height -of csv=p=0 "$file_path")
IFS=, read -r width height <<< "$dimensions"
duration=$(ffprobe -v error -show_entries format=duration -of default=nokey=1:noprint_wrappers=1 "$file_path")
[[ "$width" =~ ^[0-9]+$ && "$height" =~ ^[0-9]+$ && "$duration" =~ ^[0-9]+(\.[0-9]+)?$ ]] || { echo "video probe: unparseable ffprobe output" >&2; exit 1; }
printf '%s %s %s\n' "$width" "$height" "$duration"
