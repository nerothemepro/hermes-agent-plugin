'use strict';

const path = require('path');
const { resolveWorkflow } = require('./workflows');

const BOARD = /^[a-z0-9][a-z0-9-]{2,63}$/;
const NATIVE_TASK = /^t_[a-z0-9_]+$/;

function requireText(value, name) {
  const result = String(value || '').trim();
  if (!result) throw new Error(`${name} is required`);
  return result;
}

function parseJson(stdout, label) {
  try { return JSON.parse(String(stdout || '')); } catch { throw new Error(`${label} returned invalid JSON`); }
}

function nativeTaskId(payload) {
  const id = payload?.id || payload?.task?.id;
  if (!NATIVE_TASK.test(String(id || ''))) throw new Error('native create did not return a bounded task id');
  return String(id);
}

class NativeKanbanAdapter {
  constructor(options) {
    this.controller = options.controller;
    if (!this.controller || typeof this.controller.nextTask !== 'function') throw new Error('controller is required');
    this.client = options.client;
    if (!this.client || typeof this.client.run !== 'function') throw new Error('native command client is required');
    this.hermesBin = options.hermesBin || '/workspace/.venvs/hermes-agent/bin/hermes';
    this.profileHome = path.resolve(requireText(options.profileHome, 'profile home'));
    this.board = requireText(options.board, 'board');
    if (!BOARD.test(this.board)) throw new Error('invalid staging board');
    if (this.profileHome !== '/opt/data/hermes-profiles/hervid') throw new Error('native video adapter requires the hervid profile home');
  }

  _env() {
    return { HERMES_HOME: this.profileHome, HERMES_KANBAN_HOME: this.profileHome, PATH: process.env.PATH || '' };
  }

  _run(argv) {
    const result = this.client.run(argv, { env: this._env() });
    if (!result || !Number.isInteger(result.returncode)) throw new Error('native command returned an invalid result');
    return result;
  }

  _assertOk(result, action) {
    if (result.returncode !== 0) throw new Error(`native ${action} failed`);
    return result;
  }

  _key(runId, taskId, attempt) {
    return `sdtk-marketing:${runId}:${taskId}:${attempt}`;
  }

  _taskBody(runId, taskId, attempt) {
    const artifactRoot = path.join(this.controller.artifactRoot, runId);
    return [
      'Controller-owned Workflow B staging task.',
      `Run: ${runId}`,
      `Task: ${taskId} attempt ${attempt}`,
      `Read only the approved handoff and write candidate artifacts under: ${artifactRoot}`,
      `Write exactly one result candidate to: ${path.join(artifactRoot, 'worker-result.json')}`,
      'Use schema sdtk.video-task-result.v1 with hashes for every artifact.',
      'Do not publish, message external services, create child tasks, or mark this native card complete/block directly.',
      'The controller validates the candidate and owns every lifecycle transition.',
    ].join('\n');
  }

  _create(runId, taskId, attempt) {
    const key = this._key(runId, taskId, attempt);
    const result = this._assertOk(this._run([
      this.hermesBin, 'kanban', '--board', this.board, 'create',
      `Workflow B ${runId} ${taskId}`,
      '--assignee', 'hervid',
      '--workspace', `dir:${path.join(this.controller.artifactRoot, runId)}`,
      '--idempotency-key', key,
      '--max-runtime', '2h',
      '--max-retries', '1',
      '--created-by', 'marketing-workflow-controller',
      '--initial-status', 'blocked',
      '--body', this._taskBody(runId, taskId, attempt),
      '--json',
    ]), 'create');
    const payload = parseJson(result.stdout, 'native create');
    if (payload.assignee !== 'hervid' || payload.status !== 'blocked') throw new Error('native create returned an unexpected task identity');
    return { native_task_id: nativeTaskId(payload), idempotency_key: key };
  }

  _unblock(nativeTaskIdValue) {
    this._assertOk(this._run([
      this.hermesBin, 'kanban', '--board', this.board, 'unblock', nativeTaskIdValue,
    ]), 'unblock');
  }

  _dispatch(nativeTaskIdValue) {
    const result = this._assertOk(this._run([
      this.hermesBin, 'kanban', '--board', this.board, 'dispatch', '--max', '1', '--json',
    ]), 'dispatcher');
    const payload = parseJson(result.stdout, 'native dispatcher');
    const spawned = Array.isArray(payload.spawned) ? payload.spawned.map((item) => typeof item === 'string' ? item : item?.id) : [];
    if (!spawned.includes(nativeTaskIdValue)) throw new Error('native dispatcher did not claim the registered task');
  }

  dispatchReadyTask(input) {
    const runId = requireText(input.runId, 'run id');
    const next = this.controller.nextTask(runId);
    const state = next.state;
    if (state.workflow !== 'video_production' || resolveWorkflow(state.workflow).owner !== 'hervid') throw new Error('native adapter supports only Workflow B');
    const taskId = next.task_id;
    if (!taskId) throw new Error('workflow has no ready task');
    let task = state.tasks[taskId];
    let attempt = task?.attempt || 1;
    if (!task) {
      const created = this._create(runId, taskId, attempt);
      this.controller.registerExternalTask({
        runId, taskId, attempt, nativeTaskId: created.native_task_id, idempotencyKey: created.idempotency_key, board: this.board,
      });
      task = this.controller.status(runId).tasks[taskId];
    }
    if (task.status === 'external_registered') {
      this._unblock(task.native_task_id);
      this.controller.releaseExternalTask({ runId, taskId, attempt, nativeTaskId: task.native_task_id });
      task = this.controller.status(runId).tasks[taskId];
    }
    if (task.status !== 'external_released') throw new Error('external task is not releasable');
    this._dispatch(task.native_task_id);
    return { run_id: runId, task_id: taskId, native_task_id: task.native_task_id, attempt, board: this.board };
  }
}

module.exports = { NativeKanbanAdapter };
