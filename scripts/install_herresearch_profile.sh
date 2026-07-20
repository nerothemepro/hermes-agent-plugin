#!/usr/bin/env bash
set -euo pipefail

PROFILE_NAME="${PROFILE_NAME:-herresearch}"
PROFILE_BASE="${HERPROFILE_BASE:-/opt/data/hermes-profiles}"
PROFILE_HOME="$PROFILE_BASE/$PROFILE_NAME"
BOT_TOKEN="${TELEGRAM_BOT_TOKEN:-}"
ALLOWED_USERS="${TELEGRAM_ALLOWED_USERS:-}"
HOME_CHANNEL="${TELEGRAM_HOME_CHANNEL:-}"
BROWSER_USE_API_KEY_VALUE="${BROWSER_USE_API_KEY:-}"
REDDIT_CLIENT_ID_VALUE="${REDDIT_CLIENT_ID:-}"
REDDIT_CLIENT_SECRET_VALUE="${REDDIT_CLIENT_SECRET:-}"
REDDIT_USER_AGENT_VALUE="${REDDIT_USER_AGENT:-herresearch-readonly/1.0}"
TAVILY_API_KEY_VALUE="${TAVILY_API_KEY:-}"

command -v xvfb-run >/dev/null 2>&1 || { echo "xvfb-run is required for Booking.com headed browser" >&2; exit 2; }

mkdir -p "$PROFILE_HOME"/{logs,sessions,memories,skills,cache,reports,workspace,hooks,audio_cache,image_cache,pairing,cron,bin,sandboxes}

cp /workspace/hermes-agent-plugin/docs/HERRESEARCH_PROFILE.md "$PROFILE_HOME/PROFILE.md"
cp /workspace/hermes-agent-plugin/docs/HERRESEARCH_SOUL.md "$PROFILE_HOME/SOUL.md"
install -d -m 700 "$PROFILE_HOME/skills/research/evidence-gated-trend-research"
cp /workspace/hermes-agent-plugin/skills/evidence-gated-trend-research/SKILL.md "$PROFILE_HOME/skills/research/evidence-gated-trend-research/SKILL.md"
install -d -m 700 "$PROFILE_HOME/skills/research/japan-hotel-availability"
cp -a /workspace/hermes-agent-plugin/skills/japan-hotel-availability/. "$PROFILE_HOME/skills/research/japan-hotel-availability/"
install -d -m 700 "$PROFILE_HOME/plugins/japan-hotel-research"
cp -a /workspace/hermes-agent-plugin/hermes-plugin/japan_hotel_research/. "$PROFILE_HOME/plugins/japan-hotel-research/"

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
  max_turns: 30
  gateway_timeout: 1800
  restart_drain_timeout: 180
  api_max_retries: 3
  tool_use_enforcement: true
  task_completion_guidance: true
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
tools:
  tool_search:
    enabled: false
    threshold_pct: 10
    search_default_limit: 5
    max_search_limit: 20
tool_loop_guardrails:
  warnings_enabled: true
  hard_stop_enabled: true
  warn_after:
    exact_failure: 2
    same_tool_failure: 3
    idempotent_no_progress: 2
  hard_stop_after:
    exact_failure: 5
    same_tool_failure: 8
    idempotent_no_progress: 5
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
plugins:
  enabled:
    - japan-hotel-research
approvals:
  mode: manual
  timeout: 60
  cron_mode: deny
  mcp_reload_confirm: false
  destructive_slash_confirm: false
cron:
  wrap_response: true
  max_parallel_jobs: 1
timezone: Asia/Tokyo
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
mcp_servers:
  playwright:
    command: /workspace/hermes-agent-plugin/scripts/playwright_mcp_server.sh
    enabled: true
    tools:
      include:
        - browser_navigate
        - browser_snapshot
        - browser_find
        - browser_click
        - browser_wait_for
        - browser_network_requests
        - browser_type
        - browser_fill_form
        - browser_select_option
        - browser_tabs
        - browser_take_screenshot
  reddit:
    command: npx
    args:
      - -y
      - reddit-mcp-server@1.5.1
    env:
      REDDIT_AUTH_MODE: anonymous
      REDDIT_SAFE_MODE: strict
      REDDIT_MAX_RETRIES: '1'
      REDDIT_CACHE: 'on'
    enabled: true
    tools:
      include:
        - test_reddit_mcp_server
        - get_top_posts
        - browse_subreddit
        - search_reddit
        - get_post_comments
EOCFG
if [[ -n "$REDDIT_CLIENT_ID_VALUE" && -n "$REDDIT_CLIENT_SECRET_VALUE" ]]; then
  sed -i 's/REDDIT_AUTH_MODE: anonymous/REDDIT_AUTH_MODE: authenticated/' "$PROFILE_HOME/config.yaml"
  sed -i "/REDDIT_CACHE: 'on'/a\      REDDIT_CLIENT_ID: \${REDDIT_CLIENT_ID}\n      REDDIT_CLIENT_SECRET: \${REDDIT_CLIENT_SECRET}\n      REDDIT_USER_AGENT: \${REDDIT_USER_AGENT}" "$PROFILE_HOME/config.yaml"
fi

if [[ -n "$TAVILY_API_KEY_VALUE" ]]; then
  sed -i "s/extract_backend: ''/extract_backend: tavily/" "$PROFILE_HOME/config.yaml"
  cat >>"$PROFILE_HOME/config.yaml" <<'EOCFG'
  tavily:
    command: npx
    args:
      - -y
      - tavily-mcp@0.1.3
    env:
      TAVILY_API_KEY: ${TAVILY_API_KEY}
      DEFAULT_PARAMETERS: '{"include_images":false,"include_raw_content":false,"max_results":5,"search_depth":"basic"}'
    enabled: true
    tools:
      include:
        - tavily-search
        - tavily-extract
EOCFG
fi

cat >"$PROFILE_HOME/.env.example" <<'EOENV'
LM_API_KEY=lm-studio
TELEGRAM_BOT_TOKEN=
TELEGRAM_ALLOWED_USERS=
TELEGRAM_HOME_CHANNEL=
BROWSER_USE_API_KEY=
REDDIT_CLIENT_ID=
REDDIT_CLIENT_SECRET=
REDDIT_USER_AGENT=herresearch-readonly/1.0
TAVILY_API_KEY=
EOENV

if [[ -n "$BOT_TOKEN" && -n "$ALLOWED_USERS" && -n "$HOME_CHANNEL" ]]; then
  cat >"$PROFILE_HOME/.env" <<EOF2
LM_API_KEY=lm-studio
TELEGRAM_BOT_TOKEN=$BOT_TOKEN
TELEGRAM_ALLOWED_USERS=$ALLOWED_USERS
TELEGRAM_HOME_CHANNEL=$HOME_CHANNEL
BROWSER_USE_API_KEY=$BROWSER_USE_API_KEY_VALUE
REDDIT_CLIENT_ID=$REDDIT_CLIENT_ID_VALUE
REDDIT_CLIENT_SECRET=$REDDIT_CLIENT_SECRET_VALUE
REDDIT_USER_AGENT=$REDDIT_USER_AGENT_VALUE
TAVILY_API_KEY=$TAVILY_API_KEY_VALUE
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
   /japan-hotel-research
EOF3
