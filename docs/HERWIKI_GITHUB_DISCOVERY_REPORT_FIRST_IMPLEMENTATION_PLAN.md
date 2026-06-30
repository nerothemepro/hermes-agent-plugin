# HerWiki GitHub Discovery Report-First Implementation Plan

Date: 2026-06-30

## 1. Scope Summary

Implement a deterministic, report-first GitHub discovery workflow for the HerWiki ecosystem.

V1 scope:

- collect GitHub candidate repositories using deterministic queries
- classify and score them using rule-based logic
- optionally blend OSS Insight momentum when available
- write markdown and JSON daily reports
- optionally write a raw inbox batch file only when at least one candidate deserves review
- expose a wrapper flow suitable for cron execution and operator-triggered manual runs
- keep HerWiki ingestion manual and explicit

V1 must not:

- auto-ingest wiki pages
- auto-apply wiki compile
- use LLM classification inside cron
- depend on browser automation
- fail the whole job when OSS Insight is unavailable

## 2. Minimum Viable Change

The minimum viable implementation is a deterministic helper surface inside `hermes-agent-plugin` that can be run as:

```text
/workspace/hermes-agent-plugin/bin/herwiki-github-discovery-report
```

This helper should:

- fetch candidates from GitHub Search API
- apply hard filters and deterministic scoring
- write one markdown report and one JSON report
- return compact JSON stdout for Hermes/operator use

A second wrapper can then orchestrate:

- environment loading
- optional schedule use
- Telegram summary dispatch

## 3. Existing Patterns To Reuse

Reuse current repo patterns instead of inventing a new stack.

Existing helper patterns already available:

- `bin/oarai-camp-availability`
- `src/oaraiCampAvailability.js`
- `bin/facebook-batch-capture-to-wiki-inbox`
- `test/*.test.js`
- documentation in `docs/*.md`

Design implication:

- use Node-based helper CLIs under `bin/`
- put core logic in `src/`
- add offline tests in `test/`
- document operator usage in `docs/`

## 4. Execution Tasks

### Task 1. Define report schema and file contracts

Purpose:

- freeze the output shape before implementing collection logic

Likely files:

- `docs/HERWIKI_GITHUB_DISCOVERY_REPORT_FIRST_IMPLEMENTATION_PLAN.md`
- `docs/HERWIKI_GITHUB_DISCOVERY_REPORT_FIRST_TOOL.md`
- possibly a JSON schema fixture under `test/fixtures/`

Deliverables:

- JSON report schema
- markdown report section contract
- raw inbox batch contract
- stdout contract for CLI users

Verification:

- schema examples render cleanly in docs
- every required field is mapped to a deterministic source or fallback path

Rollback/containment:

- keep schema additive and V1-local to this helper only

### Task 2. Implement deterministic GitHub candidate collector

Purpose:

- query GitHub Search API using authenticated token when present
- build candidate set from topic-seeded and keyword-seeded searches

Likely files:

- `src/herwikiGithubDiscoveryReport.js`
- `bin/herwiki-github-discovery-report`
- optional `src/lib/githubApi.js`

Core behavior:

- accept token from env if present
- degrade to anonymous mode if token absent
- support explicit topic seeds
- normalize repo payload fields into one internal structure
- record source health and rate-limit warnings

Verification:

- offline unit tests for normalization
- mocked API fixture tests for search result parsing
- manual smoke run with a bounded query in the current environment if credentials are available

Rollback/containment:

- isolate all network code behind one module
- if API call fails, return deterministic error/degraded status instead of partial silent success

### Task 3. Implement scoring, filters, novelty, and degraded-source policy

Purpose:

- enforce hard constraints and stable ranking

Likely files:

- `src/herwikiGithubDiscoveryReport.js`
- test fixtures for candidate scoring cases

Core behavior:

- hard filter `stars >= 20000`
- hard filter `forks > 2000`
- deterministic domain relevance matcher
- activity proxy metrics using available metadata
- novelty check against current wiki evidence
- 24h momentum first, 7d fallback if sparse
- OSS Insight optional blend
- degraded mode if OSS Insight missing

Verification:

- unit tests for pass/fail filters
- unit tests for novelty suppression
- unit tests for degraded mode
- stable score ordering for known fixtures

Rollback/containment:

- keep weights/constants in one place
- expose score breakdown for debugging

### Task 4. Generate markdown report, JSON report, and optional raw batch file

Purpose:

- make output usable both by operators and later HerWiki ingestion

Likely files:

- `src/herwikiGithubDiscoveryReport.js`
- `docs/HERWIKI_GITHUB_DISCOVERY_REPORT_FIRST_TOOL.md`
- `test/fixtures/`

Core behavior:

- write markdown report under wiki maintenance path
- write machine JSON report under workspace reports path
- write raw inbox batch only when at least one candidate is worth review and not already saturated in wiki
- include explicit degraded warnings in report headers

Verification:

- tests for output paths
- tests for no-op day behavior
- tests for raw batch suppression when nothing qualifies

Rollback/containment:

- create-only writes for report artifacts
- no mutation of existing wiki pages

### Task 5. Add cron wrapper and operator-facing execution path

Purpose:

- make the workflow schedulable without mixing scheduling logic into collection code

Likely files:

- `scripts/herwiki_github_discovery_report.sh`
- optional profile-facing wrapper doc in `docs/`

Core behavior:

- load env safely
- set timezone behavior for `06:00 JST`
- call helper CLI
- optionally prepare a compact Telegram summary payload for HerOrches
- never auto-trigger ingest

