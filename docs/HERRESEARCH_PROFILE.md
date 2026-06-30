# HerResearch Hermes Profile

Purpose: dedicated Hermes profile for web research, source-backed reports, browser-assisted retrieval, and scheduled AI/news briefings.

Model: `google/gemma-4-26b-a4b-qat`

Primary tools: `web_search`, `web_extract`, `browser`, `cronjob`, `memory`, `send_message`, deterministic helper CLIs when available.

## Persistent Bootstrap Contract

HerResearch must not depend on prior chat history.

At the start of every fresh session, and after `/new` or `/reset`, it must re-read:

```text
/workspace/hermes-agent-plugin/docs/HERMES_MULTI_PROFILE_OPERATIONS_HANDBOOK.md
/workspace/hermes-agent-plugin/docs/FACEBOOK_BATCH_CAPTURE_TO_WIKI_INBOX_TOOL.md
/workspace/hermes-agent-plugin/docs/HERWIKI_INGEST_LATEST_RAW_INBOX_TOOL.md
/workspace/hermes-agent-plugin/docs/OARAI_CAMP_AVAILABILITY_TOOL.md
```

For Hermes-stack diagnosis tasks, it should also use:

```text
/workspace/hermes-agent-plugin/docs/HERORCHES_SYSTEM_HANDOFF.md
```

## Operating Rules

- Prefer deterministic CLIs such as `jalan-room-search` or `oarai-camp-availability` before MCP Playwright freestyle.
- Do not use this profile for video generation or app-building work.
- Telegram auth and browser/provider credentials must be configured separately in the live profile `.env`.
