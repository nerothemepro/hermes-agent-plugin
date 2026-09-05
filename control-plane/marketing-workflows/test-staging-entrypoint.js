'use strict';

const assert = require('assert');
const test = require('node:test');
const { execute, parseArgs } = require('./staging-entrypoint');

test('staging entrypoint accepts only bounded staging grammar', () => {
  assert.deepStrictEqual(parseArgs(['dispatch', '--database-file', '/tmp/state.sqlite', '--artifact-root', '/tmp/artifacts', '--run-id', 'run_mkt_123']), { command: 'dispatch', databaseFile: '/tmp/state.sqlite', artifactRoot: '/tmp/artifacts', runId: 'run_mkt_123' });
  assert.deepStrictEqual(parseArgs(['approve-gate', '--database-file', '/tmp/state.sqlite', '--artifact-root', '/tmp/artifacts', '--run-id', 'run_mkt_123', '--gate-id', 'asset_lock', '--packet-sha256', 'a'.repeat(64), '--command-id', 'staging:1']), { command: 'approve-gate', databaseFile: '/tmp/state.sqlite', artifactRoot: '/tmp/artifacts', runId: 'run_mkt_123', gateId: 'asset_lock', packetSha256: 'a'.repeat(64), commandId: 'staging:1' });
  assert.throws(() => parseArgs(['dispatch', '--database-file', '/tmp/state.sqlite', '--artifact-root', '/tmp/artifacts', '--run-id', 'run_mkt_123', '--board', 'default']), /unknown or incomplete/);
  assert.throws(() => parseArgs(['submit', '--database-file', '/tmp/state.sqlite', '--artifact-root', '/tmp/artifacts', '--run-id', 'run_mkt_123']), /taskId is required/);
  assert.throws(() => parseArgs(['approve-gate', '--database-file', '/tmp/state.sqlite', '--artifact-root', '/tmp/artifacts', '--run-id', 'run_mkt_123', '--gate-id', 'asset_lock']), /packetSha256 is required/);
});

test('staging entrypoint refuses all native mutation unless staging mode is explicitly enabled', () => {
  const previous = process.env.SDTK_MARKETING_WORKFLOW_MODE;
  delete process.env.SDTK_MARKETING_WORKFLOW_MODE;
  try {
    assert.throws(() => execute({ command: 'dispatch', databaseFile: '/tmp/state.sqlite', artifactRoot: '/tmp/artifacts', runId: 'run_mkt_123' }), /staging mode is not enabled/);
  } finally {
    if (previous === undefined) delete process.env.SDTK_MARKETING_WORKFLOW_MODE;
    else process.env.SDTK_MARKETING_WORKFLOW_MODE = previous;
  }
});
