#!/usr/bin/env bash
set -euo pipefail

PROFILE_NAME="${PROFILE_NAME:-herresearch}"
PROFILE_BASE="${HERPROFILE_BASE:-/opt/data/hermes-profiles}"
PROFILE_HOME="$PROFILE_BASE/$PROFILE_NAME"
BOT_TOKEN="${TELEGRAM_BOT_TOKEN:-}"
ALLOWED_USERS="${TELEGRAM_ALLOWED_USERS:-}"
HOME_CHANNEL="${TELEGRAM_HOME_CHANNEL:-}"
BROWSER_USE_API_KEY_VALUE="${BROWSER_USE_API_KEY:-}"

mkdir -p "$PROFILE_HOME"/{logs,sessions,memories,skills,cache,reports,workspace,hooks,audio_cache,image_cache,pairing,cron,bin,sandboxes}

cp /workspace/hermes-agent-plugin/docs/HERRESEARCH_PROFILE.md "$PROFILE_HOME/PROFILE.md"
cp /workspace/hermes-agent-plugin/docs/HERRESEARCH_SOUL.md "$PROFILE_HOME/SOUL.md"

cat >"$PROFILE_HOME/config.yaml" <<'EOCFG'
model:
  default: google/gemma-4-26b-a4b-qat
  provider: lmstudio
  base_url: http://host.docker.internal:1234/v1
  context_length: 65536
providers: {}
fallback_providers: []
credential_pool_strategies: {}
toolsets:
  - web
  - messaging
  - memory
  - terminal
  - browser
agent:
  max_turns: 12
  gateway_timeout: 1800
  restart_drain_timeout: 180
  api_max_retries: 3
  tool_use_enforcement: auto
  task_completion_guidance: false
  environment_probe: false
  environment_hint: ''
  gateway_timeout_warning: 900
  clarify_timeout: 600
  gateway_notify_interval: 180
  gateway_auto_continue_freshness: 3600
  disabled_toolsets: []
  reasoning_effort: none
terminal:
  backend: local
  cwd: /workspace
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
  cloud_provider: browser-use
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
  github-discovery:
    type: alias
    target: /background /github-discovery
approvals:
  mode: manual
  timeout: 60
  cron_mode: deny
  mcp_reload_confirm: false
  destructive_slash_confirm: false
cron:
  wrap_response: true
  max_parallel_jobs: null
platform_toolsets:
  cli:
    - clarify
    - messaging
    - web
    - cronjob
    - memory
    - terminal
    - browser
  telegram:
    - clarify
    - messaging
    - web
    - cronjob
    - memory
    - terminal
    - browser
EOCFG

cat >"$PROFILE_HOME/.env.example" <<'EOENV'
LM_API_KEY=lm-studio
TELEGRAM_BOT_TOKEN=
TELEGRAM_ALLOWED_USERS=
TELEGRAM_HOME_CHANNEL=
BROWSER_USE_API_KEY=
EOENV

if [[ -n "$BOT_TOKEN" && -n "$ALLOWED_USERS" && -n "$HOME_CHANNEL" ]]; then
  cat >"$PROFILE_HOME/.env" <<EOF2
LM_API_KEY=lm-studio
TELEGRAM_BOT_TOKEN=$BOT_TOKEN
TELEGRAM_ALLOWED_USERS=$ALLOWED_USERS
TELEGRAM_HOME_CHANNEL=$HOME_CHANNEL
BROWSER_USE_API_KEY=$BROWSER_USE_API_KEY_VALUE
EOF2
  echo "Wrote live .env for $PROFILE_NAME"
else
  echo "Skipped live .env creation; fill $PROFILE_HOME/.env from .env.example"
fi

cat <<EOF3
Installed $PROFILE_NAME scaffold at:
  $PROFILE_HOME

Next steps:
1. Fill $PROFILE_HOME/.env
2. Verify Browser Use / LM Studio credentials and reachability
3. Start with:
   bash /workspace/hermes-agent-plugin/scripts/herprofile_start.sh $PROFILE_NAME
4. In Telegram, test:
   /github-discovery
EOF3
