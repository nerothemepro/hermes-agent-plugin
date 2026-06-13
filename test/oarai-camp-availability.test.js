'use strict';

const { describe, it, before } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const {
  checkAvailability,
  parseCalendar,
} = require('../src/oaraiCampAvailability');

// ── Fixture ──────────────────────────────────────────────────────────────────
const FIXTURE_PATH = path.join(__dirname, 'fixtures', 'oarai-camp-june-2026.html');

let fixtureHtml;
before(() => {
  fixtureHtml = fs.readFileSync(FIXTURE_PATH, 'utf-8');
});

// ── Tests ────────────────────────────────────────────────────────────────────
describe('parseCalendar — offline fixture', () => {
  it('should parse June 2026 calendar', () => {
    const entries = parseCalendar(fixtureHtml, 2026, 6);
    assert.ok(entries.length > 0, 'Should parse at least one entry');
    // We expect 30 days (June has 30 days)
    assert.ok(entries.length >= 27, 'Should parse most of June');
  });

  it('2026-06-27 should be ○ (available)', () => {
    const entries = parseCalendar(fixtureHtml, 2026, 6);
    const entry = entries.find((e) => e.date === '2026-06-27');
    assert.ok(entry, '2026-06-27 should exist');
    assert.equal(entry.raw, '○');
    assert.equal(entry.meaning, 'available');
  });

  it('2026-06-28 should be 休日 (closed_or_non_bookable)', () => {
    const entries = parseCalendar(fixtureHtml, 2026, 6);
    const entry = entries.find((e) => e.date === '2026-06-28');
    assert.ok(entry, '2026-06-28 should exist');
    assert.equal(entry.raw, '休日');
    assert.equal(entry.meaning, 'closed_or_non_bookable');
  });

  it('2026-06-13 should be △ (limited)', () => {
    const entries = parseCalendar(fixtureHtml, 2026, 6);
    const entry = entries.find((e) => e.date === '2026-06-13');
    assert.ok(entry, '2026-06-13 should exist');
    assert.equal(entry.raw, '△');
    assert.equal(entry.meaning, 'limited');
  });
});

describe('checkAvailability — offline fixture', () => {
  it('should return completed for 2026-06-27 / 2026-06-28', async () => {
    const result = await checkAvailability({
      checkin: '2026-06-27',
      checkout: '2026-06-28',
      site_type: 'free_site',
      html: fixtureHtml,
    });

    assert.equal(result.status, 'completed');
    assert.equal(result.site, 'oarai-camp');
    assert.equal(result.site_type, 'free_site');
    assert.equal(result.checkin, '2026-06-27');
    assert.equal(result.checkout, '2026-06-28');
    assert.equal(result.free_site_rule, 'フリーサイトをご希望の場合は設備項目（区画サイト等）を選択せずにご予約ください。');
    assert.ok(Array.isArray(result.availability));
    assert.equal(result.availability.length, 2);

    const ci = result.availability.find((a) => a.date === '2026-06-27');
    assert.ok(ci, 'checkin date should be in availability');
    assert.equal(ci.meaning, 'available');

    const co = result.availability.find((a) => a.date === '2026-06-28');
    assert.ok(co, 'checkout date should be in availability');
    assert.equal(co.meaning, 'closed_or_non_bookable');
  });

  it('should handle invalid date format', async () => {
    const result = await checkAvailability({
      checkin: 'not-a-date',
      checkout: '2026-06-28',
      html: fixtureHtml,
    });

    assert.equal(result.status, 'error');
    assert.ok(result.errors.length > 0);
  });

  it('should report unknown for missing dates', async () => {
    // July fixture doesn't exist in the HTML block we're testing,
    // so a July date should fall back to 'unknown'
    const result = await checkAvailability({
      checkin: '2027-01-15',
      checkout: '2027-01-16',
      html: fixtureHtml,
    });

    assert.equal(result.status, 'completed');
    for (const entry of result.availability) {
      assert.equal(entry.meaning, 'unknown');
    }
  });
});
