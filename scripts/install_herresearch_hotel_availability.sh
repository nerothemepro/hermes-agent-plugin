#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
PROFILE_NAME="${1:-herresearch}"
PROFILE_BASE="${HERPROFILE_BASE:-/opt/data/hermes-profiles}"
PROFILE_HOME="$PROFILE_BASE/$PROFILE_NAME"
HERMES_PYTHON="${HERMES_PYTHON:-/workspace/.venvs/hermes-agent/bin/python}"
BACKUP_BASE="${HERRESEARCH_BACKUP_BASE:-/opt/data/hermes/control-plane/backups}"
STAMP="$(date -u +%Y%m%dT%H%M%S%NZ)"
BACKUP_DIR="$BACKUP_BASE/herresearch-hotel-availability-$STAMP"
SKILL_SOURCE="$ROOT_DIR/skills/japan-hotel-availability"
SKILL_TARGET="$PROFILE_HOME/skills/research/japan-hotel-availability"
PLUGIN_SOURCE="$ROOT_DIR/hermes-plugin/japan_hotel_research"
PLUGIN_TARGET="$PROFILE_HOME/plugins/japan-hotel-research"
JALAN_CLI="/workspace/jalan-room-search-tool/bin/jalan-room-search"
RUNTIME_SCRIPTS_DIR="${HERMES_RUNTIME_SCRIPTS_DIR:-/workspace/hermes-agent-plugin/scripts}"

[[ "$PROFILE_NAME" == "herresearch" ]] || { echo "Only herresearch is supported" >&2; exit 2; }
[[ -f "$PROFILE_HOME/config.yaml" ]] || { echo "Missing $PROFILE_HOME/config.yaml" >&2; exit 2; }
[[ -f "$SKILL_SOURCE/SKILL.md" ]] || { echo "Missing source skill at $SKILL_SOURCE" >&2; exit 2; }
[[ -f "$PLUGIN_SOURCE/plugin.yaml" && -f "$PLUGIN_SOURCE/workflow.py" ]] || { echo "Missing native command plugin at $PLUGIN_SOURCE" >&2; exit 2; }
[[ -x "$JALAN_CLI" ]] || { echo "Missing executable Jalan CLI at $JALAN_CLI" >&2; exit 2; }
[[ -x "$HERMES_PYTHON" ]] || { echo "Missing Hermes Python at $HERMES_PYTHON" >&2; exit 2; }
[[ -x "$RUNTIME_SCRIPTS_DIR/herprofile_stop.sh" && -x "$RUNTIME_SCRIPTS_DIR/herprofile_start.sh" ]] || { echo "Missing stable profile wrappers at $RUNTIME_SCRIPTS_DIR" >&2; exit 2; }

SKILL_EXISTED=0
PLUGIN_EXISTED=0
install -d -m 700 "$BACKUP_DIR"
cp -a "$PROFILE_HOME/config.yaml" "$BACKUP_DIR/config.yaml.before"
[[ -f "$PROFILE_HOME/PROFILE.md" ]] && cp -a "$PROFILE_HOME/PROFILE.md" "$BACKUP_DIR/PROFILE.md.before"
[[ -f "$PROFILE_HOME/SOUL.md" ]] && cp -a "$PROFILE_HOME/SOUL.md" "$BACKUP_DIR/SOUL.md.before"
if [[ -d "$SKILL_TARGET" ]]; then
  cp -a "$SKILL_TARGET" "$BACKUP_DIR/japan-hotel-availability.before"
  SKILL_EXISTED=1
fi
if [[ -d "$PLUGIN_TARGET" ]]; then
  cp -a "$PLUGIN_TARGET" "$BACKUP_DIR/japan-hotel-research-plugin.before"
  PLUGIN_EXISTED=1
fi

install -d -m 700 "$SKILL_TARGET" "$PLUGIN_TARGET"
cp -a "$SKILL_SOURCE/." "$SKILL_TARGET/"
cp -a "$PLUGIN_SOURCE/." "$PLUGIN_TARGET/"
cp "$ROOT_DIR/docs/HERRESEARCH_PROFILE.md" "$PROFILE_HOME/PROFILE.md"
cp "$ROOT_DIR/docs/HERRESEARCH_SOUL.md" "$PROFILE_HOME/SOUL.md"

