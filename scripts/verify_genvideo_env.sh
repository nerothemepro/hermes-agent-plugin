#!/usr/bin/env bash
set -u

HERMES_AGENT_DIR="${HERMES_AGENT_DIR:-/workspace/hermes-agent}"
HERMES_HOME="${HERMES_HOME:-/opt/data/hermes}"
PYTHON="${HERMES_PYTHON:-/workspace/.venvs/hermes-agent/bin/python}"
COMFY_URL="${COMFY_URL:-http://host.docker.internal:8188}"
WAN_URL="${WAN_URL:-http://host.docker.internal:8010}"
LM_URL="${LM_URL:-http://host.docker.internal:1234/v1}"

fail=0
check() {
  local name="$1"
  shift
  echo "== $name =="
  if "$@"; then
    echo "OK: $name"
  else
    echo "FAIL: $name" >&2
    fail=1
  fi
  echo
}

check "LM Studio models" bash -lc "curl -fsS '$LM_URL/models' | jq -r '.data[].id' | head -20"
check "ComfyUI system_stats" bash -lc "curl -fsS '$COMFY_URL/system_stats' | jq -r '.system.comfyui_version, (.devices[]?.name)'"
check "Wan health" bash -lc "curl -fsS '$WAN_URL/health' | jq -r '.ok, .cuda_available, .model_dir_exists, .device_name'"
check "Animagine checkpoint exposed" bash -lc "curl -fsS '$COMFY_URL/object_info/CheckpointLoaderSimple' | jq -er --arg name 'animagine-xl-3.1.safetensors' '.CheckpointLoaderSimple.input.required.ckpt_name[0][]? | select(. == \$name)'"
check "RIFE interpolation model exposed" bash -lc "curl -fsS '$COMFY_URL/object_info/FrameInterpolationModelLoader' | jq -er --arg name 'rife_v4.26.safetensors' '.FrameInterpolationModelLoader.input.required.model_name[1].options[]? | select(. == \$name)'"
check "Wan FLF2V node exposed" bash -lc "curl -fsS '$COMFY_URL/object_info/WanFirstLastFrameToVideo' >/dev/null"
check "Hermes local_media plugin registered" bash -lc "cd '$HERMES_AGENT_DIR' && env HERMES_HOME='$HERMES_HOME' LM_API_KEY=lm-studio '$PYTHON' - <<'PY'
from hermes_cli.plugins import discover_plugins
from tools.registry import registry
discover_plugins(force=True)
names = registry.get_tool_names_for_toolset('local_media')
print(names)
assert 'generate_video' in names
assert 'generate_video_sequence' in names
PY"

if [ "$fail" -ne 0 ]; then
  echo "One or more checks failed." >&2
  exit 1
fi

echo "All GenVideo environment checks passed."
