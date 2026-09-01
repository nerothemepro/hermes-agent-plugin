'use strict';

const TERMINAL_RUN_STATUSES = new Set(['completed', 'blocked', 'failed', 'cancelled']);
const fs = require('fs');
const ACTIVE_TASK_STATUSES = new Set(['submitted', 'running', 'running_external', 'waiting_external_evidence']);
const DONE_TASK_STATUSES = new Set(['completed', 'skipped']);
const BLOCKED_TASK_STATUSES = new Set(['blocked', 'failed', 'cancelled', 'timed_out', 'timeout']);
const OWNER_GATE_RUN_STATUSES = Object.freeze({
  owner_story_lock: 'waiting_for_story_lock',
  owner_script_review: 'waiting_for_story_lock',
  owner_picture_lock: 'waiting_for_picture_lock',
  owner_publish_approval: 'waiting_for_publish_approval',
  owner_social_review: 'waiting_for_publish_approval',
});

function projectTaskStatus(rawStatus) {
  const status = String(rawStatus || '').trim();
  if (status === 'created' || status === 'ready') return { status: 'TODO', reason: '' };
  if (ACTIVE_TASK_STATUSES.has(status)) return { status: 'IN_PROGRESS', reason: '' };
  if (DONE_TASK_STATUSES.has(status)) return { status: 'DONE', reason: '' };
  if (status === 'waiting_for_approval') return { status: 'IN_REVIEW', reason: 'awaiting owner approval' };
  if (status === 'waiting_for_dependency') return { status: 'PENDING', reason: '' };
  if (BLOCKED_TASK_STATUSES.has(status)) return { status: 'BLOCKED', reason: `ledger status: ${status}` };
  return { status: 'PENDING', reason: `unknown ledger status: ${status || 'missing'}` };
}

function ownerGateId(state, tasks) {
  return state.waiting_gate_id || state.waiting_gate || Object.entries(tasks)
    .find(([, task]) => task && task.type === 'human_gate' && task.status === 'waiting_for_approval')?.[0] || null;
}

function normalizeRunState(state) {
  if (!state || typeof state !== 'object' || typeof state.run_id !== 'string' || !state.tasks || typeof state.tasks !== 'object') {
    throw new Error('invalid canonical run state');
  }
  const rawStatus = String(state.status || state.run_status || '').trim();
  const tasks = state.tasks;
  const entries = Object.entries(tasks);
  const gateId = ownerGateId(state, tasks);
  const active = entries.filter(([, task]) => ACTIVE_TASK_STATUSES.has(String(task?.status || ''))).map(([id]) => id);
  const ready = entries.filter(([, task]) => task?.type !== 'human_gate' && task?.status === 'ready').map(([id]) => id);
  const dependencies = entries.filter(([, task]) => task?.status === 'waiting_for_dependency').map(([id]) => id);
  const terminal = TERMINAL_RUN_STATUSES.has(rawStatus);

  let status = rawStatus;
  let blockerClass = null;
  let nextAction;
  if (terminal) {
    blockerClass = rawStatus === 'completed' || rawStatus === 'cancelled' ? null : state.blocker_class || 'TERMINAL_RUN';
    nextAction = rawStatus === 'completed' || rawStatus === 'cancelled'
      ? { action: 'terminal_no_continue', status: rawStatus }
      : { action: 'inspect_terminal_blocker', status: rawStatus };
  } else if (gateId) {
    status = OWNER_GATE_RUN_STATUSES[gateId] || 'waiting_for_approval';
    blockerClass = 'OWNER_GATE';
    nextAction = { action: 'owner_approval_required', gate_id: gateId };
  } else if (active.length) {
    status = 'running';
    nextAction = { action: 'monitor_active_tasks', task_ids: active };
  } else if (ready.length) {
    status = rawStatus === 'prepared' ? 'awaiting_kickoff' : 'running';
    nextAction = { action: 'owner_confirmed_continue_required', task_ids: ready };
  } else if (dependencies.length) {
    status = 'running';
    nextAction = { action: 'wait_for_dependencies', task_ids: dependencies };
  } else if (rawStatus === 'prepared' || rawStatus === 'awaiting_kickoff') {
    status = 'awaiting_kickoff';
    nextAction = { action: 'owner_kickoff_required' };
  } else {
    status = rawStatus || 'unknown';
    blockerClass = 'STATE_RECONCILIATION';
    nextAction = { action: 'reconcile_readiness' };
  }

  return {
    run_id: state.run_id,
    raw_status: rawStatus || 'unknown',
    status,
    terminal,
    owner_gate: gateId,
    blocker_class: blockerClass,
    next_action: nextAction,
    active_task_ids: active,
    ready_task_ids: ready,
    dependency_task_ids: dependencies,
  };
}

function selectActiveRun(runs) {
  const active = (Array.isArray(runs) ? runs : []).filter((run) => run && !TERMINAL_RUN_STATUSES.has(String(run.status || run.run_status || '')));
  active.sort((a, b) => String(b.updated_at || '').localeCompare(String(a.updated_at || '')) || String(b.run_id || '').localeCompare(String(a.run_id || '')));
  return active[0] || null;
}

module.exports = { ACTIVE_TASK_STATUSES, TERMINAL_RUN_STATUSES, normalizeRunState, projectTaskStatus, selectActiveRun };

if (require.main === module) {
  try {
    const stateFile = process.argv[2];
    if (!stateFile) throw new Error('state file is required');
    const state = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
    process.stdout.write(JSON.stringify(normalizeRunState(state)) + '\n');
  } catch (error) {
    process.stderr.write(`NORMALIZED_STATE_ERROR ${error.message}\n`);
    process.exitCode = 1;
  }
}
