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
    'state_path', 'template_id', 'template_sha256', 'template_variant', 'template_version',
  ]);
  const serialized = JSON.stringify(record);
  assert.ok(!serialized.includes('instruction'));
  assert.ok(!serialized.includes('token'));
  assert.ok(!serialized.includes('HERMES_HOME'));
});

test('marketing video registry pins the episode manifest fingerprint', () => {
  const preview = previewTemplate('marketing_video_ep_usage', { episode: 'EP3' }, {
    templateRoot: path.join(__dirname, '..', 'control-plane', 'templates'),
  });
  const record = buildRegistryRecord(preview, 'run_ep3abc_def456', '/tmp/hermes-project');
  assert.strictEqual(record.episode_manifest_sha256, preview.episode_manifest_sha256);
  assert.strictEqual(record.episode_manifest_path, preview.episode_manifest_path);
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
    fs.writeFileSync(statePath, '{"status":"blocked"}\n');
    assert.strictEqual(findReusableEp2Record(registryDir, projectPath), null);
  } finally {
    fs.rmSync(projectPath, { recursive: true, force: true });
    fs.rmSync(registryDir, { recursive: true, force: true });
  }
});

test('EP2 duplicate protection selects the newest nonterminal canonical ledger', () => {
  const { findReusableEp2Record } = require('../src/hermesControlPlanePrepare');
  const projectPath = fs.mkdtempSync(path.join(os.tmpdir(), 'hermes-ep2-project-'));
  const registryDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hermes-ep2-registry-'));
  const fixtures = [
    ['run_aaaold_abc123', '2026-08-18T01:00:00Z'],
    ['run_zzznew_def456', '2026-08-18T02:00:00Z'],
  ];
  try {
    for (const [runId, updatedAt] of fixtures) {
      const statePath = path.join(projectPath, '.sdtk', 'agent-runtime', 'runs', runId, 'state.json');
      fs.mkdirSync(path.dirname(statePath), { recursive: true });
      fs.writeFileSync(statePath, JSON.stringify({ status: 'running', updated_at: updatedAt }) + '\n');
      fs.writeFileSync(path.join(registryDir, runId + '.json'), JSON.stringify({
        template_id: 'marketing_video_ep_usage',
        run_id: runId,
        state_path: statePath,
      }));
    }
    const reusable = findReusableEp2Record(registryDir, projectPath);
    assert.strictEqual(reusable.record.run_id, 'run_zzznew_def456');
  } finally {
    fs.rmSync(projectPath, { recursive: true, force: true });
    fs.rmSync(registryDir, { recursive: true, force: true });
  }
});


test('marketing video duplicate protection isolates episode and template fingerprint', () => {
  const { findReusableEp2Record } = require('../src/hermesControlPlanePrepare');
  const projectPath = fs.mkdtempSync(path.join(os.tmpdir(), 'hermes-video-project-'));
  const registryDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hermes-video-registry-'));
  const preview = previewTemplate('marketing_video_ep_usage', { episode: 'EP3' }, {
    templateRoot: path.join(__dirname, '..', 'control-plane', 'templates'),
    projectPath,
  });
  const runId = 'run_ep2002_abc123';
  const statePath = path.join(projectPath, '.sdtk', 'agent-runtime', 'runs', runId, 'state.json');
  fs.mkdirSync(path.dirname(statePath), { recursive: true });
  fs.writeFileSync(statePath, '{"status":"running"}\n');
  try {
    fs.writeFileSync(path.join(registryDir, runId + '.json'), JSON.stringify({
      template_id: preview.template_id,
      template_version: preview.template_version,
      template_sha256: preview.template_sha256,
      template_variant: 'EP2',
      run_id: runId,
      state_path: statePath,
    }));
    assert.strictEqual(findReusableEp2Record(registryDir, projectPath, preview), null);

    const recordPath = path.join(registryDir, runId + '.json');
    const record = JSON.parse(fs.readFileSync(recordPath, 'utf8'));
    record.template_variant = 'EP3';
    record.template_sha256 = '0'.repeat(64);
    fs.writeFileSync(recordPath, JSON.stringify(record));
    assert.strictEqual(findReusableEp2Record(registryDir, projectPath, preview), null);

    record.template_sha256 = preview.template_sha256;
    record.episode_manifest_sha256 = 'f'.repeat(64);
    fs.writeFileSync(recordPath, JSON.stringify(record));
    assert.strictEqual(findReusableEp2Record(registryDir, projectPath, preview), null);

    record.episode_manifest_sha256 = preview.episode_manifest_sha256;
    fs.writeFileSync(recordPath, JSON.stringify(record));
    assert.strictEqual(findReusableEp2Record(registryDir, projectPath, preview).record.run_id, runId);
  } finally {
    fs.rmSync(projectPath, { recursive: true, force: true });
    fs.rmSync(registryDir, { recursive: true, force: true });
  }
});
