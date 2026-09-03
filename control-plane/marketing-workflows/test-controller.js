'use strict';

const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const test = require('node:test');
const { MarketingWorkflowController } = require('./controller');

const sha = (value) => crypto.createHash('sha256').update(value).digest('hex');
function setup() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'marketing-controller-'));
  return { root, controller: new MarketingWorkflowController({ databaseFile: path.join(root, 'state.sqlite'), artifactRoot: path.join(root, 'artifacts') }) };
}
function artifactResult(root, runId, taskId, name) {
  const directory = path.join(root, runId);
  fs.mkdirSync(directory, { recursive: true });
  const bytes = Buffer.from(`${name}\n`);
  fs.writeFileSync(path.join(directory, name), bytes);
  return { schema_version: 'sdtk.video-task-result.v1', run_id: runId, task_id: taskId, attempt: 1, status: 'completed', artifacts: [{ path: name, sha256: sha(bytes), media_type: 'application/json' }], validation: { status: 'pass', validator: `${taskId}-r1`, evidence: [] }, summary: `${taskId} complete`, error: null };
}

test('research workflow reaches SHA-pinned story lock then completes after exact approval', () => {
  const env = setup();
  try {
    const prepared = env.controller.prepare({ commandId: 'tg:1', workflow: 'research_and_story', runId: 'run_research_100', input: { episode_id: 'EP4' } });
    assert.strictEqual(prepared.owner, 'herresearch');
    env.controller.startTask({ runId: prepared.run_id, taskId: 'research_story', workerId: 'herresearch:1' });
    const result = artifactResult(path.join(env.root, 'artifacts'), prepared.run_id, 'research_story', 'production-brief.json');
    const waiting = env.controller.completeTask({ runId: prepared.run_id, candidate: result });
    assert.strictEqual(waiting.state.waiting_gate, 'story_lock');
    assert.match(waiting.packet_sha256, /^[a-f0-9]{64}$/);
    assert.throws(() => env.controller.approveGate({ runId: prepared.run_id, gateId: 'story_lock', packetSha256: '0'.repeat(64) }), /packet sha256 mismatch/);
    const completed = env.controller.approveGate({ runId: prepared.run_id, gateId: 'story_lock', packetSha256: waiting.packet_sha256 });
    assert.strictEqual(completed.state.status, 'completed');
  } finally { env.controller.close(); fs.rmSync(env.root, { recursive: true, force: true }); }
});

test('video prepare rejects anything except an approved story handoff', () => {
  const env = setup();
  try {
    const handoff = { schema_version: 'sdtk.marketing-handoff.v1', workflow: 'research_and_story', episode_id: 'EP4', revision: 'r1', validation_status: 'pass', approval: { gate: 'story_lock', status: 'pending', artifact_sha256: 'a'.repeat(64) } };
    assert.throws(() => env.controller.prepare({ commandId: 'tg:2', workflow: 'video_production', runId: 'run_video_100', input: handoff }), /approved story_lock/);
  } finally { env.controller.close(); fs.rmSync(env.root, { recursive: true, force: true }); }
});

test('video tasks execute in order across asset and picture-lock gates', () => {
  const env = setup();
  try {
    const handoff = { schema_version: 'sdtk.marketing-handoff.v1', workflow: 'research_and_story', episode_id: 'EP4', revision: 'r1', validation_status: 'pass', approval: { gate: 'story_lock', status: 'approved', artifact_sha256: 'a'.repeat(64) } };
    env.controller.prepare({ commandId: 'tg:video', workflow: 'video_production', runId: 'run_video_200', input: handoff });
    assert.throws(() => env.controller.startTask({ runId: 'run_video_200', taskId: 'assemble_video', workerId: 'hervid:1' }), /expected task capture_assets/);
    env.controller.startTask({ runId: 'run_video_200', taskId: 'capture_assets', workerId: 'hervid:1' });
    const capture = env.controller.completeTask({ runId: 'run_video_200', candidate: artifactResult(path.join(env.root, 'artifacts'), 'run_video_200', 'capture_assets', 'capture-manifest.json') });
    env.controller.approveGate({ runId: 'run_video_200', gateId: 'asset_lock', packetSha256: capture.packet_sha256 });
    env.controller.startTask({ runId: 'run_video_200', taskId: 'assemble_video', workerId: 'hervid:1' });
    assert.strictEqual(env.controller.status('run_video_200').tasks.assemble_video.status, 'running');
    assert.strictEqual(env.controller.cancel('run_video_200').status, 'cancelled');
  } finally { env.controller.close(); fs.rmSync(env.root, { recursive: true, force: true }); }
});
