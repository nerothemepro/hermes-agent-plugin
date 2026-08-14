'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
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

test('EP2 duplicate protection reuses only a nonterminal canonical ledger record', () => {
  const { findReusableEp2Record } = require('../src/hermesControlPlanePrepare');
  const projectPath = fs.mkdtempSync(path.join(os.tmpdir(), 'hermes-ep2-project-'));
  const registryDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hermes-ep2-registry-'));
  const runId = 'run_ep2001_abc123';
  const statePath = path.join(projectPath, '.sdtk', 'agent-runtime', 'runs', runId, 'state.json');
  fs.mkdirSync(path.dirname(statePath), { recursive: true });
  fs.writeFileSync(statePath, '{"status":"waiting_for_approval"}\n');
  const recordPath = path.join(registryDir, `${runId}.json`);
  fs.writeFileSync(recordPath, JSON.stringify({ template_id: 'marketing_video_ep_usage', run_id: runId, state_path: statePath }));
  try {
    const reusable = findReusableEp2Record(registryDir, projectPath);
    assert.strictEqual(reusable.record.run_id, runId);
    assert.strictEqual(reusable.recordPath, recordPath);
    fs.writeFileSync(statePath, '{"status":"completed"}\n');
    assert.strictEqual(findReusableEp2Record(registryDir, projectPath), null);
  } finally {
    fs.rmSync(projectPath, { recursive: true, force: true });
    fs.rmSync(registryDir, { recursive: true, force: true });
  }
});
