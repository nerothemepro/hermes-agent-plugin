#!/usr/bin/env bash
set -euo pipefail
profile_env=/opt/data/hermes-profiles/herorches/.env
if [[ -f "$profile_env" ]]; then
  set +u
  set -a
  . "$profile_env"
  set +a
  set -u
fi
umask 077
exec /usr/bin/env node /workspace/hermes-agent-plugin/control-plane/marketing-workflows/marketing-workflow-monitor.js
