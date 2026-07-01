'use strict';

const assert = require('assert');
const test = require('node:test');

const childProcess = require('child_process');

const {
  buildArgs,
  parseSearchOutput,
  runSdtkWikiAction,
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
    } finally {
      childProcess.spawnSync = originalSpawnSync;
    }
  });
});
