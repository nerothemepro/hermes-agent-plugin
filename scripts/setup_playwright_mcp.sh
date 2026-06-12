#!/usr/bin/env bash
set -euo pipefail

PROFILE="${1:-herresearch}"
SERVER_NAME="${2:-playwright}"

if [[ "$PROFILE" != "herresearch" ]]; then
  echo "This installer is currently scoped to the herresearch profile only." >&2
  echo "Got: $PROFILE" >&2
  exit 2
fi

HERMES_HOME="${HERMES_HOME:-/opt/data/hermes-profiles/$PROFILE}"
HERMES_BIN="${HERMES_BIN:-/workspace/.venvs/hermes-agent/bin/hermes}"
SERVER_CMD="/workspace/hermes-agent-plugin/scripts/playwright_mcp_server.sh"

if ! command -v node >/dev/null 2>&1; then
  echo "Node.js is required in hermes-sandbox. Install Node.js 18+ first." >&2
  exit 1
fi

if ! command -v npx >/dev/null 2>&1; then
  echo "npx is required in hermes-sandbox. Install Node.js/npm first." >&2
  exit 1
fi

mkdir -p "$HERMES_HOME/playwright-user-data"

echo "Installing Playwright Linux system dependencies..."
npx -y playwright@latest install-deps chromium

echo "Installing Playwright Chromium browser binaries..."
npx -y @playwright/mcp@latest install-browser chromium

echo "Replacing any existing MCP entry for $SERVER_NAME"
printf 'y\n' | HERMES_HOME="$HERMES_HOME" "$HERMES_BIN" mcp remove "$SERVER_NAME" >/dev/null 2>&1 || true

echo "Adding Playwright MCP to Hermes profile: $PROFILE"
printf '\n' | HERMES_HOME="$HERMES_HOME" "$HERMES_BIN" mcp add "$SERVER_NAME" --command "$SERVER_CMD"

# Local LLMs can misuse browser_type by passing an empty selector/ref. Keep
# browser_fill_form and browser_run_code_unsafe available for typed input.
echo "Excluding brittle browser_type tool for $SERVER_NAME"
python3 - "$HERMES_HOME/config.yaml" "$SERVER_NAME" <<'PYSCRIPT'
from pathlib import Path
import re
import sys

path = Path(sys.argv[1])
server = sys.argv[2]
text = path.read_text()
start = text.index(f"  {server}:\n", text.index("mcp_servers:"))
match = re.search(r"\n[^ #\n][^\n]*:\n", text[start + 1:])
end = start + 1 + match.start() if match else len(text)
block = text[start:end]
if "browser_type" not in block:
    if "    tools:\n" in block:
        block = block.replace("    tools:\n", "    tools:\n      exclude:\n      - browser_type\n", 1)
    else:
        insert_after = "    enabled: true\n"
        block = block.replace(insert_after, insert_after + "    tools:\n      exclude:\n      - browser_type\n", 1)
    text = text[:start] + block + text[end:]
    path.write_text(text)
PYSCRIPT

echo "Testing MCP connection..."
HERMES_HOME="$HERMES_HOME" "$HERMES_BIN" mcp test "$SERVER_NAME"

echo "Done."
echo "Next step: restart/reload the profile and run /reload-mcp in the Hermes session."
