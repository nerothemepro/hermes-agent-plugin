#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CONFIG_FILE="$ROOT_DIR/configs/playwright-mcp.herresearch.json"

exec npx -y @playwright/mcp@0.0.78 --config "$CONFIG_FILE"
