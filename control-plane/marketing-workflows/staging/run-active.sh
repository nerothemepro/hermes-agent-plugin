#!/usr/bin/env bash
set -euo pipefail

command="${1:-}"
case "$command" in dispatch|submit) ;; *) echo "exact staging command required: dispatch | submit" >&2; exit 2 ;; esac

script_dir="$(cd "$(dirname "$0")" && pwd)"
staging_root="${SDTK_MARKETING_WORKFLOW_STAGING_ROOT:-/opt/data/hermes/control-plane/marketing-workflows-staging}"
pointer="$staging_root/active-release"
test -f "$pointer" || { echo "no active staging release" >&2; exit 3; }
release_id="$(tr -d '\r\n' < "$pointer")"
case "$release_id" in ""|*[!a-zA-Z0-9._-]*) echo "invalid active release id" >&2; exit 3 ;; esac
release_dir="$staging_root/releases/$release_id"
"$script_dir/verify-release.sh" "$release_dir" >/dev/null
shift
exec env SDTK_MARKETING_WORKFLOW_MODE=staging node "$release_dir/control-plane/marketing-workflows/staging-entrypoint.js" "$command" "$@"
