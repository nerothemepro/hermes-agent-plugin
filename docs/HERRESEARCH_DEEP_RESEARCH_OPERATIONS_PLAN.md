# HerResearch Deep Research Operations Plan

> Execute these steps in order. Preserve backup and verification evidence before changing the next layer.

## Objective

Upgrade HerResearch into a source-backed research agent for local `google/gemma-4-26b-a4b-qat`, with a daily online-income/POD trend brief at 09:00 Asia/Tokyo. The first release uses Hermes-native web search, browser extraction, skills, and cron. It adds no custom application code or broad MCP roster.

## Scope

Included: multi-query research, source extraction/citations, local-model guardrails, one audited research skill, an editable daily brief, native cron delivery, benchmark and smoke tests.

Credential-gated and excluded initially: GSC/GA4 OAuth, DataForSEO, KeywordTool, authenticated Reddit, Ahrefs/X, public posting, automated legal clearance, and custom MCP code.

## Architecture Decision

Use the smallest sufficient tool surface:

1. Hermes native `web_search` for discovery.
2. Playwright MCP or Browser Use for opening primary pages.
3. A lightweight research-method skill for query expansion and synthesis.
4. Hermes native cron and Telegram delivery.
5. Add one provider at a time only when benchmark evidence identifies a retrieval gap.

This limits tool-schema pressure on Gemma. An open-source MCP wrapper is not assumed to make its backend data free.

## Research Quality Contract

For deep research or trend ranking, HerResearch must:

- search at least four distinct query families
- inspect full pages rather than treating snippets as evidence
- target at least 15 useful sources across 8 independent domains when available
- cite a URL and publication/access date for material claims
- separate verified fact, inference, and community anecdote
- name the metric and time window behind `top`, `trend`, or `growing`
- avoid invented confidence, revenue, volume, competition, or growth numbers
- label unavailable paid metrics `not measured`
- report source and access gaps explicitly

## Integration Gates

| Capability | Preferred integration | Credential boundary | Priority |
|---|---|---|---|
| General discovery | DDGS fallback; Tavily MCP search/extract required by benchmark result | `TAVILY_API_KEY` | P1 |
| Full-page extraction | Playwright MCP / Browser Use | Existing browser credential | P0 |
| Reddit signal | Official Reddit API or audited read-only MCP | Client ID/secret/user agent | P1 |
| Keyword demand | KeywordTool API/MCP | Paid API key | P1 |
| SERP saturation | DataForSEO API/MCP | Paid credential | P1 |
| Site performance | PageSpeed API/audited MCP | Optional key for quota | P1 |
| GSC/GA4 | Official APIs via audited MCP | Read-only OAuth/service account and property IDs | P2 |
| Trademark screening | Official USPTO data plus human review | No legal conclusion | P2 |
| Ahrefs/X | Defer until measured ROI justifies cost | Paid credentials | P3 |

## Security And Reliability

- Secrets stay in the live profile `.env` or a mode-600 secret file, never Git, prompts, cron definitions, or reports.
- Scheduled work is report-first and read-only: no posting, purchasing, email, account/site mutation, or wiki ingest.
- OAuth scopes must be read-only and limited to approved properties.
- Configure `agent.max_turns: 30`, hard-stop loop guardrails, one cron job at a time, and no automatic paid-API retries.
- Timezone is `Asia/Tokyo`.

## Deployment

1. Capture status and back up `config.yaml`, `SOUL.md`, and `PROFILE.md`.
2. Install and deep-audit the selected `deep-research` skill.
3. Apply the repository-backed profile contract and local-model settings.
4. Restart only HerResearch and verify LM Studio, gateway, MCP, and web tools.
5. Rerun the fixed benchmark and compare tool use, citations, diversity, and unsupported claims.
6. Create the 09:00 Asia/Tokyo cron with the attached skill.
7. Run one manual cron smoke and verify delivery/state.

## Rollback

Disable/delete the cron, restore the recorded profile backup, remove the community skill if implicated, restart only HerResearch, and recheck gateway/Telegram.

## Acceptance

- Benchmark opens source pages and contains working citations without unsupported quantitative claims.
- Playwright MCP remains connected.
- Cron is registered for 09:00 Asia/Tokyo and a manual smoke delivers successfully.
- Paid/OAuth integrations remain explicit blocked inputs, not simulated data.

## Validation Update - 2026-07-16

P0 deployment is operational, but actionable deep-research acceptance is not met. Playwright passed direct navigation/snapshot. Reddit anonymous reads are blocked by HTTP 403. A generic-skill cron produced unsupported claims; the concise evidence-gated skill correctly returned `insufficient_evidence`. See `HERRESEARCH_DEEP_RESEARCH_EVALUATION_20260716.md` for the test matrix and credential-gated next steps.
