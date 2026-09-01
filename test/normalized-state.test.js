'use strict';

const assert = require('assert');
const test = require('node:test');
const { normalizeRunState, projectTaskStatus, selectActiveRun } = require('../control-plane/video-self-service/normalized-state');

test('task projection distinguishes dependency wait, owner review, activity, and terminal blockers', () => {
  assert.deepStrictEqual(projectTaskStatus('waiting_for_dependency'), { status: 'PENDING', reason: '' });
  assert.deepStrictEqual(projectTaskStatus('waiting_for_approval'), { status: 'IN_REVIEW', reason: 'awaiting owner approval' });
  assert.deepStrictEqual(projectTaskStatus('running_external'), { status: 'IN_PROGRESS', reason: '' });
  assert.deepStrictEqual(projectTaskStatus('blocked'), { status: 'BLOCKED', reason: 'ledger status: blocked' });
});

test('run normalization emits one classified next action for owner gates and dependency waits', () => {
  const gate = normalizeRunState({
    run_id: 'run_gate_abc123', status: 'waiting_for_approval', waiting_gate_id: 'owner_picture_lock',
    tasks: { owner_picture_lock: { type: 'human_gate', status: 'waiting_for_approval' } },
  });
  assert.strictEqual(gate.status, 'waiting_for_picture_lock');
  assert.strictEqual(gate.blocker_class, 'OWNER_GATE');
  assert.deepStrictEqual(gate.next_action, { action: 'owner_approval_required', gate_id: 'owner_picture_lock' });

  const dependency = normalizeRunState({
    run_id: 'run_wait_abc123', status: 'running',
    tasks: { script: { type: 'task', status: 'waiting_for_dependency' } },
  });
  assert.strictEqual(dependency.status, 'running');
  assert.strictEqual(dependency.blocker_class, null);
  assert.deepStrictEqual(dependency.next_action, { action: 'wait_for_dependencies', task_ids: ['script'] });
});

test('active selection excludes terminal history even when terminal record is newer', () => {
  const selected = selectActiveRun([
    { run_id: 'run_blocked_new', status: 'blocked', updated_at: '2026-09-01T02:00:00Z' },
    { run_id: 'run_running_old', status: 'running', updated_at: '2026-09-01T01:00:00Z' },
  ]);
  assert.strictEqual(selected.run_id, 'run_running_old');
});

test('terminal and malformed states are fail closed', () => {
  const blocked = normalizeRunState({ run_id: 'run_bad_abc123', status: 'blocked', blocker_class: 'TOOL_DEFECT', tasks: {} });
  assert.strictEqual(blocked.terminal, true);
  assert.strictEqual(blocked.blocker_class, 'TOOL_DEFECT');
  assert.deepStrictEqual(blocked.next_action, { action: 'inspect_terminal_blocker', status: 'blocked' });
  assert.throws(() => normalizeRunState(null), /invalid canonical run state/);
  assert.throws(() => normalizeRunState({ status: 'running' }), /invalid canonical run state/);
});
