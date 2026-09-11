'use strict';

const assert = require('assert');
const childProcess = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const test = require('node:test');
const { MarketingWorkflowController } = require('./controller');
const { NativeKanbanAdapter } = require('./native-kanban-adapter');
const { finalizeTaskResult } = require('./result-contract');
const { resolveEpisodeSeed } = require('./episode-seeds');

function setup() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'marketing-native-kanban-'));
  return {
    root,
    controller: new MarketingWorkflowController({ databaseFile: path.join(root, 'state.sqlite'), artifactRoot: path.join(root, 'artifacts') }),
  };
}

function approvedBrief() {
  return {
    schema_version: 'sdtk.marketing-handoff.v1', episode_id: 'EP4', revision: 'r1', workflow: 'research_and_story', validation_status: 'pass',
    approval: { gate: 'story_lock', status: 'approved', artifact_sha256: 'a'.repeat(64) },
    outputs: [{ path: 'research/production-brief.json', sha256: 'c'.repeat(64), media_type: 'application/json' }],
  };
}


test('Workflow A materializes the full allowlisted episode scope in the HerResearch workspace', () => {
  const env = setup();
  const client = { run(argv) {
    if (argv.includes('create')) return { returncode: 0, stdout: JSON.stringify({ id: 't_research_001', status: 'blocked', assignee: 'herresearch' }), stderr: '' };
    if (argv.includes('unblock')) return { returncode: 0, stdout: '', stderr: '' };
    if (argv.includes('dispatch')) return { returncode: 0, stdout: JSON.stringify({ spawned: ['t_research_001'] }), stderr: '' };
    throw new Error('unexpected command');
  } };
  try {
    const seed = resolveEpisodeSeed('EP4');
    const prepared = env.controller.prepare({ commandId: 'telegram:workflow-a-scope', workflow: 'research_and_story', runId: 'run_mkt_research001', input: seed });
    env.controller.approveKickoff({ commandId: 'telegram:workflow-a-scope-approve', runId: prepared.run_id, packetSha256: prepared.kickoff_packet_sha256 });
    new NativeKanbanAdapter({ controller: env.controller, client, workflow: 'research_and_story', profileHome: '/opt/data/hermes-profiles/herresearch', board: 'marketing-research-staging', assignee: 'herresearch' }).dispatchReadyTask({ runId: prepared.run_id });
    const artifactRoot = path.join(env.root, 'artifacts', prepared.run_id);
    const instructions = fs.readFileSync(path.join(artifactRoot, 'research-instructions.md'), 'utf8');
    const template = JSON.parse(fs.readFileSync(path.join(artifactRoot, 'production-brief.template.json'), 'utf8'));
    const capturePlan = JSON.parse(fs.readFileSync(path.join(artifactRoot, 'capture-plan.json'), 'utf8'));
    const assemblyPlan = JSON.parse(fs.readFileSync(path.join(artifactRoot, 'assembly-plan.json'), 'utf8'));
    assert.match(instructions, /Solo founders, product managers, and technical leads/);
    assert.match(instructions, /reviewable, traceable implementation plan/);
    assert.match(instructions, /sdtk-spec to SDTK-WIKI Kanban to sdtk-code/);
    assert.match(instructions, /No unmeasured productivity/);
    assert.match(instructions, /research-finalizer-cli.js/);
    assert.match(instructions, /not open-ended discovery/);
    assert.match(instructions, /Evidence invariant: evidence must remain exactly/);
    assert.match(instructions, /Do not call web, browser, terminal repository search/);
    assert.strictEqual(template.audience, seed.audience);
    assert.strictEqual(template.pain_point, seed.pain_point);
    assert.deepStrictEqual(template.evidence, ['episode-seed.json']);
    assert.strictEqual(capturePlan.runner_id, 'ep4_spec_workflow_demo');
    assert.deepStrictEqual(capturePlan, seed.capture_plan);
    assert.deepStrictEqual(assemblyPlan, seed.assembly_plan);
    assert.match(instructions, /capture-plan\.json and assembly-plan\.json are controller-owned and immutable/);
  } finally { env.controller.close(); fs.rmSync(env.root, { recursive: true, force: true }); }
});

