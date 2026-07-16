#!/usr/bin/env bash
set -euo pipefail

profile_env=/opt/data/hermes-profiles/herorches/.env
git_secret_env=/opt/data/hermes/control-plane/secrets/uc1-nightly-watch.env
digest_env=/opt/data/hermes/control-plane/secrets/mkt-digest.env

for required in "$profile_env" "$git_secret_env" "$digest_env"; do
  if [[ ! -f "$required" ]]; then
    echo "marketing digest bootstrap failed: required environment source unavailable" >&2
    exit 1
  fi
done

set +u
set -a
. "$profile_env"
. "$git_secret_env"
. "$digest_env"
set +a
set -u

for required_env in TELEGRAM_BOT_TOKEN TELEGRAM_HOME_CHANNEL UC1_GITHUB_TOKEN; do
  if [[ -z "${!required_env:-}" ]]; then
    echo "marketing digest bootstrap failed: required environment unavailable" >&2
    exit 1
  fi
done

env_args=(
  "PATH=${PATH:-/usr/local/bin:/usr/bin:/bin}"
  "HOME=/opt/data/hermes/control-plane/marketing-digest/home"
  "LANG=C.UTF-8"
  "LC_ALL=C.UTF-8"
  "TZ=Asia/Tokyo"
  "TELEGRAM_BOT_TOKEN=$TELEGRAM_BOT_TOKEN"
  "TELEGRAM_HOME_CHANNEL=$TELEGRAM_HOME_CHANNEL"
  "UC1_GITHUB_TOKEN=$UC1_GITHUB_TOKEN"
)

for name in \
  PLAUSIBLE_API_KEY PLAUSIBLE_SITE_ID \
  FB_PAGE_TOKEN FB_PAGE_ID \
  LEMONSQUEEZY_API_KEY MKT_NPM_PACKAGES MKT_GITHUB_REPO; do
  if [[ -n "${!name:-}" ]]; then
    env_args+=("$name=${!name}")
  fi
done

umask 077
exec env -i "${env_args[@]}" \
  /usr/bin/python3 /workspace/hermes-agent-plugin/control-plane/marketing-digest/marketing_digest_runner.py \
    --poll-seconds "${HERMES_MKT_POLL_SECONDS:-15}" \
    "$@"
