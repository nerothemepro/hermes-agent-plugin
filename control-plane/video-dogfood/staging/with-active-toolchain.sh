#!/usr/bin/env bash
set -eu

toolchain_root="${SDTK_VIDEO_DOGFOOD_TOOLCHAIN_ROOT:-/opt/data/hermes/control-plane/video-dogfood/toolchain}"
pointer="$toolchain_root/active-release"
test -f "$pointer" || { echo "active release pointer missing" >&2; exit 3; }
release_id="$(tr -d '\r\n' < "$pointer")"
case "$release_id" in
  ""|*[!a-zA-Z0-9._-]*) echo "invalid active release id" >&2; exit 3 ;;
esac
release_dir="$toolchain_root/releases/$release_id"
test -f "$release_dir/release.json" || { echo "active release unavailable" >&2; exit 3; }
export PATH="$release_dir/node_modules/.bin:$PATH"
export NODE_PATH="$release_dir/node_modules${NODE_PATH:+:$NODE_PATH}"
exec "$@"