test('native Kanban adapter creates one blocked HerVid card with a deterministic idempotency key before release and dispatch', () => {
  const env = setup();
  const calls = [];
  const client = {
    run(argv, options) {
      calls.push({ argv, options });
      if (argv.includes('create')) return { returncode: 0, stdout: JSON.stringify({ id: 't_video_001', status: 'blocked', assignee: 'hervid' }), stderr: '' };
      if (argv.includes('unblock')) return { returncode: 0, stdout: 'Unblocked t_video_001\n', stderr: '' };
      if (argv.includes('dispatch')) return { returncode: 0, stdout: JSON.stringify({ spawned: [{ task_id: 't_video_001', assignee: 'hervid', workspace: '/tmp/smoke' }] }), stderr: '' };
      throw new Error('unexpected command');
    },
  };
  try {
    const prepared = env.controller.prepare({ commandId: 'telegram:601', workflow: 'video_production', runId: 'run_mkt_video001', input: approvedBrief() });
    env.controller.approveKickoff({ commandId: 'telegram:602', runId: prepared.run_id, packetSha256: prepared.kickoff_packet_sha256 });
    const adapter = new NativeKanbanAdapter({
      controller: env.controller,
      client,
      hermesBin: '/workspace/.venvs/hermes-agent/bin/hermes',
      profileHome: '/opt/data/hermes-profiles/hervid',
      board: 'marketing-video-staging',
    });

    const dispatched = adapter.dispatchReadyTask({ runId: prepared.run_id });

    assert.strictEqual(dispatched.native_task_id, 't_video_001');
    const state = env.controller.status(prepared.run_id);
    assert.strictEqual(state.status, 'external_pending');
    assert.deepStrictEqual(state.tasks.capture_assets, {
      status: 'external_released', attempt: 1, native_task_id: 't_video_001',
      idempotency_key: 'sdtk-marketing:run_mkt_video001:capture_assets:1', board: 'marketing-video-staging',
    });
    assert.deepStrictEqual(calls.map((entry) => entry.argv.slice(0, 5)), [
      ['/workspace/.venvs/hermes-agent/bin/hermes', 'kanban', '--board', 'marketing-video-staging', 'create'],
      ['/workspace/.venvs/hermes-agent/bin/hermes', 'kanban', '--board', 'marketing-video-staging', 'unblock'],
      ['/workspace/.venvs/hermes-agent/bin/hermes', 'kanban', '--board', 'marketing-video-staging', 'dispatch'],
    ]);
    assert.strictEqual(calls[0].argv[calls[0].argv.indexOf('--idempotency-key') + 1], 'sdtk-marketing:run_mkt_video001:capture_assets:1');
    assert.strictEqual(calls[0].argv[calls[0].argv.indexOf('--initial-status') + 1], 'blocked');
    assert.strictEqual(calls[0].options.env.HERMES_HOME, '/opt/data/hermes-profiles/hervid');
    assert.strictEqual(calls[0].options.env.HERMES_KANBAN_HOME, '/opt/data/hermes');
    assert.ok(!calls[1].argv.includes('--json'));
    assert.ok(calls[2].argv.includes('--json'));
    const handoffPath = path.join(env.root, 'artifacts', prepared.run_id, 'approved-handoff.json');
    assert.deepStrictEqual(JSON.parse(fs.readFileSync(handoffPath, 'utf8')), approvedBrief());
    const taskBody = calls[0].argv[calls[0].argv.indexOf('--body') + 1];
    assert.ok(taskBody.includes(handoffPath));
    assert.match(taskBody, /real, reproducible product evidence/);
    assert.match(taskBody, /capture-manifest\.json/);
    assert.match(taskBody, /video-finalizer-cli\.js/);
    assert.match(taskBody, /Do not generate substitute screens/);
  } finally {
    env.controller.close();
    fs.rmSync(env.root, { recursive: true, force: true });
  }
});

