'use strict';

const crypto = require('crypto');
const path = require('path');
const { WorkflowKernel } = require('./kernel');
const { finalizeTaskResult, canonicalJson } = require('./result-contract');
const { resolveWorkflow, validateHandoff } = require('./workflows');

const FLOW = Object.freeze({
  research_and_story: [{ task: 'research_story', gate: 'story_lock', final: true }],
  video_production: [{ task: 'capture_assets', gate: 'asset_lock' }, { task: 'assemble_video', gate: 'picture_lock', final: true }],
  social_distribution: [{ task: 'prepare_social', gate: 'youtube_publish' }, { task: 'publish_youtube', gate: 'facebook_publish' }, { task: 'publish_facebook', gate: 'x_publish' }, { task: 'publish_x', final: true }],
});
const sha256 = (value) => crypto.createHash('sha256').update(value).digest('hex');

class MarketingWorkflowController {
  constructor(options) {
    this.artifactRoot = path.resolve(options.artifactRoot);
    this.kernel = options.kernel || new WorkflowKernel(options.databaseFile);
  }

  close() { this.kernel.close(); }

  prepare(input) {
    const definition = resolveWorkflow(input.workflow);
    if (input.workflow !== 'research_and_story') validateHandoff(input.workflow, input.input);
    const accepted = this.kernel.acceptCommand({ commandId: input.commandId, workflow: input.workflow, runId: input.runId, payload: input.input || {} });
    return { status: accepted.duplicate ? 'duplicate' : 'prepared', run_id: accepted.run_id, workflow: input.workflow, owner: definition.owner };
  }

  _step(state, taskId) {
    const step = FLOW[state.workflow]?.find((candidate) => candidate.task === taskId);
    if (!step) throw new Error('task is not part of workflow');
    return step;
  }

  _expectedTask(state) {
    return FLOW[state.workflow].find((step) => state.tasks[step.task]?.status !== 'completed')?.task || null;
  }

  status(runId) { return this.kernel.currentState(runId); }

  cancel(runId) {
    const state = this.kernel.currentState(runId);
    if (['completed', 'cancelled'].includes(state.status)) return state;
    this.kernel.appendEvent(runId, 'run_cancelled', {}, { expectedRevision: state.revision });
    return this.kernel.currentState(runId);
  }

  startTask(input) {
    const state = this.kernel.currentState(input.runId);
    if (['completed', 'cancelled', 'blocked'].includes(state.status) || state.waiting_gate) throw new Error('run cannot start task');
    const expectedTask = this._expectedTask(state);
    if (input.taskId !== expectedTask) throw new Error(`expected task ${expectedTask}`);
    const step = this._step(state, input.taskId);
    const attempt = Number(input.attempt || 1);
    this.kernel.acquireLease({ runId: input.runId, taskId: input.taskId, attempt, workerId: input.workerId, ttlMs: Number(input.ttlMs || 30000), now: input.now });
    this.kernel.appendEvent(input.runId, 'task_started', { task_id: step.task, attempt }, { expectedRevision: state.revision });
    return { state: this.kernel.currentState(input.runId), owner: resolveWorkflow(state.workflow).owner };
  }

  completeTask(input) {
    const state = this.kernel.currentState(input.runId);
    const taskId = input.candidate?.task_id;
    const step = this._step(state, taskId);
    if (state.tasks[taskId]?.status !== 'running') throw new Error('task is not running');
    const finalized = finalizeTaskResult(input.candidate, { root: path.join(this.artifactRoot, input.runId), expected: { run_id: input.runId, task_id: taskId, attempt: state.tasks[taskId].attempt } });
    const events = [{ type: 'task_completed', payload: { task_id: taskId, attempt: finalized.attempt, envelope_sha256: finalized.envelope_sha256 } }];
    let packetSha = null;
    if (step.gate) {
      packetSha = sha256(canonicalJson({ run_id: input.runId, gate_id: step.gate, artifact_sha256: finalized.envelope_sha256 }));
      events.push({ type: 'gate_waiting', payload: { gate_id: step.gate, packet_sha256: packetSha } });
    } else if (step.final) {
      events.push({ type: 'run_completed', payload: {} });
    }
    this.kernel.appendEvents(input.runId, events, { expectedRevision: state.revision });
    return { state: this.kernel.currentState(input.runId), packet_sha256: packetSha, result: finalized };
  }

  approveGate(input) {
    const state = this.kernel.currentState(input.runId);
    if (state.status !== 'waiting_for_approval' || state.waiting_gate !== input.gateId) throw new Error('run is not waiting for this gate');
    if (state.packet_sha256 !== input.packetSha256) throw new Error('packet sha256 mismatch');
    const steps = FLOW[state.workflow];
    const step = steps.find((candidate) => candidate.gate === input.gateId);
    if (!step) throw new Error('unknown workflow gate');
    const events = [{ type: 'gate_approved', payload: { gate_id: input.gateId, packet_sha256: input.packetSha256 } }];
    if (step.final) events.push({ type: 'run_completed', payload: {} });
    this.kernel.appendEvents(input.runId, events, { expectedRevision: state.revision });
    return { state: this.kernel.currentState(input.runId) };
  }
}

module.exports = { FLOW, MarketingWorkflowController };
