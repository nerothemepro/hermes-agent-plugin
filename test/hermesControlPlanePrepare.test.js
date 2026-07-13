'use strict';

const assert = require('assert');
const test = require('node:test');

const { previewTemplate } = require('../src/hermesControlPlane');
const { buildRegistryRecord } = require('../src/hermesControlPlanePrepare');

test('control-plane registry record stays reference-only', () => {
  const preview = previewTemplate('site_audit', '{}', {
    templateRoot: '/workspace/hermes-agent-plugin/control-plane/templates',
  });
  const record = buildRegistryRecord(preview, 'run_abc123_def456', '/tmp/hermes-project');
  assert.deepStrictEqual(Object.keys(record).sort(), [
    'canonical_report_path', 'created_at', 'ledger_path', 'run_id', 'schema_version',
    'state_path', 'template_id', 'template_sha256', 'template_version',
  ]);
  const serialized = JSON.stringify(record);
  assert.ok(!serialized.includes('instruction'));
  assert.ok(!serialized.includes('token'));
  assert.ok(!serialized.includes('HERMES_HOME'));
});
