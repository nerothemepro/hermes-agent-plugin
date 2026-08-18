#!/usr/bin/env bash
# Deploy only the EP2 board-local profile alias after source releases are installed.
# No task dispatch, retry, publication, deletion, or profile copy occurs here.
set -euo pipefail

RUN_ID="${1:-}"
if [[ ! "$RUN_ID" =~ ^run_[a-z0-9]+_[a-z0-9]+$ ]]; then
  echo "usage: $0 <run_id>" >&2
  exit 64
fi

HERMES_BIN="/workspace/.venvs/hermes-agent/bin/hermes"
PROJECT_PATH="/workspace/hermes-agent-plugin"
PROFILE_HOME="/opt/data/hermes-profiles/hervid"
REGISTRY="/opt/data/hermes/profiles"
ALIAS="$REGISTRY/hervid"
BACKUP_ROOT="/opt/data/hermes/control-plane/deploy-backups"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
BACKUP="$BACKUP_ROOT/ep2-hervid-profile-alias-$STAMP"
mkdir -p "$BACKUP"
printf "BACKUP=%s\n" "$BACKUP"

if [[ ! -d "$PROFILE_HOME" || ! -d "$REGISTRY" ]]; then
  echo "STOP: expected Hermes profile home or registry is missing" >&2
  exit 1
fi
if [[ -e "$ALIAS" || -L "$ALIAS" ]]; then
  current="$(readlink -f "$ALIAS" || true)"
  expected="$(readlink -f "$PROFILE_HOME")"
  printf "ALIAS_EXISTING=%s\n" "$current"
  [[ "$current" == "$expected" ]] || { echo "STOP: existing hervid alias has a different target" >&2; exit 1; }
else
  printf "ALIAS_ABSENT=1\n" > "$BACKUP/alias-before.txt"
  ln -s "$PROFILE_HOME" "$ALIAS"
  printf "ALIAS_CREATED=%s -> %s\n" "$ALIAS" "$PROFILE_HOME"
fi

CARD_ID="$(node -e 'const s=require(process.argv[1]); const t=s.tasks && s.tasks.episode_render; const id=t && t.external_ids && t.external_ids.hermes_task_id; if (!id) process.exit(2); process.stdout.write(id)' "$PROJECT_PATH/.sdtk/agent-runtime/runs/$RUN_ID/state.json")"
HERMES_HOME="$PROFILE_HOME" HERMES_KANBAN_HOME="$PROFILE_HOME" "$HERMES_BIN" profile list > "$BACKUP/profile-list.txt"
grep -Eq "(^|[[:space:]])hervid([[:space:]]|$)" "$BACKUP/profile-list.txt" || { echo "STOP: hervid is not visible in profile registry" >&2; exit 1; }
HERMES_HOME="$PROFILE_HOME" HERMES_KANBAN_HOME="$PROFILE_HOME" "$HERMES_BIN" -p hervid --version > "$BACKUP/hervid-version.txt"
HERMES_HOME="$PROFILE_HOME" HERMES_KANBAN_HOME="$PROFILE_HOME" "$HERMES_BIN" kanban show "$CARD_ID" --json > "$BACKUP/native-card.json"
node -e 'const fs=require("fs"); const card=process.argv[1]; const p=JSON.parse(fs.readFileSync(process.argv[2], "utf8")); const task=p.task || p; if (!task || task.id !== card) { process.stderr.write("STOP: native card lookup returned a different task\n"); process.exit(1); }' "$CARD_ID" "$BACKUP/native-card.json"
HERMES_HOME="$PROFILE_HOME" HERMES_KANBAN_HOME="$PROFILE_HOME" "$HERMES_BIN" kanban dispatch --dry-run --max 1 --json > "$BACKUP/dispatch-dry-run.json"
node -e 'const fs=require("fs"); const card=process.argv[1]; const p=JSON.parse(fs.readFileSync(process.argv[2], "utf8")); const blocked=Array.isArray(p.skipped_nonspawnable) ? p.skipped_nonspawnable : []; if (blocked.includes(card)) { process.stderr.write("STOP: Hervid card remains nonspawnable\n"); process.exit(1); }' "$CARD_ID" "$BACKUP/dispatch-dry-run.json"
printf "EP2_HERVID_PROFILE_ALIAS_OK\n"
