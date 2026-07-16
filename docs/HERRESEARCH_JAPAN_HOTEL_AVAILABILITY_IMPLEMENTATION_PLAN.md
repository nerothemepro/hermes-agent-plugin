# HerResearch Japan Hotel Availability Implementation Plan

## Scope Summary

Add a read-only Japan accommodation search workflow to HerResearch for Booking.com, Airbnb Japan, and Jalan.net. Reuse the existing deterministic Jalan CLI and the existing Playwright MCP. Do not add an unofficial scraper, private API integration, booking flow, account mutation, or payment action.

## Deterministic Telegram Command Extension

The natural-language skill path remains useful for exploratory work, but it is not the production entry point for hotel availability. The supported operator entry point is the native Hermes plugin command `/japan-hotel-research`. The gateway passes raw command arguments directly to the plugin handler, so Gemma does not select tools, invent helper names, or promise asynchronous work.

The command parser accepts Vietnamese or English labels, requires each child age, validates ISO dates before browser startup, runs each site once with bounded timeouts, persists one JSON evidence artifact, and always returns an operator-friendly Vietnamese summary. It does not use a `quick_commands` alias or exec entry because those paths either re-enter the LLM loop or impose the core 30-second exec timeout.

## Execution Order

### 1. Lock the integration contract

- Add a contract test covering the required Playwright MCP tools, skill installation, Jalan CLI path, structured output fields, and fail-closed safety text.
- Expected evidence: the new test fails before implementation because the skill and expanded allowlist do not exist.
- Rollback: remove the new test if the approved requirement is withdrawn.

### 2. Add the `japan-hotel-availability` skill

- Add `skills/japan-hotel-availability/SKILL.md` and concise site guidance under `references/`.
- Route Jalan requests to `/workspace/jalan-room-search-tool/bin/jalan-room-search` first.
- Route Booking.com and Airbnb Japan to the existing Playwright MCP with bounded navigation and form interactions.
- Normalize output in Vietnamese with timestamps, criteria, per-site status, listing details, price/fee caveats, availability text, URLs, evidence, warnings, and errors.
- Rollback: remove the skill directory and restore the prior profile backup.

### 3. Expand the bounded Playwright surface

- Add only `browser_type`, `browser_fill_form`, `browser_select_option`, `browser_tabs`, and `browser_take_screenshot` to the HerResearch Playwright include list.
- Keep unsafe evaluation, arbitrary code, file upload, cookie/storage mutation, checkout, payment, reservation, and messaging unavailable.
- Rollback: restore the previous config or remove the five added include entries.

### 4. Install and document the workflow

- Install `hermes-plugin/japan_hotel_research` into the profile plugin registry and enable only `japan-hotel-research` under `plugins.enabled`.
- Register `/japan-hotel-research` as a native plugin command without a competing quick-command alias.
- Update the HerResearch installer to copy the new skill.
- Update profile/SOUL and the operations handbook with routing, safety, input/output, smoke, and rollback guidance.
- Verification: contract test, skill validation, shell syntax, YAML parsing, and scoped secret scan.

### 5. Deploy to the live HerResearch profile

- Capture a durable backup of config, profile, SOUL, and skills.
- Install only the new skill and bounded config changes; preserve all secret values and unrelated runtime settings.
- Restart only HerResearch and verify gateway/MCP health.
- Rollback: restore backup files and restart only HerResearch.

### 6. Run read-only smoke tests

- Criteria: Tokyo, 2026-08-15 to 2026-08-16, 2 adults, 1 room, maximum 3 results per site.
- Jalan: invoke the deterministic CLI directly and validate its structured JSON.
- Booking.com and Airbnb Japan: use Playwright MCP navigation/snapshot/form tools only.
- Accept `completed`, `no_results`, or a truthful `blocked` result with URL/evidence. CAPTCHA, login wall, or anti-automation response must stop that site lane.
- No booking, login, checkout, payment, account creation, or external message is allowed.

## Dependency Notes

- Jalan depends on the existing clean checkout at `/workspace/jalan-room-search-tool` and its installed Playwright Chromium runtime.
- Booking.com and Airbnb depend on `@playwright/mcp@0.0.78` and the persistent HerResearch browser profile.
- Live deployment depends on the HerResearch gateway restart wrappers and an available LM Studio endpoint.

## Path Coverage

- Happy path: site returns available listings and direct URLs.
- Missing input: skill asks for area, check-in, check-out, adults, and rooms; no browser action starts.
- Empty result: report `no_results` per site without fabricating alternatives.
- Failure path: report `blocked`/`error` with timestamp, final URL, and evidence; do not retry indefinitely or add stealth tooling.

## Architecture Review

- Data enters as a structured user request, is routed per site, and exits as a normalized Vietnamese report. No booking state is persisted.
- The deterministic Jalan tool owns fragile Jalan selectors; the HerResearch skill owns routing and normalization; Playwright MCP owns interactive browser access for Booking/Airbnb.
- Each site is bounded to one search attempt and a small result limit to control latency and context growth.
- Operator evidence is the CLI JSON or MCP snapshot/screenshot plus gateway logs. Customer-visible failures name the blocked site and reason.

## Assumptions

| # | Assumption | Verified | Risk if wrong |
|---|---|---|---|
| A1 | `/workspace/jalan-room-search-tool` is the clean source linked to the owner repository. | Yes | Low |
| A2 | Jalan CLI remains read-only and returns structured status values. | Yes | Low |
| A3 | Playwright MCP 0.0.78 exposes the five proposed form/tab/screenshot tools. | Yes | Low |
| A4 | Booking.com and Airbnb permit a basic anonymous search from the current environment. | Partially: Airbnb works; Booking strips dates after submit. | Medium |
| A5 | Tokyo test dates in August 2026 are accepted by all three sites. | Partially: Airbnb retains them; Jalan returns structured `no_results`; Booking loses them after submit. | Medium |

## Not In Scope

- Booking, checkout, payment, reservation confirmation, account creation, login automation, messaging hosts/properties, CAPTCHA bypass, stealth browsers, private APIs, unofficial scraper MCPs, paid partner APIs, and scheduled hotel searches.

## Verification Checklist

- [x] New contract test observed failing before implementation.
- [x] Contract test and existing relevant tests pass after implementation.
- [x] Jalan baseline and live smoke return structured JSON.
- [x] Skill passes `quick_validate.py`.
- [x] Installer passes `bash -n`; generated/live YAML parses.
- [x] Live MCP roster contains only approved additions and no unsafe browser tools.
- [x] HerResearch gateway is healthy after restart.
- [x] Per-site smoke reports preserve criteria, URLs/evidence, warnings, and errors; volatile access times remain in runtime artifacts.
- [x] Secret scan returns no literal credentials.
- [x] Rollback backup path is recorded in the verification report.
