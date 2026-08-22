#!/usr/bin/env node
'use strict';

const crypto = require('crypto');
const fs = require('fs');
const http = require('http');
const path = require('path');
const { spawnSync } = require('child_process');

const SHA256 = /^[a-f0-9]{64}$/i;
const PHASES = new Set(['entry', 'representative', 'final']);
const SESSION_FILE = path.join('.sdtk-marketing', 'hyperframes-preview-session.json');
const SNAPSHOT_PLAN_FILE = 'snapshot-times.json';
const DEFAULT_TIMEOUT_MS = 30_000;
// Chromium-backed inspection can exceed the control-command budget on software GPU.
const FRAME_PRODUCTION_TIMEOUT_MS = 120_000;

function die(message) {
  process.stderr.write('hyperframes provider: ' + message + '\n');
  process.exit(2);
}

function args(argv) {
  const [action, ...rest] = argv;
  const flags = {};
  for (let index = 0; index < rest.length; index += 1) {
    const key = rest[index];
    if (!key.startsWith('--')) die('invalid argument');
    const name = key.slice(2);
    const value = rest[index + 1];
    if (value == null || value.startsWith('--')) die('missing value for --' + name);
    flags[name] = value;
    index += 1;
  }
  return { action, flags };
}

function validProject(value) {
  return typeof value === 'string' && path.isAbsolute(value) && fs.existsSync(value) && fs.statSync(value).isDirectory();
}

function providerRoot(ledger) {
  const root = path.join(ledger, 'provider', 'hyperframes');
  if (!fs.existsSync(path.join(root, 'index.html'))) die('HyperFrames source is missing at provider/hyperframes/index.html');
  return root;
}

function runHyperframes(argv, cwd) {
  const timeout = ['check', 'snapshot'].includes(argv[0])
    ? FRAME_PRODUCTION_TIMEOUT_MS
    : DEFAULT_TIMEOUT_MS;
  const result = spawnSync('hyperframes', argv, {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout,
    maxBuffer: 1024 * 1024,
  });
  if (result.error) return { ok: false, status: result.status, stdout: result.stdout || '', stderr: result.stderr || '', error: result.error.message };
  return { ok: result.status === 0, status: result.status, stdout: result.stdout || '', stderr: result.stderr || '' };
}

function readJson(text, description) {
  try { return JSON.parse(text); } catch { die(description + ' did not return JSON'); }
}

function version() {
  const result = runHyperframes(['--version'], process.cwd());
  if (!result.ok) die('HyperFrames executable is unavailable');
  const match = String(result.stdout).trim().match(/(\d+\.\d+\.\d+)/);
  if (!match) die('HyperFrames version is unreadable');
  return match[1];
}

function doctor() {
  const executableVersion = version();
  const result = runHyperframes(['doctor', '--json'], process.cwd());
  const report = readJson(result.stdout, 'HyperFrames doctor');
  const checks = Array.isArray(report.checks) ? report.checks : [];
  const has = (name) => checks.some((check) => check && check.name === name && check.ok === true);
  const shm = checks.find((check) => check && check.name === '/dev/shm');
  process.stdout.write(JSON.stringify({
    schema_version: 'sdtk.marketing-video-provider-doctor.v1',
    provider: 'hyperframes',
    executable: { version: executableVersion },
    requirements: { node: has('Node.js'), chrome: has('Chrome'), ffmpeg: has('FFmpeg'), shm: Boolean(shm && shm.ok === true) },
    local_only: true,
    capability_ids: ['timeline', 'comments', 'snapshots', 'local_render'],
    advisories: checks.filter((check) => check && check.ok === false).map((check) => ({ name: check.name, detail: check.detail || '' })),
  }, null, 2) + '\n');
}

function sessionPath(ledger) { return path.join(ledger, SESSION_FILE); }
function readSession(ledger) {
  try { return JSON.parse(fs.readFileSync(sessionPath(ledger), 'utf8')); }
  catch { return null; }
}
function writeSession(ledger, session) {
  const file = sessionPath(ledger);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(session, null, 2) + '\n', { mode: 0o600 });
}
function listenPid(status) {
  const visit = (value) => {
    if (!value || typeof value !== 'object') return null;
    if (Number.isInteger(value.pid) && value.pid > 0) return value.pid;
    for (const item of Array.isArray(value) ? value : Object.values(value)) {
      const pid = visit(item);
      if (pid) return pid;
    }
    return null;
  };
  return visit(status);
}
function waitForLocalHttp(port) {
  return new Promise((resolve) => {
    let remaining = 20;
    const probe = () => {
      const request = http.get({ hostname: '127.0.0.1', port, path: '/', timeout: 500 }, (response) => {
        response.resume();
        resolve(response.statusCode >= 200 && response.statusCode < 500);
      });
      request.on('error', () => {
        if (--remaining <= 0) return resolve(false);
        setTimeout(probe, 250);
      });
      request.on('timeout', () => request.destroy());
    };
    probe();
  });
}

