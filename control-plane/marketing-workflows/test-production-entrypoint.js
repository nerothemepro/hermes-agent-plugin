'use strict';

const assert = require('assert');
const test = require('node:test');
const { parseArgs } = require('./production-entrypoint');

test('production dispatch accepts only bounded arguments', () => {
  assert.deepStrictEqual(parseArgs(['dispatch', '--database-file', '/tmp/state.sqlite', '--artifact-root', '/tmp/artifacts', '--run-id', 'run_mkt_abc123def456']), {
    command: 'dispatch', databaseFile: '/tmp/state.sqlite', artifactRoot: '/tmp/artifacts', runId: 'run_mkt_abc123def456',
  });
  assert.throws(() => parseArgs(['dispatch', '--database-file', '/tmp/state.sqlite']), /artifactRoot is required/);
  assert.throws(() => parseArgs(['status', '--database-file', '/tmp/state.sqlite', '--artifact-root', '/tmp/artifacts', '--run-id', 'run_mkt_abc123def456']), /exact production command/);
});
