'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const test = require('node:test');

const {
  amendCaptureContract,
  closeDefect,
  deliverCaptureHandoff,
  executeCommand,
  inspectRun,
  prepareCaptureHandoff,
  parseArgs,
  recommendNext,
  recordDefect,
} = require('./controller');

function fixture(state) {
  const projectPath = fs.mkdtempSync(path.join(os.tmpdir(), 'video-dogfood-controller-'));
  const runId = 'run_controller_abc123';
  const runRoot = path.join(projectPath, '.sdtk', 'agent-runtime', 'runs', runId);
  fs.mkdirSync(runRoot, { recursive: true });
  fs.writeFileSync(path.join(runRoot, 'state.json'), JSON.stringify({ run_id: runId, ...state }, null, 2));
  return { projectPath, runId };
}

test('inspect reports ready dispatch count and roles from canonical ledger', () => {
  const { projectPath, runId } = fixture({
    status: 'running',
    tasks: {
      research_evidence: { type: 'task', role: 'researcher', status: 'ready', attempt: 1 },
      episode_lessons: { type: 'task', role: 'wiki', status: 'ready', attempt: 1 },
      owner_story_lock: { type: 'human_gate', status: 'created' },
    },
  });
  try {
    const result = inspectRun(projectPath, runId);
    assert.strictEqual(result.ready_dispatch_count, 2);
    assert.deepStrictEqual(result.ready_roles, ['researcher', 'wiki']);
    assert.strictEqual(result.owner_gate, null);
  } finally {
    fs.rmSync(projectPath, { recursive: true, force: true });
  }
});

test('next reports the exact owner gate without approving it', () => {
  const { projectPath, runId } = fixture({
    status: 'waiting_for_approval',
    waiting_gate_id: 'owner_story_lock',
    tasks: {
      owner_story_lock: { type: 'human_gate', status: 'waiting_for_approval' },
    },
  });
  try {
    const result = recommendNext(inspectRun(projectPath, runId));
    assert.deepStrictEqual(result, {
      action: 'owner_approval_required',
      gate_id: 'owner_story_lock',
      mutates_state: false,
    });
  } finally {
    fs.rmSync(projectPath, { recursive: true, force: true });
  }
});

test('continue requires explicit confirm and unsupported mutation verbs are rejected', () => {
  assert.throws(() => parseArgs(['continue', '--run-id', 'run_controller_abc123']), /--confirm/);
  assert.throws(() => parseArgs(['approve', '--run-id', 'run_controller_abc123']), /unsupported command/);
  assert.throws(() => parseArgs(['publish', '--run-id', 'run_controller_abc123']), /unsupported command/);
  assert.throws(() => parseArgs(['delete', '--run-id', 'run_controller_abc123']), /unsupported command/);
  const parsed = parseArgs(['continue', '--run-id', 'run_controller_abc123', '--confirm']);
  assert.strictEqual(parsed.confirm, true);
  assert.throws(() => parseArgs(['capture', 'amend', '--run-id', 'run_controller_abc123', '--story-sha', 'a'.repeat(64)]), /requires --confirm/);
  const amended = parseArgs(['capture', 'amend', '--run-id', 'run_controller_abc123', '--story-sha', 'a'.repeat(64), '--confirm']);
  assert.strictEqual(amended.command, 'capture-amend');
  assert.throws(() => parseArgs(['handoff', 'prepare', '--run-id', 'run_controller_abc123']), /requires --confirm/);
  const handoff = parseArgs(['handoff', 'prepare', '--run-id', 'run_controller_abc123', '--confirm']);
  assert.strictEqual(handoff.command, 'handoff-prepare');
  assert.throws(() => parseArgs(['handoff', 'deliver', '--run-id', 'run_controller_abc123']), /requires --confirm/);
  const delivery = parseArgs(['handoff', 'deliver', '--run-id', 'run_controller_abc123', '--confirm']);
  assert.strictEqual(delivery.command, 'handoff-deliver');
  assert.throws(() => parseArgs(['capture', 'amend', '--run-id', 'run_controller_abc123', '--story-sha', 'a'.repeat(64), '--confirm', '--instruction', 'free text']), /unknown or incomplete/);
});