test('native Kanban adapter preserves a registered native card after dispatch fails and does not create a duplicate on recovery', () => {
  const env = setup();
  let createCount = 0;
  let dispatchAttempt = 0;
  const client = {
    run(argv) {
      if (argv.includes('create')) {
        createCount += 1;
        return { returncode: 0, stdout: JSON.stringify({ id: 't_video_002', status: 'blocked', assignee: 'hervid' }), stderr: '' };
      }
      if (argv.includes('unblock')) return { returncode: 0, stdout: 'Unblocked t_video_002\n', stderr: '' };
      if (argv.includes('dispatch')) {
        dispatchAttempt += 1;
        return dispatchAttempt === 1
          ? { returncode: 1, stdout: '', stderr: 'dispatcher unavailable' }
          : { returncode: 0, stdout: JSON.stringify({ spawned: ['t_video_002'] }), stderr: '' };
      }
      throw new Error('unexpected command');
    },
  };
  try {
    const prepared = env.controller.prepare({ commandId: 'telegram:611', workflow: 'video_production', runId: 'run_mkt_video002', input: approvedBrief() });
    env.controller.approveKickoff({ commandId: 'telegram:612', runId: prepared.run_id, packetSha256: prepared.kickoff_packet_sha256 });
    const adapter = new NativeKanbanAdapter({ controller: env.controller, client, profileHome: '/opt/data/hermes-profiles/hervid', board: 'marketing-video-staging' });

    assert.throws(() => adapter.dispatchReadyTask({ runId: prepared.run_id }), /native dispatcher failed/);
    const state = env.controller.status(prepared.run_id);
    assert.strictEqual(state.status, 'external_pending');
    assert.strictEqual(state.tasks.capture_assets.native_task_id, 't_video_002');
    assert.strictEqual(createCount, 1);

    const recovered = adapter.dispatchReadyTask({ runId: prepared.run_id });
    assert.strictEqual(recovered.native_task_id, 't_video_002');
    assert.strictEqual(createCount, 1);
    assert.strictEqual(dispatchAttempt, 2);
  } finally {
    env.controller.close();
    fs.rmSync(env.root, { recursive: true, force: true });
  }
});

test('staging smoke task gives HerVid one deterministic local completion command and emits a valid candidate', () => {
  const env = setup();
  const calls = [];
  const client = { run(argv) {
    calls.push(argv);
    if (argv.includes('create')) return { returncode: 0, stdout: JSON.stringify({ id: 't_video_003', status: 'blocked', assignee: 'hervid' }), stderr: '' };
    if (argv.includes('unblock')) return { returncode: 0, stdout: 'Unblocked t_video_003\n', stderr: '' };
    if (argv.includes('dispatch')) return { returncode: 0, stdout: JSON.stringify({ spawned: [{ task_id: 't_video_003', assignee: 'hervid', workspace: '/tmp/smoke' }] }), stderr: '' };
    throw new Error('unexpected command');
  } };
  try {
    const runId = 'run_smoke_003';
    const prepared = env.controller.prepare({ commandId: 'telegram:701', workflow: 'video_production', runId, input: { ...approvedBrief(), staging_smoke: true } });
    env.controller.approveKickoff({ commandId: 'telegram:702', runId, packetSha256: prepared.kickoff_packet_sha256 });
    const adapter = new NativeKanbanAdapter({ controller: env.controller, client, profileHome: '/opt/data/hermes-profiles/hervid', board: 'marketing-video-staging' });
    adapter.dispatchReadyTask({ runId });
    const body = calls[0][calls[0].indexOf('--body') + 1];
    const match = body.match(/^Run exactly: node (.+)$/m);
    assert.ok(match);
    assert.match(body, /mark this native card complete/);
    childProcess.execFileSync(process.execPath, [match[1]], { stdio: 'pipe' });
    const root = path.join(env.root, 'artifacts', runId);
    const candidate = JSON.parse(fs.readFileSync(path.join(root, 'worker-result.json'), 'utf8'));
    const finalized = finalizeTaskResult(candidate, { root, expected: { run_id: runId, task_id: 'capture_assets', attempt: 1 } });
    assert.strictEqual(finalized.validation_status, 'pass');
    assert.strictEqual(finalized.artifacts[0].path, 'capture_assets-smoke-evidence.txt');
  } finally { env.controller.close(); fs.rmSync(env.root, { recursive: true, force: true }); }
});


