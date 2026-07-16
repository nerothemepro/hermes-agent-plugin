#!/usr/bin/env bash
set -euo pipefail

PROFILE_HOME="${HERMES_HOME:-/opt/data/hermes-profiles/herresearch}"
HERMES_BIN="${HERMES_BIN:-/workspace/.venvs/hermes-agent/bin/hermes}"

if [[ ! -f "$PROFILE_HOME/config.yaml" ]]; then
  echo "Missing HerResearch config: $PROFILE_HOME/config.yaml" >&2
  exit 1
fi

# Keep the browser binary version aligned with the pinned MCP package.
npx -y @playwright/mcp@0.0.78 install-browser chromium

HERMES_HOME="$PROFILE_HOME" "$HERMES_BIN" mcp test playwright
HERMES_HOME="$PROFILE_HOME" "$HERMES_BIN" mcp test reddit

cat <<'EOM'
MCP bootstrap completed.
If anonymous Reddit reads return 403, put REDDIT_CLIENT_ID, REDDIT_CLIENT_SECRET,
and REDDIT_USER_AGENT in the profile .env. Then change REDDIT_AUTH_MODE to
authenticated and add these literal placeholders under mcp_servers.reddit.env:
  REDDIT_CLIENT_ID: ${REDDIT_CLIENT_ID}
  REDDIT_CLIENT_SECRET: ${REDDIT_CLIENT_SECRET}
  REDDIT_USER_AGENT: ${REDDIT_USER_AGENT}
Never put secret values in YAML. Do not configure Reddit username/password; the
HerResearch MCP roster intentionally exposes read-only tools only.
EOM
