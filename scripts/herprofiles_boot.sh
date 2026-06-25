#!/usr/bin/env bash
# Start every Hermes profile gateway that is not already running.
#
# Designed to be the container's startup command so all agents (HerVid,
# HerResearch, HerDev, HerTran) come up automatically when the container
# starts. The container has no init system (PID 1 is `sleep infinity`), so
# this script is the auto-start hook.
#
# Usage:
#   herprofiles_boot.sh                 # start all missing profiles, then exit
#   herprofiles_boot.sh --keep-alive    # start all, then stay in foreground
#                                        # (use this as the container CMD)
#
# Env:
#   HERMES_PROFILES   space-separated profile list
#                     (default: "hervid herresearch herdev hertran herwiki")
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
START_SH="$SCRIPT_DIR/herprofile_start.sh"
PROFILES="${HERMES_PROFILES:-hervid herresearch herdev hertran herwiki}"
HERMES_BIN="${HERMES_BIN:-/workspace/.venvs/hermes-agent/bin/hermes}"

KEEP_ALIVE=0
[[ "${1:-}" == "--keep-alive" ]] && KEEP_ALIVE=1

# Return 0 if a `hermes gateway run` process already has this HERMES_HOME.
is_running() {
  local home="$1" pid proc_home
  while IFS= read -r pid; do
    [[ -r "/proc/$pid/environ" ]] || continue
    proc_home="$(tr '\000' '\n' < "/proc/$pid/environ" | sed -n 's/^HERMES_HOME=//p' | head -1)"
    [[ "$proc_home" == "$home" ]] && return 0
  done < <(pgrep -f "hermes gateway run" 2>/dev/null || true)
  return 1
}

echo "[boot] starting Hermes profiles: $PROFILES"
for profile in $PROFILES; do
  home="/opt/data/hermes-profiles/$profile"
  if [[ ! -d "$home" ]]; then
    echo "[boot] ✗ $profile: profile dir not found ($home), skipping"
    continue
  fi
  if is_running "$home"; then
    echo "[boot] = $profile already running, skipping"
    continue
  fi
  echo "[boot] + starting $profile"
  bash "$START_SH" "$profile" || echo "[boot] ✗ $profile failed to start"
done

echo "[boot] done."

if [[ "$KEEP_ALIVE" -eq 1 ]]; then
  echo "[boot] keep-alive: holding container foreground (Ctrl+C / docker stop to exit)"
  exec sleep infinity
fi
