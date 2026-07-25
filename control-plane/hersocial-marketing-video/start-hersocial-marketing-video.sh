#!/usr/bin/env bash
set -euo pipefail

# Deterministic operator entry point for sdtk-marketing video/publish. It loads exactly the
# same HerSocial + marketing sources as the attended post runner, then clears the ambient shell.
# This script never adds --approve; attended upload remains the owner's explicit decision.
profile_env=/opt/data/hermes-profiles/hersocial/.env
marketing_env=/opt/data/hermes/control-plane/secrets/mkt-digest.env

for required_file in "$profile_env" "$marketing_env"; do
  [[ -f "$required_file" ]] || { echo "hersocial marketing video bootstrap failed: environment source unavailable" >&2; exit 1; }
done
[[ "$(stat -c %a "$marketing_env")" == "600" ]] || { echo "hersocial marketing video bootstrap failed: marketing secret mode must be 0600" >&2; exit 1; }

set +u
set -a
. "$profile_env"
. "$marketing_env"
set +a
set -u

[[ $# -gt 0 ]] || { echo "usage: start-hersocial-marketing-video.sh <sdtk-marketing args>" >&2; exit 2; }

env_args=(
  "PATH=${PATH:-/usr/local/bin:/usr/bin:/bin}"
  "HOME=/opt/data/hermes/control-plane/hersocial-marketing-video/home"
  "LANG=C.UTF-8"
  "LC_ALL=C.UTF-8"
  "TZ=Asia/Tokyo"
  "FACEBOOK_PAGE_ACCESS_TOKEN=${FB_PAGE_TOKEN:-}"
  "FACEBOOK_PAGE_ID=${FB_PAGE_ID:-}"
)

for optional_name in \
  SDTK_MARKETING_HOME \
  SDTK_MARKETING_ASSET_HOME \
  SDTK_MARKETING_VIDEO_CMD_REMOTION \
  SDTK_MARKETING_VIDEO_CMD_COMFYUI \
  SDTK_MARKETING_PUBLISH_CMD_YOUTUBE \
  SDTK_MARKETING_PUBLISH_CMD_FACEBOOK_VIDEO \
  SDTK_MARKETING_REMOTION_PROJECT \
  SDTK_MARKETING_REMOTION_COMPOSITION \
  YOUTUBE_CLIENT_ID \
  YOUTUBE_CLIENT_SECRET \
  YOUTUBE_REFRESH_TOKEN; do
  if [[ -n "${!optional_name:-}" ]]; then
    env_args+=("${optional_name}=${!optional_name}")
  fi
done

umask 077
exec env -i "${env_args[@]}" sdtk-marketing "$@"
