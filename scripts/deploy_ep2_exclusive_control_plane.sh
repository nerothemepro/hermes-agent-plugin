#!/usr/bin/env bash
# Enable exact-command-only handling in the configured HerOrches home group.
# Run only after the core router release containing exclusive_control_plane_mode is installed.
set -euo pipefail

CONFIG="/opt/data/hermes-profiles/herorches/config.yaml"
STOP="/workspace/hermes-agent-plugin/scripts/herprofile_stop.sh"
START="/workspace/hermes-agent-plugin/scripts/herprofile_start.sh"
STATUS="/workspace/hermes-agent-plugin/scripts/herprofile_status.sh"
BACKUP_ROOT="/opt/data/hermes/control-plane/deploy-backups"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
BACKUP="$BACKUP_ROOT/ep2-exclusive-control-plane-$STAMP"
mkdir -p "$BACKUP"
cp -p "$CONFIG" "$BACKUP/config.yaml.before"
printf 'BACKUP=%s\n' "$BACKUP"

node - "$CONFIG" <<'NODE_INNER'
const fs = require('fs');
const file = process.argv[2];
const text = fs.readFileSync(file, 'utf8');
const blockMatch = text.match(/^control_plane_router:\n/m);
if (!blockMatch || blockMatch.index === undefined) throw new Error('STOP: control_plane_router block is missing');
const start = blockMatch.index;
const tail = text.slice(start);
const nextTopLevel = tail.slice('control_plane_router:\n'.length).match(/^\S.*:$/m);
const blockEnd = nextTopLevel
  ? start + 'control_plane_router:\n'.length + nextTopLevel.index
  : text.length;
const before = text.slice(0, start);
const block = text.slice(start, blockEnd);
const after = text.slice(blockEnd);
if (!/^control_plane_router:\n(?:  .*\n)*$/.test(block)) {
  throw new Error('STOP: control_plane_router block has unexpected indentation');
}
function setKey(source, key, value) {
  const pattern = new RegExp('^  ' + key + ':.*$', 'm');
  const line = '  ' + key + ': ' + value;
  return pattern.test(source)
    ? source.replace(pattern, line)
    : source.replace(/^control_plane_router:\n/, 'control_plane_router:\n' + line + '\n');
}
let next = setKey(block, 'home_telegram_chat_env', 'TELEGRAM_HOME_CHANNEL');
next = setKey(next, 'exclusive_control_plane_mode', 'true');
fs.writeFileSync(file, before + next + after);
NODE_INNER

grep -Eq '^  home_telegram_chat_env: TELEGRAM_HOME_CHANNEL$' "$CONFIG"
grep -Eq '^  exclusive_control_plane_mode: true$' "$CONFIG"
bash "$STOP" herorches
bash "$START" herorches
bash "$STATUS" herorches
printf 'EP2_EXCLUSIVE_CONTROL_PLANE_OK\n'
