# HerResearch Japan Hotel Availability Verification - 2026-07-16

## Verdict

`DEPLOYED_ALL_SITES_COMPLETED`

The latest deployed native command completed all three read-only provider lanes for the fixed Tateyama family criteria. The initial blocked/no-results evidence is retained below as historical evidence and is superseded by the regression verification section.

## Initial Fixed Smoke Criteria (Historical)

- Area: Tokyo, Japan
- Check-in: 2026-08-15
- Check-out: 2026-08-16
- Adults: 2
- Children: 0
- Rooms: 1
- Maximum results inspected: 3 per site

## Deployment Evidence

- HerResearch gateway restarted successfully and remained connected.
- Playwright MCP version: `@playwright/mcp@0.0.78`.
- Playwright server exposed 24 capabilities; HerResearch model allowlist includes the 11 approved browser tools only.
- Newly approved tools: `browser_type`, `browser_fill_form`, `browser_select_option`, `browser_tabs`, `browser_take_screenshot`.
- Explicitly absent from the model allowlist: `browser_run_code_unsafe`, `browser_evaluate`, `browser_file_upload`.
- Existing `.env` SHA-256 was unchanged across deployment.
- Rollback script: `/opt/data/hermes/control-plane/backups/herresearch-hotel-availability-20260716T042808309728495Z/rollback.sh`.

## Initial Site Matrix (Historical)

| Site | Result | Evidence | Interpretation |
|---|---|---|---|
| Jalan.net | `no_results` | `/tmp/herresearch-hotel-jalan-smoke.json`; SHA-256 `7ba07ee49f52739ab013d041c83da304a02de619bf3e2cecd545d4950feba342` | CLI completed without crash. Area fallback searched Tokyo prefecture because the generic `Tokyo` area label was not matched. No availability was fabricated. |
| Airbnb Japan | `completed` | `/tmp/herresearch-hotel-airbnb-mcp.json`; SHA-256 `38d39f432c0d76adfb2ccffb18fbdf5d6ef28c9b0649ea6d53ae10a90b496ef3` | Final URL retained destination, dates, adults, and children. Visible inventory included stay prices and direct listing URLs. |
| Booking.com | `blocked` / `partial` | `/tmp/herresearch-hotel-booking-final-mcp.json`; SHA-256 `78d72d64c76ef4a0bccd8611fdcb9322e4e61710dffefd705eb51c8065cfa3e4` | The form showed Tokyo and selected 2026-08-15 through 2026-08-16 before submit. Booking redirected to `/city/jp/tokyo.html` and reset the date control. Landing-page prices are rejected as availability evidence. |

## Airbnb Visible Sample

The smoke inspected only the first three visible results. Examples included listings in Suginami, Koto, and Toshima with a one-night displayed price and direct `/rooms/...` URLs. These values are volatile and must always be reported with the live access timestamp and the fee wording shown by Airbnb.

## Safety And Quality Checks

- No login, account creation, host/property message, reservation, checkout, payment, or file upload occurred.
- No CAPTCHA bypass, stealth browser, arbitrary evaluation, private API replay, or unsafe MCP tool was used.
- Browser interaction was bounded to destination/date form controls, result snapshots, and one screenshot for ambiguous Booking state.
- The workflow requires a truthful per-site status and forbids inferring availability when criteria are missing.
- Source contract tests, full plugin tests, skill validation, shell syntax, YAML parsing, and secret scans are required again immediately before commit.

## Residual Risks

1. Booking.com requires standard headed Chromium under Xvfb on this box. The installer fails closed if `xvfb-run` is unavailable, and the lane still rejects results whenever any criterion is lost.
2. Jalan DOM classes and plan-link shapes can change. The current-card fixture and exact live smoke must be rerun after parser changes.
3. Prices and inventory are volatile. A saved artifact proves only the observed state at its runtime timestamp, not future availability.

## Command Workflow Verification

### Root Cause And Fix

The failed Telegram prompt was caused by LLM-dependent tool routing: the local Gemma model invented an unavailable `oarai_camp_availability_tool`, then returned a promise instead of executing evidence-producing tools. The fix is a native Hermes plugin command, `/japan-hotel-research`, whose handler validates the operator payload and invokes the bounded Jalan and Playwright lanes directly. The command does not enter the LLM conversation loop.

### Initial Live Command Smoke (Superseded)

Input:

```text
/japan-hotel-research kiểm tra phòng trống theo thông tin sau:
Khu vực: Tateyama,Chiba,Nhật Bản
Checkin: 2026-08-15
Checkout: 2026-08-16
Người lớn: 2
Trẻ em: 2 tuổi + 9 tuổi
Số phòng: 1
```

