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
  "HERSOCIAL_MARKETING_CHECK_COMMAND=${HERSOCIAL_MARKETING_CHECK_COMMAND:-}"
  "HERSOCIAL_MARKETING_CHECK_TIMEOUT_SECONDS=${HERSOCIAL_MARKETING_CHECK_TIMEOUT_SECONDS:-15}"
)

umask 077
exec env -i "${env_args[@]}" \
  /usr/bin/python3 /workspace/hermes-agent-plugin/control-plane/hersocial-auto-post/hersocial_attended_runner.py \
    --posts-dir "${HERSOCIAL_AUTO_POST_POSTS_DIR:-/workspace/hermes-agent-plugin/control-plane/hersocial-auto-post/posts}" \
    --state-path "${HERSOCIAL_AUTO_POST_STATE_PATH:-/opt/data/hermes/control-plane/hersocial-auto-post/state.json}" \
    --poll-seconds "${HERSOCIAL_AUTO_POST_POLL_SECONDS:-30}" \
    "$@"
