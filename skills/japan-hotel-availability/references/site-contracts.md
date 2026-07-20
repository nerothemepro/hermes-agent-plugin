# Site Contracts

## Common rules

- Use one browser tab per site and retain the final query URL.
- Navigate with bounded timeouts and wait for visible result text, URL changes, or a specific control. Never wait for `networkidle`.
- Extract no more than `max_results_per_site` visible results.
- Availability and prices are volatile. Add the access timestamp and direct URL.
- A successful page load without visible matching inventory is `no_results`, not `completed`.

## Booking.com

Start with this URL pattern:

```text
https://www.booking.com/searchresults.html?ss=<encoded-area>&checkin=<YYYY-MM-DD>&checkout=<YYYY-MM-DD>&group_adults=<N>&no_rooms=<N>&group_children=<N>
```

Confirm the rendered destination, dates, guests, rooms, and currency before extracting cards. Capture visible property name, room/type when present, displayed total or nightly price exactly as labeled, tax/fee wording, cancellation wording, availability message, and property URL.

If Booking redirects to a landing page or strips any required criterion after form submission, stop with `blocked` or `partial` and preserve both the pre-submit criteria snapshot and final URL. Do not report landing-page prices as matching availability.

Stop with `blocked` on CAPTCHA, sign-in-only inventory, access denial, bot challenge, or required-criteria loss.

## Airbnb Japan

Start with this URL pattern:

```text
https://www.airbnb.jp/s/<encoded-area>/homes?refinement_paths%5B%5D=%2Fhomes&date_picker_type=calendar&checkin=<YYYY-MM-DD>&checkout=<YYYY-MM-DD>&adults=<N>&children=<N>
```

Confirm the rendered place, dates, and guests before extracting listing cards. Record listing name, type, displayed stay price, fee visibility, rating only when visible, and listing URL. Airbnb may defer taxes/fees; mark them `unclear` instead of calculating.

Stop with `blocked` on CAPTCHA, sign-in requirement, access denial, or bot challenge. Do not use unofficial Airbnb APIs.

## Jalan.net

Invoke the deterministic CLI:

```text
node /workspace/jalan-room-search-tool/bin/jalan-room-search --input '<json>'
```

The tool owns Jalan selectors, date fields, guest categories, room allocation, result parsing, artifacts, and timeout behavior. Do not repeat the same search through MCP after a structured `blocked` or `error` response. Preserve `final_url`, `warnings`, `errors`, and `debug_artifacts` in operator evidence.

Children should be passed as `children_ages` for simple searches. Use explicit `child_categories` or `room_allocations` only when the user specifies meal/bedding policy or exact multi-room allocation.
