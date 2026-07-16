# HerResearch Japan Hotel Availability Verification - 2026-07-16

## Verdict

`DEPLOYED_WITH_ONE_SITE_BLOCKED`

The read-only workflow is installed for HerResearch. Airbnb Japan returned matching anonymous inventory, Jalan returned a valid structured `no_results` response, and Booking.com accepted the client-side criteria but stripped the selected dates after form submission. Booking must therefore report `blocked` or `partial`; its landing-page prices are not matching availability evidence.

## Fixed Smoke Criteria

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

## Site Matrix

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

1. Booking.com's anonymous flow is unstable in this environment. Keep it fail-closed until a future read-only smoke proves all required criteria survive submission.
2. The Jalan CLI's free-form `Tokyo` area resolution may broaden to the prefecture. Prefer a more specific area such as Shinjuku, Shibuya, or a known Jalan region name when precise matching is required.
3. Prices and inventory are volatile. A saved artifact proves only the observed state at its runtime timestamp, not future availability.
