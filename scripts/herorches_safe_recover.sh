#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
HEALTH_PY="$SCRIPT_DIR/herorches_collect_health.py"
START_SH="$SCRIPT_DIR/herprofile_start.sh"
STOP_SH="$SCRIPT_DIR/herprofile_stop.sh"
STATUS_SH="$SCRIPT_DIR/herprofile_status.sh"
TARGET="${1:---all}"
TMP_JSON="$(mktemp)"
trap 'rm -f "$TMP_JSON"' EXIT

if [[ "$TARGET" == "-h" || "$TARGET" == "--help" ]]; then
  cat <<'EOH'
Usage:
  herorches_safe_recover.sh --all
  herorches_safe_recover.sh <profile>

Safe behavior only:
- start profile when gateway is down/stale
- restart profile when gateway is degraded
- never mutate external auth, tokens, or model configs
EOH
  exit 0
fi

PROFILE_FILTER="${HERMES_PROFILES:-}"

if [[ "$TARGET" == "--all" ]]; then
  if [[ -n "$PROFILE_FILTER" ]]; then
    python3 "$HEALTH_PY" --profiles "$PROFILE_FILTER" --json >"$TMP_JSON"
  else
    python3 "$HEALTH_PY" --json >"$TMP_JSON"
  fi
else
  python3 "$HEALTH_PY" --profiles "$TARGET" --json >"$TMP_JSON"
fi

python3 - <<'PY' "$TMP_JSON" | while IFS='|' read -r profile status issues; do
import json, sys
report = json.load(open(sys.argv[1], encoding='utf-8'))
for row in report['profiles']:
    if row['status'] in {'down', 'stale', 'degraded'}:
        print(f"{row['name']}|{row['status']}|{','.join(row['issues'])}")
PY
  [[ -n "$profile" ]] || continue
  echo "[recover-safe] profile=$profile status=$status issues=$issues"
  case "$status" in
    down|stale)
      bash "$START_SH" "$profile" || true
      ;;
    degraded)
      bash "$STOP_SH" "$profile" || true
      sleep 1
      bash "$START_SH" "$profile" || true
      ;;
  esac
  sleep 2
  bash "$STATUS_SH" "$profile" || true
done

if [[ "$TARGET" == "--all" ]]; then
  python3 "$HEALTH_PY" --json
else
  python3 "$HEALTH_PY" --profiles "$TARGET" --json
fi
