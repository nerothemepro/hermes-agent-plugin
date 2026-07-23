#!/usr/bin/env bash
set -euo pipefail

profile_env=/opt/data/hermes-profiles/hersocial/.env
marketing_env=/opt/data/hermes/control-plane/secrets/mkt-digest.env
ledger_home=/opt/data/hermes/control-plane/marketing

for required_file in "$profile_env" "$marketing_env"; do
  if [[ ! -f "$required_file" ]]; then
    echo "hersocial marketing automation bootstrap failed: required environment source unavailable" >&2
    exit 1
  fi
done

if [[ "$(stat -c %a "$marketing_env")" != "600" ]]; then
  echo "hersocial marketing automation bootstrap failed: marketing secret mode must be 0600" >&2
  exit 1
fi

set +u
set -a
. "$profile_env"
. "$marketing_env"
set +a
set -u

for required_name in TELEGRAM_BOT_TOKEN TELEGRAM_HOME_CHANNEL; do
  if [[ -z "${!required_name:-}" ]]; then
    echo "hersocial marketing automation bootstrap failed: required environment unavailable" >&2
    exit 1
  fi
done

install -d -m 700 "$ledger_home"

env_args=(
  "PATH=${PATH:-/usr/local/bin:/usr/bin:/bin}"
  "HOME=/opt/data/hermes/control-plane/hersocial-marketing-automation/home"
  "LANG=C.UTF-8"
  "LC_ALL=C.UTF-8"
  "TZ=Asia/Ho_Chi_Minh"
  "TELEGRAM_BOT_TOKEN=$TELEGRAM_BOT_TOKEN"
  "TELEGRAM_HOME_CHANNEL=$TELEGRAM_HOME_CHANNEL"
  "SDTK_MARKETING_HOME=$ledger_home"
)

for name in   PLAUSIBLE_API_KEY PLAUSIBLE_SITE_ID PLAUSIBLE_API_BASE   FB_PAGE_TOKEN FB_PAGE_ID FACEBOOK_PAGE_ACCESS_TOKEN FACEBOOK_PAGE_ID   LEMONSQUEEZY_API_KEY MKT_NPM_PACKAGES MKT_GITHUB_REPO; do
  if [[ -n "${!name:-}" ]]; then
    env_args+=("$name=${!name}")
  fi
done

umask 077
exec env -i "${env_args[@]}"   /usr/bin/python3 /workspace/hermes-agent-plugin/control-plane/hersocial-marketing-automation/hersocial_marketing_automation_runner.py     --poll-seconds "${HERSOCIAL_MARKETING_POLL_SECONDS:-30}"     "$@"
