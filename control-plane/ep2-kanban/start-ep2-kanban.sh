#!/usr/bin/env bash
set -euo pipefail

if [ "$#" -ne 0 ]; then
  printf '%s\n' 'This localhost-only launcher accepts no arguments. Run sdtk-wiki directly only after separate owner authorization for a public tunnel.' >&2
  exit 2
fi

project_path="${HERMES_EP2_KANBAN_PROJECT_PATH:-/workspace/hermes-agent-plugin}"
port="${HERMES_EP2_KANBAN_PORT:-7654}"

# The board is a read-only observability surface. Keep it local by construction.
exec sdtk-wiki kanban --project "$project_path" --host 127.0.0.1 --port "$port" --no-open
