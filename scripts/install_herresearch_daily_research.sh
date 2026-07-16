#!/usr/bin/env bash
set -euo pipefail

PROFILE_HOME="${HERMES_HOME:-/opt/data/hermes-profiles/herresearch}"
HERMES_BIN="${HERMES_BIN:-/workspace/.venvs/hermes-agent/bin/hermes}"
REPO_ROOT="${REPO_ROOT:-/workspace/hermes-agent-plugin}"
JOB_NAME="HerResearch Daily MMO/POD Trend Brief"
SCHEDULE="${HERRESEARCH_DAILY_SCHEDULE:-0 9 * * *}"
PROMPT_FILE="$REPO_ROOT/configs/herresearch-daily-research-brief.md"
SKILL_NAME="evidence-gated-trend-research"
SKILL_SOURCE="$REPO_ROOT/skills/$SKILL_NAME/SKILL.md"
SKILL_DEST="$PROFILE_HOME/skills/research/$SKILL_NAME/SKILL.md"
JOBS_FILE="$PROFILE_HOME/cron/jobs.json"

for path in "$PROFILE_HOME/config.yaml" "$PROMPT_FILE" "$SKILL_SOURCE"; do
  [[ -f "$path" ]] || { echo "Missing required file: $path" >&2; exit 1; }
done

grep -q '^timezone: Asia/Tokyo$' "$PROFILE_HOME/config.yaml" || {
  echo "Refusing to schedule: profile timezone is not Asia/Tokyo" >&2
  exit 1
}

install -d -m 700 "$(dirname "$SKILL_DEST")"
install -m 600 "$SKILL_SOURCE" "$SKILL_DEST"
prompt="$(cat "$PROMPT_FILE")"
job_id=""
if [[ -f "$JOBS_FILE" ]]; then
  job_id="$(jq -r --arg name "$JOB_NAME" '.jobs[]? | select(.name == $name) | .id' "$JOBS_FILE" | head -n1)"
fi

if [[ -n "$job_id" ]]; then
  HERMES_HOME="$PROFILE_HOME" "$HERMES_BIN" cron edit "$job_id" \
    --schedule "$SCHEDULE" --prompt "$prompt" --deliver telegram --skill "$SKILL_NAME"
else
  HERMES_HOME="$PROFILE_HOME" "$HERMES_BIN" cron create "$SCHEDULE" "$prompt" \
    --name "$JOB_NAME" --deliver telegram --skill "$SKILL_NAME"
fi

HERMES_HOME="$PROFILE_HOME" "$HERMES_BIN" cron list
