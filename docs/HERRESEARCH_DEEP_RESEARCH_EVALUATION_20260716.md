# HerResearch Deep Research Evaluation - 2026-07-16

## Verdict

`OPERATIONALLY_READY_BUT_RESEARCH_QUALITY_GATED`

The profile, browser, MCP registry, skill loading, Telegram delivery, and 09:00 Asia/Tokyo cron are operational. Current output is not yet reliable enough for autonomous actionable `top 10` recommendations. Until Reddit app credentials and a higher-quality search/extract provider are configured, the cron must fail closed with `status: insufficient_evidence`.

## Environment

- Model: `google/gemma-4-26b-a4b-qat` through LM Studio.
- Hermes profile: `/opt/data/hermes-profiles/herresearch`.
- Cron job: `75a5ab5ba399`, `0 9 * * *`, timezone `Asia/Tokyo`, Telegram delivery.
- Skills: general `deep-research`; cron-specific `evidence-gated-trend-research`.
- MCP roster exposed to the model: 5 read-only Reddit tools and 6 bounded Playwright tools.
- Native discovery: DDGS `web_search`; native browser remains available.

## Changes Applied

1. Increased the local-model tool budget to 30 turns and enabled tool-use/task-completion guidance plus hard loop stops.
2. Installed and audited the open-source `deep-research` skill.
3. Added the concise `evidence-gated-trend-research` skill for scheduled runs.
4. Configured Reddit MCP `reddit-mcp-server@1.5.1` in anonymous, strict, read-only mode with a five-tool allowlist.
5. Reduced Playwright MCP to six read/navigation tools and disabled progressive `tool_search` for this profile.
6. Installed the Chromium version required by the current Playwright MCP package.
7. Added a native Hermes cron at 09:00 Asia/Tokyo with report-first Telegram delivery.

## Test Evidence

| Test | Result | Evidence |
|---|---|---|
| Baseline one-shot | FAIL | One API call, no tools, no citations. |
| Strict baseline | FAIL | Search snippets only; no full-page evidence. |
| Initial deep-research benchmark | PARTIAL | Multiple searches and one page open, but weak diversity and unsupported claims. |
| Playwright direct smoke | PASS | Navigated to `https://example.com` and returned a real accessibility snapshot. |
| Effective MCP allowlist | PASS | Exactly 11 MCP tools: 5 Reddit read tools plus 6 Playwright read/navigation tools. |
| Reddit anonymous smoke | BLOCKED | Reddit returned HTTP 403 from this environment. No write tools or account credentials were exposed. |
| Generic-skill cron smoke | FAIL QUALITY | 17 tool calls, but only two full-page extracts; output included unsupported numbers, stale evidence windows, and non-read-only next actions. |
| Evidence-gated cron smoke | PASS FAIL-CLOSED | Returned `status: insufficient_evidence`, ranked no opportunities, named Reddit and paid-metric gaps, and delivered successfully. |

Canonical smoke outputs:

- `/opt/data/hermes-profiles/herresearch/cron/output/75a5ab5ba399/2026-07-16_10-23-36.md`
- `/opt/data/hermes-profiles/herresearch/cron/output/75a5ab5ba399/2026-07-16_10-29-13.md`
- `/tmp/herresearch-cron-smoke-v2.jsonl`
- `/tmp/herresearch-cron-smoke-v3.jsonl`

## Root Causes

1. DDGS frequently ranks affiliate listicles for broad commercial queries; snippets are insufficient evidence.
2. Reddit anonymous endpoints return HTTP 403 from the current runtime/IP, so app-only OAuth credentials are required.
3. The general deep-research skill is too broad and verbose for a constrained local Gemma workflow.
4. The model can still misclassify snippets as verified evidence. Prompt/skill controls reduce harm but cannot deterministically validate citations.
5. `hermes -z` has an MCP discovery race: it starts discovery in the background but snapshots tools before waiting. Gateway and cron use the correct dedicated MCP startup path; one-shot is not a valid MCP acceptance path on this build.

## Recommended Integration Order

### P1 - Required for useful daily trend reports

1. Reddit app-only read access: set `REDDIT_CLIENT_ID`, `REDDIT_CLIENT_SECRET`, and a unique `REDDIT_USER_AGENT` in the live profile `.env`; then pass them with `${...}` placeholders in the MCP server env. Do not set Reddit username/password.
2. Tavily MCP with a narrow `search` + `extract` allowlist. It provides search and clean extraction; start on its free credits and set a hard daily budget. Official docs: <https://docs.tavily.com/documentation/mcp>.
3. Rerun the fixed benchmark. Require at least eight full-page sources across five domains, working URLs, correct dates, and zero unsupported numbers.

### P2 - Site evaluation

1. PageSpeed Insights can run without an API key for low-volume tests; use a key for scheduled automation. Official docs: <https://developers.google.com/speed/docs/insights/v5/get-started>.
2. GA4: use Google's experimental official MCP with `analytics.readonly` credentials: <https://github.com/googleanalytics/google-analytics-mcp>.
3. GSC: use a reviewed community binary after service-account setup and property access: <https://github.com/ncosentino/google-search-console-mcp>. Google requires OAuth authorization for private Search Console data: <https://developers.google.com/webmaster-tools/v1/how-tos/authorizing>.

### P3 - Paid demand and saturation

1. Add KeywordTool only after confirming API access and cost limits.
2. Add DataForSEO with only the exact keyword/SERP tools needed; do not expose its full tool catalog to Gemma. DataForSEO supports location-specific SERP tasks and paid Standard/Live methods: <https://docs.dataforseo.com/v3/serp/overview/>.
3. Defer Ahrefs and X until a measured use case justifies their recurring cost.

## Remaining Inputs

- Reddit client ID, client secret, and user-agent label.
- Tavily API key.
- Site URL plus GSC property identifier and GA4 property ID.
- Read-only Google credential file stored outside Git.
- Optional PageSpeed API key.
- DataForSEO/KeywordTool credentials and per-run spending ceiling.

## Product Boundary

No-code configuration is sufficient for tool connectivity and scheduling, but not for deterministic report quality. If the report still violates evidence rules after Reddit + Tavily are active, the next justified code is a small pre-delivery validator that rejects missing URLs, stale dates, unsupported numeric claims, and insufficient domain diversity. It should reject delivery, not rewrite the report with another LLM.

## Rollback

Restore `/opt/data/hermes/control-plane/backups/herresearch-deep-research-20260716T005054Z/config.before-mcp-allowlist.yaml`, restore the profile documents from the same backup, remove or pause cron job `75a5ab5ba399`, and restart only HerResearch.

## Final Verification

- LM Studio listed `google/gemma-4-26b-a4b-qat`.
- HerResearch gateway PID after final restart: `80264`.
- Playwright MCP pinned to `0.0.78`; fresh navigate/snapshot smoke passed.
- Effective MCP roster contained exactly 11 allowlisted read-only/navigation tools.
- Cron last status and Telegram delivery status: `ok`; next run is 2026-07-17 09:00 Asia/Tokyo.
- Skill Creator `quick_validate.py`: PASS. Hermes `skills audit <name>` is hub-install-only and therefore not applicable to this profile-local skill.
- No zombie process was present after the final test.
- Reproducible installer validation: both anonymous and authenticated generated configs parsed as valid YAML; authenticated config contained `${REDDIT_*}` placeholders only, with no dummy secret literal.
