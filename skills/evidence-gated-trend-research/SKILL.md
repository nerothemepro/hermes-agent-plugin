---
name: evidence-gated-trend-research
description: Use for scheduled or manual niche, POD, MMO, trend, demand, competition, and opportunity research that requires current sources, explicit freshness windows, and fail-closed evidence quality.
---

# Evidence-Gated Trend Research

## Procedure

1. State the current date and define a 24-hour evidence window. Widen to seven days only when needed and label the widened window.
2. Call direct read-only community tools first. For Reddit, try distinct relevant subreddits; after one repeated 401/403 or server failure, record the blocker and stop calling Reddit.
3. Run at least four query families: community pain, buying intent, current news, and competing products/listings.
4. Open full pages for candidate evidence. Search snippets may select sources but cannot support final claims.
5. Build an internal source ledger with URL, title, publisher, publication/access date, observed claim, and evidence type.
6. Keep only opportunities supported by two independent URLs, including at least one source dated inside the declared window.
7. Rank only surviving opportunities. Return fewer than ten rather than weakening the gate.

## Evidence Gate

- Target 15 useful sources across 8 independent domains for a deep-grade report.
- Minimum deliverable: 8 useful sources across 5 domains and at least 3 qualifying opportunities.
- If minimum is not met, set `status: insufficient_evidence`; do not use `top`, `trending`, `high`, `low saturation`, or numerical confidence.
- Every numeric claim must appear in a cited full-page source. Otherwise remove the number.
- Mark claims `verified`, `inference`, or `community anecdote`.
- Paid metrics not queried are `not measured`; never estimate them.
- Trademark screening is a risk flag, never legal clearance.

## Output

1. `status`, report date, evidence window, source/domain counts, and unavailable sources.
2. Up to 10 opportunities. Each includes signal, audience, monetization angle, two clickable evidence URLs with dates, competition observation, risk, and one read-only validation action.
3. At most three `Act today` items, all read-only. Do not recommend posting, ad spend, purchases, account creation, or site changes.
4. Data gaps and contradictions.

## Boundaries

Do not use arbitrary code execution. Do not post, message, purchase, create accounts, alter websites/accounts, invoke paid APIs without approval, or ingest the wiki. Never replace missing evidence with model knowledge.
