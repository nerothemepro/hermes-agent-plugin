#!/usr/bin/env bash
set -eu

release_id="${1:-}"
toolchain_root="${SDTK_VIDEO_DOGFOOD_TOOLCHAIN_ROOT:-/opt/data/hermes/control-plane/video-dogfood/toolchain}"
case "$release_id" in
  ""|*[!a-zA-Z0-9._-]*) echo "invalid release id" >&2; exit 2 ;;
esac
release_dir="$toolchain_root/releases/$release_id"
manifest_path="$release_dir/release.json"
test -f "$manifest_path" || { echo "release manifest missing" >&2; exit 3; }
test -x "$release_dir/node_modules/.bin/sdtk-agent" || { echo "sdtk-agent binary missing" >&2; exit 3; }
node -e '
const crypto=require("crypto"); const fs=require("fs"); const path=require("path");
const [manifestPath,root,id]=process.argv.slice(1); const manifest=require(manifestPath);
const hash=(file)=>crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
const core=require(path.join(root,"node_modules/sdtk-agent-kit/package.json")).version;
const adapter=require(path.join(root,"node_modules/sdtk-agent-hermes-adapter/package.json")).version;
if(manifest.release_id!==id||manifest.packages["sdtk-agent-kit"].version!==core||manifest.packages["sdtk-agent-hermes-adapter"].version!==adapter) throw new Error("release manifest mismatch");
for(const name of ["sdtk-agent-kit","sdtk-agent-hermes-adapter"]){const item=manifest.packages[name]; const artifact=path.resolve(root,item.artifact); if(!artifact.startsWith(path.resolve(root)+path.sep)||hash(artifact)!==item.sha256) throw new Error("release artifact hash mismatch: "+name);}
' "$manifest_path" "$release_dir" "$release_id"
"$release_dir/node_modules/.bin/sdtk-agent" --version >/dev/null
NODE_PATH="$release_dir/node_modules" node -e 'require("sdtk-agent-hermes-adapter")'
printf 'STAGING_RELEASE_VERIFIED id=%s\n' "$release_id"
