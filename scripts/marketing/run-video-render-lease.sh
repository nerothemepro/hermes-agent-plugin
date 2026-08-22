#!/usr/bin/env bash
set -euo pipefail

usage() {
  echo "usage: run-video-render-lease.sh --lease <lease.json> [--dry-run]" >&2
  exit 2
}

lease=''
dry_run=false
while [[ $# -gt 0 ]]; do
  case "$1" in
    --lease) lease="${2:-}"; shift 2 ;;
    --dry-run) dry_run=true; shift ;;
    *) usage ;;
  esac
done
[[ -n "$lease" && -f "$lease" ]] || usage

readarray -t fields < <(node - "$lease" <<'NODE'
const fs = require('fs');
const file = process.argv[2];
let lease;
try { lease = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { process.exit(2); }
if (!lease || lease.schema_version !== 'sdtk.marketing-video-render-lease-request.v1' ||
  lease.state !== 'REQUESTED' || lease.provider !== 'hyperframes' ||
  typeof lease.project_id !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/.test(lease.project_id) ||
  typeof lease.output_reference !== 'string' || !lease.output_reference ||
  !/^[a-f0-9]{64}$/i.test(String(lease.creative_directive_sha256 || '')) ||
  !/^[a-f0-9]{64}$/i.test(String(lease.motion_map_sha256 || ''))) process.exit(2);
for (const value of [lease.project_id, lease.output_reference, lease.creative_directive_sha256, lease.motion_map_sha256]) console.log(value);
NODE
) || { echo 'render lease: invalid lease record; nothing started' >&2; exit 2; }

project_id="${fields[0]}"
out="${fields[1]}"

for name in SDTK_MARKETING_RENDER_LEASE_VERIFY_EVIDENCE_CMD SDTK_MARKETING_RENDER_LEASE_UNLOAD_LLM_CMD SDTK_MARKETING_RENDER_LEASE_FREE_CACHE_CMD SDTK_MARKETING_RENDER_LEASE_RENDER_CMD SDTK_MARKETING_RENDER_LEASE_BANK_OUTPUT_CMD; do
  [[ -n "${!name:-}" ]] || { echo "render lease: $name is not configured; nothing started" >&2; exit 2; }
done

quote() { printf "'%s'" "${1//\'/\'\\\'\'}"; }
expand() {
  local template="$1"
  template="${template//\{lease\}/$(quote "$lease")}"
  template="${template//\{out\}/$(quote "$out")}"
  printf '%s' "$template"
}

run_phase() {
  local phase="$1"
  local template="$2"
  if [[ "$dry_run" == true ]]; then
    printf '%s\n' "DRY_RUN phase=$phase"
    return 0
  fi
  bash -lc "$(expand "$template")" >/dev/null
}

status=completed
failed_phase=''
if ! run_phase verify_persisted_evidence "$SDTK_MARKETING_RENDER_LEASE_VERIFY_EVIDENCE_CMD"; then status=failed; failed_phase=verify_persisted_evidence; fi
if [[ "$status" == completed ]] && ! run_phase unload_local_llm "$SDTK_MARKETING_RENDER_LEASE_UNLOAD_LLM_CMD"; then status=failed; failed_phase=unload_local_llm; fi
if [[ "$status" == completed ]] && ! run_phase free_renderer_cache "$SDTK_MARKETING_RENDER_LEASE_FREE_CACHE_CMD"; then status=failed; failed_phase=free_renderer_cache; fi
if [[ "$status" == completed ]] && ! run_phase render "$SDTK_MARKETING_RENDER_LEASE_RENDER_CMD"; then status=failed; failed_phase=render; fi
if [[ "$status" == completed ]] && ! run_phase bank_output_and_frames "$SDTK_MARKETING_RENDER_LEASE_BANK_OUTPUT_CMD"; then status=failed; failed_phase=bank_output_and_frames; fi

node - "$status" "$project_id" "$out" "$failed_phase" <<'NODE'
const [status, projectId, outputReference, failedPhase] = process.argv.slice(2);
process.stdout.write(JSON.stringify({
  schema_version: 'sdtk.marketing-video-render-lease-receipt.v1',
  status,
  project_id: projectId,
  output_reference: outputReference,
  failed_phase: failedPhase || undefined,
  actions: ['persist-local-executor-result', 'unload-local-llm', 'free-renderer-cache', 'render', 'bank-output-and-frames'],
}, null, 2) + '\n');
NODE

[[ "$status" == completed ]]
