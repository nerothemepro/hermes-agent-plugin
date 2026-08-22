#!/usr/bin/env bash
set -euo pipefail

plugin_root=/workspace/hermes-agent-plugin
marketing_env=/opt/data/hermes/control-plane/secrets/mkt-digest.env
backup_root=/opt/data/hermes/control-plane/deploy-backups
stamp="$(date -u +%Y%m%dT%H%M%SZ)"
deployed=false
backup="$backup_root/marketing-render-lease-$stamp"

[[ -f "$marketing_env" ]] || { echo 'render lease deploy: marketing environment is unavailable' >&2; exit 2; }
[[ "$(stat -c %a "$marketing_env")" == 600 ]] || { echo 'render lease deploy: marketing environment must be 0600' >&2; exit 2; }
for file in scripts/marketing/run-video-render-lease.sh scripts/marketing/render-lease-local-operator.py; do
  [[ -f "$plugin_root/$file" ]] || { echo "render lease deploy: missing $file" >&2; exit 2; }
done

mkdir -p "$backup"
cp -a "$marketing_env" "$backup/mkt-digest.env"

temporary="$(mktemp)"
cleanup() {
  rm -f "$temporary"
  if [[ "$deployed" != true ]]; then
    install -m 600 "$backup/mkt-digest.env" "$marketing_env"
  fi
}
trap cleanup EXIT
grep -Ev '^SDTK_MARKETING_RENDER_LEASE_(VERIFY_EVIDENCE|UNLOAD_LLM|FREE_CACHE|RENDER|BANK_OUTPUT)_CMD=' "$marketing_env" > "$temporary"
cat >> "$temporary" <<'EOF'
SDTK_MARKETING_RENDER_LEASE_VERIFY_EVIDENCE_CMD='python3 /workspace/hermes-agent-plugin/scripts/marketing/render-lease-local-operator.py verify --lease {lease} --marketing-home "$SDTK_MARKETING_HOME" --output-root /workspace/video_review'
SDTK_MARKETING_RENDER_LEASE_UNLOAD_LLM_CMD='python3 /workspace/hermes-agent-plugin/scripts/marketing/render-lease-local-operator.py unload-lmstudio --lease {lease} --marketing-home "$SDTK_MARKETING_HOME" --output-root /workspace/video_review --base-url "$LMSTUDIO_BASE_URL"'
SDTK_MARKETING_RENDER_LEASE_FREE_CACHE_CMD='python3 /workspace/hermes-agent-plugin/scripts/marketing/render-lease-local-operator.py free-comfy --lease {lease} --marketing-home "$SDTK_MARKETING_HOME" --output-root /workspace/video_review --base-url http://host.docker.internal:8188'
SDTK_MARKETING_RENDER_LEASE_RENDER_CMD='python3 /workspace/hermes-agent-plugin/scripts/marketing/render-lease-local-operator.py render --lease {lease} --marketing-home "$SDTK_MARKETING_HOME" --output-root /workspace/video_review'
SDTK_MARKETING_RENDER_LEASE_BANK_OUTPUT_CMD='python3 /workspace/hermes-agent-plugin/scripts/marketing/render-lease-local-operator.py bank --lease {lease} --marketing-home "$SDTK_MARKETING_HOME" --output-root /workspace/video_review'
EOF
install -m 600 "$temporary" "$marketing_env"
chmod 755 "$plugin_root/scripts/marketing/run-video-render-lease.sh" "$plugin_root/scripts/marketing/render-lease-local-operator.py"

node "$plugin_root/scripts/marketing/test-run-video-render-lease.js" >/dev/null
python3 "$plugin_root/scripts/marketing/test-render-lease-local-operator.py" >/dev/null
for name in VERIFY_EVIDENCE UNLOAD_LLM FREE_CACHE RENDER BANK_OUTPUT; do
  grep -q "^SDTK_MARKETING_RENDER_LEASE_${name}_CMD=" "$marketing_env" || { echo "render lease deploy: missing $name wiring" >&2; exit 1; }
done
[[ "$(stat -c %a "$marketing_env")" == 600 ]] || { echo 'render lease deploy: environment mode drifted' >&2; exit 1; }
deployed=true

echo 'MARKETING_RENDER_LEASE_OPERATOR_DEPLOY_OK'
echo "BACKUP=$backup"