test('native Kanban adapter accepts a card already claimed by the gateway only after direct status confirmation', () => {
  const env = setup();
  const calls = [];
  const client = { run(argv) {
    calls.push(argv);
    if (argv.includes('create')) return { returncode: 0, stdout: JSON.stringify({ id: 't_video_004', status: 'blocked', assignee: 'hervid' }), stderr: '' };
    if (argv.includes('unblock')) return { returncode: 0, stdout: '', stderr: '' };
    if (argv.includes('dispatch')) return { returncode: 0, stdout: JSON.stringify({ spawned: [] }), stderr: '' };
    if (argv.includes('show')) return { returncode: 0, stdout: JSON.stringify({ task: { id: 't_video_004', assignee: 'hervid', status: 'done' } }), stderr: '' };
    throw new Error('unexpected command');
  } };
  try {
    const prepared = env.controller.prepare({ commandId: 'telegram:801', workflow: 'video_production', runId: 'run_mkt_video004', input: approvedBrief() });
    env.controller.approveKickoff({ commandId: 'telegram:802', runId: prepared.run_id, packetSha256: prepared.kickoff_packet_sha256 });
    const adapter = new NativeKanbanAdapter({ controller: env.controller, client, profileHome: '/opt/data/hermes-profiles/hervid', board: 'marketing-video-staging' });
    const dispatched = adapter.dispatchReadyTask({ runId: prepared.run_id });
    assert.strictEqual(dispatched.native_task_id, 't_video_004');
    assert.ok(calls.some((argv) => argv.includes('show')));
  } finally { env.controller.close(); fs.rmSync(env.root, { recursive: true, force: true }); }
});


test('native Kanban adapter does not treat a ready card as an acknowledged gateway claim', () => {
  const env = setup();
  const client = { run(argv) {
    if (argv.includes('create')) return { returncode: 0, stdout: JSON.stringify({ id: 't_video_005', status: 'blocked', assignee: 'hervid' }), stderr: '' };
    if (argv.includes('unblock')) return { returncode: 0, stdout: '', stderr: '' };
    if (argv.includes('dispatch')) return { returncode: 0, stdout: JSON.stringify({ spawned: [] }), stderr: '' };
    if (argv.includes('show')) return { returncode: 0, stdout: JSON.stringify({ task: { id: 't_video_005', assignee: 'hervid', status: 'ready' } }), stderr: '' };
    throw new Error('unexpected command');
  } };
  try {
    const prepared = env.controller.prepare({ commandId: 'telegram:811', workflow: 'video_production', runId: 'run_mkt_video005', input: approvedBrief() });
    env.controller.approveKickoff({ commandId: 'telegram:812', runId: prepared.run_id, packetSha256: prepared.kickoff_packet_sha256 });
    const adapter = new NativeKanbanAdapter({ controller: env.controller, client, profileHome: '/opt/data/hermes-profiles/hervid', board: 'marketing-video-staging' });
    assert.throws(() => adapter.dispatchReadyTask({ runId: prepared.run_id }), /native dispatcher did not claim/);
    assert.strictEqual(env.controller.status(prepared.run_id).tasks.capture_assets.status, 'external_released');
  } finally { env.controller.close(); fs.rmSync(env.root, { recursive: true, force: true }); }
});


test('Workflow C creates only a bounded HerSocial preparation card with no publisher command', () => {
  const env = setup(); const calls = [];
  const client = { run(argv) { calls.push(argv); if (argv.includes('create')) return { returncode: 0, stdout: JSON.stringify({ id: 't_social_001', status: 'blocked', assignee: 'hersocial' }), stderr: '' }; if (argv.includes('unblock')) return { returncode: 0, stdout: '', stderr: '' }; if (argv.includes('dispatch')) return { returncode: 0, stdout: JSON.stringify({ spawned: ['t_social_001'] }), stderr: '' }; throw new Error('unexpected command'); } };
  try {
    const brief = approvedBrief();
    const video = { schema_version: 'sdtk.marketing-handoff.v1', episode_id: 'EP4', revision: 'r1', workflow: 'video_production', validation_status: 'pass', approval: { gate: 'picture_lock', status: 'approved', artifact_sha256: 'b'.repeat(64) }, inputs: [{ sha256: brief.approval.artifact_sha256 }] };
    const prepared = env.controller.prepare({ commandId: 'telegram:social:001', workflow: 'social_distribution', runId: 'run_mkt_social001', input: { brief, video } });
    env.controller.approveKickoff({ commandId: 'telegram:social:002', runId: prepared.run_id, packetSha256: prepared.kickoff_packet_sha256 });
    new NativeKanbanAdapter({ controller: env.controller, client, workflow: 'social_distribution', profileHome: '/opt/data/hermes-profiles/hersocial', board: 'marketing-social-staging' }).dispatchReadyTask({ runId: prepared.run_id });
    const body = calls[0][calls[0].indexOf('--body') + 1];
    assert.match(body, /prepare-only social task/);
    assert.match(body, /social-finalizer-cli\.js/);
    assert.match(body, /Do not run any publisher, uploader, scheduler/);
    assert.ok(!/sdtk-marketing video social publish/.test(body));
  } finally { env.controller.close(); fs.rmSync(env.root, { recursive: true, force: true }); }
});


