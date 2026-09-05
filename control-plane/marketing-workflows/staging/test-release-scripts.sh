#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd "$(dirname "$0")" && pwd)"
root="$(mktemp -d /tmp/sdtk-marketing-workflow-staging-test-XXXXXX)"
trap 'rm -rf "$root"' EXIT

export SDTK_MARKETING_WORKFLOW_STAGING_ROOT="$root/staging"
"$script_dir/install-release.sh" "smoke-r1" > "$root/install.log"
"$script_dir/activate-release.sh" "smoke-r1" > "$root/activate.log"
"$script_dir/verify-release.sh" "$SDTK_MARKETING_WORKFLOW_STAGING_ROOT/releases/smoke-r1" > "$root/verify.log"
test "$(tr -d '\r\n' < "$SDTK_MARKETING_WORKFLOW_STAGING_ROOT/active-release")" = "smoke-r1"
test -f "$SDTK_MARKETING_WORKFLOW_STAGING_ROOT/activation-backups/$(ls "$SDTK_MARKETING_WORKFLOW_STAGING_ROOT/activation-backups" | head -1)"
printf '\n// tamper\n' >> "$SDTK_MARKETING_WORKFLOW_STAGING_ROOT/releases/smoke-r1/control-plane/marketing-workflows/controller.js"
if "$script_dir/verify-release.sh" "$SDTK_MARKETING_WORKFLOW_STAGING_ROOT/releases/smoke-r1" >/dev/null 2>&1; then
  echo "tampered release unexpectedly verified" >&2
  exit 4
fi
printf 'MARKETING_WORKFLOW_STAGING_RELEASE_TEST_OK root=%s\n' "$root"
