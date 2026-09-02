'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const childProcess = require('child_process');
const { preflightEpisode } = require('./preflight');
const { normalizeRunState } = require('./normalized-state');
const { prepareTemplate } = require('../../src/hermesControlPlanePrepare');

const RUN_ID_PATTERN = /^run_[a-z0-9]+_[a-z0-9]+$/;
const DEFAULT_PROJECT_PATH = '/workspace/hermes-agent-plugin';
const DEFAULT_REGISTRY_DIR = '/opt/data/hermes/control-plane/runs';
const GATE_ALIASES = Object.freeze({
  story_lock: 'owner_story_lock',
  picture_lock: 'owner_picture_lock',
  publish: 'owner_publish_approval',
});
const REASON_CODE_PATTERN = /^[A-Z][A-Z0-9_]{2,48}$/;

function sha256(value) { return crypto.createHash('sha256').update(value).digest('hex'); }
function requireRunId(runId) { if (!RUN_ID_PATTERN.test(String(runId || ''))) throw new Error('invalid run id'); return runId; }
function readJson(filePath) { return JSON.parse(fs.readFileSync(filePath, 'utf8')); }
function registryPath(registryDir, runId) { return path.join(path.resolve(registryDir), `${requireRunId(runId)}.json`); }
function parseJsonResult(result) { try { return JSON.parse(result.stdout || '{}'); } catch (_) { throw new Error('controller command returned invalid JSON'); } }
function requireGateAlias(gateId) {
  if (!Object.hasOwn(GATE_ALIASES, String(gateId || ''))) throw new Error('invalid video gate id');
  return GATE_ALIASES[gateId];
}
function requirePacketSha(packetSha) {
  if (!/^[a-f0-9]{64}$/.test(String(packetSha || ''))) throw new Error('invalid packet sha256');
  return packetSha;
}
function requireReasonCode(reasonCode) {
  if (!REASON_CODE_PATTERN.test(String(reasonCode || ''))) throw new Error('invalid reason code');
  return reasonCode;
}
function taskRecord(state, taskId) {
  const task = state && state.tasks && state.tasks[taskId];
  if (!task || typeof task !== 'object') throw new Error('unknown task id');
  return task;
}
function runCommand(commandRunner, args) {
  const result = commandRunner('sdtk-agent', args, { encoding: 'utf8', env: process.env });
  if (!result || result.status !== 0) throw new Error('controller command failed closed');
  return result;
}

function prepare(input, dependencies = {}) {
  const projectPath = path.resolve(input.projectPath || DEFAULT_PROJECT_PATH);
  const preflight = (dependencies.preflightEpisode || preflightEpisode)({
    projectPath, episode: input.episode, episodeManifestRoot: input.episodeManifestRoot, policyPath: input.policyPath, env: input.env,
  }, dependencies);
  if (!preflight.ok) return { status: 'preflight_failed', preflight, exact_kickoff_approval: null };
  const result = (dependencies.prepareTemplate || prepareTemplate)('marketing_video_ep_usage', { episode: input.episode }, {
    projectPath, registryDir: input.registryDir || DEFAULT_REGISTRY_DIR, episodeManifestRoot: input.episodeManifestRoot, preflightPacket: preflight,
  });
  return Object.assign({}, result, { preflight, exact_kickoff_approval: `APPROVE VIDEO KICKOFF ${result.run_id} ${preflight.manifest_sha256}` });
}

function readRun(projectPath, runId) {
  return readJson(path.join(path.resolve(projectPath), '.sdtk', 'agent-runtime', 'runs', requireRunId(runId), 'state.json'));
}

function assertManifest(record, manifestSha) {
  if (!/^[a-f0-9]{64}$/.test(String(manifestSha || ''))) throw new Error('invalid manifest sha256');
  if (record.episode_manifest_sha256 !== manifestSha) throw new Error('stale or mismatched episode manifest');
}

function kickoff(input, dependencies = {}) {
  const projectPath = path.resolve(input.projectPath || DEFAULT_PROJECT_PATH);
  const registryDir = path.resolve(input.registryDir || DEFAULT_REGISTRY_DIR);
  const runId = requireRunId(input.runId);
  const record = readJson(registryPath(registryDir, runId));
  assertManifest(record, input.manifestSha256);
  const state = readRun(projectPath, runId);
  const normalized = normalizeRunState(state);
  if (normalized.terminal) return { status: 'terminal_no_dispatch', run_id: runId, normalized };
  const commandRunner = dependencies.commandRunner || childProcess.spawnSync;
  const result = runCommand(commandRunner, ['run', 'continue', '--project-path', projectPath, '--run-id', runId, '--confirm', '--json']);
  return { status: 'dispatched', run_id: runId, manifest_sha256: input.manifestSha256, result: parseJsonResult(result) };
}