test('Workflow B copies the approved source files and runs capture preflight before creating HerVid work', () => {
  const env = setup();
  const calls = [];
  const sourceRunId = 'run_mkt_source001';
  const sourceRoot = path.join(env.root, 'artifacts', sourceRunId);
  const briefBytes = Buffer.from(JSON.stringify({ schema_version: 'sdtk.marketing-production-brief.v1', episode_id: 'EP4', revision: 'r1', audience: 'founders', pain_point: 'unclear work', hook: 'Trace it.', narration: 'Make it visible.', cta: 'https://sdtk.dev/', shot_list: [{ id: 's1' }], claim_ledger: [{ claim: 'proof' }], evidence: ['episode-seed.json'] }) + '\n');
  const plan = { schema_version: 'sdtk.marketing-capture-plan.v1', episode_id: 'EP4', revision: 'r1', data_classification: 'demo_only', runner_id: 'ep4_spec_workflow_demo', artifacts: { capture: 'captures/ep4-spec-workflow-demo.mp4', receipt: 'receipts/ep4-spec-workflow-demo.txt' }, viewport: { width: 1440, height: 900 } };
  const planBytes = Buffer.from(JSON.stringify(plan) + '\n');
  const assemblyPlan = resolveEpisodeSeed('EP4').assembly_plan;
  const assemblyPlanBytes = Buffer.from(JSON.stringify(assemblyPlan) + '\n');
  fs.mkdirSync(sourceRoot, { recursive: true });
  fs.writeFileSync(path.join(sourceRoot, 'production-brief.json'), briefBytes);
  fs.writeFileSync(path.join(sourceRoot, 'capture-plan.json'), planBytes);
  fs.writeFileSync(path.join(sourceRoot, 'assembly-plan.json'), assemblyPlanBytes);
  const handoff = { schema_version: 'sdtk.marketing-handoff.v1', workflow: 'research_and_story', episode_id: 'EP4', revision: 'r1', validation_status: 'pass', source_run_id: sourceRunId, approval: { gate: 'story_lock', status: 'approved', artifact_sha256: 'a'.repeat(64) }, outputs: [
    { path: 'production-brief.json', sha256: crypto.createHash('sha256').update(briefBytes).digest('hex'), media_type: 'application/json' },
    { path: 'capture-plan.json', sha256: crypto.createHash('sha256').update(planBytes).digest('hex'), media_type: 'application/json' },
    { path: 'assembly-plan.json', sha256: crypto.createHash('sha256').update(assemblyPlanBytes).digest('hex'), media_type: 'application/json' },
  ] };
  const client = { run(argv) { calls.push(argv); if (argv.includes('create')) return { returncode: 0, stdout: JSON.stringify({ id: 't_video_006', status: 'blocked', assignee: 'hervid' }), stderr: '' }; if (argv.includes('unblock')) return { returncode: 0, stdout: '', stderr: '' }; if (argv.includes('dispatch')) return { returncode: 0, stdout: JSON.stringify({ spawned: ['t_video_006'] }), stderr: '' }; throw new Error('unexpected command'); } };
  const preflights = [];
  try {
    const runId = 'run_mkt_video006';
    const prepared = env.controller.prepare({ commandId: 'telegram:901', workflow: 'video_production', runId, input: handoff });
    env.controller.approveKickoff({ commandId: 'telegram:902', runId, packetSha256: prepared.kickoff_packet_sha256 });
    new NativeKanbanAdapter({ controller: env.controller, client, profileHome: '/opt/data/hermes-profiles/hervid', board: 'marketing-video-staging', capturePreflight: (input) => { preflights.push(input); return { status: 'pass' }; } }).dispatchReadyTask({ runId });
    assert.strictEqual(preflights.length, 1);
    assert.strictEqual(calls.filter((argv) => argv.includes('create')).length, 1);
    const targetRoot = path.join(env.root, 'artifacts', runId);
    assert.deepStrictEqual(fs.readFileSync(path.join(targetRoot, 'approved-production-brief.json')), briefBytes);
    assert.deepStrictEqual(fs.readFileSync(path.join(targetRoot, 'approved-capture-plan.json')), planBytes);
    assert.deepStrictEqual(fs.readFileSync(path.join(targetRoot, 'approved-assembly-plan.json')), assemblyPlanBytes);
    assert.match(calls[0][calls[0].indexOf('--body') + 1], /Run exactly: node .*capture-ep4-spec-workflow-demo.js/);
  } finally { env.controller.close(); fs.rmSync(env.root, { recursive: true, force: true }); }
});


