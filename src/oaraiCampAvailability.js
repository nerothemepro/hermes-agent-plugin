#!/usr/bin/env node
'use strict';

const https = require('https');
const http = require('http');
const fs = require('fs');
const path = require('path');

// ── Constants ────────────────────────────────────────────────────────────────
const BASE_URL =
  'https://www.oarai-camp.jp/camp.php?large_category=1&mode=camp';

const FREE_SITE_RULE =
  'フリーサイトをご希望の場合は設備項目（区画サイト等）を選択せずにご予約ください。';

const STATUS_MAP = {
  '○': 'available',
  '△': 'limited',
  '×': 'unavailable',
};

// ── HTTP fetch (no browser, no Playwright) ──────────────────────────────────
function fetchHTML(url, timeoutMs) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const mod = parsed.protocol === 'https:' ? https : http;
    const opts = {
      method: 'GET',
      hostname: parsed.hostname,
      port: parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
      path: parsed.pathname + parsed.search,
      headers: {
        'User-Agent':
          'Mozilla/5.0 (compatible; HerResearch/1.0)',
        'Accept': 'text/html,application/xhtml+xml',
        'Accept-Language': 'ja,en-US;q=0.9',
      },
    };
    const req = mod.request(opts, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const buf = Buffer.concat(chunks);
        resolve({
          statusCode: res.statusCode,
          headers: res.headers,
          body: buf.toString('utf-8'),
        });
      });
    });
    req.on('error', reject);
    req.setTimeout(timeoutMs, () => {
      req.destroy(new Error(`Request timed out after ${timeoutMs}ms`));
    });
    req.end();
  });
}

// ── HTML parser ──────────────────────────────────────────────────────────────
/**
 * Parse the reservationCalendar table from Oarai HTML.
 * Returns an array of { date: 'YYYY-MM-DD', raw: string, meaning: string }.
 *
 * Strategy: find all <dl> blocks inside .reservationCalendar,
 * extract the day number from <dt>, then read <dd> content for status.
 */
function parseCalendar(html, year, month) {
  // Locate the calendar block for the given month
  // Caption format: "2026年<span class=\"month\">6月</span>"
  const captionRegex = new RegExp(
    `<caption>${year}年[\\s]*<span[^>]*class=["'][^"']*month[^"']*["'][^>]*>[\\s]*${month}月[\\s]*</span>[\\s]*</caption>[\\s]*<table[^>]*>|` +
    `<caption>${year}年[\\s]*<span[^>]*class=["'][^"']*month[^"']*["'][^>]*>[\\s]*${month}月[\\s]*</span>[\\s]*</caption>`,
    'i',
  );

  // Simpler approach: find the caption for this month, then grab everything
  // until the next <caption> or end of reservationCalendar
  const monthCaptionPattern = new RegExp(
    `<caption>${year}年[\\s\\S]*?${month}月[\\s\\S]*?</caption>`,
    'i',
  );
  const captionMatch = html.match(monthCaptionPattern);
  if (!captionMatch) {
    return [];
  }

  // Find the start of this month's table block
  const captionIndex = captionMatch.index;
  // Find the next <caption> or the next </div> that closes reservationCalendar
  const nextCaption = html.indexOf('<caption>', captionIndex + captionMatch[0].length);
  const nextDivClose = html.indexOf('</div>', captionIndex);
  let endIndex = html.length;
  if (nextCaption > 0 && nextCaption < endIndex) endIndex = nextCaption;
  if (nextDivClose > 0 && nextDivClose < endIndex) endIndex = nextDivClose;

  const monthBlock = html.slice(captionIndex, endIndex);

  // Extract all <dl> entries with <dt>N日</dt> and <dd>...</dd>
  const entries = [];
  const dlRegex = /<dl[^>]*>([\s\S]*?)<\/dl>/gi;
  let dlMatch;

  while ((dlMatch = dlRegex.exec(monthBlock)) !== null) {
    const dlContent = dlMatch[1];

    // Extract day number from <dt>...</dt>
    // Format: "27日" or "[ハイ]<br>27日"
    const dtMatch = dlContent.match(/<dt[^>]*>([\s\S]*?)<\/dt>/i);
    if (!dtMatch) continue;

    const dayStr = dtMatch[1];
    const dayNumMatch = dayStr.match(/(\d+)日/);
    if (!dayNumMatch) continue;
    const day = parseInt(dayNumMatch[1], 10);

    // Extract status from <dd>...</dd>
    const ddMatch = dlContent.match(/<dd[^>]*>([\s\S]*?)<\/dd>/i);
    let raw = '';
    let meaning = 'unknown';

    if (ddMatch) {
      const ddContent = ddMatch[1].trim();

      // Check for 休日 span
      const holidayMatch = ddContent.match(/<span[^>]*>休日<\/span>/i);
      if (holidayMatch) {
        raw = '休日';
        meaning = 'closed_or_non_bookable';
      } else {
        // Check for ○ △ × in text content
        if (/\u25CB/.test(ddContent)) {
          raw = '○';
          meaning = 'available';
        } else if (/\u25B3/.test(ddContent)) {
          raw = '△';
          meaning = 'limited';
        } else if (/\u00D7/.test(ddContent)) {
          raw = '×';
          meaning = 'unavailable';
        } else if (ddContent.length === 0) {
          // Empty dd — no data shown for this date
          raw = '';
          meaning = 'unknown';
        } else {
          raw = ddContent;
          meaning = 'unknown';
        }
      }
    }

    const dateStr = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    entries.push({ date: dateStr, raw, meaning });
  }

  return entries;
}

