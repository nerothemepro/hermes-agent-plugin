#!/usr/bin/env bash
set -euo pipefail

PIPELINE_DIR="${PIPELINE_DIR:-/workspace/projects/media-pipeline}"
PROMPT="${PROMPT:-two original anime samurai warriors clash blades in a moonlit bamboo forest, cinematic Japanese 2D anime sword battle, close-up intense eyes, hands gripping katana, diagonal blade clash with sparks, one warrior dodges and counters with a low-angle slash, water and fire energy trails around the blades, clean cel-shaded line art, sharp silhouettes, readable choreography, dramatic lighting, no text, no watermark, no logo, no gore}"

python3 "$PIPELINE_DIR/generate_video_sequence.py"   --prompt "$PROMPT"   --duration-seconds 8   --mode quality   --style-preset anime_action   --storyboard-mode action_core   --control-mode flf2v   --keyframe-engine animagine   --keyframe-frame-mode single_scene   --keyframe-quality-preset anime_action_v2   --shot-prompt-strength strong   --composition-profile auto   --motion-profile impact   --keyframe-only-sequence

python3 "$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/scripts/print_latest_manifest.py"
