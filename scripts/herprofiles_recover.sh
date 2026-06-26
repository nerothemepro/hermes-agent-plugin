#!/usr/bin/env bash
# Recover Hermes profile gateways after host/container restart.
#
# Default mode is conservative: check each known Her bot and start only the
# profiles whose gateway is not running. Use --restart only when you explicitly
# want to stop/start all profiles.
#
# Usage:
#   herprofiles_recover.sh
#   herprofiles_recover.sh --restart
#   HERMES_PROFILES="herresearch herwiki" herprofiles_recover.sh
#
# Docker/PowerShell:
#   docker exec -it hermes-sandbox bash -lc "bash /workspace/hermes-agent-plugin/scripts/herprofiles_recover.sh"
#   docker exec -it hermes-sandbox bash -lc "bash /workspace/hermes-agent-plugin/scripts/herprofiles_recover.sh --restart"
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
START_SH="$SCRIPT_DIR/herprofile_start.sh"
STOP_SH="$SCRIPT_DIR/herprofile_stop.sh"
STATUS_SH="$SCRIPT_DIR/herprofile_status.sh"
PROFILES="${HERMES_PROFILES:-hervid herresearch herdev hertran herwiki hersocial}"

MODE="recover"
case "${1:-}" in
  "")
    ;;
  --restart)
    MODE="restart"
    ;;
  -h|--help)
    sed -n '1,22p' "$0" | sed 's/^# \{0,1\}//'
    exit 0
    ;;
  *)
    echo "Usage: $0 [--restart]" >&2
    exit 2
    ;;
esac

is_running() {
  local home="$1" pid proc_home
  while IFS= read -r pid; do
    [[ -r "/proc/$pid/environ" ]] || continue
    proc_home="$(tr '\000' '\n' < "/proc/$pid/environ" | sed -n 's/^HERMES_HOME=//p' | head -1)"
    [[ "$proc_home" == "$home" ]] && return 0
  done < <(pgrep -f "hermes gateway run" 2>/dev/null || true)
  return 1
}

echo "[recover] mode=$MODE profiles=$PROFILES"

for profile in $PROFILES; do
  home="${HERPROFILE_BASE:-/opt/data/hermes-profiles}/$profile"
  log_file="$home/logs/gateway.log"

  if [[ ! -d "$home" ]]; then
    echo "[recover] FAIL $profile: profile dir not found ($home), skipping"
    continue
  fi

  if [[ "$MODE" == "restart" ]]; then
    echo "[recover] RESTART $profile: stopping existing gateway if any"
    bash "$STOP_SH" "$profile" >/tmp/herprofile_stop_"$profile".log 2>&1 || true
    sleep 1
  elif is_running "$home"; then
    echo "[recover] OK $profile: already running"
    bash "$STATUS_SH" "$profile" 2>/dev/null | sed 's/^/[recover]   /'
    continue
  fi

  echo "[recover] START $profile: starting gateway"
  if bash "$START_SH" "$profile"; then
    sleep 2
    if is_running "$home"; then
      echo "[recover] OK $profile: running"
    else
      echo "[recover] FAIL $profile: start command returned success but no gateway process found"
      [[ -f "$log_file" ]] && tail -40 "$log_file" | sed 's/^/[recover]   log: /'
    fi
  else
    echo "[recover] FAIL $profile: start failed"
    [[ -f "$log_file" ]] && tail -40 "$log_file" | sed 's/^/[recover]   log: /'
  fi
done

echo "[recover] final status"
for profile in $PROFILES; do
  if bash "$STATUS_SH" "$profile" >/tmp/herprofile_status_"$profile".log 2>&1; then
    sed "s/^/[recover]   /" /tmp/herprofile_status_"$profile".log
  else
    sed "s/^/[recover]   /" /tmp/herprofile_status_"$profile".log
  fi
done