function status(input) {
  const state = readRun(input.projectPath || DEFAULT_PROJECT_PATH, input.runId);
  return { run_id: input.runId, normalized: normalizeRunState(state) };
}

function approveGate(input, dependencies = {}) {
  const projectPath = path.resolve(input.projectPath || DEFAULT_PROJECT_PATH);
  const runId = requireRunId(input.runId);
  const gate = requireGateAlias(input.gateId);
  const packetSha = requirePacketSha(input.packetSha256);
  const state = readRun(projectPath, runId);
  if (state.status !== 'waiting_for_approval' || state.waiting_gate !== gate) throw new Error('run is not waiting for this video gate');
  const commandRunner = dependencies.commandRunner || childProcess.spawnSync;
  runCommand(commandRunner, ['gate', 'approve', '--project-path', projectPath, '--run-id', runId, '--gate', gate, '--approved-by', 'owner', '--note', `packet_sha256=${packetSha}`]);
  const result = runCommand(commandRunner, ['run', 'continue', '--project-path', projectPath, '--run-id', runId, '--confirm', '--json']);
  return { status: 'gate_approved_and_advanced', run_id: runId, gate_id: input.gateId, packet_sha256: packetSha, result: parseJsonResult(result) };
}

function rejectGate(input, dependencies = {}) {
  const projectPath = path.resolve(input.projectPath || DEFAULT_PROJECT_PATH);
  const runId = requireRunId(input.runId);
  const gate = requireGateAlias(input.gateId);
  const reasonCode = requireReasonCode(input.reasonCode);
  const state = readRun(projectPath, runId);
  if (state.status !== 'waiting_for_approval' || state.waiting_gate !== gate) throw new Error('run is not waiting for this video gate');
  const commandRunner = dependencies.commandRunner || childProcess.spawnSync;
  runCommand(commandRunner, ['gate', 'reject', '--project-path', projectPath, '--run-id', runId, '--gate', gate, '--rejected-by', 'owner', '--needs-changes', '--note', `reason_code=${reasonCode}`]);
  return { status: 'gate_rejected', run_id: runId, gate_id: input.gateId, reason_code: reasonCode };
}

function cancel(input, dependencies = {}) {
  const projectPath = path.resolve(input.projectPath || DEFAULT_PROJECT_PATH);
  const runId = requireRunId(input.runId);
  const state = readRun(projectPath, runId);
  if (normalizeRunState(state).terminal) return { status: 'terminal_no_cancel', run_id: runId };
  const commandRunner = dependencies.commandRunner || childProcess.spawnSync;
  const result = runCommand(commandRunner, ['run', 'cancel', '--project-path', projectPath, '--run-id', runId, '--reason', 'owner_video_cancelled', '--json']);
  return { status: 'cancelled', run_id: runId, result: parseJsonResult(result) };
}

function reconcile(input, dependencies = {}) {
  const projectPath = path.resolve(input.projectPath || DEFAULT_PROJECT_PATH);
  const runId = requireRunId(input.runId);
  const commandRunner = dependencies.commandRunner || childProcess.spawnSync;
  const result = runCommand(commandRunner, ['run', 'reconcile', '--project-path', projectPath, '--run-id', runId, '--json']);
  return { status: 'reconciled', run_id: runId, result: parseJsonResult(result) };
}

function recover(input, dependencies = {}) {
  const projectPath = path.resolve(input.projectPath || DEFAULT_PROJECT_PATH);
  const runId = requireRunId(input.runId);
  const taskId = String(input.taskId || '');
  if (!/^[a-z][a-z0-9_]{2,80}$/.test(taskId)) throw new Error('invalid task id');
  const state = readRun(projectPath, runId);
  const task = taskRecord(state, taskId);
  if (task.blocker_class !== 'RECOVERABLE_WORKER') throw new Error('task is not recoverable_worker');
  if (Number(task.retry_count || 0) >= 1) throw new Error('recoverable worker retry budget exhausted');
  const commandRunner = dependencies.commandRunner || childProcess.spawnSync;
  const result = runCommand(commandRunner, ['task', 'retry', '--project-path', projectPath, '--run-id', runId, '--task', taskId, '--max', '1', '--reason', 'recoverable_worker', '--json']);
  return { status: 'recovery_rereadied', run_id: runId, task_id: taskId, result: parseJsonResult(result) };
}

function command(argv, dependencies = {}) {
  const [verb, ...rest] = argv;
  if (verb === 'prepare' && rest.length === 1) return prepare({ episode: rest[0] }, dependencies);
  if (verb === 'status' && rest.length === 1) return status({ runId: rest[0] });
  throw new Error('unsupported self-service controller command');
}

module.exports = { GATE_ALIASES, approveGate, assertManifest, cancel, command, kickoff, prepare, readRun, reconcile, recover, registryPath, rejectGate, sha256, status };
