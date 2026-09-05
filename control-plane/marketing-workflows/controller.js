'use strict';

const crypto = require('crypto');
const path = require('path');
const { WorkflowKernel } = require('./kernel');
const { finalizeTaskResult, canonicalJson } = require('./result-contract');
const { resolveWorkflow, validateProductionBrief, validateHandoff, validateSocialInput } = require('./workflows');

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
    if (input.workflow === 'video_production') validateHandoff(input.workflow, input.input);
    if (input.workflow === 'social_distribution') validateSocialInput(input.input);
    const kickoffPacketSha = sha256(canonicalJson({ run_id: input.runId, workflow: input.workflow, input: input.input || {} }));
    const accepted = this.kernel.acceptCommand({
      commandId: input.commandId,
      workflow: input.workflow,
      runId: input.runId,
      payload: input.input || {},
      initialEvents: [{ type: 'kickoff_waiting', payload: { packet_sha256: kickoffPacketSha } }],
    });
    const state = this.kernel.currentState(accepted.run_id);
    return {
      status: accepted.duplicate ? 'duplicate' : 'awaiting_kickoff',
      run_id: accepted.run_id,
      workflow: input.workflow,
      owner: definition.owner,
      kickoff_packet_sha256: state.kickoff_packet_sha256,
      state,
    };
  }

  approveKickoff(input) {
    const existing = this.kernel.command(input.commandId);
    if (existing) {
      if (existing.run_id !== input.runId || existing.payload.action !== 'kickoff' || existing.payload.packet_sha256 !== input.packetSha256) throw new Error('command id conflict');
      return { status: 'duplicate', state: this.kernel.currentState(input.runId) };
    }
    const state = this.kernel.currentState(input.runId);
    if (state.status !== 'awaiting_kickoff') throw new Error('run is not waiting for kickoff');
    if (state.kickoff_packet_sha256 !== input.packetSha256) throw new Error('packet sha256 mismatch');
    const accepted = this.kernel.commitCommand({
      commandId: input.commandId,
      runId: input.runId,
      workflow: state.workflow,
      payload: { action: 'kickoff', packet_sha256: input.packetSha256 },
      expectedRevision: state.revision,
      events: [{ type: 'kickoff_approved', payload: { packet_sha256: input.packetSha256 } }],
    });
    const next = this.kernel.currentState(input.runId);
    return { status: accepted.duplicate ? 'duplicate' : 'ready_for_worker_dispatch', state: next };
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

  input(runId) { return structuredClone(this.kernel.initialPayload(runId)); }

  nextTask(runId) {
    const state = this.kernel.currentState(runId);
    return { state, task_id: this._expectedTask(state) };
  }

  registerExternalTask(input) {
    const state = this.kernel.currentState(input.runId);
    const expectedTask = this._expectedTask(state);
    const attempt = Number(input.attempt);
    const nativeTaskId = String(input.nativeTaskId || '');
    const idempotencyKey = String(input.idempotencyKey || '');
    const board = String(input.board || '');
    if (!Number.isInteger(attempt) || attempt < 1 || !/^t_[a-z0-9_]+$/.test(nativeTaskId) || !/^sdtk-marketing:[a-z0-9_-]+:[a-z0-9_-]+:[1-9][0-9]*$/.test(idempotencyKey) || !/^[a-z0-9][a-z0-9-]{2,63}$/.test(board)) {
      throw new Error('invalid external task mapping');
    }
    const existing = state.tasks[input.taskId];
    if (existing?.status === 'external_registered' || existing?.status === 'external_released') {
      if (existing.attempt !== attempt || existing.native_task_id !== nativeTaskId || existing.idempotency_key !== idempotencyKey || existing.board !== board) throw new Error('external task mapping conflict');
      return { status: 'duplicate', state };
    }
    if (!['ready', 'running'].includes(state.status) || state.waiting_gate || input.taskId !== expectedTask) throw new Error(`expected task ${expectedTask}`);
    this.kernel.appendEvent(input.runId, 'task_external_registered', {
      task_id: input.taskId, attempt, native_task_id: nativeTaskId, idempotency_key: idempotencyKey, board,
    }, { expectedRevision: state.revision });
    return { status: 'registered', state: this.kernel.currentState(input.runId) };
  }

  releaseExternalTask(input) {
    const state = this.kernel.currentState(input.runId);
    const task = state.tasks[input.taskId];
    const attempt = Number(input.attempt);
    if (!task || task.attempt !== attempt || task.native_task_id !== input.nativeTaskId) throw new Error('external task mapping is missing');
    if (task.status === 'external_released') return { status: 'duplicate', state };
    if (task.status !== 'external_registered') throw new Error('external task cannot be released');
    this.kernel.appendEvent(input.runId, 'task_external_released', { task_id: input.taskId, attempt, native_task_id: input.nativeTaskId }, { expectedRevision: state.revision });
    return { status: 'released', state: this.kernel.currentState(input.runId) };
  }

  cancel(input) {
    const request = typeof input === 'string' ? { runId: input } : input || {};
    if (request.commandId) {
      const existing = this.kernel.command(request.commandId);
      if (existing) {
        if (existing.run_id !== request.runId || existing.payload.action !== 'cancel') throw new Error('command id conflict');
        return { status: 'duplicate', state: this.kernel.currentState(request.runId) };
      }
    }
    const state = this.kernel.currentState(request.runId);
    if (['completed', 'cancelled', 'rejected'].includes(state.status)) return request.commandId ? { status: 'terminal_no_cancel', state } : state;
    if (request.commandId) {
      this.kernel.commitCommand({
        commandId: request.commandId,
        runId: request.runId,
        workflow: state.workflow,
        payload: { action: 'cancel' },
        expectedRevision: state.revision,
        events: [{ type: 'run_cancelled', payload: {} }],
      });
    } else {
      this.kernel.appendEvent(request.runId, 'run_cancelled', {}, { expectedRevision: state.revision });
    }
    const next = this.kernel.currentState(request.runId);
    return request.commandId ? { status: 'cancelled', state: next } : next;
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
    if (finalized.status === 'failed') {
      const errorClass = String(finalized.error?.error_class || 'RECOVERABLE_WORKER');
      if (!/^[A-Z][A-Z0-9_]{2,48}$/.test(errorClass)) throw new Error('invalid worker error class');
      this.kernel.appendEvent(input.runId, 'task_failed', { task_id: taskId, attempt: finalized.attempt, envelope_sha256: finalized.envelope_sha256, error_class: errorClass }, { expectedRevision: state.revision });
      return { state: this.kernel.currentState(input.runId), packet_sha256: null, result: finalized };
    }
    if (state.workflow === 'research_and_story') {
      const briefArtifact = finalized.artifacts.find((artifact) => artifact.path === 'production-brief.json');
      if (!briefArtifact) throw new Error('research result must include production-brief.json');
      const briefPath = path.join(this.artifactRoot, input.runId, briefArtifact.path);
      let brief;
      try { brief = JSON.parse(require('fs').readFileSync(briefPath, 'utf8')); } catch { throw new Error('production brief is not valid JSON'); }
      validateProductionBrief(brief);
      if (brief.episode_id !== this.kernel.initialPayload(input.runId).episode_id) throw new Error('production brief episode does not match run');
    }
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

  rejectGate(input) {
    const existing = this.kernel.command(input.commandId);
    if (existing) {
      if (existing.run_id !== input.runId || existing.payload.action !== 'reject_gate' || existing.payload.gate_id !== input.gateId || existing.payload.reason_code !== input.reasonCode) throw new Error('command id conflict');
      return { status: 'duplicate', state: this.kernel.currentState(input.runId) };
    }
    const state = this.kernel.currentState(input.runId);
    if (state.status !== 'waiting_for_approval' || state.waiting_gate !== input.gateId) throw new Error('run is not waiting for this gate');
    if (!/^[A-Z][A-Z0-9_]{2,48}$/.test(String(input.reasonCode || ''))) throw new Error('invalid rejection reason code');
    this.kernel.commitCommand({
      commandId: input.commandId,
      runId: input.runId,
      workflow: state.workflow,
      payload: { action: 'reject_gate', gate_id: input.gateId, reason_code: input.reasonCode },
      expectedRevision: state.revision,
      events: [
        { type: 'gate_rejected', payload: { gate_id: input.gateId, reason_code: input.reasonCode } },
        { type: 'run_rejected', payload: { gate_id: input.gateId, reason_code: input.reasonCode } },
      ],
    });
    return { state: this.kernel.currentState(input.runId) };
  }

  approveGate(input) {
    if (input.commandId) {
      const existing = this.kernel.command(input.commandId);
      if (existing) {
        if (existing.run_id !== input.runId || existing.payload.action !== 'approve_gate' || existing.payload.gate_id !== input.gateId || existing.payload.packet_sha256 !== input.packetSha256) throw new Error('command id conflict');
        return { status: 'duplicate', state: this.kernel.currentState(input.runId) };
      }
    }
    const state = this.kernel.currentState(input.runId);
    if (state.status !== 'waiting_for_approval' || state.waiting_gate !== input.gateId) throw new Error('run is not waiting for this gate');
    if (state.packet_sha256 !== input.packetSha256) throw new Error('packet sha256 mismatch');
    const steps = FLOW[state.workflow];
    const step = steps.find((candidate) => candidate.gate === input.gateId);
    if (!step) throw new Error('unknown workflow gate');
    const events = [{ type: 'gate_approved', payload: { gate_id: input.gateId, packet_sha256: input.packetSha256 } }];
    if (step.final) events.push({ type: 'run_completed', payload: {} });
    if (input.commandId) {
      this.kernel.commitCommand({
        commandId: input.commandId,
        runId: input.runId,
        workflow: state.workflow,
        payload: { action: 'approve_gate', gate_id: input.gateId, packet_sha256: input.packetSha256 },
        expectedRevision: state.revision,
        events,
      });
    } else {
      this.kernel.appendEvents(input.runId, events, { expectedRevision: state.revision });
    }
    return { state: this.kernel.currentState(input.runId) };
  }
}

module.exports = { FLOW, MarketingWorkflowController };
