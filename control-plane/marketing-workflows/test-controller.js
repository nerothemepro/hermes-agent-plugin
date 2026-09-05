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
  const bytes = name === 'production-brief.json' ? Buffer.from(JSON.stringify({ schema_version: 'sdtk.marketing-production-brief.v1', episode_id: 'EP4', revision: 'r1', audience: 'technical founders', pain_point: 'untracked product work creates delivery risk', hook: 'Make the next feature traceable.', narration: 'Turn a requirement into evidence before you ship.', cta: 'Build with proof at sdtk.dev.', shot_list: [{ id: 's1', visual: 'product evidence' }], claim_ledger: [{ claim: 'The workflow records evidence.', status: 'supported' }], evidence: ['evidence.txt'] }) + String.fromCharCode(10)) : Buffer.from(name + String.fromCharCode(10));
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

test('research prepare waits for a SHA-pinned kickoff and treats a duplicate owner command as a no-op', () => {
  const env = setup();
  try {
    const prepared = env.controller.prepare({ commandId: 'tg:prepare:1', workflow: 'research_and_story', runId: 'run_research_200', input: { episode_id: 'EP4' } });
    assert.strictEqual(prepared.status, 'awaiting_kickoff');
    assert.match(prepared.kickoff_packet_sha256, /^[a-f0-9]{64}$/);
    assert.strictEqual(env.controller.status(prepared.run_id).revision, 2);
    assert.throws(() => env.controller.approveKickoff({ commandId: 'tg:kickoff:1', runId: prepared.run_id, packetSha256: '0'.repeat(64) }), /packet sha256 mismatch/);

    const accepted = env.controller.approveKickoff({ commandId: 'tg:kickoff:1', runId: prepared.run_id, packetSha256: prepared.kickoff_packet_sha256 });
    assert.strictEqual(accepted.status, 'ready_for_worker_dispatch');
    assert.strictEqual(accepted.state.status, 'ready');
    const duplicate = env.controller.approveKickoff({ commandId: 'tg:kickoff:1', runId: prepared.run_id, packetSha256: prepared.kickoff_packet_sha256 });
    assert.strictEqual(duplicate.status, 'duplicate');
    assert.strictEqual(duplicate.state.revision, accepted.state.revision);
  } finally { env.controller.close(); fs.rmSync(env.root, { recursive: true, force: true }); }
});

test('owner gate approval is idempotent when Telegram repeats the same command id', () => {
  const env = setup();
  try {
    const prepared = env.controller.prepare({ commandId: 'tg:prepare:gate', workflow: 'research_and_story', runId: 'run_research_201', input: { episode_id: 'EP4' } });
    env.controller.approveKickoff({ commandId: 'tg:kickoff:gate', runId: prepared.run_id, packetSha256: prepared.kickoff_packet_sha256 });
    env.controller.startTask({ runId: prepared.run_id, taskId: 'research_story', workerId: 'herresearch:1' });
    const waiting = env.controller.completeTask({ runId: prepared.run_id, candidate: artifactResult(path.join(env.root, 'artifacts'), prepared.run_id, 'research_story', 'production-brief.json') });
    const approved = env.controller.approveGate({ commandId: 'tg:story-lock:1', runId: prepared.run_id, gateId: 'story_lock', packetSha256: waiting.packet_sha256 });
    assert.strictEqual(approved.state.status, 'completed');
    const duplicate = env.controller.approveGate({ commandId: 'tg:story-lock:1', runId: prepared.run_id, gateId: 'story_lock', packetSha256: waiting.packet_sha256 });
    assert.strictEqual(duplicate.status, 'duplicate');
    assert.strictEqual(duplicate.state.revision, approved.state.revision);
  } finally { env.controller.close(); fs.rmSync(env.root, { recursive: true, force: true }); }
});

test('social preparation accepts only a video handoff bound to the approved research brief', () => {
  const env = setup();
  try {
    const brief = { schema_version: 'sdtk.marketing-handoff.v1', workflow: 'research_and_story', episode_id: 'EP4', revision: 'r1', validation_status: 'pass', approval: { gate: 'story_lock', status: 'approved', artifact_sha256: 'a'.repeat(64) } };
    const video = { schema_version: 'sdtk.marketing-handoff.v1', workflow: 'video_production', episode_id: 'EP4', revision: 'r1', validation_status: 'pass', approval: { gate: 'picture_lock', status: 'approved', artifact_sha256: 'b'.repeat(64) }, inputs: [{ sha256: 'a'.repeat(64) }] };
    const prepared = env.controller.prepare({ commandId: 'tg:social:1', workflow: 'social_distribution', runId: 'run_social_300', input: { brief, video } });
    assert.strictEqual(prepared.status, 'awaiting_kickoff');
    assert.throws(() => env.controller.prepare({ commandId: 'tg:social:2', workflow: 'social_distribution', runId: 'run_social_301', input: { brief, video: { ...video, inputs: [] } } }), /bound to approved research brief/);
  } finally { env.controller.close(); fs.rmSync(env.root, { recursive: true, force: true }); }
});

