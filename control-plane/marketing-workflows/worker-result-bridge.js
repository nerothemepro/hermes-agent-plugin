'use strict';

const fs = require('fs');
const path = require('path');
const { finalizeTaskResult } = require('./result-contract');

const NATIVE_TASK = /^t_[a-z0-9_]+$/;

function requireText(value, name) {
  const result = String(value || '').trim();
  if (!result) throw new Error(`${name} is required`);
  return result;
}

function parseJson(stdout, label) {
  try { return JSON.parse(String(stdout || '')); } catch { throw new Error(`${label} returned invalid JSON`); }
}

function containedFile(root, candidate) {
  const base = path.resolve(root);
  const target = path.resolve(candidate);
  if (target === base || !target.startsWith(`${base}${path.sep}`)) throw new Error('candidate file is outside canonical run root');
  if (!fs.existsSync(target) || !fs.lstatSync(target).isFile()) throw new Error('candidate file is unavailable');
  const realBase = fs.realpathSync(base);
  const realTarget = fs.realpathSync(target);
  if (!realTarget.startsWith(`${realBase}${path.sep}`)) throw new Error('candidate file is outside canonical run root');
  return realTarget;
}

class WorkerResultBridge {
  constructor(options) {
    this.controller = options.controller;
    if (!this.controller || typeof this.controller.startTask !== 'function') throw new Error('controller is required');
    this.client = options.client;
    if (!this.client || typeof this.client.run !== 'function') throw new Error('native command client is required');
    this.hermesBin = options.hermesBin || '/workspace/.venvs/hermes-agent/bin/hermes';
    this.profileHome = path.resolve(requireText(options.profileHome, 'profile home'));
    this.board = requireText(options.board, 'board');
    this.workflow = options.workflow || 'video_production';
    this.assignee = options.assignee || require('./workflows').resolveWorkflow(this.workflow).owner;
    if (this.assignee !== require('./workflows').resolveWorkflow(this.workflow).owner) throw new Error('worker bridge assignee does not match workflow owner');
  }

  _env() { return { HERMES_HOME: this.profileHome, HERMES_KANBAN_HOME: '/opt/data/hermes', PATH: process.env.PATH || '' }; }

  _show(nativeTaskId) {
    const result = this.client.run([this.hermesBin, 'kanban', '--board', this.board, 'show', nativeTaskId, '--json'], { env: this._env() });
    if (!result || result.returncode !== 0) throw new Error('native task lookup failed');
    const task = parseJson(result.stdout, 'native task lookup').task;
    if (!task || task.id !== nativeTaskId || task.assignee !== this.assignee) throw new Error('native task identity mismatch');
    return task;
  }

  _completeNative(nativeTaskId, summary) {
    const result = this.client.run([
      this.hermesBin, 'kanban', '--board', this.board, 'complete', nativeTaskId,
      '--result', summary.slice(0, 500),
    ], { env: this._env() });
    if (result && result.returncode === 0) return 'completed';
    const task = this._show(nativeTaskId);
    if (task.status === 'done') return 'already_completed';
    throw new Error('native task completion failed');
  }

  _blockNative(nativeTaskId, reason) {
    const result = this.client.run([
      this.hermesBin, 'kanban', '--board', this.board, 'block', nativeTaskId, reason.slice(0, 500),
    ], { env: this._env() });
    if (result && result.returncode === 0) return 'blocked';
    const task = this._show(nativeTaskId);
    if (task.status === 'blocked') return 'already_blocked';
    throw new Error('native task block failed');
  }

  _candidate(runId, taskId, attempt, candidateFile) {
    const root = path.join(this.controller.artifactRoot, runId);
    const file = containedFile(root, candidateFile);
    let candidate;
    try { candidate = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { throw new Error('candidate result is not valid JSON'); }
    return finalizeTaskResult(candidate, { root, expected: { run_id: runId, task_id: taskId, attempt } });
  }

  submit(input) {
    const runId = requireText(input.runId, 'run id');
    const taskId = requireText(input.taskId, 'task id');
    const nativeTaskId = requireText(input.nativeTaskId, 'native task id');
    if (!NATIVE_TASK.test(nativeTaskId)) throw new Error('invalid native task id');
    const initial = this.controller.status(runId);
    const mapped = initial.tasks[taskId];
    if (!mapped || mapped.native_task_id !== nativeTaskId || mapped.board !== this.board) throw new Error('native task is not the controller-mapped task');
    const finalized = this._candidate(runId, taskId, mapped.attempt, input.candidateFile);
    if (mapped.status === 'completed') {
      if (mapped.envelope_sha256 !== finalized.envelope_sha256) throw new Error('completed task result conflict');
      return { status: 'duplicate', state: initial, result: finalized, native_completion: this._completeNative(nativeTaskId, finalized.summary) };
    }
    const native = this._show(nativeTaskId);
    if (!['running', 'ready', 'done'].includes(native.status)) throw new Error('native task is not eligible for result submission');
    if (mapped.status === 'external_released') {
      this.controller.startTask({ runId, taskId, workerId: `native:hervid:${nativeTaskId}`, attempt: mapped.attempt, ttlMs: 30000 });
    }
    const running = this.controller.status(runId).tasks[taskId];
    if (running.status !== 'running') throw new Error('controller task is not running');
    const completed = this.controller.completeTask({ runId, candidate: JSON.parse(fs.readFileSync(containedFile(path.join(this.controller.artifactRoot, runId), input.candidateFile), 'utf8')) });
    if (completed.result.status === 'failed') {
      return { status: 'failed', state: completed.state, result: completed.result, packet_sha256: null, native_completion: this._blockNative(nativeTaskId, completed.result.summary) };
    }
    return { status: 'completed', state: completed.state, result: completed.result, packet_sha256: completed.packet_sha256, native_completion: this._completeNative(nativeTaskId, completed.result.summary) };
  }
}

module.exports = { WorkerResultBridge, containedFile };
