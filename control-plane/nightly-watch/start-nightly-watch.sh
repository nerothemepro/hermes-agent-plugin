#!/usr/bin/env bash
set -euo pipefail

profile_env=/opt/data/hermes-profiles/herorches/.env
secret_env=/opt/data/hermes/control-plane/secrets/uc1-nightly-watch.env

for required in "$profile_env" "$secret_env"; do
  if [[ ! -f "$required" ]]; then
    echo "nightly watch bootstrap failed: required secret source unavailable" >&2
    exit 1
  fi
done

set +u
set -a
. "$profile_env"
. "$secret_env"
set +a
set -u

for required_env in TELEGRAM_BOT_TOKEN TELEGRAM_HOME_CHANNEL UC1_GITHUB_TOKEN; do
  if [[ -z "${!required_env:-}" ]]; then
    echo "nightly watch bootstrap failed: required environment unavailable" >&2
    exit 1
  fi
done

umask 077
exec env -i \
  PATH="${PATH:-/usr/local/bin:/usr/bin:/bin}" \
  HOME=/opt/data/hermes/control-plane/nightly-watch/home \
  LANG=C.UTF-8 \
  LC_ALL=C.UTF-8 \
  TZ=Asia/Tokyo \
  HERMES_HOME=/opt/data/hermes \
  TELEGRAM_BOT_TOKEN="$TELEGRAM_BOT_TOKEN" \
  TELEGRAM_HOME_CHANNEL="$TELEGRAM_HOME_CHANNEL" \
  UC1_GITHUB_TOKEN="$UC1_GITHUB_TOKEN" \
  /usr/bin/python3 /workspace/hermes-agent-plugin/control-plane/nightly-watch/nightly_watch_runner.py \
    --poll-seconds "${HERMES_UC1_POLL_SECONDS:-15}"
