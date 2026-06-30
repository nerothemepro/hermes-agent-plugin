# HerWiki GitHub Discovery Report-First Tool

Purpose: run a deterministic daily GitHub discovery scan for high-signal AI repositories and write review artifacts without mutating the wiki knowledge layer.

This tool is report-first only.

It may write:

- a markdown report under `wiki/maintenance/`
- a machine JSON report under `workspace/reports/`
- an optional raw batch file under `raw/inbox/` only when at least one repo deserves review and is not already saturated in the wiki

It does **not**:

- ingest wiki pages
- compile wiki pages
- rewrite existing wiki content
- use browser automation
- auto-approve anything for HerWiki

## CLI

```bash
/workspace/hermes-agent-plugin/bin/herwiki-github-discovery-report
```

Common usage:

```bash
/workspace/hermes-agent-plugin/bin/herwiki-github-discovery-report \
  --wiki-root /workspace/sdtk-wiki/ai-agent-second-brain-main
```

Override topic seeds:

```bash
/workspace/hermes-agent-plugin/bin/herwiki-github-discovery-report \
  --topics ai-agents,multi-agent,rag,knowledge-base,second-brain,llm-framework
```

Override keyword seeds:

```bash
/workspace/hermes-agent-plugin/bin/herwiki-github-discovery-report \
  --keywords "AI agent framework,multi-agent framework,advanced RAG workflow,AI knowledge base,AI second brain"
```

## Wrapper For Cron / Operator Runs

```bash
/workspace/hermes-agent-plugin/scripts/herwiki_github_discovery_report.sh
```

Default behavior:

- timezone exported as `Asia/Tokyo`
- topic seeds set to the approved V1 list
- keyword seeds set to the approved V1 list
- token env name defaults to `GITHUB_TOKEN`

Supported environment variables:

- `WIKI_ROOT`
- `GITHUB_TOKEN_ENV`
- `TOPICS`
- `KEYWORDS`
- `PER_PAGE`
- `TIMEOUT_SECONDS`
- `GENERATED_AT`
- `TZ`

## Output Contract

CLI stdout:

```json
{
  "status": "completed|degraded",
  "generated_at": "2026-06-30T06:00:00Z",
  "markdown_report_path": ".../wiki/maintenance/github-trending-report-YYYY-MM-DD.md",
  "json_report_path": ".../workspace/reports/github-trending-report-YYYY-MM-DD.json",
  "raw_batch_path": ".../raw/inbox/YYYY-MM-DD-github-trending-batch.md",
  "candidate_count": 42,
  "selected_count": 5,
  "top_recommendations": [
    {
      "full_name": "owner/repo",
      "repo_url": "https://github.com/owner/repo",
      "score_total": 0.7123,
      "stars": 52300,
      "forks": 6100,
      "already_known": false
    }
  ],
  "warnings": [],
  "errors": []
}
```

## Deterministic V1 Rules

- hard filters:
  - stars `>= 20000`
  - forks `> 2000`
  - must pass deterministic domain relevance
- domain relevance is rule-based, not LLM-based
- OSS Insight is optional
- if OSS Insight is unavailable, status should become `degraded`, but report generation must continue
- HerWiki ingest remains manual

## Recommended Daily Flow

1. Cron or operator runs `herwiki_github_discovery_report.sh`.
2. Review markdown report in `wiki/maintenance/`.
3. Review JSON report in `workspace/reports/`.
4. If `raw_batch_path` exists and Nero approves, ask HerWiki to ingest that batch file.
5. Do not auto-run `sdtk-wiki compile --apply`.

## Recommended HerResearch / HerOrches Usage

### HerResearch

Use this deterministic helper instead of free-form web research for the daily GitHub scan.

### HerOrches

Use this helper when preparing a compact operator report. HerOrches may summarize the result and send it over Telegram, but it must not auto-trigger HerWiki ingest in V1.
