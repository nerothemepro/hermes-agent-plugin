#!/usr/bin/env bash
set -eu

release_id="${1:-}"
core_package="${2:-}"
adapter_package="${3:-}"
toolchain_root="${SDTK_VIDEO_DOGFOOD_TOOLCHAIN_ROOT:-/opt/data/hermes/control-plane/video-dogfood/toolchain}"

case "$release_id" in
  ""|*[!a-zA-Z0-9._-]*) echo "invalid release id" >&2; exit 2 ;;
esac
test -f "$core_package" || { echo "core package missing" >&2; exit 2; }
test -f "$adapter_package" || { echo "adapter package missing" >&2; exit 2; }

releases_dir="$toolchain_root/releases"
release_dir="$releases_dir/$release_id"
install_dir="$releases_dir/.install-$release_id-$$"
test ! -e "$release_dir" || { echo "release already exists" >&2; exit 3; }
test ! -e "$install_dir" || { echo "staging path already exists" >&2; exit 3; }
mkdir -p "$releases_dir"
chmod 700 "$toolchain_root" "$releases_dir"
mkdir "$install_dir"
chmod 700 "$install_dir"
mkdir "$install_dir/artifacts"
chmod 700 "$install_dir/artifacts"

core_artifact="$install_dir/artifacts/sdtk-agent-kit.tgz"
adapter_artifact="$install_dir/artifacts/sdtk-agent-hermes-adapter.tgz"
cp "$core_package" "$core_artifact"
cp "$adapter_package" "$adapter_artifact"
chmod 600 "$core_artifact" "$adapter_artifact"

npm install --prefix "$install_dir" --ignore-scripts --no-save --silent "$core_artifact" "$adapter_artifact"
core_sha="$(sha256sum "$core_artifact" | cut -d ' ' -f 1)"
adapter_sha="$(sha256sum "$adapter_artifact" | cut -d ' ' -f 1)"
core_version="$(node -p "require('$install_dir/node_modules/sdtk-agent-kit/package.json').version")"
adapter_version="$(node -p "require('$install_dir/node_modules/sdtk-agent-hermes-adapter/package.json').version")"
manifest_path="$install_dir/release.json"
node -e 'const fs=require("fs"); const [file,id,coreVersion,adapterVersion,coreSha,adapterSha]=process.argv.slice(1); fs.writeFileSync(file, JSON.stringify({schema_version:"hermes.video-dogfood-toolchain-release.v1",release_id:id,packages:{"sdtk-agent-kit":{version:coreVersion,sha256:coreSha,artifact:"artifacts/sdtk-agent-kit.tgz"},"sdtk-agent-hermes-adapter":{version:adapterVersion,sha256:adapterSha,artifact:"artifacts/sdtk-agent-hermes-adapter.tgz"}}},null,2)+"\n",{mode:0o600});' "$manifest_path" "$release_id" "$core_version" "$adapter_version" "$core_sha" "$adapter_sha"
chmod 600 "$manifest_path"
test -x "$install_dir/node_modules/.bin/sdtk-agent"
"$install_dir/node_modules/.bin/sdtk-agent" --version >/dev/null
NODE_PATH="$install_dir/node_modules" node -e 'require("sdtk-agent-hermes-adapter")'
mv "$install_dir" "$release_dir"
printf 'STAGING_RELEASE_INSTALLED id=%s core=%s adapter=%s\n' "$release_id" "$core_version" "$adapter_version"
