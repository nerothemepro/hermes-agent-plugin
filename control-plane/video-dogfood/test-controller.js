'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const test = require('node:test');

const {
  amendCaptureContract,
  closeDefect,
  inspectRun,
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
  assert.throws(() => parseArgs(['capture', 'amend', '--run-id', 'run_controller_abc123', '--story-sha', 'a'.repeat(64), '--confirm', '--instruction', 'free text']), /unknown or incomplete/);
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