test('handoff prepare executes the controller handoff instead of invoking sdtk-agent', () => {
  const args = parseArgs(['handoff', 'prepare', '--run-id', 'run_controller_abc123', '--confirm']);
  const calls = [];
  const result = executeCommand(args, {
    prepareCaptureHandoff(projectPath, runId) {
      calls.push({ projectPath, runId });
      return { manifest_sha256: 'a'.repeat(64), reused: false };
    },
  });
  assert.deepStrictEqual(calls, [{ projectPath: '/workspace/hermes-agent-plugin', runId: 'run_controller_abc123' }]);
  assert.strictEqual(result.reused, false);
});

test('handoff deliver appends one hash-pinned native comment and is idempotent', () => {
  const args = parseArgs(['handoff', 'deliver', '--run-id', 'run_controller_abc123', '--confirm']);
  const calls = [];
  const result = executeCommand(args, {
    deliverCaptureHandoff(projectPath, runId) {
      calls.push({ projectPath, runId });
      return { task_id: 't_abc123', delivered: true, reused: false };
    },
  });
  assert.deepStrictEqual(calls, [{ projectPath: '/workspace/hermes-agent-plugin', runId: 'run_controller_abc123' }]);
  assert.strictEqual(result.task_id, 't_abc123');
});

test('defect ledger records linked defects and requires closure evidence', () => {
  const projectPath = fs.mkdtempSync(path.join(os.tmpdir(), 'video-dogfood-defects-'));
  try {
    const recorded = recordDefect(projectPath, {
      defect_id: 'DEF-EP2-001', title: 'Blocked run reused', severity: 'P1',
      run_id: 'run_controller_abc123', task_id: 'script_package',
      blocker_class: 'TOOL_DEFECT', next_action: 'Fix terminal semantics',
    }, '2026-08-18T04:00:00Z');
    assert.strictEqual(recorded.status, 'OPEN');
    assert.throws(() => closeDefect(projectPath, 'DEF-EP2-001', ''), /verification/);
    const closed = closeDefect(projectPath, 'DEF-EP2-001', 'node --test: 4 pass', '2026-08-18T05:00:00Z');
    assert.strictEqual(closed.status, 'CLOSED');
    assert.strictEqual(closed.verification, 'node --test: 4 pass');
  } finally {
    fs.rmSync(projectPath, { recursive: true, force: true });
  }
});

test('defect command grammar is bounded and close requires verification', () => {
  const recorded = parseArgs(['defect', 'record', '--project-path', '/tmp/project', '--defect-id', 'DEF-EP2-002', '--title', 'Projector stale', '--severity', 'P1', '--run-id', 'run_controller_abc123', '--task-id', 'episode_render', '--blocker-class', 'TOOL_DEFECT', '--next-action', 'Fix projector']);
  assert.strictEqual(recorded.command, 'defect-record');
  assert.throws(() => parseArgs(['defect', 'close', '--project-path', '/tmp/project', '--defect-id', 'DEF-EP2-002']), /verification/);
  const closed = parseArgs(['defect', 'close', '--project-path', '/tmp/project', '--defect-id', 'DEF-EP2-002', '--verification', 'tests pass']);
  assert.strictEqual(closed.command, 'defect-close');
});


test('capture amendment replaces only failed EP2 capture instruction with audited Story Lock hash', () => {
  const projectPath = fs.mkdtempSync(path.join(os.tmpdir(), 'video-dogfood-amend-'));
  const runId = 'run_controller_abc123';
  const runRoot = path.join(projectPath, '.sdtk', 'agent-runtime', 'runs', runId);
  const reportRoot = path.join(runRoot, 'reports');
  fs.mkdirSync(reportRoot, { recursive: true });
  const reviewed = '# Approved script\n';
  const storySha = require('crypto').createHash('sha256').update(reviewed).digest('hex');
  const oldInstruction = 'old capture contract';
  const state = {
    run_id: runId,
    status: 'blocked',
    tasks: {
      owner_story_lock: { id: 'owner_story_lock', type: 'human_gate', status: 'completed' },
      product_capture: { id: 'product_capture', type: 'task', status: 'failed', params: { instruction: oldInstruction } },
    },
  };
  const workflow = { workflow_id: 'hermes_marketing_video_ep2_r3', stages: [{ id: 'product_capture', type: 'task', params: { instruction: oldInstruction } }] };
  fs.writeFileSync(path.join(runRoot, 'state.json'), JSON.stringify(state, null, 2));
  fs.writeFileSync(path.join(runRoot, 'workflow.json'), JSON.stringify(workflow, null, 2));
  fs.writeFileSync(path.join(reportRoot, 'script_package.controller-reviewed.md'), reviewed);
  fs.writeFileSync(path.join(runRoot, 'events.ndjson'), '');
  try {
    const result = amendCaptureContract(projectPath, runId, storySha, '2026-08-18T04:00:00.000Z');
    const amendedState = JSON.parse(fs.readFileSync(path.join(runRoot, 'state.json'), 'utf8'));
    const amendedWorkflow = JSON.parse(fs.readFileSync(path.join(runRoot, 'workflow.json'), 'utf8'));
    const amendedStage = amendedWorkflow.stages.find((stage) => stage.id === 'product_capture');
    assert.strictEqual(result.task_id, 'product_capture');
    assert.match(amendedState.tasks.product_capture.params.instruction, /dedicated local DEMO DATA fixture/);
    assert.strictEqual(amendedState.tasks.product_capture.params.instruction, amendedStage.params.instruction);
    assert.ok(fs.existsSync(path.join(reportRoot, 'product_capture.contract-amendment.json')));
    assert.match(fs.readFileSync(path.join(runRoot, 'events.ndjson'), 'utf8'), /controller_capture_contract_amended/);
  } finally {
    fs.rmSync(projectPath, { recursive: true, force: true });
  }
});


