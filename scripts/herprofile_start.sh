#!/usr/bin/env bash
set -euo pipefail

PROFILE="${1:-}"
if [[ -z "$PROFILE" ]]; then
  echo "Usage: $0 <hervid|herresearch|herdev|hertran|herwiki>" >&2
  exit 2
fi

HERMES_HOME="${HERPROFILE_HOME:-/opt/data/hermes-profiles/$PROFILE}"
HERMES_BIN="${HERMES_BIN:-/workspace/.venvs/hermes-agent/bin/hermes}"
HERMES_SRC="${HERMES_SRC:-/workspace/hermes-agent}"
LOG_DIR="$HERMES_HOME/logs"
LOG_FILE="$LOG_DIR/gateway.log"

mkdir -p "$LOG_DIR"

# Export profile-specific environment variables for tools/providers that read
# directly from os.environ, such as Browser Use, Browserbase, Firecrawl, and
# platform tokens. Hermes also reads .env internally, but browser providers need
# these variables in the process environment.
if [[ -f "$HERMES_HOME/.env" ]]; then
  set -a
  # shellcheck disable=SC1091
  source "$HERMES_HOME/.env"
  set +a
fi

cd "$HERMES_SRC"
setsid -f nohup env HERMES_HOME="$HERMES_HOME" LM_API_KEY="${LM_API_KEY:-lm-studio}" "$HERMES_BIN" gateway run >> "$LOG_FILE" 2>&1 &

echo "Started $PROFILE gateway for HERMES_HOME=$HERMES_HOME"
echo "Log: $LOG_FILE"
