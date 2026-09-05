'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const childProcess = require('child_process');
const test = require('node:test');
const { MarketingWorkflowController } = require('./controller');
const { execute } = require('./staging-entrypoint');

function brief() {
  return {
    schema_version: 'sdtk.marketing-handoff.v1', episode_id: 'EP4', revision: 'r1', workflow: 'research_and_story', validation_status: 'pass',
    approval: { gate: 'story_lock', status: 'approved', artifact_sha256: 'a'.repeat(64) },
    outputs: [{ path: 'research/production-brief.json', sha256: 'c'.repeat(64), media_type: 'application/json' }],
    staging_smoke: true,
  };
}

function nativeClient() {
  const tasks = new Map();
  const createBodies = [];
  let sequence = 0;
  return {
    tasks, createBodies,
    run(argv) {
      const action = argv[4];
      if (action === 'create') {
        const id = 't_e2e_' + String(++sequence).padStart(3, '0');
        tasks.set(id, { id, assignee: 'hervid', status: 'blocked' });
        createBodies.push(argv[argv.indexOf('--body') + 1]);
        return { returncode: 0, stdout: JSON.stringify({ id, assignee: 'hervid', status: 'blocked' }), stderr: '' };
      }
      if (action === 'unblock') { tasks.get(argv[5]).status = 'ready'; return { returncode: 0, stdout: '', stderr: '' }; }
      if (action === 'dispatch') {
        const task = [...tasks.values()].find((item) => item.status === 'ready');
        task.status = 'running';
        return { returncode: 0, stdout: JSON.stringify({ spawned: [{ task_id: task.id, assignee: 'hervid' }] }), stderr: '' };
      }
      if (action === 'show') return { returncode: 0, stdout: JSON.stringify({ task: tasks.get(argv[5]) }), stderr: '' };
      if (action === 'complete') { tasks.get(argv[5]).status = 'done'; return { returncode: 0, stdout: '', stderr: '' }; }
      if (action === 'block') { tasks.get(argv[5]).status = 'blocked'; return { returncode: 0, stdout: '', stderr: '' }; }
      throw new Error('unexpected native command: ' + action);
    },
  };
}

function runWorker(root, runId, taskId, client, nativeTaskId) {
  const body = client.createBodies.at(-1);
  const command = body.match(/^Run exactly: node (.+)$/m);
  assert.ok(command, 'smoke worker must receive one deterministic command');
  childProcess.execFileSync(process.execPath, [command[1]], { stdio: 'pipe' });
  client.tasks.get(nativeTaskId).status = 'done';
  return path.join(root, runId, 'worker-result.json');
}

test('disposable Workflow B staging E2E reaches asset lock then picture lock without render or publish', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'workflow-b-staging-e2e-'));
  const runId = 'run_e2e_video_001';
  const controller = new MarketingWorkflowController({ databaseFile: path.join(root, 'state.sqlite'), artifactRoot: root });
  const client = nativeClient();
  const previous = process.env.SDTK_MARKETING_WORKFLOW_MODE;
  process.env.SDTK_MARKETING_WORKFLOW_MODE = 'staging';
  try {
    const prepared = controller.prepare({ commandId: 'staging:e2e:prepare', workflow: 'video_production', runId, input: brief() });
    controller.approveKickoff({ commandId: 'staging:e2e:kickoff', runId, packetSha256: prepared.kickoff_packet_sha256 });
    const common = { databaseFile: path.join(root, 'state.sqlite'), artifactRoot: root, runId };

    const capture = execute({ command: 'dispatch', ...common }, { controller, client });
    const captureCandidate = runWorker(root, runId, 'capture_assets', client, capture.native_task_id);
    const asset = execute({ command: 'submit', ...common, taskId: 'capture_assets', nativeTaskId: capture.native_task_id, candidateFile: captureCandidate }, { controller, client });
    assert.strictEqual(asset.state.waiting_gate, 'asset_lock');
    assert.strictEqual(asset.result.artifacts[0].path, 'capture_assets-smoke-evidence.txt');

    const assetApproved = execute({ command: 'approve-gate', ...common, gateId: 'asset_lock', packetSha256: asset.packet_sha256, commandId: 'staging:e2e:asset-lock' }, { controller, client });
    assert.strictEqual(assetApproved.state.status, 'running');

    const assembly = execute({ command: 'dispatch', ...common }, { controller, client });
    const assemblyCandidate = runWorker(root, runId, 'assemble_video', client, assembly.native_task_id);
    const picture = execute({ command: 'submit', ...common, taskId: 'assemble_video', nativeTaskId: assembly.native_task_id, candidateFile: assemblyCandidate }, { controller, client });
    assert.strictEqual(picture.state.waiting_gate, 'picture_lock');
    assert.strictEqual(picture.result.artifacts[0].path, 'assemble_video-smoke-evidence.txt');
    assert.notStrictEqual(asset.result.artifacts[0].path, picture.result.artifacts[0].path);

    const duplicate = execute({ command: 'submit', ...common, taskId: 'assemble_video', nativeTaskId: assembly.native_task_id, candidateFile: assemblyCandidate }, { controller, client });
    assert.strictEqual(duplicate.status, 'duplicate');
    assert.strictEqual(duplicate.state.revision, picture.state.revision);

    const completed = execute({ command: 'approve-gate', ...common, gateId: 'picture_lock', packetSha256: picture.packet_sha256, commandId: 'staging:e2e:picture-lock' }, { controller, client });
    assert.strictEqual(completed.state.status, 'completed');
    assert.deepStrictEqual([...client.tasks.values()].map((task) => task.status), ['done', 'done']);
    assert.match(client.createBodies[0], /Do not capture, render, browse, or publish/);
    assert.match(client.createBodies[1], /Do not capture, render, browse, or publish/);
  } finally {
    if (previous === undefined) delete process.env.SDTK_MARKETING_WORKFLOW_MODE;
    else process.env.SDTK_MARKETING_WORKFLOW_MODE = previous;
    controller.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});