test('capture handoff delivery uses one marker comment and does not duplicate it', () => {
  const projectPath = fs.mkdtempSync(path.join(os.tmpdir(), 'video-dogfood-delivery-'));
  const runId = 'run_controller_abc123';
  const runRoot = path.join(projectPath, '.sdtk', 'agent-runtime', 'runs', runId);
  fs.mkdirSync(path.join(runRoot, 'artifacts', 'product_capture'), { recursive: true });
  fs.writeFileSync(path.join(runRoot, 'events.ndjson'), '');
  fs.writeFileSync(path.join(runRoot, 'state.json'), JSON.stringify({
    run_id: runId, status: 'running', tasks: { episode_render: { status: 'running_external', external_ids: { hermes_task_id: 't_abc123' } } },
  }));
  fs.writeFileSync(path.join(runRoot, 'artifacts', 'product_capture', 'manifest.json'), JSON.stringify({
    run_id: runId, source_task_id: 'product_capture', data_classification: 'demo_only', assets: [],
  }));
  const calls = [];
  let deliveredComment = '';
  const runner = (_bin, argv) => {
    calls.push(argv);
    if (argv[1] === 'show') return { status: 0, stdout: JSON.stringify({ comments: deliveredComment ? [{ body: deliveredComment }] : [] }) };
    if (argv[1] === 'comment') { deliveredComment = argv[3]; return { status: 0, stdout: '' }; }
    return { status: 1, stdout: '' };
  };
  try {
    const result = deliverCaptureHandoff(projectPath, runId, '2026-08-18T07:00:00.000Z', { commandRunner: runner });
    assert.strictEqual(result.delivered, true);
    assert.strictEqual(calls.length, 2);
    assert.strictEqual(calls[1][1], 'comment');
    assert.match(calls[1][3], /SDTK_CAPTURE_HANDOFF_V1/);
    assert.match(calls[1][3], new RegExp(result.manifest_sha256));
    const retry = deliverCaptureHandoff(projectPath, runId, '2026-08-18T07:01:00.000Z', { commandRunner: runner });
    assert.strictEqual(retry.reused, true);
    assert.strictEqual(calls.length, 3);
    assert.strictEqual(calls[2][1], 'show');
  } finally {
    fs.rmSync(projectPath, { recursive: true, force: true });
  }
});


