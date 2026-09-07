'use strict';

const fs = require('fs');
const path = require('path');
const { WorkerResultBridge } = require('./worker-result-bridge');

function required(value, name) {
  const result = String(value || '').trim();
  if (!result) throw new Error(name + ' is required');
  return result;
}

class ProductionReconciler {
  constructor(options) {
    if (!options?.controller || typeof options.controller.status !== 'function') throw new Error('controller is required');
    this.controller = options.controller;
    this.client = options.client;
    if (!this.client || typeof this.client.run !== 'function') throw new Error('native command client is required');
    this.workflow = required(options.workflow, 'workflow');
    this.assignee = required(options.assignee, 'assignee');
    this.hermesBin = options.hermesBin || '/workspace/.venvs/hermes-agent/bin/hermes';
    this.profileHome = path.resolve(required(options.profileHome, 'profile home'));
    this.board = required(options.board, 'board');
  }

  candidatePath(runId) {
    return path.join(this.controller.artifactRoot, required(runId, 'run id'), 'worker-result.json');
  }

  _pendingTask(state) {
    return Object.entries(state.tasks || {}).find(([, task]) => task && task.status === 'external_released') || null;
  }

  reconcile(runIdValue) {
    const runId = required(runIdValue, 'run id');
    const state = this.controller.status(runId);
    if (state.workflow !== this.workflow) return { status: 'ignored_workflow', state };
    const pending = this._pendingTask(state);
    if (!pending) return { status: state.status === 'completed' ? 'already_completed' : 'not_released', state };
    const [taskId, task] = pending;
    const candidateFile = this.candidatePath(runId);
    if (!fs.existsSync(candidateFile) || !fs.lstatSync(candidateFile).isFile()) return { status: 'pending_candidate', state };
    try {
      const result = new WorkerResultBridge({
        controller: this.controller,
        client: this.client,
        hermesBin: this.hermesBin,
        profileHome: this.profileHome,
        board: this.board,
        workflow: this.workflow,
        assignee: this.assignee,
      }).submit({ runId, taskId, nativeTaskId: task.native_task_id, candidateFile });
      return { ...result, status: result.status === 'completed' ? 'bridged' : result.status };
    } catch (error) {
      return { status: 'invalid_candidate', state: this.controller.status(runId), error: error.message };
    }
  }
}

class ResearchProductionReconciler extends ProductionReconciler {
  constructor(options) {
    super({ ...options, workflow: 'research_and_story', assignee: 'herresearch' });
  }
}

module.exports = { ProductionReconciler, ResearchProductionReconciler };
