---
name: evidence-gated-trend-research
description: Use for scheduled or manual niche, POD, MMO, trend, demand, competition, and opportunity research that requires current sources, explicit freshness windows, and fail-closed evidence quality.
---

# Evidence-Gated Trend Research

## Procedure

1. State the current date and define a 24-hour evidence window. Widen to seven days only when needed and label the widened window.
2. Make exactly one read-only Reddit probe. On any 401/403/server failure, record the blocker and do not call another Reddit tool in this run.
3. Use `mcp_tavily_tavily_search` for four query families: community pain, buying intent, current news, and competing products/listings.
4. Select candidate URLs from search results, then call `mcp_tavily_tavily_extract` before treating any page as evidence. Search snippets cannot support final claims.
5. Build a source ledger in the final response. Every source row must contain a literal clickable URL, title, publisher, publication/access date, observed claim, and evidence type.
6. Recalculate URL and independent-domain counts only from URLs visibly listed in the final response. Never name or count a source that is not listed with its URL.
7. Keep only opportunities supported by two independent extracted URLs, including at least one source dated inside the declared window.
8. Rank only surviving opportunities. Return fewer than ten rather than weakening the gate.

## Evidence Gate

- Target 15 useful sources across 8 independent domains for a deep-grade report.
- Minimum deliverable: 8 useful sources across 5 domains and at least 3 qualifying opportunities.
- If minimum is not met, set `status: insufficient_evidence`; do not use `top`, `trending`, `high`, `low saturation`, or numerical confidence.
- Every numeric claim must appear in a cited full-page source. Otherwise remove the number.
- Mark claims `verified`, `inference`, or `community anecdote`.
- Paid metrics not queried are `not measured`; never estimate them.
- Trademark screening is a risk flag, never legal clearance.

## Output

Language contract:

- Write the complete final report in Vietnamese, including every heading, summary, analysis, risk, action, blocker, and data-gap section.
- Apply Vietnamese output even when the request and evidence sources are in another language.
- Keep URLs, proper names, source titles, short quotations, and machine-readable status values in their original form when necessary, and explain them in Vietnamese.
- Do not emit an English narrative.

1. `status`, report date, evidence window, source/domain counts, and unavailable sources.
2. Up to 10 opportunities. Each includes signal, audience, monetization angle, two clickable evidence URLs with dates, competition observation, risk, and one read-only validation action.
3. At most three `Act today` items, all read-only. Do not recommend posting, ad spend, purchases, account creation, or site changes.
4. Data gaps and contradictions.

## Boundaries

Do not use arbitrary code execution. Do not post, message, purchase, create accounts, alter websites/accounts, invoke paid APIs without approval, or ingest the wiki. Never replace missing evidence with model knowledge.
