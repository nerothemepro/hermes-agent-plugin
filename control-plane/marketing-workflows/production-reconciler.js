'use strict';

const fs = require('fs');
const path = require('path');
const { WorkerResultBridge } = require('./worker-result-bridge');

function required(value, name) {
  const result = String(value || '').trim();
  if (!result) throw new Error(name + ' is required');
  return result;
}

class ResearchProductionReconciler {
  constructor(options) {
    if (!options?.controller || typeof options.controller.status !== 'function') throw new Error('controller is required');
    this.controller = options.controller;
    this.client = options.client;
    if (!this.client || typeof this.client.run !== 'function') throw new Error('native command client is required');
    this.hermesBin = options.hermesBin || '/workspace/.venvs/hermes-agent/bin/hermes';
    this.profileHome = path.resolve(required(options.profileHome, 'profile home'));
    this.board = required(options.board, 'board');
  }

  candidatePath(runId) {
    return path.join(this.controller.artifactRoot, required(runId, 'run id'), 'worker-result.json');
  }

  reconcile(runIdValue) {
    const runId = required(runIdValue, 'run id');
    const state = this.controller.status(runId);
    if (state.workflow !== 'research_and_story') return { status: 'ignored_workflow', state };
    const task = state.tasks.research_story;
    if (!task) return { status: 'not_released', state };
    if (task.status === 'completed') return { status: 'already_completed', state };
    if (task.status !== 'external_released') return { status: 'not_released', state };
    const candidateFile = this.candidatePath(runId);
    if (!fs.existsSync(candidateFile) || !fs.lstatSync(candidateFile).isFile()) return { status: 'pending_candidate', state };
    try {
      const result = new WorkerResultBridge({
        controller: this.controller,
        client: this.client,
        hermesBin: this.hermesBin,
        profileHome: this.profileHome,
        board: this.board,
        workflow: 'research_and_story',
        assignee: 'herresearch',
      }).submit({ runId, taskId: 'research_story', nativeTaskId: task.native_task_id, candidateFile });
      return { ...result, status: result.status === 'completed' ? 'bridged' : result.status };
    } catch (error) {
      return { status: 'invalid_candidate', state: this.controller.status(runId), error: error.message };
    }
  }
}

module.exports = { ResearchProductionReconciler };
