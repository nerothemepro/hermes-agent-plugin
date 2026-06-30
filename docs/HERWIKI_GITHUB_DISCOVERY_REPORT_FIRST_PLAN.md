# HerWiki GitHub Discovery Report-First Plan

Date: 2026-06-30

## 1. Goal

Design a safe daily discovery workflow that scans GitHub for high-signal AI repositories, produces a review-first report, and only ingests selected items into the wiki after explicit human approval.

This is not an autonomous write loop. The default operating mode is:

- collect candidate repositories
- score and summarize them
- write a deterministic report
- wait for Nero to approve which repos should be ingested
- let HerWiki ingest only approved items

## 2. Desired User Outcome

Nero wants HerWiki and the surrounding Hermes bot stack to support a daily scan for repositories related to:

- AI agent frameworks
- multi-agent systems
- advanced RAG workflows
- personal knowledge base / second brain systems with AI integration

The workflow should use:

- GitHub Search API
- GitHub Topics
- OSS Insight trending signals

The workflow should apply strict filters and rank the top candidates, but it should not automatically mutate the wiki.

## 3. Core Decision

Do not make HerWiki both crawler and editor.

Recommended split:

- HerResearch or a deterministic collector helper owns external discovery and candidate capture
- HerWiki owns wiki-local ingest, compile, maintain, search, lint, and query

Reason:

- HerWiki is currently defined as a librarian/editor profile, not a general crawler
- `sdtk-wiki` R1 commands are intentionally safe and local-first
- external fetch, ranking, and scoring are easier to debug when separated from wiki mutation

## 4. Current Capability Reality

Direct checks of `sdtk-wiki` show:

- `sdtk-wiki discover --plan` is plan-only and does not fetch the web
- `sdtk-wiki enrich --source github --mode review` is review-only and does not perform network-backed metadata fetch
- `sdtk-wiki maintain --mode safe` runs report-first maintenance and does not apply wiki mutations or web fetches

Implication:

- `sdtk-wiki` is suitable for local wiki governance and review flows
- it is not, in its current form, the external GitHub crawler/runtime

## 5. Recommended Architecture

Use a three-layer workflow.

### 5.1 Collector Layer

Purpose:

- query GitHub
- gather candidate repositories
- normalize metadata
- produce a deterministic candidate set

Preferred implementation:

- a small deterministic helper CLI, not a free-form LLM prompt loop

Candidate outputs:

- machine-readable report under `workspace/reports/`
- optional raw markdown batch file under wiki `raw/inbox/`

### 5.2 Scoring and Review Layer

Purpose:

- apply hard filters
- compute ranking
- produce a daily review artifact

This layer should be deterministic and explicit. The output should explain:

- why each repo passed
- which filter excluded others
- how the ranking score was computed
- whether the repo is already known in the wiki

### 5.3 Wiki Integration Layer

Purpose:

- ingest only approved repositories into the wiki
- preserve provenance
- compile or maintain only after ingestion is explicitly requested

This remains HerWiki territory.

## 6. Recommended Role Split

### HerResearch / Collector Helper

Owns:

- external query execution
- GitHub API requests
- topic seeding
- optional OSS Insight signal lookup
- candidate normalization
- daily report generation

Must not:

- auto-write knowledge claims into `wiki/`
- auto-rewrite wiki pages

### HerWiki

Owns:

- `sdtk-wiki ingest`
- `sdtk-wiki compile`
- `sdtk-wiki maintain`
- `sdtk-wiki search`
- `sdtk-wiki query`
- `sdtk-wiki lint`
- provenance-safe source page creation

Must not:

- become the primary external crawler
- auto-ingest unreviewed daily candidates

## 7. Data Sources

### 7.1 GitHub Search API

This should be the primary source of truth for candidate discovery.

Use it for:

- stars threshold
- forks threshold
- topic/keyword/domain matching
- recency metadata such as `updated_at` or `pushed_at`

### 7.2 GitHub Topics

Use topics as taxonomy seeds, not as the final ranking source.

Purpose:

- discover category language
- find adjacent repos that pure keyword search may miss
- enrich query construction

Do not rely on topic pages alone for daily scoring.

### 7.3 OSS Insight

Use OSS Insight as a supporting momentum signal only.

Do not make the workflow depend on scraping the public HTML page alone, because dynamic rendering may be unstable. If a stable API or machine-readable endpoint is not available at runtime, the workflow should degrade gracefully and continue with GitHub-derived scoring.

## 8. Hard Filters

The requested filter policy is valid, but one item needs technical adjustment.

### 8.1 Keep These Hard Filters

- stars `>= 20000`
- forks `> 2000`
- domain relevance to one of:
  - AI agent framework
  - multi-agent system
  - advanced RAG workflow
  - personal knowledge base / second brain with AI

### 8.2 Adjust This Filter

Original request:

- active contributors/reviewers

Issue:

- "active reviewers" is not a cheap or stable direct field for a daily broad scan

Recommended proxy metrics:

- `pushed_at` recency
- contributor count
- release recency
- recent issue / PR activity if available

This gives a practical "active community" signal without turning the daily job into a heavy per-repo deep audit.

