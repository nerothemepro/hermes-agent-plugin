#!/usr/bin/env bash
set -euo pipefail

PROFILE="${1:-}"
if [[ -z "$PROFILE" ]]; then
  echo "Usage: $0 <hervid|herresearch|herdev>" >&2
  exit 2
fi

HERMES_HOME="${HERMES_HOME:-/opt/data/hermes-profiles/$PROFILE}"
HERMES_BIN="${HERMES_BIN:-/workspace/.venvs/hermes-agent/bin/hermes}"
HERMES_SRC="${HERMES_SRC:-/workspace/hermes-agent}"
LOG_DIR="$HERMES_HOME/logs"
LOG_FILE="$LOG_DIR/gateway.log"

mkdir -p "$LOG_DIR"

cd "$HERMES_SRC"
setsid -f nohup env HERMES_HOME="$HERMES_HOME" LM_API_KEY="${LM_API_KEY:-lm-studio}" "$HERMES_BIN" gateway run >> "$LOG_FILE" 2>&1 &

echo "Started $PROFILE gateway for HERMES_HOME=$HERMES_HOME"
echo "Log: $LOG_FILE"
