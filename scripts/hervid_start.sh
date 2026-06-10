#!/usr/bin/env bash
set -euo pipefail

HERMES_HOME="${HERMES_HOME:-/opt/data/hermes-profiles/hervid}"
HERMES_BIN="${HERMES_BIN:-/workspace/.venvs/hermes-agent/bin/hermes}"
HERMES_SRC="${HERMES_SRC:-/workspace/hermes-agent}"
LOG_DIR="$HERMES_HOME/logs"
LOG_FILE="$LOG_DIR/gateway.log"

mkdir -p "$LOG_DIR"

cd "$HERMES_SRC"
setsid -f nohup env HERMES_HOME="$HERMES_HOME" LM_API_KEY="${LM_API_KEY:-lm-studio}" "$HERMES_BIN" gateway run >> "$LOG_FILE" 2>&1 &

echo "Started HerVid gateway for HERMES_HOME=$HERMES_HOME"
echo "Log: $LOG_FILE"
