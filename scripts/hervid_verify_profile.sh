#!/usr/bin/env bash
set -euo pipefail

HERMES_HOME="${HERMES_HOME:-/opt/data/hermes-profiles/hervid}"
CONFIG="$HERMES_HOME/config.yaml"

if [[ ! -f "$CONFIG" ]]; then
  echo "FAIL: missing config: $CONFIG" >&2
  exit 1
fi

python_bin="${PYTHON_BIN:-/workspace/.venvs/hermes-agent/bin/python}"

"$python_bin" - "$CONFIG" <<'PY'
import sys
import yaml
from pathlib import Path

config_path = Path(sys.argv[1])
cfg = yaml.safe_load(config_path.read_text())

errors = []
model = cfg.get("model", {})
if model.get("default") != "google/gemma-4-12b-qat":
    errors.append(f"model.default={model.get('default')!r}")
if model.get("provider") != "lmstudio":
    errors.append(f"model.provider={model.get('provider')!r}")
if cfg.get("plugins", {}).get("enabled") != ["local_media"]:
    errors.append(f"plugins.enabled={cfg.get('plugins', {}).get('enabled')!r}")
telegram_tools = cfg.get("platform_toolsets", {}).get("telegram", [])
for required in ("clarify", "messaging", "local_media"):
    if required not in telegram_tools:
        errors.append(f"missing telegram toolset: {required}")
if cfg.get("memory", {}).get("memory_enabled") is not False:
    errors.append("memory.memory_enabled should be false")
if cfg.get("kanban", {}).get("dispatch_in_gateway") is not False:
    errors.append("kanban.dispatch_in_gateway should be false")

if errors:
    print("FAIL: HerVid profile config mismatch")
    for error in errors:
        print(f"- {error}")
    raise SystemExit(1)

print("OK: HerVid profile config")
print(f"model={model.get('default')}")
print(f"context_length={model.get('context_length')}")
print(f"telegram_toolsets={telegram_tools}")
PY

curl -fsS http://host.docker.internal:1234/v1/models >/dev/null
curl -fsS http://host.docker.internal:8188/system_stats >/dev/null
curl -fsS http://host.docker.internal:8010/health >/dev/null

echo "OK: LM Studio, ComfyUI, and Wan endpoints are reachable"
