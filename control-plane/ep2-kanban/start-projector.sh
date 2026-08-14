#!/usr/bin/env bash
set -euo pipefail

if [ "$#" -gt 1 ] || { [ "$#" -eq 1 ] && [ "$1" != "--once" ]; }; then
  printf '%s\n' 'Usage: start-projector.sh [--once]' >&2
  exit 2
fi

project_path="${HERMES_EP2_KANBAN_PROJECT_PATH:-/workspace/hermes-agent-plugin}"
interval_seconds="${HERMES_EP2_KANBAN_PROJECTOR_INTERVAL_SECONDS:-15}"
projector="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/project-kanban.js"

if ! [[ "$interval_seconds" =~ ^[0-9]+$ ]] || [ "$interval_seconds" -lt 5 ] || [ "$interval_seconds" -gt 300 ]; then
  printf '%s\n' 'HERMES_EP2_KANBAN_PROJECTOR_INTERVAL_SECONDS must be an integer from 5 to 300.' >&2
  exit 2
fi

run_once() {
  node "$projector" --project-path "$project_path"
}

if [ "${1:-}" = "--once" ]; then
  exec node "$projector" --project-path "$project_path"
fi

trap 'exit 0' INT TERM
while true; do
  if ! run_once; then
    printf '%s\n' 'EP2_KANBAN_PROJECTOR_ERROR projection retained; retrying on the next interval.' >&2
  fi
  sleep "$interval_seconds" &
  wait $!
done