test('capture handoff fails closed when the canonical manifest omits required terminal output', () => {
  const projectPath = fs.mkdtempSync(path.join(os.tmpdir(), 'video-dogfood-handoff-missing-'));
  const runId = 'run_controller_abc123';
  const runRoot = path.join(projectPath, '.sdtk', 'agent-runtime', 'runs', runId);
  const handoffRoot = path.join(runRoot, 'artifacts', 'product_capture');
  const label = 'DEMO DATA - synthetic fixture only\n';
  const hash = require('crypto').createHash('sha256').update(label).digest('hex');
  fs.mkdirSync(path.join(handoffRoot, 'assets', 'demo_fixture'), { recursive: true });
  fs.writeFileSync(path.join(handoffRoot, 'assets', 'demo_fixture', 'DEMO_DATA.txt'), label);
  fs.writeFileSync(path.join(runRoot, 'events.ndjson'), '');
  fs.writeFileSync(path.join(runRoot, 'state.json'), JSON.stringify({
    run_id: runId,
    tasks: { product_capture: { status: 'completed' }, episode_render: { status: 'ready' } },
  }));
  fs.writeFileSync(path.join(runRoot, 'workflow.json'), JSON.stringify({
    workflow_id: 'hermes_marketing_video_ep2_r3',
    stages: [{ id: 'episode_render', params: { instruction: 'render' } }],
  }));
  fs.writeFileSync(path.join(handoffRoot, 'manifest.json'), JSON.stringify({
    schema_version: 'hermes.video-dogfood.capture-handoff.v1',
    run_id: runId,
    source_task_id: 'product_capture',
    data_classification: 'demo_only',
    exit_code: 0,
    assets: [{ path: 'assets/demo_fixture/DEMO_DATA.txt', sha256: hash, bytes: Buffer.byteLength(label), purpose: 'DEMO DATA label' }],
  }));
  try {
    assert.throws(() => prepareCaptureHandoff(projectPath, runId), /requires terminal table output/);
  } finally {
    fs.rmSync(projectPath, { recursive: true, force: true });
  }
});

test('capture handoff validates worker-written canonical demo assets after scratch is absent', () => {
  const projectPath = fs.mkdtempSync(path.join(os.tmpdir(), 'video-dogfood-handoff-'));
  const runId = 'run_controller_abc123';
  const runRoot = path.join(projectPath, '.sdtk', 'agent-runtime', 'runs', runId);
  const handoffRoot = path.join(runRoot, 'artifacts', 'product_capture');
  const label = 'DEMO DATA - synthetic fixture only\n';
  const table = 'SDTK usage DEMO DATA\n';
  const hash = (value) => require('crypto').createHash('sha256').update(value).digest('hex');
  fs.mkdirSync(path.join(handoffRoot, 'assets', 'demo_fixture'), { recursive: true });
  fs.writeFileSync(path.join(handoffRoot, 'assets', 'demo_fixture', 'DEMO_DATA.txt'), label);
  fs.writeFileSync(path.join(handoffRoot, 'assets', 'capture_table_output.txt'), table);
  const state = {
    run_id: runId,
    status: 'running',
    tasks: {
      product_capture: { id: 'product_capture', type: 'task', status: 'completed' },
      episode_render: { id: 'episode_render', type: 'task', status: 'running_external', params: { instruction: 'render from real captures' } },
    },
  };
  const workflow = { workflow_id: 'hermes_marketing_video_ep2_r3', stages: [{ id: 'episode_render', type: 'task', params: { instruction: 'render from real captures' } }] };
  const manifest = {
    schema_version: 'hermes.video-dogfood.capture-handoff.v1',
    run_id: runId,
    source_task_id: 'product_capture',
    data_classification: 'demo_only',
    command_run: 'sdtk usage --dir demo_fixture/.claude',
    exit_code: 0,
    assets: [
      { path: 'assets/demo_fixture/DEMO_DATA.txt', sha256: hash(label), bytes: Buffer.byteLength(label), purpose: 'DEMO DATA label' },
      { path: 'assets/capture_table_output.txt', sha256: hash(table), bytes: Buffer.byteLength(table), purpose: 'Terminal table output' },
    ],
  };
  fs.writeFileSync(path.join(runRoot, 'state.json'), JSON.stringify(state));
  fs.writeFileSync(path.join(runRoot, 'workflow.json'), JSON.stringify(workflow));
  fs.writeFileSync(path.join(runRoot, 'events.ndjson'), '');
  fs.writeFileSync(path.join(handoffRoot, 'manifest.json'), JSON.stringify(manifest));
  try {
    const result = prepareCaptureHandoff(projectPath, runId, '2026-08-18T06:00:00.000Z');
    const amended = JSON.parse(fs.readFileSync(path.join(runRoot, 'state.json'), 'utf8'));
    assert.strictEqual(result.reused, false);
    assert.strictEqual(result.asset_count, 2);
    assert.match(amended.tasks.episode_render.params.instruction, new RegExp(result.manifest_sha256));
  } finally {
    fs.rmSync(projectPath, { recursive: true, force: true });
  }
});
