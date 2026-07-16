#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
command -v xvfb-run >/dev/null 2>&1 || { echo "xvfb-run is required for Booking.com" >&2; exit 2; }

exec xvfb-run -a npx -y @playwright/mcp@0.0.78 --config "$SCRIPT_DIR/booking-playwright-mcp.json"
