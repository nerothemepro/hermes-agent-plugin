#!/usr/bin/env bash
set -euo pipefail

PROFILE_HOME="${HERMES_HOME:-/opt/data/hermes-profiles/herresearch}"
HERMES_BIN="${HERMES_BIN:-/workspace/.venvs/hermes-agent/bin/hermes}"
REPO_ROOT="${REPO_ROOT:-/workspace/hermes-agent-plugin}"
JOB_NAME="HerResearch Daily MMO/POD Trend Brief"
SCHEDULE="${HERRESEARCH_DAILY_SCHEDULE:-0 9 * * *}"
COLLECTOR_NAME="herresearch_mmo_trend_collector.py"
COLLECTOR_SOURCE="$REPO_ROOT/scripts/$COLLECTOR_NAME"
COLLECTOR_DEST="$PROFILE_HOME/scripts/$COLLECTOR_NAME"
JOBS_FILE="$PROFILE_HOME/cron/jobs.json"
BACKUP_ROOT="${BACKUP_ROOT:-/opt/data/hermes/control-plane/backups}"

for path in "$PROFILE_HOME/config.yaml" "$PROFILE_HOME/.env" "$COLLECTOR_SOURCE"; do
  [[ -f "$path" ]] || { echo "Missing required file: $path" >&2; exit 1; }
done
grep -q '^timezone: Asia/Tokyo$' "$PROFILE_HOME/config.yaml" || {
  echo "Refusing to schedule: profile timezone is not Asia/Tokyo" >&2; exit 1;
}
grep -q '^TAVILY_API_KEY=' "$PROFILE_HOME/.env" || {
  echo "Missing TAVILY_API_KEY entry in $PROFILE_HOME/.env" >&2; exit 1;
}

backup_dir="$BACKUP_ROOT/herresearch-mmo-deterministic-$(date -u +%Y%m%dT%H%M%SZ)"
install -d -m 700 "$backup_dir" "$(dirname "$COLLECTOR_DEST")"
[[ ! -f "$JOBS_FILE" ]] || install -m 600 "$JOBS_FILE" "$backup_dir/jobs.before.json"
[[ ! -f "$COLLECTOR_DEST" ]] || install -m 700 "$COLLECTOR_DEST" "$backup_dir/$COLLECTOR_NAME.before"
install -m 700 "$COLLECTOR_SOURCE" "$COLLECTOR_DEST"

job_id=""
if [[ -f "$JOBS_FILE" ]]; then
  job_id="$(jq -r --arg name "$JOB_NAME" '.jobs[]? | select(.name == $name) | .id' "$JOBS_FILE" | head -n1)"
fi

if [[ -n "$job_id" ]]; then
  HERMES_HOME="$PROFILE_HOME" "$HERMES_BIN" cron edit "$job_id" \
    --schedule "$SCHEDULE" \
    --prompt "Deterministic evidence collector; stdout is delivered verbatim." \
    --deliver telegram --clear-skills --script "$COLLECTOR_NAME" --no-agent
else
  HERMES_HOME="$PROFILE_HOME" "$HERMES_BIN" cron create "$SCHEDULE" \
    --name "$JOB_NAME" --deliver telegram --script "$COLLECTOR_NAME" --no-agent
fi

printf 'BACKUP_DIR=%s\n' "$backup_dir"
printf 'ROLLBACK=cp %q %q && rm -f %q && HERMES_HOME=%q %q gateway restart\n' \
  "$backup_dir/jobs.before.json" "$JOBS_FILE" "$COLLECTOR_DEST" "$PROFILE_HOME" "$HERMES_BIN"
HERMES_HOME="$PROFILE_HOME" "$HERMES_BIN" cron list