test('staging recovers a released native card after restart without creating a duplicate', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'workflow-b-staging-recovery-'));
  const runId = 'run_e2e_video_003';
  const databaseFile = path.join(root, 'state.sqlite');
  const client = nativeClient();
  const originalRun = client.run.bind(client);
  let failOnce = true;
  client.run = (argv) => {
    if (argv[4] === 'dispatch' && failOnce) {
      failOnce = false;
      return { returncode: 1, stdout: '', stderr: 'temporary dispatcher failure' };
    }
    return originalRun(argv);
  };
  const previous = process.env.SDTK_MARKETING_WORKFLOW_MODE;
  process.env.SDTK_MARKETING_WORKFLOW_MODE = 'staging';
  let controller = new MarketingWorkflowController({ databaseFile, artifactRoot: root });
  try {
    const prepared = controller.prepare({ commandId: 'staging:recovery:prepare', workflow: 'video_production', runId, input: brief() });
    controller.approveKickoff({ commandId: 'staging:recovery:kickoff', runId, packetSha256: prepared.kickoff_packet_sha256 });
    const common = { databaseFile, artifactRoot: root, runId };
    assert.throws(() => execute({ command: 'dispatch', ...common }, { controller, client }), /native dispatcher failed/);
    assert.strictEqual(controller.status(runId).tasks.capture_assets.status, 'external_released');
    controller.close();
    controller = new MarketingWorkflowController({ databaseFile, artifactRoot: root });

    const status = execute({ command: 'status', ...common }, { controller, client });
    assert.strictEqual(status.state.tasks.capture_assets.status, 'external_released');
    const recovered = execute({ command: 'dispatch', ...common }, { controller, client });
    assert.strictEqual(recovered.native_task_id, 't_e2e_001');
    assert.strictEqual(client.createBodies.length, 1);
  } finally {
    if (previous === undefined) delete process.env.SDTK_MARKETING_WORKFLOW_MODE;
    else process.env.SDTK_MARKETING_WORKFLOW_MODE = previous;
    controller.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('staging rejects malformed evidence and cancellation is idempotent', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'workflow-b-staging-negative-'));
  const runId = 'run_e2e_video_002';
  const controller = new MarketingWorkflowController({ databaseFile: path.join(root, 'state.sqlite'), artifactRoot: root });
  const client = nativeClient();
  const previous = process.env.SDTK_MARKETING_WORKFLOW_MODE;
  process.env.SDTK_MARKETING_WORKFLOW_MODE = 'staging';
  try {
    const prepared = controller.prepare({ commandId: 'staging:negative:prepare', workflow: 'video_production', runId, input: brief() });
    controller.approveKickoff({ commandId: 'staging:negative:kickoff', runId, packetSha256: prepared.kickoff_packet_sha256 });
    const common = { databaseFile: path.join(root, 'state.sqlite'), artifactRoot: root, runId };
    const capture = execute({ command: 'dispatch', ...common }, { controller, client });
    const candidate = runWorker(root, runId, 'capture_assets', client, capture.native_task_id);
    const payload = JSON.parse(fs.readFileSync(candidate, 'utf8'));
    payload.artifacts[0].sha256 = '0'.repeat(64);
    fs.writeFileSync(candidate, JSON.stringify(payload));
    assert.throws(() => execute({ command: 'submit', ...common, taskId: 'capture_assets', nativeTaskId: capture.native_task_id, candidateFile: candidate }, { controller, client }), /artifact sha256 mismatch/);
    assert.strictEqual(controller.status(runId).status, 'external_pending');

    const cancelled = execute({ command: 'cancel', ...common, commandId: 'staging:negative:cancel' }, { controller, client });
    assert.strictEqual(cancelled.status, 'cancelled');
    const duplicate = execute({ command: 'cancel', ...common, commandId: 'staging:negative:cancel' }, { controller, client });
    assert.strictEqual(duplicate.status, 'duplicate');
  } finally {
    if (previous === undefined) delete process.env.SDTK_MARKETING_WORKFLOW_MODE;
    else process.env.SDTK_MARKETING_WORKFLOW_MODE = previous;
    controller.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});
