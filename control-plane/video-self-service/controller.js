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

function sha256(value) { return crypto.createHash('sha256').update(value).digest('hex'); }
function requireRunId(runId) { if (!RUN_ID_PATTERN.test(String(runId || ''))) throw new Error('invalid run id'); return runId; }
function readJson(filePath) { return JSON.parse(fs.readFileSync(filePath, 'utf8')); }
function registryPath(registryDir, runId) { return path.join(path.resolve(registryDir), `${requireRunId(runId)}.json`); }
function parseJsonResult(result) { try { return JSON.parse(result.stdout || '{}'); } catch (_) { throw new Error('controller command returned invalid JSON'); } }

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
  const result = commandRunner('sdtk-agent', ['run', 'continue', '--project-path', projectPath, '--run-id', runId, '--confirm', '--json'], { encoding: 'utf8', env: process.env });
  if (!result || result.status !== 0) throw new Error('kickoff failed closed');
  return { status: 'dispatched', run_id: runId, manifest_sha256: input.manifestSha256, result: parseJsonResult(result) };
}

function status(input) {
  const state = readRun(input.projectPath || DEFAULT_PROJECT_PATH, input.runId);
  return { run_id: input.runId, normalized: normalizeRunState(state) };
}

function command(argv, dependencies = {}) {
  const [verb, ...rest] = argv;
  if (verb === 'prepare' && rest.length === 1) return prepare({ episode: rest[0] }, dependencies);
  throw new Error('unsupported self-service controller command');
}

module.exports = { assertManifest, command, kickoff, prepare, readRun, registryPath, sha256, status };
