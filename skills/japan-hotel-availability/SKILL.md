---
name: japan-hotel-availability
description: Search read-only room availability on Booking.com, Airbnb Japan, and Jalan.net from area, check-in/check-out dates, guest counts, rooms, and a bounded result limit. Use for Japan hotel, ryokan, apartment, or vacation-rental availability comparisons; never book, log in, message, pay, or bypass access controls.
---

# Japan Hotel Availability

## Required input

Before using any tool, require:

- `area`
- `checkin` and `checkout` in `YYYY-MM-DD`
- `adults`
- `rooms`

Optional: `children_ages`, `sites`, `budget_jpy_max`, and `max_results_per_site` (default 5, maximum 10).

Reject invalid dates, `checkout <= checkin`, non-positive guest/room counts, and past check-in dates. Ask one concise clarification when required input is missing. Do not browse first.

## Routing

### Jalan.net

Always prefer the deterministic CLI over MCP form manipulation:

```text
node /workspace/jalan-room-search-tool/bin/jalan-room-search --input '<structured-json>'
```

Pass `area`, dates, adults, children ages, rooms, budget when present, `max_results`, `headless:true`, and `timeout_seconds:60`. Parse stdout as JSON. Accept only `completed`, `no_results`, `blocked`, or `error`; never infer availability outside the returned JSON.

### Booking.com and Airbnb Japan

Use the Playwright MCP. Prefer a direct search URL containing the validated criteria, then call `browser_snapshot`. Use `browser_tabs`, `browser_fill_form`, `browser_type`, `browser_select_option`, `browser_click`, and bounded `browser_wait_for` only when the direct URL does not apply the criteria. Use `browser_take_screenshot` for evidence when a page is blocked or the result state is ambiguous.

Do not use `networkidle`. Do not inspect or replay private APIs from network traffic. Do not use arbitrary browser evaluation or unsafe code.

Read [references/site-contracts.md](references/site-contracts.md) for direct URL patterns, extraction fields, and site-specific stop rules.

## Safety boundary

This workflow is search-only and **không đặt phòng**.

- Never log in, create an account, accept a booking, reserve, checkout, pay, message a host/property, upload a file, or change cookies/storage.
- Stop on CAPTCHA, login wall, bot challenge, access denial, or consent flow that requires account state.
- Do not add stealth/anti-detection tooling, unofficial scraper MCPs, or undocumented/private APIs.
- Do not retry a blocked site more than once in the same request.
- A future booking action requires a separate workflow and explicit human approval; this skill must never perform it.

## Output

Write the report in Vietnamese. Include:

```yaml
status: completed | partial | no_results | blocked | error
checked_at: ISO-8601 timestamp with timezone
criteria:
  area: string
  checkin: YYYY-MM-DD
  checkout: YYYY-MM-DD
  adults: integer
  children_ages: []
  rooms: integer
  max_results_per_site: integer
sites:
  - site: booking | airbnb | jalan
    status: completed | no_results | blocked | error
    query_url: string
    results:
      - property_name: string
        room_or_listing_type: string | null
        total_stay_price: string | null
        taxes_and_fees: included | excluded | unclear
        cancellation: string | null
        availability_text: string
        direct_url: string
    evidence: []
    warnings: []
    errors: []
warnings: []
errors: []
```

Price comparison is allowed only when the displayed currency, stay total versus nightly price, taxes/fees, and guest/room criteria are explicit. Otherwise label the field `unclear`; never normalize or calculate from missing data.
