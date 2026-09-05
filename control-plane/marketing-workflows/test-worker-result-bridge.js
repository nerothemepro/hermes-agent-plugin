'use strict';

const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const test = require('node:test');
const { MarketingWorkflowController } = require('./controller');
const { WorkerResultBridge } = require('./worker-result-bridge');

const sha = (value) => crypto.createHash('sha256').update(value).digest('hex');
function setup() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'marketing-worker-bridge-'));
  return { root, controller: new MarketingWorkflowController({ databaseFile: path.join(root, 'state.sqlite'), artifactRoot: path.join(root, 'artifacts') }) };
}
function brief() {
  return { schema_version: 'sdtk.marketing-handoff.v1', episode_id: 'EP4', revision: 'r1', workflow: 'research_and_story', validation_status: 'pass', approval: { gate: 'story_lock', status: 'approved', artifact_sha256: 'a'.repeat(64) } };
}
function candidate(root, runId) {
  const dir = path.join(root, 'artifacts', runId);
  fs.mkdirSync(dir, { recursive: true });
  const artifact = Buffer.from('capture manifest\n');
  fs.writeFileSync(path.join(dir, 'capture-manifest.json'), artifact);
  const payload = { schema_version: 'sdtk.video-task-result.v1', run_id: runId, task_id: 'capture_assets', attempt: 1, status: 'completed', artifacts: [{ path: 'capture-manifest.json', sha256: sha(artifact), media_type: 'application/json' }], validation: { status: 'pass', validator: 'capture-r1', evidence: ['capture-manifest.json'] }, summary: 'Capture validated', error: null };
  const file = path.join(dir, 'candidate.json');
  fs.writeFileSync(file, JSON.stringify(payload));
  return file;
}
function register(controller, runId) {
  const prepared = controller.prepare({ commandId: `telegram:${runId}:prepare`, workflow: 'video_production', runId, input: brief() });
  controller.approveKickoff({ commandId: `telegram:${runId}:kickoff`, runId, packetSha256: prepared.kickoff_packet_sha256 });
  controller.registerExternalTask({ runId, taskId: 'capture_assets', attempt: 1, nativeTaskId: 't_worker_001', idempotencyKey: `sdtk-marketing:${runId}:capture_assets:1`, board: 'marketing-video-staging' });
  controller.releaseExternalTask({ runId, taskId: 'capture_assets', attempt: 1, nativeTaskId: 't_worker_001' });
}

test('worker result bridge accepts only the mapped HerVid native card and creates the SHA-pinned asset lock', () => {
  const env = setup();
  const calls = [];
  const client = { run(argv, options) {
    calls.push({ argv, options });
    if (argv.includes('show')) return { returncode: 0, stdout: JSON.stringify({ task: { id: 't_worker_001', assignee: 'hervid', status: 'running' } }), stderr: '' };
    if (argv.includes('complete')) return { returncode: 0, stdout: '{}', stderr: '' };
    throw new Error('unexpected native command');
  } };
  try {
    const runId = 'run_mkt_worker001';
    register(env.controller, runId);
    const bridge = new WorkerResultBridge({ controller: env.controller, client, profileHome: '/opt/data/hermes-profiles/hervid', board: 'marketing-video-staging' });
    const submitted = bridge.submit({ runId, taskId: 'capture_assets', nativeTaskId: 't_worker_001', candidateFile: candidate(env.root, runId) });
    assert.strictEqual(submitted.status, 'completed');
    assert.match(submitted.packet_sha256, /^[a-f0-9]{64}$/);
    const state = env.controller.status(runId);
    assert.strictEqual(state.status, 'waiting_for_approval');
    assert.strictEqual(state.waiting_gate, 'asset_lock');
    assert.strictEqual(state.tasks.capture_assets.native_task_id, 't_worker_001');
    const complete = calls.find((call) => call.argv.includes('complete'));
    assert.ok(complete);
    assert.ok(!complete.argv.includes('--json'));
    assert.strictEqual(calls[0].options.env.HERMES_HOME, '/opt/data/hermes-profiles/hervid');
    assert.strictEqual(calls[0].options.env.HERMES_KANBAN_HOME, '/opt/data/hermes');
  } finally { env.controller.close(); fs.rmSync(env.root, { recursive: true, force: true }); }
});

test('worker result bridge rejects an unmapped native card before controller mutation', () => {
  const env = setup();
  const client = { run() { throw new Error('native client should not run'); } };
  try {
    const runId = 'run_mkt_worker002';
    register(env.controller, runId);
    const bridge = new WorkerResultBridge({ controller: env.controller, client, profileHome: '/opt/data/hermes-profiles/hervid', board: 'marketing-video-staging' });
    assert.throws(() => bridge.submit({ runId, taskId: 'capture_assets', nativeTaskId: 't_wrong_002', candidateFile: candidate(env.root, runId) }), /not the controller-mapped task/);
    assert.strictEqual(env.controller.status(runId).status, 'external_pending');
  } finally { env.controller.close(); fs.rmSync(env.root, { recursive: true, force: true }); }
});

test('worker result bridge blocks native work when the validated candidate reports failure', () => {
  const env = setup();
  const calls = [];
  const client = { run(argv) {
    calls.push(argv);
    if (argv.includes('show')) return { returncode: 0, stdout: JSON.stringify({ task: { id: 't_worker_001', assignee: 'hervid', status: 'running' } }), stderr: '' };
    if (argv.includes('block')) return { returncode: 0, stdout: '{}', stderr: '' };
    throw new Error('unexpected native command');
  } };
  try {
    const runId = 'run_mkt_worker003';
    register(env.controller, runId);
    const file = candidate(env.root, runId);
    const payload = JSON.parse(fs.readFileSync(file, 'utf8'));
    payload.status = 'failed';
    payload.validation.status = 'fail';
    payload.error = { error_class: 'TOOL_DEFECT' };
    fs.writeFileSync(file, JSON.stringify(payload));
    const bridge = new WorkerResultBridge({ controller: env.controller, client, profileHome: '/opt/data/hermes-profiles/hervid', board: 'marketing-video-staging' });
    const submitted = bridge.submit({ runId, taskId: 'capture_assets', nativeTaskId: 't_worker_001', candidateFile: file });
    assert.strictEqual(submitted.status, 'failed');
    assert.strictEqual(env.controller.status(runId).status, 'blocked');
    const block = calls.find((argv) => argv.includes('block'));
    assert.ok(block);
    assert.ok(!block.includes('--json'));
    assert.ok(!calls.some((argv) => argv.includes('complete')));
  } finally { env.controller.close(); fs.rmSync(env.root, { recursive: true, force: true }); }
});
