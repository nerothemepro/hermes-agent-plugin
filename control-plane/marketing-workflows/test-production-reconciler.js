'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const test = require('node:test');
const { MarketingWorkflowController } = require('./controller');
const { resolveEpisodeSeed } = require('./episode-seeds');
const { finalizeResearchBrief } = require('./research-finalizer');
const { ResearchProductionReconciler, ProductionReconciler } = require('./production-reconciler');

function setup() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'marketing-production-reconcile-'));
  const controller = new MarketingWorkflowController({ databaseFile: path.join(root, 'state.sqlite'), artifactRoot: path.join(root, 'artifacts') });
  const runId = 'run_mkt_reconcile001';
  const seed = resolveEpisodeSeed('EP4');
  const prepared = controller.prepare({ commandId: 'test:prepare', workflow: 'research_and_story', runId, input: seed });
  controller.approveKickoff({ commandId: 'test:kickoff', runId, packetSha256: prepared.kickoff_packet_sha256 });
  controller.registerExternalTask({ runId, taskId: 'research_story', attempt: 1, nativeTaskId: 't_research_001', idempotencyKey: 'sdtk-marketing:run_mkt_reconcile001:research_story:1', board: 'default' });
  controller.releaseExternalTask({ runId, taskId: 'research_story', attempt: 1, nativeTaskId: 't_research_001' });
  const runRoot = path.join(root, 'artifacts', runId);
  fs.mkdirSync(runRoot, { recursive: true });
  fs.writeFileSync(path.join(runRoot, 'episode-seed.json'), JSON.stringify(seed, null, 2) + '\n');
  return { root, controller, runId, seed, runRoot };
}

function writeCandidate(env) {
  const brief = {
    schema_version: 'sdtk.marketing-production-brief.v1', episode_id: env.seed.episode_id, revision: env.seed.revision,
    audience: env.seed.audience, pain_point: env.seed.pain_point, hook: 'A raw customer request is not a reviewable plan.',
    narration: 'Use the approved requirement to make decisions and handoffs visible before implementation.', cta: env.seed.cta,
    shot_list: [{ id: 'shot_1', visual: 'real requirement evidence' }], claim_ledger: [{ claim: 'The workflow has a human review gate.', status: 'supported', evidence: 'episode-seed.json' }], evidence: ['episode-seed.json'],
  };
  fs.writeFileSync(path.join(env.runRoot, 'production-brief.json'), JSON.stringify(brief, null, 2) + '\n');
  finalizeResearchBrief({ root: env.runRoot, runId: env.runId, attempt: 1, seed: env.seed });
}

function nativeClient(calls) {
  return { run(argv) {
    calls.push(argv);
    if (argv.includes('show')) return { returncode: 0, stdout: JSON.stringify({ task: { id: 't_research_001', assignee: 'herresearch', status: 'done' } }), stderr: '' };
    if (argv.includes('complete')) return { returncode: 0, stdout: '', stderr: '' };
    throw new Error('unexpected native command');
  } };
}

test('production reconciler bridges only a valid mapped HerResearch candidate into Story Lock', () => {
  const env = setup(); const calls = [];
  try {
    writeCandidate(env);
    const result = new ResearchProductionReconciler({ controller: env.controller, client: nativeClient(calls), profileHome: '/opt/data/hermes-profiles/herresearch', board: 'default' }).reconcile(env.runId);
    assert.strictEqual(result.status, 'bridged');
    assert.strictEqual(result.state.waiting_gate, 'story_lock');
    assert.ok(calls.some((argv) => argv.includes('complete')));
  } finally { env.controller.close(); fs.rmSync(env.root, { recursive: true, force: true }); }
});

test('production reconciler leaves a released task untouched until its canonical candidate exists', () => {
  const env = setup(); const calls = [];
  try {
    const result = new ResearchProductionReconciler({ controller: env.controller, client: nativeClient(calls), profileHome: '/opt/data/hermes-profiles/herresearch', board: 'default' }).reconcile(env.runId);
    assert.strictEqual(result.status, 'pending_candidate');
    assert.strictEqual(env.controller.status(env.runId).tasks.research_story.status, 'external_released');
    assert.strictEqual(calls.length, 0);
  } finally { env.controller.close(); fs.rmSync(env.root, { recursive: true, force: true }); }
});


