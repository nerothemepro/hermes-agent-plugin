#!/usr/bin/env bash
set -euo pipefail

profile_env=/opt/data/hermes-profiles/hersocial/.env
marketing_env=/opt/data/hermes/control-plane/secrets/mkt-digest.env

for required_file in "$profile_env" "$marketing_env"; do
  if [[ ! -f "$required_file" ]]; then
    echo "hersocial auto-post bootstrap failed: required environment source unavailable" >&2
    exit 1
  fi
done

if [[ "$(stat -c %a "$marketing_env")" != "600" ]]; then
  echo "hersocial auto-post bootstrap failed: marketing secret mode must be 0600" >&2
  exit 1
fi

set +u
set -a
. "$profile_env"
. "$marketing_env"
set +a
set -u

marketing_check_command="${HERSOCIAL_MARKETING_CHECK_COMMAND:-sdtk-marketing}"

for required_name in TELEGRAM_BOT_TOKEN TELEGRAM_HOME_CHANNEL FB_PAGE_TOKEN FB_PAGE_ID; do
  if [[ -z "${!required_name:-}" ]]; then
    echo "hersocial auto-post bootstrap failed: required environment unavailable" >&2
    exit 1
  fi
done

env_args=(
  "PATH=${PATH:-/usr/local/bin:/usr/bin:/bin}"
  "HOME=/opt/data/hermes/control-plane/hersocial-auto-post/home"
  "LANG=C.UTF-8"
  "LC_ALL=C.UTF-8"
  "TZ=Asia/Tokyo"
  "TELEGRAM_BOT_TOKEN=$TELEGRAM_BOT_TOKEN"
  "TELEGRAM_HOME_CHANNEL=$TELEGRAM_HOME_CHANNEL"
  "FACEBOOK_PAGE_ACCESS_TOKEN=$FB_PAGE_TOKEN"
  "FACEBOOK_PAGE_ID=$FB_PAGE_ID"
  "HERSOCIAL_AUTO_POST_ENABLED=${HERSOCIAL_AUTO_POST_ENABLED:-false}"
  "HERSOCIAL_ATTENDED_REMINDERS_ENABLED=${HERSOCIAL_ATTENDED_REMINDERS_ENABLED:-true}"
  "HERSOCIAL_MARKETING_CHECK_COMMAND=$marketing_check_command"
  "HERSOCIAL_MARKETING_CHECK_TIMEOUT_SECONDS=${HERSOCIAL_MARKETING_CHECK_TIMEOUT_SECONDS:-15}"
)


# Keep video/publish delegates in the same clean environment as the attended runner.
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

# Video publisher approvals use a dedicated deterministic dispatcher. It resolves only a matching
# social publisher record and invokes the sha-gated marketing CLI; all legacy manifest keys retain
# the existing attended runner unchanged.
if [[ "${1:-}" == "--record-approval" && "${2:-}" == social-video-* ]]; then
  exec env -i "${env_args[@]}" \
    /usr/bin/python3 /workspace/hermes-agent-plugin/control-plane/hersocial-auto-post/hersocial_social_publisher_dispatcher.py \
      "$@"
fi

exec env -i "${env_args[@]}" \
  /usr/bin/python3 /workspace/hermes-agent-plugin/control-plane/hersocial-auto-post/hersocial_attended_runner.py \
    --posts-dir "${HERSOCIAL_AUTO_POST_POSTS_DIR:-/workspace/hermes-agent-plugin/control-plane/hersocial-auto-post/posts}" \
    --state-path "${HERSOCIAL_AUTO_POST_STATE_PATH:-/opt/data/hermes/control-plane/hersocial-auto-post/state.json}" \
    --poll-seconds "${HERSOCIAL_AUTO_POST_POLL_SECONDS:-30}" \
    "$@"
