#!/usr/bin/env bash
set -euo pipefail

release_dir="${1:-}"
case "$release_dir" in
  /*) ;;
  *) echo "release directory must be absolute" >&2; exit 2 ;;
esac
test -f "$release_dir/release.json" || { echo "release manifest missing" >&2; exit 3; }
test -f "$release_dir/control-plane/marketing-workflows/staging-entrypoint.js" || { echo "staging entrypoint missing" >&2; exit 3; }
test -x "$release_dir/bin/hermes-marketing-workflow" || { echo "controller CLI missing" >&2; exit 3; }

node - "$release_dir" <<'NODE'
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const root = path.resolve(process.argv[2]);
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'release.json'), 'utf8'));
if (manifest.schema_version !== 'sdtk.marketing-workflow-staging-release.v1' || !/^[a-zA-Z0-9._-]+$/.test(manifest.release_id || '') || !/^[a-f0-9]{40}$/.test(manifest.source_commit || '') || !Array.isArray(manifest.files) || manifest.files.length === 0) process.exit(2);
for (const item of manifest.files) {
  if (!item || typeof item.path !== 'string' || path.isAbsolute(item.path) || item.path.includes('..') || !/^[a-f0-9]{64}$/.test(item.sha256 || '')) process.exit(2);
  const file = path.resolve(root, item.path);
  if (!file.startsWith(root + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) process.exit(3);
  const actual = crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
  if (actual !== item.sha256) process.exit(4);
}
NODE
printf 'MARKETING_WORKFLOW_STAGING_RELEASE_VERIFIED dir=%s\n' "$release_dir"
