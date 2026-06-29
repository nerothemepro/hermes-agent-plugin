#!/usr/bin/env bash
set -euo pipefail

PROFILE_NAME="${PROFILE_NAME:-herorches}"
PROFILE_BASE="${HERPROFILE_BASE:-/opt/data/hermes-profiles}"
PROFILE_HOME="$PROFILE_BASE/$PROFILE_NAME"
BOT_TOKEN="${TELEGRAM_BOT_TOKEN:-}"
ALLOWED_USERS="${TELEGRAM_ALLOWED_USERS:-}"
HOME_CHANNEL="${TELEGRAM_HOME_CHANNEL:-}"

mkdir -p "$PROFILE_HOME"/{logs,sessions,memories,skills,cache,reports,workspace,hooks,audio_cache,image_cache,pairing,cron,bin,sandboxes}

cp /workspace/hermes-agent-plugin/docs/HERORCHES_PROFILE.md "$PROFILE_HOME/PROFILE.md"
cp /workspace/hermes-agent-plugin/docs/HERORCHES_SOUL.md "$PROFILE_HOME/SOUL.md"

cat >"$PROFILE_HOME/config.yaml" <<'EOCFG'
model:
  default: gpt-5.5
  provider: openai-codex
  context_length: 200000
providers: {}
fallback_providers:
  - provider: lmstudio
    model: google/gemma-4-26b-a4b-qat
    base_url: http://host.docker.internal:1234/v1
  - provider: lmstudio
    model: qwen/qwen3.6-27b
    base_url: http://host.docker.internal:1234/v1
credential_pool_strategies: {}
toolsets:
  - messaging
  - terminal
  - file
  - search
  - memory
agent:
  max_turns: 16
  gateway_timeout: 1800
  restart_drain_timeout: 180
  api_max_retries: 3
  tool_use_enforcement: auto
  task_completion_guidance: false
  environment_probe: true
  environment_hint: "Use deterministic scripts under /workspace/hermes-agent-plugin/scripts for monitoring and recovery."
  gateway_timeout_warning: 900
  clarify_timeout: 600
  gateway_notify_interval: 180
  gateway_auto_continue_freshness: 3600
  disabled_toolsets: []
  reasoning_effort: high
terminal:
  backend: local
  cwd: /workspace/hermes-agent-plugin
  timeout: 180
  env_passthrough: []
  shell_init_files: []
  auto_source_bashrc: true
  persistent_shell: true
  lifetime_seconds: 300
web:
  backend: ''
  search_backend: ddgs
  extract_backend: ''
browser:
  inactivity_timeout: 120
  command_timeout: 30
  record_sessions: false
  allow_private_urls: false
  engine: auto
  auto_local_for_private_urls: true
  cdp_url: ''
  dialog_policy: must_respond
  dialog_timeout_s: 300
quick_commands:
  health-all:
    type: alias
    target: /background /health-all
  health:
    type: alias
    target: /background /health
  diag:
    type: alias
    target: /background /diag
  tail:
    type: alias
    target: /background /tail
  recover-all:
    type: alias
    target: /background /recover-all
  recover:
    type: alias
    target: /background /recover
  models:
    type: alias
    target: /background /models
  deps:
    type: alias
    target: /background /deps
  incidents:
    type: alias
    target: /background /incidents
EOCFG

cat >"$PROFILE_HOME/.env.example" <<'EOENV'
LM_API_KEY=unused-for-openai-codex
TELEGRAM_BOT_TOKEN=
TELEGRAM_ALLOWED_USERS=
TELEGRAM_HOME_CHANNEL=
EOENV

if [[ -n "$BOT_TOKEN" && -n "$ALLOWED_USERS" && -n "$HOME_CHANNEL" ]]; then
  cat >"$PROFILE_HOME/.env" <<EOF2
LM_API_KEY=unused-for-openai-codex
TELEGRAM_BOT_TOKEN=$BOT_TOKEN
TELEGRAM_ALLOWED_USERS=$ALLOWED_USERS
TELEGRAM_HOME_CHANNEL=$HOME_CHANNEL
EOF2
  echo "Wrote live .env for $PROFILE_NAME"
else
  echo "Skipped live .env creation; fill $PROFILE_HOME/.env from .env.example"
fi

cat <<EOF3
Installed $PROFILE_NAME scaffold at:
  $PROFILE_HOME

Next steps:
1. Run OAuth login for openai-codex in the same Hermes environment.
2. Fill $PROFILE_HOME/.env
3. Start with:
   bash /workspace/hermes-agent-plugin/scripts/herprofile_start.sh $PROFILE_NAME
EOF3