"$HERMES_PYTHON" - "$PROFILE_HOME/config.yaml" <<'PY'
import sys
from pathlib import Path

import yaml

path = Path(sys.argv[1])
data = yaml.safe_load(path.read_text(encoding="utf-8")) or {}
plugins = data.setdefault("plugins", {})
enabled = plugins.setdefault("enabled", [])
if "japan-hotel-research" not in enabled:
    enabled.append("japan-hotel-research")

servers = data.setdefault("mcp_servers", {})
playwright = servers.get("playwright")
if not isinstance(playwright, dict) or not playwright.get("enabled", False):
    raise SystemExit("Playwright MCP is missing or disabled")

include = playwright.setdefault("tools", {}).setdefault("include", [])
required = [
    "browser_type",
    "browser_fill_form",
    "browser_select_option",
    "browser_tabs",
    "browser_take_screenshot",
]
for tool in required:
    if tool not in include:
        include.append(tool)

forbidden = {
    "browser_run_code_unsafe",
    "browser_evaluate",
    "browser_file_upload",
}
present = sorted(forbidden.intersection(include))
if present:
    raise SystemExit(f"Unsafe Playwright tools present: {', '.join(present)}")

path.write_text(yaml.safe_dump(data, sort_keys=False, allow_unicode=True), encoding="utf-8")
PY

chmod 600 "$PROFILE_HOME/config.yaml" "$PROFILE_HOME/PROFILE.md" "$PROFILE_HOME/SOUL.md"

ROLLBACK_SCRIPT="$BACKUP_DIR/rollback.sh"
printf '#!/usr/bin/env bash\nset -euo pipefail\n' >"$ROLLBACK_SCRIPT"
printf 'cp -a %q %q\n' "$BACKUP_DIR/config.yaml.before" "$PROFILE_HOME/config.yaml" >>"$ROLLBACK_SCRIPT"
[[ -f "$BACKUP_DIR/PROFILE.md.before" ]] && printf 'cp -a %q %q\n' "$BACKUP_DIR/PROFILE.md.before" "$PROFILE_HOME/PROFILE.md" >>"$ROLLBACK_SCRIPT"
[[ -f "$BACKUP_DIR/SOUL.md.before" ]] && printf 'cp -a %q %q\n' "$BACKUP_DIR/SOUL.md.before" "$PROFILE_HOME/SOUL.md" >>"$ROLLBACK_SCRIPT"
printf 'rm -rf %q\n' "$SKILL_TARGET" >>"$ROLLBACK_SCRIPT"
if [[ "$SKILL_EXISTED" == "1" ]]; then
  printf 'cp -a %q %q\n' "$BACKUP_DIR/japan-hotel-availability.before" "$SKILL_TARGET" >>"$ROLLBACK_SCRIPT"
fi
printf 'rm -rf %q\n' "$PLUGIN_TARGET" >>"$ROLLBACK_SCRIPT"
if [[ "$PLUGIN_EXISTED" == "1" ]]; then
  printf 'cp -a %q %q\n' "$BACKUP_DIR/japan-hotel-research-plugin.before" "$PLUGIN_TARGET" >>"$ROLLBACK_SCRIPT"
fi
printf 'bash %q herresearch\n' "$RUNTIME_SCRIPTS_DIR/herprofile_stop.sh" >>"$ROLLBACK_SCRIPT"
printf 'bash %q herresearch\n' "$RUNTIME_SCRIPTS_DIR/herprofile_start.sh" >>"$ROLLBACK_SCRIPT"
chmod 700 "$ROLLBACK_SCRIPT"

printf 'backup_dir=%s\n' "$BACKUP_DIR"
printf 'skill_dir=%s\n' "$SKILL_TARGET"
printf 'plugin_dir=%s\n' "$PLUGIN_TARGET"
printf 'rollback_script=%s\n' "$ROLLBACK_SCRIPT"
