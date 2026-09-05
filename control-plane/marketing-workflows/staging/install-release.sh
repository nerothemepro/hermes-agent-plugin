#!/usr/bin/env bash
set -euo pipefail

release_id="${1:-}"
case "$release_id" in
  ""|*[!a-zA-Z0-9._-]*) echo "invalid release id" >&2; exit 2 ;;
esac

script_dir="$(cd "$(dirname "$0")" && pwd)"
repo_root="$(cd "$script_dir/../../.." && pwd)"
staging_root="${SDTK_MARKETING_WORKFLOW_STAGING_ROOT:-/opt/data/hermes/control-plane/marketing-workflows-staging}"
releases_dir="$staging_root/releases"
release_dir="$releases_dir/$release_id"
install_dir="$releases_dir/.install-$release_id-$$"

test ! -e "$release_dir" || { echo "release already exists" >&2; exit 3; }
test ! -e "$install_dir" || { echo "staging install path already exists" >&2; exit 3; }

mkdir -p "$releases_dir"
chmod 700 "$staging_root" "$releases_dir"
mkdir "$install_dir"
chmod 700 "$install_dir"

mkdir -p "$install_dir/control-plane" "$install_dir/bin"
cp -a "$repo_root/control-plane/marketing-workflows" "$install_dir/control-plane/marketing-workflows"
cp -a "$repo_root/bin/hermes-marketing-workflow" "$install_dir/bin/hermes-marketing-workflow"
chmod 700 "$install_dir/bin/hermes-marketing-workflow"

source_commit="$(git -C "$repo_root" rev-parse HEAD)"
node - "$install_dir" "$release_id" "$source_commit" <<'NODE'
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const [root, releaseId, sourceCommit] = process.argv.slice(2);
function walk(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) return walk(absolute);
    if (entry.isFile()) return [absolute];
    return [];
  });
}
const files = walk(root)
  .filter((file) => !file.endsWith('/release.json'))
  .map((file) => ({ path: path.relative(root, file), sha256: crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex') }))
  .sort((left, right) => left.path.localeCompare(right.path));
const manifest = { schema_version: 'sdtk.marketing-workflow-staging-release.v1', release_id: releaseId, source_commit: sourceCommit, files };
fs.writeFileSync(path.join(root, 'release.json'), JSON.stringify(manifest, null, 2) + '\n', { mode: 0o600 });
NODE

"$script_dir/verify-release.sh" "$install_dir"
mv "$install_dir" "$release_dir"
printf 'MARKETING_WORKFLOW_STAGING_RELEASE_INSTALLED id=%s source_commit=%s\n' "$release_id" "$source_commit"