test('generic production reconciler bridges only the mapped HerVid capture candidate into Asset Lock', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'marketing-video-production-reconcile-'));
  const controller = new MarketingWorkflowController({ databaseFile: path.join(root, 'state.sqlite'), artifactRoot: path.join(root, 'artifacts') });
  const runId = 'run_mkt_video_reconcile001';
  const brief = {
    schema_version: 'sdtk.marketing-handoff.v1', episode_id: 'EP4', revision: 'r1', workflow: 'research_and_story', validation_status: 'pass',
    approval: { gate: 'story_lock', status: 'approved', artifact_sha256: 'a'.repeat(64) },
    outputs: [{ path: 'research/production-brief.json', sha256: 'b'.repeat(64), media_type: 'application/json' }],
  };
  const calls = [];
  const client = { run(argv) {
    calls.push(argv);
    if (argv.includes('show')) return { returncode: 0, stdout: JSON.stringify({ task: { id: 't_video_reconcile_001', assignee: 'hervid', status: 'done' } }), stderr: '' };
    if (argv.includes('complete')) return { returncode: 0, stdout: '', stderr: '' };
    throw new Error('unexpected native command');
  } };
  try {
    const prepared = controller.prepare({ commandId: 'test:video:prepare', workflow: 'video_production', runId, input: brief });
    controller.approveKickoff({ commandId: 'test:video:kickoff', runId, packetSha256: prepared.kickoff_packet_sha256 });
    controller.registerExternalTask({ runId, taskId: 'capture_assets', attempt: 1, nativeTaskId: 't_video_reconcile_001', idempotencyKey: 'sdtk-marketing:run_mkt_video_reconcile001:capture_assets:1', board: 'default' });
    controller.releaseExternalTask({ runId, taskId: 'capture_assets', attempt: 1, nativeTaskId: 't_video_reconcile_001' });
    const runRoot = path.join(root, 'artifacts', runId);
    fs.mkdirSync(runRoot, { recursive: true });
    const digest = (bytes) => require('crypto').createHash('sha256').update(bytes).digest('hex');
    const capture = Buffer.from('real screen recording\n');
    const receipt = Buffer.from('sdtk usage --json\nexit=0\n');
    fs.writeFileSync(path.join(runRoot, 'capture.mp4'), capture);
    fs.writeFileSync(path.join(runRoot, 'capture-command.txt'), receipt);
    const manifest = Buffer.from(JSON.stringify({
      schema_version: 'sdtk.marketing-capture-manifest.v1', run_id: runId, task_id: 'capture_assets', capture_mode: 'real_product_evidence',
      privacy: { status: 'pass' }, truth_boundary: { product_behavior: 'real', generated_visuals: false, fabricated_product_behavior: false },
      captures: [{ artifact_path: 'capture.mp4', sha256: digest(capture), kind: 'screen_recording', viewport: { width: 1920, height: 1080 } }],
      command_receipts: [{ artifact_path: 'capture-command.txt', sha256: digest(receipt), exit_code: 0 }],
    }) + '\n');
    fs.writeFileSync(path.join(runRoot, 'capture-manifest.json'), manifest);
    const artifacts = [
      { path: 'capture.mp4', sha256: digest(capture), media_type: 'video/mp4' },
      { path: 'capture-command.txt', sha256: digest(receipt), media_type: 'text/plain' },
      { path: 'capture-manifest.json', sha256: digest(manifest), media_type: 'application/json' },
    ];
    fs.writeFileSync(path.join(runRoot, 'worker-result.json'), JSON.stringify({ schema_version: 'sdtk.video-task-result.v1', run_id: runId, task_id: 'capture_assets', attempt: 1, status: 'completed', artifacts, validation: { status: 'pass', validator: 'capture-manifest-r1', evidence: ['capture-manifest.json'] }, summary: 'Real capture manifest ready for owner review', error: null }, null, 2) + '\n');
    const result = new ProductionReconciler({ controller, client, workflow: 'video_production', profileHome: '/opt/data/hermes-profiles/hervid', board: 'default', assignee: 'hervid' }).reconcile(runId);
    assert.strictEqual(result.status, 'bridged');
    assert.strictEqual(result.state.waiting_gate, 'asset_lock');
    assert.ok(calls.some((argv) => argv.includes('complete')));
  } finally { controller.close(); fs.rmSync(root, { recursive: true, force: true }); }
});