async function preview(flags) {
  if (!validProject(flags.project)) die('project must be an existing absolute ledger directory');
  if (!['storyboard', 'timeline'].includes(flags.mode)) die('mode must be storyboard or timeline');
  const port = Number(flags.port);
  if (!Number.isInteger(port) || port < 1024 || port > 65535) die('port must be 1024..65535');
  const ledger = path.resolve(flags.project);
  const root = providerRoot(ledger);
  if (readSession(ledger)) die('an owned preview session already exists; stop it explicitly first');
  const existing = runHyperframes(['preview', root, '--status', '--json'], root);
  if (existing.ok) die('a preview session already exists without this ledger ownership record; no process was touched');
  const start = runHyperframes(['preview', root, '--background', '--port', String(port), '--no-open'], root);
  if (!start.ok) die('preview did not start');
  const statusResult = runHyperframes(['preview', root, '--status', '--json'], root);
  if (!statusResult.ok) {
    runHyperframes(['preview', root, '--stop'], root);
    die('preview status is unavailable; session was stopped');
  }
  const status = readJson(statusResult.stdout, 'preview status');
  const pid = listenPid(status);
  if (!pid || !await waitForLocalHttp(port)) {
    runHyperframes(['preview', root, '--stop'], root);
    die('preview did not provide an owned local HTTP session; session was stopped');
  }
  const session = {
    session_id: 'hf-' + crypto.randomUUID(),
    ownership_token: crypto.randomBytes(24).toString('hex'),
    pid,
    port,
    started_at: new Date().toISOString(),
    provider_root: root,
  };
  writeSession(ledger, session);
  process.stdout.write(JSON.stringify({
    url: 'http://127.0.0.1:' + port + (flags.mode === 'storyboard' ? '/?view=storyboard' : '/') + '#project/' + encodeURIComponent(path.basename(root)),
    ...session,
  }, null, 2) + '\n');
}

function stop(flags) {
  if (!validProject(flags.project)) die('project must be an existing absolute ledger directory');
  const ledger = path.resolve(flags.project);
  const session = readSession(ledger);
  if (!session || session.session_id !== flags['session-id'] || session.ownership_token !== flags['ownership-token'] || String(session.pid) !== String(flags.pid)) {
    die('session ownership does not match; no process was touched');
  }
  const root = providerRoot(ledger);
  const current = runHyperframes(['preview', root, '--status', '--json'], root);
  if (!current.ok || listenPid(readJson(current.stdout, 'preview status')) !== session.pid) {
    die('active preview ownership cannot be proven; session remains recorded');
  }
  const result = runHyperframes(['preview', root, '--stop'], root);
  if (!result.ok) die('HyperFrames rejected preview stop; session remains recorded');
  fs.unlinkSync(sessionPath(ledger));
  process.stdout.write(JSON.stringify({ stopped: true, session_id: session.session_id, ownership_token: session.ownership_token }) + '\n');
}

