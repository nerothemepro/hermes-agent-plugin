'use strict';

const assert = require('assert');
const test = require('node:test');

const childProcess = require('child_process');

const {
  buildArgs,
  normalizeSearchResults,
  parseSearchOutput,
  runSdtkWikiAction,
  sanitizeReportPaths,
} = require('../src/herWikiSdtkWikiTool');

test('herwiki sdtk wiki tool helper', async (t) => {
  await t.test('builds deterministic ingest command against raw inbox', () => {
    const result = buildArgs('ingest', {
      wikiRoot: '/tmp/wiki-root',
      sourceRoot: '/tmp/wiki-root/raw/inbox',
    });

    assert.deepStrictEqual(result.argv, [
      'ingest',
      '/tmp/wiki-root/raw/inbox',
      '--project-path',
      '/tmp/wiki-root',
    ]);
  });

  await t.test('requires a query for search', () => {
    assert.throws(
      () => buildArgs('search', { wikiRoot: '/tmp/wiki-root', sourceRoot: '/tmp/wiki-root/raw/inbox' }),
      /Search query is required/,
    );
  });

  await t.test('parses search JSON when valid', () => {
    const parsed = parseSearchOutput('[{"path":"wiki/index.md"}]');
    assert.deepStrictEqual(parsed, [{ path: 'wiki/index.md' }]);
  });

  await t.test('returns null for invalid search JSON', () => {
    assert.strictEqual(parseSearchOutput('not-json'), null);
  });

  await t.test('drops blank report paths', () => {
    assert.deepStrictEqual(sanitizeReportPaths(['', '  ', '/tmp/a.json', '/tmp/a.json']), ['/tmp/a.json']);
  });

  await t.test('normalizes object search output into compact deterministic results', () => {
    const normalized = normalizeSearchResults({
      scannedFiles: 12,
      totalMatches: 42,
      searchMode: 'local',
      premiumRequired: false,
      mutated: false,
      matches: [{
        path: 'wiki/a.md',
        title: 'A',
        score: 9,
        why: 'matched',
        snippet: 'x '.repeat(200),
      }],
    }, 10);

    assert.strictEqual(normalized.resultCount, 1);
    assert.strictEqual(normalized.totalMatches, 42);
    assert.deepStrictEqual(normalized.searchMeta, {
      scanned_files: 12,
      search_mode: 'local',
      premium_required: false,
      mutated: false,
    });
    assert.strictEqual(normalized.searchResults[0].path, 'wiki/a.md');
    assert.ok(normalized.searchResults[0].snippet.endsWith('…'));
  });

  await t.test('wraps command output into deterministic JSON payload', () => {
    const originalSpawnSync = childProcess.spawnSync;
    childProcess.spawnSync = () => ({
      status: 0,
      signal: null,
      stdout: 'ok\n',
      stderr: '',
      error: null,
    });

    try {
      const result = runSdtkWikiAction('lint', {
        wikiRoot: '/tmp/wiki-root',
        sourceRoot: '/tmp/wiki-root/raw/inbox',
        reportDir: '/tmp/wiki-root/.sdtk/wiki/reports',
      });
      assert.strictEqual(result.status, 'completed');
      assert.strictEqual(result.action, 'lint');
      assert.deepStrictEqual(result.command, [
        'sdtk-wiki',
        'lint',
        '--project-path',
        '/tmp/wiki-root',
      ]);
      assert.ok(result.warnings.includes('no changed report files were detected'));
    } finally {
      childProcess.spawnSync = originalSpawnSync;
    }
  });

  await t.test('search payload exposes compact results and counts', () => {
    const originalSpawnSync = childProcess.spawnSync;
    childProcess.spawnSync = () => ({
      status: 0,
      signal: null,
      stdout: JSON.stringify({
        scannedFiles: 381,
        totalMatches: 377,
        searchMode: 'local_deterministic_project_wiki_markdown',
        premiumRequired: false,
        mutated: false,
        matches: [
          {
            path: 'wiki/queries/a.md',
            title: 'A',
            score: 178,
            why: 'matched 30/35 query token(s)',
            snippet: 'example snippet',
          },
        ],
      }),
      stderr: '',
      error: null,
    });

    try {
      const result = runSdtkWikiAction('search', {
        wikiRoot: '/tmp/wiki-root',
        sourceRoot: '/tmp/wiki-root/raw/inbox',
        reportDir: '/tmp/wiki-root/.sdtk/wiki/reports',
        query: 'multi-agent runtime',
        limit: 10,
      });
      assert.strictEqual(result.status, 'completed');
      assert.strictEqual(result.result_count, 1);
      assert.strictEqual(result.total_matches, 377);
      assert.strictEqual(result.search_meta.scanned_files, 381);
      assert.strictEqual(result.search_results[0].path, 'wiki/queries/a.md');
    } finally {
      childProcess.spawnSync = originalSpawnSync;
    }
  });
});
