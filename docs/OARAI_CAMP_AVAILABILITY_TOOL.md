# Oarai Camp Availability Tool

## Purpose

Deterministic CLI tool for HerResearch to check Oarai Camp (Ibaraki, Japan) availability status — **without** browser automation (Playwright MCP).

## Why This Exists

Previous approach used Playwright MCP to navigate and click the Oarai reservation site. This failed because:

1. Element references (`[ref=e67]`, `[ref=e400]`) are session-specific and stale across turns.
2. Click-based strategy is non-deterministic and fragile.
3. The availability data is already embedded in the HTML as text (○, △, ×, 休日).

**Solution:** Fetch HTML directly, parse the calendar table, extract status per date. No browser needed.

## Architecture

```
bin/oarai-camp-availability   ← CLI entry point
src/oaraiCampAvailability.js  ← fetch + parse logic
test/oarai-camp-availability.test.js  ← offline fixture tests
test/fixtures/                ← saved HTML snapshots
```

## Usage

### CLI

```bash
# Inline JSON input
node bin/oarai-camp-availability --input '{
  "checkin": "2026-06-27",
  "checkout": "2026-06-28",
  "site_type": "free_site",
  "timeout_seconds": 30
}'

# From file
node bin/oarai-camp-availability --input /path/to/input.json

# With artifact saving
node bin/oarai-camp-availability --input '{...}' --artifact-dir /tmp/oarai-artifacts
```

### Programmatic

```javascript
const { checkAvailability } = require('./src/oaraiCampAvailability');

const result = await checkAvailability({
  checkin: '2026-06-27',
  checkout: '2026-06-28',
  site_type: 'free_site',
  timeout_seconds: 30,
});
```

## Input Schema

| Field | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `checkin` | string | yes | — | Check-in date, `YYYY-MM-DD` |
| `checkout` | string | yes | — | Check-out date, `YYYY-MM-DD` |
| `site_type` | string | no | `free_site` | Site type (e.g. `free_site`) |
| `timeout_seconds` | number | no | `30` | HTTP timeout in seconds |

## Output Schema

```json
{
  "status": "completed|blocked|error",
  "site": "oarai-camp",
  "site_type": "free_site",
  "checkin": "YYYY-MM-DD",
  "checkout": "YYYY-MM-DD",
  "availability": [
    {
      "date": "YYYY-MM-DD",
      "raw": "○|△|×|休日|...",
      "meaning": "available|limited|unavailable|closed_or_non_bookable|unknown"
    }
  ],
  "free_site_rule": "フリーサイトをご希望の場合は設備項目（区画サイト等）を選択せずにご予約ください。",
  "final_url": "https://www.oarai-camp.jp/camp.php?large_category=1&mode=camp",
  "evidence_text": ["..."],
  "errors": [],
  "debug_artifacts": {
    "html": "path if saved"
  }
}
```

## Status Mapping

| Raw | Meaning | Description |
|-----|---------|-------------|
| ○ | `available` | Sites available |
| △ | `limited` | Limited availability |
| × | `unavailable` | No availability |
| 休日 | `closed_or_non_bookable` | Date is marked as a day off on the
  reservation calendar — not bookable / no availability displayed.
  **Do NOT interpret this as a Japanese national holiday.** |
| *(empty)* | `unknown` | No data for this date |

## Agent Usage Notes

When summarizing tool output, **only report what the JSON proves**:

- If checkout date is `closed_or_non_bookable`, **do not** conclude the stay is
  bookable. Say the booking needs **manual confirmation** on the Oarai site.
- `休日` on the reservation calendar means the camp's booking system does not
  display availability for that date. It does **not** imply a national holiday,
  and it does **not** guarantee the camp is open or closed.
- A checkin date of `available` (○) does not guarantee a full stay is bookable
  if the checkout date is `closed_or_non_bookable`.

## Strategy

1. **Fetch** the reservation page via `https` module (no browser).
2. **Parse** the `<div class="reservationCalendar">` table.
3. **Extract** each `<dl>` block: `<dt>N日</dt>` for day, `<dd>` for status.
4. **Map** symbols to meaning via `STATUS_MAP`.
5. **Return** structured JSON.

## Tests

```bash
# Run offline fixture tests
node --test test/oarai-camp-availability.test.js

# Run live smoke test (requires network)
node bin/oarai-camp-availability --input '{"checkin":"2026-06-27","checkout":"2026-06-28","site_type":"free_site","timeout_seconds":30}'
```

## Free Site Rule

From the Oarai camp site:

> フリーサイトをご希望の場合は設備項目（区画サイト等）を選択せずにご予約ください。

Translation: For free sites, make a reservation without selecting any facility items (designated sites, etc.).

## Limitations

- Only works for Oarai Camp Main site (`large_category=1`). Other sites would need separate URLs.
- Calendar data is only available for the current and next month.
- Requires network access for live checks; offline tests use saved fixtures.
- Does not handle authentication or actual booking — only reads availability status.
