#!/usr/bin/env bash
set -euo pipefail

PROFILE="${1:-}"
if [[ -z "$PROFILE" ]]; then
  echo "Usage: $0 <hervid|herresearch|herdev|hertran|herwiki>" >&2
  exit 2
fi

HERMES_HOME="${HERPROFILE_HOME:-/opt/data/hermes-profiles/$PROFILE}"
HERMES_BIN="${HERMES_BIN:-/workspace/.venvs/hermes-agent/bin/hermes}"

found=0
while IFS= read -r pid; do
  [[ -r "/proc/$pid/environ" ]] || continue
  proc_home="$(tr '\000' '\n' < "/proc/$pid/environ" | sed -n 's/^HERMES_HOME=//p' | head -1)"
  if [[ "$proc_home" == "$HERMES_HOME" ]]; then
    if [[ "$found" -eq 0 ]]; then
      echo "✓ Gateway is running for $PROFILE"
      echo "  HERMES_HOME=$HERMES_HOME"
    fi
    ps -p "$pid" -o pid,ppid,cmd --no-headers
    found=1
  fi
done < <(pgrep -f "hermes gateway run" || true)

if [[ "$found" -eq 0 ]]; then
  echo "✗ Gateway is not running for $PROFILE"
  echo "  HERMES_HOME=$HERMES_HOME"
  exit 1
fi