function plan(ledger, sourceSha) {
  const file = path.join(providerRoot(ledger), SNAPSHOT_PLAN_FILE);
  let value;
  try { value = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { die('snapshot-times.json is required for scene-bound evidence'); }
  if (value.schema_version !== 'sdtk.hyperframes-snapshot-times.v1' || value.source_sha256 !== sourceSha || !Array.isArray(value.scenes)) die('snapshot-times.json is invalid or not bound to the motion-map SHA');
  for (const scene of value.scenes) {
    if (!scene || !/^[A-Za-z0-9._-]{1,100}$/.test(scene.scene_id || '') || !scene.times) die('snapshot-times.json contains an invalid scene');
    for (const phase of PHASES) if (!Number.isFinite(scene.times[phase]) || scene.times[phase] < 0) die('snapshot-times.json is missing a non-negative ' + phase + ' timestamp');
  }
  return value;
}
function scenePlan(value, sceneId) {
  const scene = value.scenes.find((item) => item.scene_id === sceneId);
  if (!scene) die('scene is absent from snapshot-times.json');
  return scene;
}
function findPngs(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const item = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...findPngs(item));
    else if (entry.isFile() && entry.name.endsWith('.png')) out.push(item);
  }
  return out;
}
function sha256(file) { return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'); }
function snapshot(flags) {
  if (!validProject(flags.project) || !SHA256.test(flags['source-sha256'] || '') || !PHASES.has(flags.phase)) die('invalid snapshot request');
  const ledger = path.resolve(flags.project);
  const scene = scenePlan(plan(ledger, flags['source-sha256']), flags.scene);
  const root = providerRoot(ledger);
  const relative = path.join('production', 'evidence', 'snapshots', scene.scene_id, flags.phase + '.png');
  const destination = path.join(ledger, relative);
  const scratch = path.join(ledger, '.sdtk-marketing', 'snapshot-tmp-' + crypto.randomUUID());
  fs.mkdirSync(scratch, { recursive: true });
  const result = runHyperframes(['snapshot', root, '--at', String(scene.times[flags.phase]), '--no-end', '--output', scratch], root);
  const pngs = fs.existsSync(scratch) ? findPngs(scratch) : [];
  if (!result.ok || pngs.length !== 1) die('HyperFrames did not produce exactly one requested snapshot');
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.renameSync(pngs[0], destination);
  fs.rmSync(scratch, { recursive: true, force: true });
  process.stdout.write(JSON.stringify({
    schema_version: 'sdtk.marketing-video-snapshot.v1', provider: 'hyperframes', project_id: path.basename(ledger), source_sha256: flags['source-sha256'], scene_id: scene.scene_id, phase: flags.phase, path: relative.split(path.sep).join('/'), sha256: sha256(destination),
  }, null, 2) + '\n');
}

function findIssueArrays(value, inherited = 'info', out = []) {
  if (!value || typeof value !== 'object') return out;
  if (Array.isArray(value)) { for (const item of value) findIssueArrays(item, inherited, out); return out; }
  for (const [key, item] of Object.entries(value)) {
    const severity = /error/i.test(key) ? 'error' : /warn/i.test(key) ? 'warning' : inherited;
    if (Array.isArray(item) && /(finding|issue|error|warning)/i.test(key)) {
      for (const finding of item) if (finding && typeof finding === 'object') out.push({ finding, severity });
    } else if (item && typeof item === 'object') findIssueArrays(item, severity, out);
  }
  return out;
}
function ruleFor(value) {
  const raw = String(value.code || value.rule || value.type || 'provider-check-error').toLowerCase();
  if (raw.includes('overflow')) return 'overflow';
  if (raw.includes('occlusion')) return 'occlusion';
  if (raw.includes('overlap')) return 'unapproved-overlap';
  if (raw.includes('caption')) return 'caption-collision';
  if (raw.includes('frame')) return 'frame-fit';
  if (raw.includes('safe')) return 'safe-area';
  if (raw.includes('wordmark')) return 'clipped-wordmark';
  if (raw.includes('black')) return 'black-video-panel';
  if (raw.includes('blank')) return 'blank-media-surface';
  return 'provider-check-error';
}
function messageFor(value) { return String(value.message || value.detail || value.code || value.rule || 'HyperFrames check failed').slice(0, 1000); }
function check(flags) {
  if (!validProject(flags.project) || !SHA256.test(flags['source-sha256'] || '')) die('invalid check request');
  const ledger = path.resolve(flags.project);
  const snapshotPlan = plan(ledger, flags['source-sha256']);
  const root = providerRoot(ledger);
  const result = runHyperframes(['check', root, '--json', '--snapshots', '--frame-check', 'severity=error;seek=.25,.75'], root);
  let report = null;
  try { report = JSON.parse(result.stdout); } catch {}
  const versionResult = version();
  const rows = report ? findIssueArrays(report) : [];
  const findings = [];
  for (const row of rows) {
    const severity = row.finding.severity || row.severity;
    if (!['error', 'warning', 'info'].includes(severity)) continue;
    for (const scene of snapshotPlan.scenes) findings.push({ scene_id: scene.scene_id, severity, rule: ruleFor(row.finding), message: messageFor(row.finding) });
  }
  if ((!result.ok || (report && report.ok === false)) && !findings.some((item) => item.severity === 'error')) {
    for (const scene of snapshotPlan.scenes) findings.push({ scene_id: scene.scene_id, severity: 'error', rule: 'provider-check-error', message: 'HyperFrames check failed without a parseable finding' });
  }
  process.stdout.write(JSON.stringify({
    schema_version: 'sdtk.marketing-video-provider-check.v1', provider: 'hyperframes', project_id: path.basename(ledger), source_sha256: flags['source-sha256'], provider_version: versionResult, findings,
  }, null, 2) + '\n');
}

(async () => {
  const { action, flags } = args(process.argv.slice(2));
  if (action === 'doctor') return doctor();
  if (action === 'preview') return preview(flags);
  if (action === 'stop') return stop(flags);
  if (action === 'snapshot') return snapshot(flags);
  if (action === 'check') return check(flags);
  die('usage: hyperframes-provider.js <doctor|preview|stop|snapshot|check>');
})().catch((error) => die(error && error.message ? error.message : 'unexpected failure'));
