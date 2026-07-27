#!/usr/bin/env bash
set -euo pipefail

out="${1:-}"
[[ -n "$out" ]] || { echo "usage: generate-cc0-music-bed.sh <output.m4a>" >&2; exit 2; }
mkdir -p "$(dirname "$out")"

# Original deterministic ambient bed: four synthesized tones plus filtered pink noise.
# No samples or third-party recordings are used; see public/audio/LICENSE.md (CC0-1.0).
ffmpeg -hide_banner -loglevel error -y \
  -f lavfi -i "sine=frequency=110:duration=300:sample_rate=48000" \
  -f lavfi -i "sine=frequency=164.81:duration=300:sample_rate=48000" \
  -f lavfi -i "sine=frequency=220:duration=300:sample_rate=48000" \
  -f lavfi -i "anoisesrc=color=pink:duration=300:sample_rate=48000" \
  -filter_complex \
  "[0:a]volume=0.055,tremolo=f=0.10:d=0.35[a0]; \
   [1:a]volume=0.035,tremolo=f=0.12:d=0.28[a1]; \
   [2:a]volume=0.018,tremolo=f=0.14:d=0.22[a2]; \
   [3:a]lowpass=f=900,highpass=f=80,volume=0.012[a3]; \
   [a0][a1][a2][a3]amix=inputs=4:duration=longest:normalize=0, \
   afade=t=in:st=0:d=3,afade=t=out:st=294:d=6,alimiter=limit=0.7[a]" \
  -map "[a]" -c:a aac -b:a 128k "$out"

echo "CC0 ambient bed generated: $out"