Observed result:

- Overall status: `partial`.
- Jalan.net: `no_results`; Tateyama resolved to Jalan area `館山` under Chiba region `LRG_122600`.
- Airbnb Japan: `completed`; three anonymous Tateyama listings were returned with direct listing URLs.
- Booking.com: `blocked`; the site reset or failed to retain the full date and child occupancy criteria after submission, so landing-page prices were rejected.
- Evidence JSON: `/opt/data/hermes-profiles/herresearch/reports/japan-hotel-research/20260716T055541196175Z/report.json`.
- Live command output: `/tmp/herresearch-japan-command-live-smoke.txt`.

### Deployment And Rollback

- Plugin path: `/opt/data/hermes-profiles/herresearch/plugins/japan-hotel-research`.
- Hermes command discovery: `japan-hotel-research`.
- HerResearch gateway restored, restarted, and reconnected with current PID `167508`.
- Existing HerResearch `.env` hash remained unchanged.
- Durable rollback script from the original deployment: `/opt/data/hermes/control-plane/backups/herresearch-hotel-availability-20260716T060152621395720Z/rollback.sh`.
- Telegram registered 60 visible commands and hid 66 because of the platform menu limit. The hyphenated command remains callable when typed manually and is listed by the full `/commands` output.

### Verification Results

- Native workflow parser/contract tests: `6/6` passed.
- Hermes Agent plugin test suite: `49/49` passed.
- Jalan Tateyama resolver test: `1/1` passed.
- Jalan live read-only smoke evidence: `/tmp/jalan-tateyama-20260716-smoke.json`; SHA-256 `b6abb113b68786390b3a8cbc5a7f23b4c25c9a547cd00ffff0c49967aacb0e9a`.
- Plugin manifest validation, Python bytecode compilation, shell syntax checks, and SDTK skill validation passed.
- No login, booking, payment, account mutation, or message action was performed.

## Regression Fix Verification - 2026-07-16

### Root Causes

1. Jalan returned a false `no_results`. The live `LRG_122600` page contained available plans, prices, and availability markers, but the legacy parser did not recognize the current `.js-searchResultItem` cards or `/uw/uwp3200/uww3201init.do` plan links.
2. Booking.com degraded anonymous Chromium headless searches to destination-only state. The same public URL under standard headed Chromium/Xvfb retained check-in, checkout, adults, both child ages, and room count and returned priced property cards.
3. The evidence path appeared blank at the end of a long Telegram response. It is now emitted before site details so Telegram chunking cannot separate the label from its value.
4. The initial headed wrapper left an Xvfb orphan when only the wrapper PID was terminated. MCP processes now start in a new session and close through process-group termination.

### Latest End-To-End Result

- Overall status: `completed`.
- Jalan.net: `completed`, 3 displayed results from 30 parsed properties.
- Airbnb Japan: `completed`, 3 displayed listings.
- Booking.com: `completed`, 3 priced properties with full criteria retained.
- Canonical evidence JSON: `/opt/data/hermes-profiles/herresearch/reports/japan-hotel-research/20260716T072117902220Z/report.json`; SHA-256 `0d6468c4f47c52f1812cf893b6904aea9f7d724deeecbf5bf51c5487009520a7`.
- Operator output artifact: `/tmp/japan-hotel-command-fixed-live2.txt`.
- Current HerResearch gateway PID after final source-parity deployment: `200267`.
- Durable rollback: `/opt/data/hermes/control-plane/backups/herresearch-hotel-availability-20260716T072642186624523Z/rollback.sh`.

Observed price samples at verification time:

| Site | Property | Displayed price / availability |
|---|---|---|
| Jalan.net | グランドメルキュール南房総リゾート＆スパ | `¥152,670`, あと1部屋 |
| Jalan.net | AIHAMA TERRACE | `¥110,000`, あと1部屋 |
| Booking.com | 青と夕日 | `¥35,200` |
| Booking.com | Tateyama Resort Hotel | `¥78,710` |

These values are volatile observations, not price guarantees.

### Regression Evidence

- Jalan current-card parser fixture: pass.
- Jalan exact live query: `completed`, 30 results before output limit.
- Booking headed-MCP exact lane: `completed`, 3 results and criteria URL retained.
- Native workflow tests: `10/10` passed.
- Hermes Agent plugin suite: `49/49` passed.
- Xvfb process count after full command: `0`.
- Zombie process count after full command: `0`.
- HerResearch `.env` hash unchanged.
- No login, booking, payment, account mutation, message action, CAPTCHA bypass, stealth browser, or private API was used.
