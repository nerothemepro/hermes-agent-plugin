'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { loadEpisodeManifest } = require('./episode-manifest');
const { selectActiveRun } = require('./normalized-state');
const { activePackageVersion, activeToolchainEnvironment } = require('../../src/hermesControlPlaneToolchain');

const DEFAULT_POLICY_PATH = path.join(__dirname, 'toolchain-policy.json');
const DEFAULT_RUN_ROOT = '.sdtk/agent-runtime/runs';
const DEFAULT_HERMES_BIN = '/workspace/.venvs/hermes-agent/bin/hermes';
const DEFAULT_HERMES_PROFILES_ROOT = '/opt/data/hermes-profiles';

function sha256(value) { return crypto.createHash('sha256').update(value).digest('hex'); }
function readJson(filePath) { return JSON.parse(fs.readFileSync(filePath, 'utf8')); }
function bounded(value, max = 240) { return String(value || '').replace(/[\r\n\t]/g, ' ').slice(0, max); }

function loadPolicy(policyPath = DEFAULT_POLICY_PATH) {
  const policy = readJson(policyPath);
  if (policy.schema_version !== 'sdtk.marketing-video-toolchain-policy.v1') throw new Error('Toolchain policy schema is invalid.');
  if (!Array.isArray(policy.required_tools) || !policy.required_tools.length) throw new Error('Toolchain policy tools are required.');
  if (!policy.role_profiles || typeof policy.role_profiles !== 'object') throw new Error('Toolchain policy role_profiles are required.');
  return policy;
}

function episodeIdentityFromRun(state, runDirectory) {
  if (state.episode_id && state.episode_revision) {
    return { episode: state.episode_id, revision: state.episode_revision };
  }
  try {
    const workflow = readJson(path.join(runDirectory, 'workflow.json'));
    const stage = Array.isArray(workflow.stages)
      ? workflow.stages.find((item) => item && item.type === 'task' && item.params && item.params.episode_id)
      : null;
    return stage ? { episode: stage.params.episode_id, revision: stage.params.episode_revision } : null;
  } catch (_) {
    return null;
  }
}

function findActiveEpisodeRun(projectPath, episode, revision) {
  const root = path.join(path.resolve(projectPath), DEFAULT_RUN_ROOT);
  if (!fs.existsSync(root)) return null;
  const candidates = [];
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    if (!entry.isDirectory() || !/^run_[a-z0-9]+_[a-z0-9]+$/.test(entry.name)) continue;
    const statePath = path.join(root, entry.name, 'state.json');
    try {
      const state = readJson(statePath);
      const identity = episodeIdentityFromRun(state, path.join(root, entry.name));
      if (identity && identity.episode === episode && identity.revision === revision) candidates.push(state);
    } catch (_) { /* corrupted ledgers fail later in their own canonical path */ }
  }
  return selectActiveRun(candidates);
}
function defaultCommandRunner(command, args, options = {}) {
  const childProcess = require('child_process');
  return childProcess.spawnSync(command, args, { encoding: 'utf8', timeout: options.timeoutMs || 30000, env: options.env || process.env });
}

function toolVersionArgs(tool) { return tool === 'ffmpeg' || tool === 'ffprobe' ? ['-version'] : ['--version']; }
function hermesBinary(env) { return env.HERMES_BIN || DEFAULT_HERMES_BIN; }
function profileEnvironment(env, profile) {
  const home = path.join(env.HERMES_PROFILES_ROOT || DEFAULT_HERMES_PROFILES_ROOT, profile);
  return { ...env, HERMES_HOME: home, HERMES_KANBAN_HOME: home };
}

function commandCheck(runner, command, args, env) {
  try {
    const result = runner(command, args, { env, timeoutMs: 30000 }) || {};
    return { ok: result.status === 0, detail: bounded(result.status === 0 ? result.stdout : result.stderr || result.stdout || `exit ${result.status}`) };
  } catch (error) {
    return { ok: false, detail: bounded(error.message) };
  }
}