test('owner gate rejection is durable and idempotent without deleting the submitted artifacts', () => {
  const env = setup();
  try {
    const prepared = env.controller.prepare({ commandId: 'tg:prepare:reject', workflow: 'research_and_story', runId: 'run_research_202', input: { episode_id: 'EP4' } });
    env.controller.approveKickoff({ commandId: 'tg:kickoff:reject', runId: prepared.run_id, packetSha256: prepared.kickoff_packet_sha256 });
    env.controller.startTask({ runId: prepared.run_id, taskId: 'research_story', workerId: 'herresearch:1' });
    const candidate = artifactResult(path.join(env.root, 'artifacts'), prepared.run_id, 'research_story', 'production-brief.json');
    const waiting = env.controller.completeTask({ runId: prepared.run_id, candidate });
    const rejected = env.controller.rejectGate({ commandId: 'tg:reject:1', runId: prepared.run_id, gateId: 'story_lock', reasonCode: 'CLAIM_EVIDENCE_MISSING' });
    assert.strictEqual(rejected.state.status, 'rejected');
    assert.ok(fs.existsSync(path.join(env.root, 'artifacts', prepared.run_id, 'production-brief.json')));
    const duplicate = env.controller.rejectGate({ commandId: 'tg:reject:1', runId: prepared.run_id, gateId: 'story_lock', reasonCode: 'CLAIM_EVIDENCE_MISSING' });
    assert.strictEqual(duplicate.status, 'duplicate');
    assert.strictEqual(duplicate.state.revision, rejected.state.revision);
    assert.notStrictEqual(waiting.packet_sha256, '');
  } finally { env.controller.close(); fs.rmSync(env.root, { recursive: true, force: true }); }
});

test('owner cancellation records one event and a repeated Telegram command is a no-op', () => {
  const env = setup();
  try {
    const prepared = env.controller.prepare({ commandId: 'tg:prepare:cancel', workflow: 'research_and_story', runId: 'run_research_203', input: { episode_id: 'EP4' } });
    const cancelled = env.controller.cancel({ commandId: 'tg:cancel:1', runId: prepared.run_id });
    assert.strictEqual(cancelled.status, 'cancelled');
    assert.strictEqual(cancelled.state.status, 'cancelled');
    const duplicate = env.controller.cancel({ commandId: 'tg:cancel:1', runId: prepared.run_id });
    assert.strictEqual(duplicate.status, 'duplicate');
    assert.strictEqual(duplicate.state.revision, cancelled.state.revision);
  } finally { env.controller.close(); fs.rmSync(env.root, { recursive: true, force: true }); }
});

test('failed worker evidence blocks the run and never opens an owner gate', () => {
  const env = setup();
  try {
    const handoff = { schema_version: 'sdtk.marketing-handoff.v1', workflow: 'research_and_story', episode_id: 'EP4', revision: 'r1', validation_status: 'pass', approval: { gate: 'story_lock', status: 'approved', artifact_sha256: 'a'.repeat(64) } };
    const runId = 'run_video_failed_1';
    env.controller.prepare({ commandId: 'tg:video:failed', workflow: 'video_production', runId, input: handoff });
    env.controller.startTask({ runId, taskId: 'capture_assets', workerId: 'hervid:1' });
    const result = artifactResult(path.join(env.root, 'artifacts'), runId, 'capture_assets', 'capture-failure.json');
    result.status = 'failed';
    result.validation.status = 'fail';
    result.error = { error_class: 'TOOL_DEFECT' };
    const blocked = env.controller.completeTask({ runId, candidate: result });
    assert.strictEqual(blocked.packet_sha256, null);
    assert.strictEqual(blocked.state.status, 'blocked');
    assert.strictEqual(blocked.state.waiting_gate, undefined);
    assert.strictEqual(blocked.state.tasks.capture_assets.status, 'failed');
    assert.strictEqual(blocked.state.tasks.capture_assets.error_class, 'TOOL_DEFECT');
    assert.match(blocked.state.tasks.capture_assets.envelope_sha256, /^[a-f0-9]{64}$/);
  } finally { env.controller.close(); fs.rmSync(env.root, { recursive: true, force: true }); }
});