test('Workflow B fails before native card creation when a Story Lock handoff lacks the pinned capture plan', () => {
  const env = setup();
  const client = { run() { throw new Error('native create must not be called'); } };
  try {
    const sourceRunId = 'run_mkt_source_missing_plan';
    const sourceRoot = path.join(env.root, 'artifacts', sourceRunId);
    const bytes = Buffer.from('{}\n');
    fs.mkdirSync(sourceRoot, { recursive: true });
    fs.writeFileSync(path.join(sourceRoot, 'production-brief.json'), bytes);
    const handoff = { schema_version: 'sdtk.marketing-handoff.v1', workflow: 'research_and_story', episode_id: 'EP4', revision: 'r1', validation_status: 'pass', source_run_id: sourceRunId, approval: { gate: 'story_lock', status: 'approved', artifact_sha256: 'a'.repeat(64) }, outputs: [{ path: 'production-brief.json', sha256: crypto.createHash('sha256').update(bytes).digest('hex'), media_type: 'application/json' }] };
    const runId = 'run_mkt_video_missing_plan';
    const prepared = env.controller.prepare({ commandId: 'telegram:missing-plan', workflow: 'video_production', runId, input: handoff });
    env.controller.approveKickoff({ commandId: 'telegram:missing-plan-kickoff', runId, packetSha256: prepared.kickoff_packet_sha256 });
    const adapter = new NativeKanbanAdapter({ controller: env.controller, client, profileHome: '/opt/data/hermes-profiles/hervid', board: 'marketing-video-staging' });
    assert.throws(() => adapter.dispatchReadyTask({ runId }), /approved handoff missing capture-plan.json/);
    assert.strictEqual(env.controller.status(runId).tasks.capture_assets, undefined);
  } finally { env.controller.close(); fs.rmSync(env.root, { recursive: true, force: true }); }
});


test('Workflow B assembly card invokes the controller-owned EP4 assembly runner exactly', () => {
  const env = setup();
  try {
    const adapter = new NativeKanbanAdapter({ controller: env.controller, client: { run() { throw new Error('not called'); } }, profileHome: '/opt/data/hermes-profiles/hervid', board: 'marketing-video-staging' });
    const text = adapter._materializeVideoInstructions('run_mkt_assembly_exact', 'assemble_video', 1, { assemblyPlan: { path: '/tmp/approved-assembly-plan.json', sha256: 'a'.repeat(64), runnerPath: '/tmp/assemble-ep4-spec-workflow-demo.js' } }, { path: '/tmp/accepted-capture.json', sha256: 'b'.repeat(64) });
    assert.match(text, /Run exactly: node \/tmp\/assemble-ep4-spec-workflow-demo\.js --root /);
    assert.ok(!/Assemble video-master\.mp4 only from/.test(text));
  } finally { env.controller.close(); fs.rmSync(env.root, { recursive: true, force: true }); }
});