Verification:

- shell smoke test with `--dry-run` or bounded mode
- verify exit codes for success, degraded, and hard failure

Rollback/containment:

- keep wrapper thin
- keep core business logic out of shell

### Task 6. Integrate with HerResearch / HerOrches / HerWiki operating docs

Purpose:

- make the new workflow usable by humans and profiles without relying on chat memory

Likely files:

- `docs/HERRESEARCH_PROFILE.md`
- `docs/HERWIKI_SOUL.md`
- `docs/HERORCHES_SYSTEM_HANDOFF.md`
- `docs/HERMES_PROJECT_DOCS_INDEX.md`
- `docs/HERWIKI_GITHUB_DISCOVERY_REPORT_FIRST_TOOL.md`

Core behavior:

- document who runs collection
- document report-first boundary
- document manual approval to ingest
- document token/env requirements

Verification:

- docs are internally consistent
- no doc says auto-ingest happens in V1

Rollback/containment:

- keep doc changes bounded to workflow surfaces touched by this feature

## 5. Critical Flow Review

### Happy Path

- authenticated GitHub API works
- topic and keyword searches return candidates
- at least one candidate passes filters
- OSS Insight is available or optional
- markdown and JSON reports are written
- raw inbox batch is written only if warranted
- Telegram summary can be sent
- Nero reviews and later manually asks HerWiki to ingest

### Nil / Missing-Input Path

- GitHub token absent
- workflow falls back to anonymous mode
- report still runs, with warning about lower rate headroom

### Empty / No-Op Path

- no candidate passes the filters
- report still writes a valid summary with zero selected repos
- no raw inbox batch is created
- status should be `completed` or `completed_with_no_candidates`, not treated as a crash

### Error / Failure Path

- GitHub API hard failure
- invalid JSON response
- rate limit exhausted
- wiki root path missing
- output write fails
- OSS Insight unavailable

Expected V1 behavior:

- OSS Insight failure -> degraded but continue
- GitHub hard failure -> fail the run with explicit error
- output path failure -> fail with explicit write error
- missing wiki path -> fail fast with configuration error

## 6. Data Flow Boundaries

1. External data enters through GitHub Search API and optional OSS Insight signal.
2. Raw candidate records are normalized into one internal repo object shape.
3. Filter and scoring logic produces ranked candidates plus exclusion reasons.
4. Report renderer writes markdown and JSON artifacts.
5. Optional raw inbox batch is written as review material only.
6. HerWiki ingestion remains an explicit separate step.

Ownership boundary:

- collection/scoring/reporting belongs to the new helper
- wiki mutation belongs to HerWiki and `sdtk-wiki`

## 7. Dependency Notes

- GitHub API access is a hard dependency for meaningful discovery
- OSS Insight is optional
- current wiki content is required for novelty checking
- Telegram delivery is optional and should not block local report generation

## 8. Observable State Notes

### Customer sees:

- not applicable; this is an internal operator workflow

### Operator sees:

- markdown daily report
- JSON machine report
- optional Telegram summary
- explicit degraded-source warnings when OSS Insight is absent

### Database:

- none

### Logs:

- CLI stdout JSON result
- shell wrapper exit code
- optional log file if wrapper chooses to persist runs later

## 9. Performance and Risk Notes

- avoid per-repo deep API fanout in the first pass; keep collection bounded
- contributor/reviewer activity must use cheap proxies in V1
- novelty lookup should read local wiki evidence efficiently, not scan the full repo repeatedly without caching
- rate-limit handling must be visible in the report
- topic expansion must be bounded to avoid result explosion

## 10. Assumptions

| # | Assumption | Verified | Risk if wrong |
|---|---|---|---|
| A1 | GitHub Search API is reachable from the runtime that will execute the collector. | No | High |
| A2 | A GitHub token can be provided for cron reliability. | No | Medium |
| A3 | Current wiki content contains enough stable signals to support a basic novelty check. | Partly | Medium |
| A4 | OSS Insight can be treated as optional without harming operator value. | Yes | Low |
| A5 | Existing helper CLI pattern in `hermes-agent-plugin` is the preferred implementation surface. | Yes | Low |
| A6 | Manual approval before HerWiki ingest remains acceptable for operator workflow. | Yes | Low |

## 11. Not In Scope

- full autonomous wiki curation
- automatic ingestion after daily scan
- browser-based crawling for this workflow
- LLM ranking/classification inside cron
- persistent run database
- cross-profile automatic task spawning from HerOrches in V1

## 12. Open Questions Remaining

Only implementation-level questions remain:

- exact CLI name and argument schema
- exact markdown report filename convention
- whether Telegram summary is emitted by the shell wrapper or by a separate HerOrches call
- whether novelty check reads wiki pages directly or a smaller derived index

These do not block V1 implementation.

## 13. Verification Checklist

Before claiming implementation complete, verify all of the following:

1. CLI `--help` renders and documents input/output correctly.
2. Unit tests cover:
   - filter pass/fail
   - novelty suppression
   - degraded OSS mode
   - empty candidate day
   - markdown/JSON report writing
   - raw batch creation suppression
3. A smoke run without OSS Insight still produces a degraded but valid report.
4. A smoke run with zero passing repos produces a no-op report and no raw batch.
5. No wiki page under `wiki/` is modified by the collector workflow.
6. Wrapper exit codes clearly distinguish success, degraded success, and hard failure.
7. Documentation states manual ingest remains required.