function checkPackageVersions(manifest, resolvePackageVersion) {
  const aliases = { sdtk_marketing: 'sdtk-marketing-kit', sdtk_agent: 'sdtk-agent-kit', hermes_adapter: 'sdtk-agent-hermes-adapter' };
  return Object.entries(manifest.toolchain).map(([key, expected]) => {
    const packageName = aliases[key] || key;
    let actual = null;
    let detail = '';
    try { actual = resolvePackageVersion(packageName); detail = actual || 'not installed'; }
    catch (error) { detail = bounded(error.message); }
    return { name: `package:${packageName}`, ok: actual === expected, expected, actual, detail };
  });
}

function defaultPackageVersionResolver(packageName) {
  const result = defaultCommandRunner('npm', ['list', '-g', packageName, '--depth=0', '--json']);
  if (result.status !== 0) return null;
  const parsed = JSON.parse(result.stdout || '{}');
  return parsed.dependencies && parsed.dependencies[packageName] && parsed.dependencies[packageName].version || null;
}

function preflightEpisode(input, deps = {}) {
  const projectPath = path.resolve(input.projectPath || process.cwd());
  const episode = String(input.episode || '');
  const manifestRoot = input.episodeManifestRoot;
  const manifestEntry = loadEpisodeManifest(episode, { episodeManifestRoot: manifestRoot });
  const policy = loadPolicy(input.policyPath);
  const runner = deps.commandRunner || defaultCommandRunner;
  const baseEnv = Object.assign({}, process.env, input.env || {});
  const env = activeToolchainEnvironment(baseEnv);
  const fallbackPackageVersion = deps.packageVersionResolver || defaultPackageVersionResolver;
  const packageVersion = (packageName) => activePackageVersion(packageName, baseEnv) || fallbackPackageVersion(packageName);
  const checks = [];
  const add = (name, ok, detail, extra = {}) => checks.push(Object.assign({ name, ok: Boolean(ok), detail: bounded(detail) }, extra));

  add('manifest', true, manifestEntry.filePath, { sha256: manifestEntry.sha256 });
  add('quality_profile', policy.quality_profiles.includes(manifestEntry.manifest.quality_profile), manifestEntry.manifest.quality_profile);
  const duplicate = findActiveEpisodeRun(projectPath, manifestEntry.manifest.episode_id, manifestEntry.manifest.revision);
  add('duplicate_active_run', !duplicate, duplicate ? duplicate.run_id : 'none');
  for (const result of checkPackageVersions(manifestEntry.manifest, packageVersion)) checks.push(result);
  for (const tool of policy.required_tools) {
    const result = commandCheck(runner, tool, toolVersionArgs(tool), env);
    add(`tool:${tool}`, result.ok, result.detail);
  }
  for (const role of manifestEntry.manifest.allowed_roles) {
    const profile = policy.role_profiles[role];
    if (!profile) { add(`role:${role}`, false, 'profile policy missing'); continue; }
    const result = commandCheck(runner, hermesBinary(env), ['kanban', 'list', '--json'], profileEnvironment(env, profile));
    add(`role:${role}`, result.ok, profile, { profile, probe: result.detail });
  }
  const outputRoot = path.join(projectPath, DEFAULT_RUN_ROOT);
  let outputWritable = false;
  try { outputWritable = fs.existsSync(outputRoot) && fs.statSync(outputRoot).isDirectory() && fs.accessSync(outputRoot, fs.constants.W_OK) === undefined; } catch (_) { outputWritable = false; }
  add('output_root', outputWritable, outputRoot);
  const autoPost = env.HERSOCIAL_AUTO_POST_ENABLED;
  const publishDisabled = policy.publish_policy && policy.publish_policy.external_publish === false;
  add('publish_disabled', publishDisabled && (!policy.publish_policy.require_auto_post_disabled || autoPost === 'false'), publishDisabled ? `auto_post=${autoPost || 'unset'}` : 'policy allows publish');

  const packet = {
    schema_version: 'sdtk.marketing-video-preflight.v1',
    episode: manifestEntry.manifest.episode_id,
    revision: manifestEntry.manifest.revision,
    manifest_path: manifestEntry.filePath,
    manifest_sha256: manifestEntry.sha256,
    project_path: projectPath,
    checks,
  };
  packet.ok = checks.every((check) => check.ok);
  packet.preflight_sha256 = sha256(JSON.stringify(packet));
  return packet;
}

module.exports = { DEFAULT_HERMES_BIN, DEFAULT_POLICY_PATH, loadPolicy, findActiveEpisodeRun, preflightEpisode };
