#!/usr/bin/env bash
set -eu

# Disposable, no-publish proof for the staged SDTK video self-service control path.
# It leaves its ledger in /tmp for inspection and never contacts Hermes, Telegram, or social APIs.

staging_root="${1:-}"
release_id="${2:-}"
case "$staging_root" in ""|/*) ;; *) echo "staging root must be absolute" >&2; exit 2 ;; esac
case "$release_id" in ""|*[!a-zA-Z0-9._-]*) echo "invalid release id" >&2; exit 2 ;; esac

script_dir="$(cd "$(dirname "$0")/.." && pwd)"
wrapper="$script_dir/control-plane/video-dogfood/staging/with-active-toolchain.sh"
release_dir="$staging_root/releases/$release_id"
test -x "$wrapper" || { echo "staging wrapper unavailable" >&2; exit 3; }
test -x "$release_dir/node_modules/.bin/sdtk-agent" || { echo "staged sdtk-agent unavailable" >&2; exit 3; }

root="$(mktemp -d /tmp/sdtk-video-self-service-e2e-XXXXXX)"
project="$root/project"
mkdir -p "$project"
mkdir -p "$project/.sdtk/agent-runtime/runs" "$root/registry"
prepare_json="$(HERSOCIAL_AUTO_POST_ENABLED=false SDTK_VIDEO_DOGFOOD_TOOLCHAIN_ROOT="$staging_root" SDTK_VIDEO_SELF_SERVICE_PROJECT_PATH="$project" SDTK_VIDEO_SELF_SERVICE_REGISTRY_DIR="$root/registry" node "$script_dir/bin/hermes-video-self-service" prepare EP2)"
printf '%s\n' "$prepare_json" > "$root/prepare.json"
prepared_run_id="$(printf '%s' "$prepare_json" | node -pe 'const p=JSON.parse(require("fs").readFileSync(0,"utf8")); if(p.status!=="prepared_waiting_for_exact_dispatch_approval") process.exit(1); p.run_id')"
HERSOCIAL_AUTO_POST_ENABLED=false SDTK_VIDEO_DOGFOOD_TOOLCHAIN_ROOT="$staging_root" SDTK_VIDEO_SELF_SERVICE_PROJECT_PATH="$project" SDTK_VIDEO_SELF_SERVICE_REGISTRY_DIR="$root/registry" node "$script_dir/bin/hermes-video-self-service" cancel "$prepared_run_id" > "$root/prepare-cancel.json"
prepared_status="$(SDTK_VIDEO_DOGFOOD_TOOLCHAIN_ROOT="$staging_root" "$wrapper" sdtk-agent run status --project-path "$project" --run-id "$prepared_run_id" --json | node -pe 'JSON.parse(require("fs").readFileSync(0,"utf8")).status')"
test "$prepared_status" = "cancelled"
cat > "$root/workflow.json" <<'JSON'
{"schema_version":"sdtk.agent-workflow.v1","workflow_id":"self_service_disposable_smoke","stages":[
{"id":"script_package","type":"task","role":"worker","params":{"episode_manifest_sha256":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"}},
{"id":"owner_story_lock","type":"human_gate","depends_on":["script_package"]},
{"id":"product_capture","type":"task","role":"worker","depends_on":["owner_story_lock"]},
{"id":"owner_picture_lock","type":"human_gate","depends_on":["product_capture"]},
{"id":"social_package","type":"task","role":"worker","depends_on":["owner_picture_lock"]},
{"id":"owner_publish_approval","type":"human_gate","depends_on":["social_package"]},
{"id":"final_report","type":"report","depends_on":["owner_publish_approval"],"output":{"path":"reports/final_report.md"}}]}
JSON
printf '%s\n' '{"schema_version":"sdtk.agent-runtime-map.v1","environment_id":"disposable-manual","roles":{"worker":{"adapter":"manual"}}}' > "$root/runtime-map.json"

run_agent() {
  SDTK_VIDEO_DOGFOOD_TOOLCHAIN_ROOT="$staging_root" "$wrapper" sdtk-agent "$@"
}
run_id="$(run_agent run start --workflow "$root/workflow.json" --runtime-map "$root/runtime-map.json" --feature-key HCP_SMOKE --goal 'disposable only' --project-path "$project" --json | node -pe 'JSON.parse(require("fs").readFileSync(0,"utf8")).run_id')"
run_agent run continue --project-path "$project" --run-id "$run_id" --json >/dev/null
cat > "$root/evidence.json" <<JSON
{"schema_version":"sdtk.agent-evidence.v1","run_id":"$run_id","task_id":"script_package","role":"worker","summary":"disposable script evidence","verification_evidence":"manual smoke fixture","commands_run":[],"blockers":[],"files_touched":[],"artifacts":[],"external_ids":{},"stop_condition_hit":null,"errors":[],"warnings":[],"fields":{}}
JSON
run_agent evidence submit --project-path "$project" --run-id "$run_id" --task script_package --file "$root/evidence.json" --json >/dev/null
run_agent run continue --project-path "$project" --run-id "$run_id" --json >/dev/null
packet="$(PATH="$release_dir/node_modules/.bin:$PATH" SDTK_VIDEO_SELF_SERVICE_PROJECT_PATH="$project" node "$script_dir/bin/hermes-video-self-service" packet "$run_id" story_lock)"
packet_sha="$(printf '%s' "$packet" | node -pe 'JSON.parse(require("fs").readFileSync(0,"utf8")).packet_sha256')"
PATH="$release_dir/node_modules/.bin:$PATH" SDTK_VIDEO_SELF_SERVICE_PROJECT_PATH="$project" node "$script_dir/bin/hermes-video-self-service" approve-gate "$run_id" story_lock "$packet_sha" >/dev/null
PATH="$release_dir/node_modules/.bin:$PATH" SDTK_VIDEO_SELF_SERVICE_PROJECT_PATH="$project" node "$script_dir/bin/hermes-video-self-service" cancel "$run_id" >/dev/null
final="$(run_agent run status --project-path "$project" --run-id "$run_id" --json)"
status="$(printf '%s' "$final" | node -pe 'JSON.parse(require("fs").readFileSync(0,"utf8")).status')"
test "$status" = "cancelled" || { echo "smoke run did not cancel" >&2; exit 4; }
printf 'VIDEO_SELF_SERVICE_DISPOSABLE_SMOKE_OK root=%s run_id=%s packet_sha256=%s final_status=%s\n' "$root" "$run_id" "$packet_sha" "$status"
