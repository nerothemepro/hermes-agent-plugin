#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="/workspace/hermes-agent-plugin"
WIKI_ROOT="${WIKI_ROOT:-/workspace/sdtk-wiki/ai-agent-second-brain-main}"
GITHUB_TOKEN_ENV="${GITHUB_TOKEN_ENV:-GITHUB_TOKEN}"
TOPICS="${TOPICS:-ai-agents,multi-agent,rag,knowledge-base,second-brain,llm-framework}"
KEYWORDS="${KEYWORDS:-AI agent framework,multi-agent framework,advanced RAG workflow,AI knowledge base,AI second brain}"
PER_PAGE="${PER_PAGE:-20}"
TIMEOUT_SECONDS="${TIMEOUT_SECONDS:-30}"
GENERATED_AT="${GENERATED_AT:-}"
OSS_MOMENTUM_FILE="${OSS_MOMENTUM_FILE:-}"
OSS_MOMENTUM_URL="${OSS_MOMENTUM_URL:-}"

export TZ="${TZ:-Asia/Tokyo}"

ARGS=(
  "--wiki-root" "$WIKI_ROOT"
  "--topics" "$TOPICS"
  "--keywords" "$KEYWORDS"
  "--per-page" "$PER_PAGE"
  "--timeout-seconds" "$TIMEOUT_SECONDS"
  "--github-token-env" "$GITHUB_TOKEN_ENV"
)

if [[ -n "$GENERATED_AT" ]]; then
  ARGS+=("--generated-at" "$GENERATED_AT")
fi
if [[ -n "$OSS_MOMENTUM_FILE" ]]; then
  ARGS+=("--oss-momentum-file" "$OSS_MOMENTUM_FILE")
fi
if [[ -n "$OSS_MOMENTUM_URL" ]]; then
  ARGS+=("--oss-momentum-url" "$OSS_MOMENTUM_URL")
fi

exec "$ROOT_DIR/bin/herwiki-github-discovery-report" "${ARGS[@]}" "$@"
