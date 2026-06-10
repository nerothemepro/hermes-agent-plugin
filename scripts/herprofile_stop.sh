#!/usr/bin/env bash
set -euo pipefail

PROFILE="${1:-}"
if [[ -z "$PROFILE" ]]; then
  echo "Usage: $0 <hervid|herresearch|herdev>" >&2
  exit 2
fi

HERMES_HOME="${HERMES_HOME:-/opt/data/hermes-profiles/$PROFILE}"
HERMES_BIN="${HERMES_BIN:-/workspace/.venvs/hermes-agent/bin/hermes}"

env HERMES_HOME="$HERMES_HOME" "$HERMES_BIN" gateway stop || true
