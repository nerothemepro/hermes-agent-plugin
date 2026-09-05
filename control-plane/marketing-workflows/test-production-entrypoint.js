'use strict';
const assert = require('assert');
const test = require('node:test');
const { parseArgs } = require('./production-entrypoint');

const common = ['--database-file', '/tmp/state.sqlite', '--artifact-root', '/tmp/artifacts'];

test('production dispatch accepts only bounded arguments', () => {
  assert.deepStrictEqual(parseArgs(['dispatch', ...common, '--run-id', 'run_mkt_abc123def456']), {
    command: 'dispatch', databaseFile: '/tmp/state.sqlite', artifactRoot: '/tmp/artifacts', runId: 'run_mkt_abc123def456',
  });
  assert.throws(() => parseArgs(['dispatch', '--database-file', '/tmp/state.sqlite']), /artifactRoot is required/);
  assert.throws(() => parseArgs(['status', ...common, '--run-id', 'run_mkt_abc123def456']), /exact production command/);
});

test('production reconciliation accepts only fixed single-run or all-run commands', () => {
  assert.deepStrictEqual(parseArgs(['reconcile', ...common, '--run-id', 'run_mkt_abc123def456']), {
    command: 'reconcile', databaseFile: '/tmp/state.sqlite', artifactRoot: '/tmp/artifacts', runId: 'run_mkt_abc123def456',
  });
  assert.deepStrictEqual(parseArgs(['reconcile-all', ...common]), {
    command: 'reconcile-all', databaseFile: '/tmp/state.sqlite', artifactRoot: '/tmp/artifacts', runId: '',
  });
  assert.throws(() => parseArgs(['reconcile-all', ...common, '--run-id', 'run_mkt_abc123def456']), /does not accept run id/);
});