### 8.3 Trending Velocity

Use:

- 24h momentum when enough candidates exist
- 7d momentum fallback when the 24h window is sparse or unstable

## 9. Ranking Model

Do not rank only by total stars.

Recommended weighted score:

- 35% star momentum
- 25% domain relevance
- 20% maintenance activity
- 10% forks/community scale
- 10% wiki novelty

`wiki novelty` means:

- prefer repos not yet represented in the wiki
- if already present, include only when the repo shows materially new momentum, relevance, or changed status

## 10. Daily Operating Mode

Daily job should be `report-first only`.

That means:

- no automatic wiki ingest
- no automatic compile apply
- no automatic semantic rewrite of existing wiki pages

Daily job should produce:

- top 5 ranked repos
- supporting metrics for each
- excluded notable repos with reasons
- `already in wiki / not in wiki` marker
- recommended next action for Nero

Example next actions:

- ingest now
- monitor for another 7 days
- ignore because already saturated in wiki
- ignore because weak domain relevance

## 11. Proposed File Outputs

### 11.1 Discovery Report

Suggested path:

```text
/workspace/sdtk-wiki/ai-agent-second-brain-main/wiki/maintenance/github-trending-report-YYYY-MM-DD.md
```

Contents:

- scan timestamp
- source availability summary
- query set used
- hard filter summary
- top 5 table
- notable rejects
- already-known wiki entities
- ingestion recommendations

### 11.2 Machine Report

Suggested path:

```text
/workspace/sdtk-wiki/ai-agent-second-brain-main/workspace/reports/github-trending-report-YYYY-MM-DD.json
```

Contents:

- raw candidate metadata
- normalized fields
- score breakdown
- exclusion reasons
- source health flags

### 11.3 Optional Raw Inbox Batch

Only if Nero later wants faster manual ingest preparation:

```text
/workspace/sdtk-wiki/ai-agent-second-brain-main/raw/inbox/YYYY-MM-DD-github-trending-batch.md
```

This file should still be treated as review material, not auto-ingested content.

## 12. Cron Strategy

Recommended cron target is not HerWiki directly.

Preferred cron target:

- a wrapper script or deterministic collector CLI

Daily sequence:

1. collect candidates from GitHub
2. enrich with topic/domain classification
3. add OSS Insight momentum only if available
4. apply hard filters
5. compute ranking
6. write markdown + JSON reports
7. optionally create a raw batch file when at least one candidate deserves review
8. send a Telegram summary through HerOrches or the assigned operator-facing profile

HerWiki should only run later when Nero explicitly approves ingestion.

## 13. Why This Is Better Than Letting HerWiki Auto-Fetch

### 13.1 Clear Responsibility Boundaries

- HerResearch / helper = external discovery
- HerWiki = internal knowledge maintenance

### 13.2 Better Debuggability

If data quality is bad, the failure surface is isolated to collection/scoring instead of polluting the wiki layer.

### 13.3 Better Safety

Report-first mode prevents silent wiki drift from low-quality trending noise.

### 13.4 Better Fit For Current `sdtk-wiki`

The current CLI semantics already lean toward:

- local-first
- safe mode
- review-first
- explicit apply

This plan stays aligned with that design.

## 14. Non-Goals For V1

- fully autonomous wiki mutation
- automatic page rewrite based on daily trends
- full GitHub deep audit of every candidate
- dependency on a fragile HTML scrape
- using HerWiki as a general browser crawler

## 15. Resolved Decisions For V1

### OQ-01 Topic seeds

Use this starting set:

- `ai-agents`
- `multi-agent`
- `rag`
- `knowledge-base`
- `second-brain`
- `llm-framework`

### OQ-02 Report channel

- write the daily report to local markdown and JSON artifacts
- also send a short Telegram summary through HerOrches or the assigned operator-facing profile

### OQ-03 Raw inbox batch policy

- create a raw batch file only when there is at least one candidate worth review that is not already saturated in the wiki

### OQ-04 Wiki novelty rule

- suppress repos already represented in the wiki unless they exceed a momentum delta threshold

### OQ-05 GitHub API auth mode

- V1 should support a GitHub token and prefer authenticated API access for cron reliability

### OQ-06 Cron time and timezone

- run at `06:00 JST`
- use JST as the operator-facing schedule timezone
- convert timestamps explicitly when computing report windows

### OQ-07 OSS Insight fallback policy

- continue the run in degraded mode using GitHub-only scoring
- mark the report with an explicit degraded-source warning
- do not fail the whole daily job only because OSS Insight is unavailable

### OQ-08 Domain relevance method

- use deterministic rule-based topic/keyword matching in V1
- do not use LLM-based classification inside the daily cron loop

### OQ-09 Approval handoff into HerWiki

- approval remains manual
- after approval, Nero explicitly asks HerWiki to ingest the chosen repo or batch source
- no automatic ingest transition is allowed in V1

## 16. Recommended Next Step

This plan is now approved as the V1 design baseline.

Next step:

1. write an execution-ready implementation plan
2. implement the deterministic collector helper and report schema
3. add a cron wrapper that remains report-first only
4. keep HerWiki ingest as an explicit manual follow-up step
