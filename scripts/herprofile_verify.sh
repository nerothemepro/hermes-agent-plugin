#!/usr/bin/env bash
set -euo pipefail

PROFILE="${1:-}"
if [[ -z "$PROFILE" ]]; then
  echo "Usage: $0 <hervid|herresearch|herdev>" >&2
  exit 2
fi

HERMES_HOME="${HERMES_HOME:-/opt/data/hermes-profiles/$PROFILE}"
CONFIG="$HERMES_HOME/config.yaml"
PYTHON_BIN="${PYTHON_BIN:-/workspace/.venvs/hermes-agent/bin/python}"

if [[ ! -f "$CONFIG" ]]; then
  echo "FAIL: missing config: $CONFIG" >&2
  exit 1
fi

"$PYTHON_BIN" - "$PROFILE" "$CONFIG" <<'PY'
import sys
import yaml
from pathlib import Path

profile, config_path = sys.argv[1], Path(sys.argv[2])
cfg = yaml.safe_load(config_path.read_text())

expected = {
    "hervid": "google/gemma-4-12b-qat",
    "herresearch": "google/gemma-4-26b-a4b-qat",
    "herdev": "qwen/qwen3.6-27b",
}
if profile not in expected:
    raise SystemExit(f"Unknown profile: {profile}")

errors = []
model = cfg.get("model", {})
if model.get("default") != expected[profile]:
    errors.append(f"model.default={model.get('default')!r}, expected={expected[profile]!r}")
if model.get("provider") != "lmstudio":
    errors.append(f"model.provider={model.get('provider')!r}")
if cfg.get("_profile_name") not in (profile, None):
    errors.append(f"_profile_name={cfg.get('_profile_name')!r}")

telegram_tools = cfg.get("platform_toolsets", {}).get("telegram", [])
if not telegram_tools:
    errors.append("missing platform_toolsets.telegram")

if errors:
    print("FAIL: profile config mismatch")
    for error in errors:
        print(f"- {error}")
    raise SystemExit(1)

print(f"OK: {profile} config")
print(f"model={model.get('default')}")
print(f"context_length={model.get('context_length')}")
print(f"telegram_toolsets={telegram_tools}")
print(f"memory_enabled={cfg.get('memory', {}).get('memory_enabled')}")
PY

model_id="$("$PYTHON_BIN" - "$CONFIG" <<'PY'
import sys, yaml
print(yaml.safe_load(open(sys.argv[1]))["model"]["default"])
PY
)"

if curl -fsS http://host.docker.internal:1234/v1/models | grep -Fq "\"id\":\"$model_id\""; then
  echo "OK: LM Studio exposes $model_id"
else
  # LM Studio may pretty-print JSON with spaces; retry via Python parser.
  curl -fsS http://host.docker.internal:1234/v1/models > /tmp/hermes-models.json
  "$PYTHON_BIN" - "$model_id" /tmp/hermes-models.json <<'PY'
import json, sys
model_id, path = sys.argv[1], sys.argv[2]
ids = [item.get("id") for item in json.load(open(path)).get("data", [])]
if model_id not in ids:
    print(f"FAIL: LM Studio does not expose {model_id}")
    print("available=" + ", ".join(str(x) for x in ids))
    raise SystemExit(1)
print(f"OK: LM Studio exposes {model_id}")
PY
fi