// ── Public API ───────────────────────────────────────────────────────────────
/**
 * Check availability for Oarai Camp.
 *
 * @param {Object} opts
 * @param {string} opts.checkin - "YYYY-MM-DD"
 * @param {string} opts.checkout - "YYYY-MM-DD"
 * @param {string} [opts.site_type] - e.g. "free_site"
 * @param {number} [opts.timeout_seconds] - HTTP timeout
 * @param {string} [opts.html] - pre-loaded HTML (for offline testing)
 * @param {string} [opts.artifact_dir] - where to save HTML artifacts
 * @returns {Promise<Object>} result object matching output schema
 */
async function checkAvailability(opts) {
  const {
    checkin,
    checkout,
    site_type = 'free_site',
    timeout_seconds = 30,
    html: preloadedHtml,
    artifact_dir,
  } = opts;

  const result = {
    status: 'completed',
    site: 'oarai-camp',
    site_type,
    checkin,
    checkout,
    availability: [],
    free_site_rule: FREE_SITE_RULE,
    final_url: BASE_URL,
    evidence_text: [],
    errors: [],
    debug_artifacts: { html: null },
  };

  // Parse dates
  const [ciYear, ciMonth, ciDay] = checkin.split('-').map(Number);
  const [coYear, coMonth, coDay] = checkout.split('-').map(Number);

  if (
    isNaN(ciYear) || isNaN(ciMonth) || isNaN(ciDay) ||
    isNaN(coYear) || isNaN(coMonth) || isNaN(coDay)
  ) {
    result.status = 'error';
    result.errors.push('Invalid date format. Use YYYY-MM-DD.');
    return result;
  }

  let html = preloadedHtml;
  let fetched = false;

  // Fetch if no preloaded HTML
  if (!html) {
    try {
      const res = await fetchHTML(BASE_URL, timeout_seconds * 1000);
      if (res.statusCode !== 200) {
        result.status = 'blocked';
        result.errors.push(
          `HTTP ${res.statusCode} from ${BASE_URL}`,
        );
        return result;
      }
      html = res.body;
      fetched = true;
    } catch (err) {
      result.status = 'error';
      result.errors.push(`Fetch failed: ${err.message}`);
      return result;
    }
  }

  // Save artifact
  if (artifact_dir) {
    try {
      fs.mkdirSync(artifact_dir, { recursive: true });
      const ts = new Date().toISOString().replace(/[:.]/g, '-');
      const filePath = path.join(
        artifact_dir,
        `oarai_${ts}.html`,
      );
      fs.writeFileSync(filePath, html, 'utf-8');
      result.debug_artifacts.html = filePath;
    } catch {
      // Non-fatal
    }
  }

  // Collect evidence text (first 200 chars of calendar area)
  const calendarIdx = html.indexOf('reservationCalendar');
  if (calendarIdx >= 0) {
    const snippet = html.slice(calendarIdx, calendarIdx + 500);
    result.evidence_text.push(snippet.replace(/\s+/g, ' ').trim());
  }

  // Parse calendar for checkin month and checkout month
  const monthsToParse = new Set();
  monthsToParse.add(`${ciYear}-${ciMonth}`);
  monthsToParse.add(`${coYear}-${coMonth}`);

  const allEntries = [];
  for (const mk of monthsToParse) {
    const [y, m] = mk.split('-').map(Number);
    const entries = parseCalendar(html, y, m);
    allEntries.push(...entries);
  }

  // Filter to requested dates
  const targetDates = new Set([checkin, checkout]);
  for (const entry of allEntries) {
    if (targetDates.has(entry.date)) {
      result.availability.push(entry);
    }
  }

  // If we couldn't find one of the dates
  const foundDates = new Set(result.availability.map((a) => a.date));
  for (const d of [checkin, checkout]) {
    if (!foundDates.has(d)) {
      result.availability.push({
        date: d,
        raw: '',
        meaning: 'unknown',
      });
      result.errors.push(`Date ${d} not found in calendar data.`);
    }
  }

  return result;
}

module.exports = {
  checkAvailability,
  parseCalendar,
  fetchHTML,
  BASE_URL,
  FREE_SITE_RULE,
  STATUS_MAP,
};
