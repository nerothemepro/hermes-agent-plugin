#!/usr/bin/env bash
set -euo pipefail

HERMES_HOME="${HERMES_HOME:-/opt/data/hermes-profiles/hervid}"
HERMES_BIN="${HERMES_BIN:-/workspace/.venvs/hermes-agent/bin/hermes}"

env HERMES_HOME="$HERMES_HOME" "$HERMES_BIN" gateway status
