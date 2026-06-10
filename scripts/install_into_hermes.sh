#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
HERMES_AGENT_DIR="${HERMES_AGENT_DIR:-/workspace/hermes-agent}"
PIPELINE_DIR="${PIPELINE_DIR:-/workspace/projects/media-pipeline}"
HERMES_HOME="${HERMES_HOME:-/opt/data/hermes}"
PLUGIN_DIR="$HERMES_AGENT_DIR/plugins/local_media"
SKILL_DIR="$HERMES_HOME/skills/creative/local-comfy-wan-video"

printf 'Installing Hermes GenVideo package...
'
printf 'Repo: %s
' "$REPO_ROOT"
printf 'Hermes agent: %s
' "$HERMES_AGENT_DIR"
printf 'Pipeline: %s
' "$PIPELINE_DIR"
printf 'Hermes home: %s
' "$HERMES_HOME"

if [ ! -d "$HERMES_AGENT_DIR" ]; then
  echo "ERROR: Hermes agent dir not found: $HERMES_AGENT_DIR" >&2
  exit 1
fi

mkdir -p "$PLUGIN_DIR" "$PIPELINE_DIR" "$SKILL_DIR"
mkdir -p "$HERMES_HOME/generated-images" "$HERMES_HOME/generated-videos" "$HERMES_HOME/media-sequences" "$HERMES_HOME/logs"

cp -a "$REPO_ROOT/hermes-plugin/local_media/." "$PLUGIN_DIR/"
cp -a "$REPO_ROOT/media-pipeline/." "$PIPELINE_DIR/"
cp -a "$REPO_ROOT/skills/local-comfy-wan-video/." "$SKILL_DIR/"

python3 -m py_compile "$PLUGIN_DIR/tools.py" "$PIPELINE_DIR/generate_video.py" "$PIPELINE_DIR/generate_video_sequence.py"

python3 "$REPO_ROOT/scripts/patch_gateway_media_delivery.py" "$HERMES_AGENT_DIR/gateway/run.py"
python3 -m py_compile "$HERMES_AGENT_DIR/gateway/run.py"

cat <<'EOF'
Install complete.

Next:
  bash scripts/verify_genvideo_env.sh
  bash scripts/restart_hermes_gateway.sh
EOF
