#!/usr/bin/env bash
set -euo pipefail

HERMES_AGENT_DIR="${HERMES_AGENT_DIR:-/workspace/hermes-agent}"
HERMES_HOME="${HERMES_HOME:-/opt/data/hermes}"
HERMES_BIN="${HERMES_BIN:-/workspace/.venvs/hermes-agent/bin/hermes}"
LM_API_KEY="${LM_API_KEY:-lm-studio}"

mkdir -p "$HERMES_HOME/logs"

env HERMES_HOME="$HERMES_HOME" LM_API_KEY="$LM_API_KEY" "$HERMES_BIN" gateway stop || true
cd "$HERMES_AGENT_DIR"
env HERMES_HOME="$HERMES_HOME" LM_API_KEY="$LM_API_KEY" "$HERMES_BIN" gateway run >> "$HERMES_HOME/logs/gateway.log" 2>&1 &
sleep 2
env HERMES_HOME="$HERMES_HOME" LM_API_KEY="$LM_API_KEY" "$HERMES_BIN" gateway status
