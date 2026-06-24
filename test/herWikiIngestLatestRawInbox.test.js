'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const test = require('node:test');

const {
  buildHerWikiPrompt,
  resolveLatestRawInbox,
} = require('../src/herWikiIngestLatestRawInbox');

test('herwiki ingest latest raw inbox helper', async (t) => {
  await t.test('selects the newest markdown file', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'herwiki-latest-'));
    const inbox = path.join(root, 'raw', 'inbox');
    fs.mkdirSync(inbox, { recursive: true });

    const older = path.join(inbox, '2026-06-20-facebook-old.md');
    const newer = path.join(inbox, '2026-06-24-facebook-new.md');
    fs.writeFileSync(older, '# old\n', 'utf-8');
    fs.writeFileSync(newer, '# new\n', 'utf-8');
    const olderTime = new Date('2026-06-20T00:00:00.000Z');
    const newerTime = new Date('2026-06-24T00:00:00.000Z');
    fs.utimesSync(older, olderTime, olderTime);
    fs.utimesSync(newer, newerTime, newerTime);

    const result = resolveLatestRawInbox({ wikiRoot: root });
    assert.strictEqual(result.latest_raw_path, newer);
    assert.strictEqual(result.source_count, 2);
  });

  await t.test('builds a concise ingest prompt', () => {
    const prompt = buildHerWikiPrompt('/workspace/sdtk-wiki/ai-agent-second-brain-main/raw/inbox/sample.md');
    assert.match(prompt, /Ingest file raw này vào wiki/);
    assert.match(prompt, /sample\.md/);
    assert.match(prompt, /append wiki\/log\.md/);
  });

  await t.test('fails when inbox is empty', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'herwiki-empty-'));
    const inbox = path.join(root, 'raw', 'inbox');
    fs.mkdirSync(inbox, { recursive: true });
    assert.throws(() => resolveLatestRawInbox({ wikiRoot: root }), /No ingestable markdown files found/);
  });

  await t.test("skips login-required captures by default", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "herwiki-skip-"));
    const inbox = path.join(root, "raw", "inbox");
    fs.mkdirSync(inbox, { recursive: true });

    const valid = path.join(inbox, "2026-06-24-facebook-valid.md");
    const blocked = path.join(inbox, "2026-06-24-facebook-login-required.md");
    fs.writeFileSync(valid, "# Valid capture\n\nActual post body.\n", "utf-8");
    fs.writeFileSync(blocked, "# Facebook Login Required\n\nMain heading: Facebook Login\n", "utf-8");
    const validTime = new Date("2026-06-24T00:00:00.000Z");
    const blockedTime = new Date("2026-06-24T01:00:00.000Z");
    fs.utimesSync(valid, validTime, validTime);
    fs.utimesSync(blocked, blockedTime, blockedTime);

    const result = resolveLatestRawInbox({ wikiRoot: root });
    assert.strictEqual(result.latest_raw_path, valid);
    assert.strictEqual(result.skipped_problematic_count, 1);

    const debugResult = resolveLatestRawInbox({ wikiRoot: root, includeProblematic: true });
    assert.strictEqual(debugResult.latest_raw_path, blocked);
  });
});
