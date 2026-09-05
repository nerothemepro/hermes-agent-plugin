#!/usr/bin/env bash
set -euo pipefail

release_id="${1:-}"
case "$release_id" in
  ""|*[!a-zA-Z0-9._-]*) echo "invalid release id" >&2; exit 2 ;;
esac

script_dir="$(cd "$(dirname "$0")" && pwd)"
staging_root="${SDTK_MARKETING_WORKFLOW_STAGING_ROOT:-/opt/data/hermes/control-plane/marketing-workflows-staging}"
release_dir="$staging_root/releases/$release_id"
"$script_dir/verify-release.sh" "$release_dir"

mkdir -p "$staging_root/activation-backups"
chmod 700 "$staging_root" "$staging_root/activation-backups"
pointer="$staging_root/active-release"
previous=""
if test -f "$pointer"; then previous="$(tr -d '\r\n' < "$pointer")"; fi
backup="$staging_root/activation-backups/$(date -u +%Y%m%dT%H%M%S)-$$.json"
node - "$backup" "$previous" "$release_id" <<'NODE'
const fs = require('fs');
const [file, previous, next] = process.argv.slice(2);
fs.writeFileSync(file, JSON.stringify({ schema_version: 'sdtk.marketing-workflow-staging-activation.v1', previous_release_id: previous || null, activated_release_id: next, activated_at: new Date().toISOString() }, null, 2) + '\n', { mode: 0o600 });
NODE
tmp="$staging_root/.active-release.$$"
printf '%s\n' "$release_id" > "$tmp"
chmod 600 "$tmp"
mv "$tmp" "$pointer"
printf 'MARKETING_WORKFLOW_STAGING_RELEASE_ACTIVE id=%s backup=%s\n' "$release_id" "$backup"
