#!/usr/bin/env node
'use strict';

const crypto = require('crypto');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const { createRequire } = require('module');
const { spawn, spawnSync } = require('child_process');
const { validateCapturePlan } = require('./workflows');

const RUN_ID = /^run_[a-z0-9_]+$/;
const PORT_MIN = 19000;
const PORT_MAX = 19999;

function required(value, name) { const text = String(value || '').trim(); if (!text) throw new Error(name + ' is required'); return text; }
function inside(root, relative) {
  if (path.isAbsolute(relative)) throw new Error('artifact path must be relative');
  const candidate = path.resolve(root, relative);
  if (!candidate.startsWith(root + path.sep)) throw new Error('artifact path is outside run root');
  return candidate;
}
function sha256(file) { return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'); }
function parseArgs(argv) {
  const values = {};
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    if (flag === '--preflight') { values.preflight = true; continue; }
    if (!['--root', '--run-id', '--attempt'].includes(flag) || !argv[i + 1] || argv[i + 1].startsWith('--')) throw new Error('exact arguments required: --root --run-id --attempt [--preflight]');
    values[flag.slice(2).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase())] = argv[++i];
  }
  const root = path.resolve(required(values.root, 'root'));
  const runId = required(values.runId, 'run id');
  const attempt = Number(values.attempt);
  if (!RUN_ID.test(runId) || !Number.isInteger(attempt) || attempt < 1) throw new Error('invalid runner identity');
  return { root, runId, attempt, preflight: values.preflight === true };
}
function executable(name) {
  const entries = String(process.env.PATH || '').split(path.delimiter);
  for (const entry of entries) { const target = path.join(entry, name); if (fs.existsSync(target) && fs.statSync(target).isFile()) return target; }
  return '';
}
function chromiumExecutable() {
  const configured = String(process.env.SDTK_MARKETING_CHROMIUM_EXECUTABLE || '').trim();
  const candidates = [configured, '/root/.cache/ms-playwright/chromium-1232/chrome-linux64/chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser'].filter(Boolean);
  return candidates.find((candidate) => fs.existsSync(candidate) && fs.statSync(candidate).isFile()) || '';
}
function loadPlaywright() {
  const modulePath = process.env.SDTK_MARKETING_PLAYWRIGHT_MODULE;
  if (modulePath) return require(path.resolve(modulePath));
  const project = process.env.SDTK_MARKETING_PLAYWRIGHT_PROJECT || path.resolve(__dirname, '../../media-pipeline/remotion/sdtk-tutorial');
  const packageFile = path.join(project, 'package.json');
  if (!fs.existsSync(packageFile)) throw new Error('Playwright project package.json is unavailable');
  return createRequire(packageFile)('playwright');
}
function readPlan(root) {
  const file = inside(root, 'approved-capture-plan.json');
  if (!fs.existsSync(file) || !fs.lstatSync(file).isFile()) throw new Error('approved capture plan is unavailable');
  let plan;
  try { plan = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { throw new Error('approved capture plan is not valid JSON'); }
  validateCapturePlan(plan);
  return { file, plan };
}
function preflight(input) {
  const { file, plan } = readPlan(input.root);
  const checks = {
    sdtk_wiki: executable('sdtk-wiki'),
    ffmpeg: executable('ffmpeg'),
    chromium: chromiumExecutable(),
    playwright_project: process.env.SDTK_MARKETING_PLAYWRIGHT_PROJECT || path.resolve(__dirname, '../../media-pipeline/remotion/sdtk-tutorial'),
  };
  if (!checks.sdtk_wiki || !checks.ffmpeg || !checks.chromium) throw new Error('EP4 capture preflight requires sdtk-wiki, ffmpeg, and Chromium');
  try { loadPlaywright(); } catch { throw new Error('EP4 capture preflight requires the configured local Playwright runtime'); }
  return { schema_version: 'sdtk.marketing-capture-preflight.v1', status: 'pass', run_id: input.runId, runner_id: plan.runner_id, plan_sha256: sha256(file), checks };
}
function writeFixture(root) {
  const fixture = path.join(root, 'demo-fixture');
  const files = {
    'DEMO_DATA.md': '# DEMO DATA\n\nThis isolated fixture exists only to demonstrate real SDTK product behavior. It is not production project data.\n',
    'SHARED_PLANNING.md': '# Shared Planning\n\n## Refund approval\n\n- [ ] Review customer requirement\n- [ ] Draft implementation plan\n- [ ] Owner approval\n',
    'QUALITY_CHECKLIST.md': '# Quality Checklist\n\n- [ ] Requirement mapped to plan\n- [ ] Owner gate recorded\n',
    'docs/requirements/refund-approval.md': '# Refund approval\n\nA support manager needs a reviewable refund approval flow.\n\n## Acceptance\n\n- Owner reviews the decision before implementation.\n',
    'docs/plans/refund-approval-plan.md': '# Refund approval plan\n\n1. Record the requirement.\n2. Break work into reviewable tasks.\n3. Hold the owner gate.\n',
  };
  for (const [relative, content] of Object.entries(files)) {
    const target = path.join(fixture, relative);
    fs.mkdirSync(path.dirname(target), { recursive: true, mode: 0o700 });
    fs.writeFileSync(target, content, { mode: 0o600 });
  }
  return fixture;
}
function runChecked(command, args, options = {}) {
  const result = spawnSync(command, args, { cwd: options.cwd, encoding: 'utf8', timeout: options.timeout || 60000, env: options.env || process.env, maxBuffer: 4 * 1024 * 1024 });
  if (result.status !== 0) throw new Error(command + ' failed');
  return { command: [command, ...args], stdout: String(result.stdout || ''), stderr: String(result.stderr || '') };
}
function waitForServer(url, child) {
  return new Promise((resolve, reject) => {
    const deadline = Date.now() + 20000;
    const probe = () => {
      if (child.exitCode !== null) return reject(new Error('sdtk-wiki viewer stopped before capture'));
      const req = http.get(url, (response) => { response.resume(); if (response.statusCode >= 200 && response.statusCode < 500) resolve(); else retry(); });
      req.on('error', retry);
    };
    const retry = () => Date.now() >= deadline ? reject(new Error('sdtk-wiki viewer did not become ready')) : setTimeout(probe, 250);
    probe();
  });
}
async function captureViewer(input, plan, fixture) {
  const port = PORT_MIN + (parseInt(crypto.createHash('sha256').update(input.runId).digest('hex').slice(0, 6), 16) % (PORT_MAX - PORT_MIN));
  const viewer = spawn('sdtk-wiki', ['atlas', 'open', '--project-path', fixture, '--host', '127.0.0.1', '--port', String(port), '--no-open'], { stdio: ['ignore', 'ignore', 'pipe'], env: process.env });
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'ep4-atlas-capture-'));
  let browser;
  try {
    await waitForServer('http://127.0.0.1:' + port + '/', viewer);
    const { chromium } = loadPlaywright();
    browser = await chromium.launch({ headless: true, executablePath: chromiumExecutable(), args: ['--no-sandbox', '--disable-dev-shm-usage'] });
    const context = await browser.newContext({ viewport: plan.viewport, recordVideo: { dir: temp, size: plan.viewport } });
    const page = await context.newPage();
    const video = page.video();
    await page.goto('http://127.0.0.1:' + port + '/', { waitUntil: 'networkidle' });
    await page.waitForTimeout(1200);
    await page.mouse.wheel(0, 500);
    await page.waitForTimeout(900);
    await context.close();
    await browser.close(); browser = null;
    const raw = await video.path();
    const output = inside(input.root, plan.artifacts.capture);
    fs.mkdirSync(path.dirname(output), { recursive: true, mode: 0o700 });
    runChecked('ffmpeg', ['-y', '-i', raw, '-vf', 'fps=30', '-c:v', 'libx264', '-preset', 'medium', '-crf', '18', '-pix_fmt', 'yuv420p', '-an', '-movflags', '+faststart', output]);
    return output;
  } finally {
    if (browser) await browser.close().catch(() => {});
    viewer.kill('SIGTERM');
    fs.rmSync(temp, { recursive: true, force: true });
  }
}
async function main(argv = process.argv.slice(2)) {
  const input = parseArgs(argv);
  const receipt = preflight(input);
  if (input.preflight) { process.stdout.write(JSON.stringify(receipt) + '\n'); return receipt; }
  const { plan } = readPlan(input.root);
  const fixture = writeFixture(input.root);
  const build = runChecked('sdtk-wiki', ['atlas', 'build', '--project-path', fixture, '--scan-root', 'docs'], { cwd: fixture });
  const capture = await captureViewer(input, plan, fixture);
  const receiptPath = inside(input.root, plan.artifacts.receipt);
  fs.mkdirSync(path.dirname(receiptPath), { recursive: true, mode: 0o700 });
  fs.writeFileSync(receiptPath, JSON.stringify({ ...receipt, fixture: 'demo-fixture', build_command: build.command, capture_artifact: plan.artifacts.capture }, null, 2) + '\n', { mode: 0o600 });
  const manifest = {
    schema_version: 'sdtk.marketing-capture-manifest.v1', run_id: input.runId, task_id: 'capture_assets', capture_mode: 'real_product_evidence', privacy: { status: 'pass' },
    truth_boundary: { product_behavior: 'real', generated_visuals: false, fabricated_product_behavior: false, data_classification: 'demo_only' },
    captures: [{ artifact_path: plan.artifacts.capture, sha256: sha256(capture), kind: 'screen_recording', viewport: plan.viewport }],
    command_receipts: [{ artifact_path: plan.artifacts.receipt, sha256: sha256(receiptPath), exit_code: 0 }],
  };
  fs.writeFileSync(path.join(input.root, 'capture-manifest.json'), JSON.stringify(manifest, null, 2) + '\n', { mode: 0o600 });
  const finalizer = path.join(__dirname, 'video-finalizer-cli.js');
  runChecked(process.execPath, [finalizer, '--root', input.root, '--run-id', input.runId, '--task-id', 'capture_assets', '--attempt', String(input.attempt)]);
  process.stdout.write('EP4_DEMO_CAPTURE_READY\n');
  return manifest;
}
module.exports = { captureViewer, chromiumExecutable, main, parseArgs, preflight, readPlan, writeFixture };
if (require.main === module) main().catch((error) => { process.stderr.write(error.message + '\n'); process.exitCode = 1; });
