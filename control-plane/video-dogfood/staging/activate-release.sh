#!/usr/bin/env bash
set -eu

release_id="${1:-}"
script_dir="$(cd "$(dirname "$0")" && pwd)"
toolchain_root="${SDTK_VIDEO_DOGFOOD_TOOLCHAIN_ROOT:-/opt/data/hermes/control-plane/video-dogfood/toolchain}"
"$script_dir/verify-release.sh" "$release_id"
mkdir -p "$toolchain_root/activation-backups"
chmod 700 "$toolchain_root" "$toolchain_root/activation-backups"
pointer="$toolchain_root/active-release"
previous_release_id=""
if test -f "$pointer"; then
  previous_release_id="$(tr -d '\r\n' < "$pointer")"
fi
activated_at="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
backup_path="$toolchain_root/activation-backups/$(date -u +%Y%m%dT%H%M%S)-$$.json"
node -e 'const fs=require("fs"); const [file,previous,next,at]=process.argv.slice(1); fs.writeFileSync(file,JSON.stringify({schema_version:"hermes.video-dogfood-activation.v1",previous_release_id:previous||null,activated_release_id:next,activated_at:at},null,2)+"\n",{mode:0o600});' "$backup_path" "$previous_release_id" "$release_id" "$activated_at"
chmod 600 "$backup_path"
pointer_tmp="$toolchain_root/.active-release.$$"
printf '%s\n' "$release_id" > "$pointer_tmp"
chmod 600 "$pointer_tmp"
mv "$pointer_tmp" "$pointer"
printf 'STAGING_RELEASE_ACTIVE id=%s backup=%s\n' "$release_id" "$backup_path"
