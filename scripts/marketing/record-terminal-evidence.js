#!/usr/bin/env node
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { createRequire } = require('module');
const { spawnSync } = require('child_process');
const {
  browserLaunchOptions,
  extractUsageMetrics,
  buildTerminalHtml,
  runUsageCommands,
  validateUsageCommands,
} = require('./terminal-capture-runner');

function fail(message) {
  process.stderr.write('terminal capture: ' + message + '\n');
  process.exitCode = 1;
}

function flag(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : null;
}

function inside(root, file) {
  const base = path.resolve(root);
  const candidate = path.resolve(file);
  return candidate.startsWith(base + path.sep);
}

function loadPlaywright() {
  const project = process.env.SDTK_MARKETING_PLAYWRIGHT_PROJECT
    || path.resolve(__dirname, '../../media-pipeline/remotion/sdtk-tutorial');
  const packageFile = path.join(project, 'package.json');
  if (!fs.existsSync(packageFile)) throw new Error('Playwright project package.json is unavailable');
  return createRequire(packageFile)('playwright');
}

async function revealCommand(page, result) {
  const command = result.argv.join(' ');
  await page.evaluate((text) => window.setTerminal('DEMO DATA - isolated local fixture\n\n$ ' + text + '\n'), command);
  const lines = result.output.split('\n');
  for (const line of lines) {
    await page.evaluate((text) => window.appendTerminal(text + '\n'), line);
    await page.waitForTimeout(90);
  }
  await page.waitForTimeout(result.hold_seconds * 1000);
}

async function main() {
  const planFile = flag('--plan');
  const runRoot = flag('--run-root');
  const out = flag('--out');
  if (!planFile || !runRoot || !out) throw new Error('usage: record-terminal-evidence.js --plan <plan.json> --run-root <path> --out <capture.mp4>');
  const root = path.resolve(runRoot);
  const output = path.resolve(out);
  if (!inside(root, planFile) || !inside(root, output)) throw new Error('plan and output must stay inside the canonical run root');
  const plan = JSON.parse(fs.readFileSync(planFile, 'utf8'));
  const commandValidation = validateUsageCommands(plan.commands);
  if (!commandValidation.ok) throw new Error(commandValidation.findings.join('; '));
  if (plan.truth_boundary !== 'composited_from_real_command_output') throw new Error('explicit composited command-output truth boundary is required');
  const fixtureHome = path.resolve(root, plan.fixture_home);
  if (!inside(root, fixtureHome) || !fs.existsSync(path.join(fixtureHome, 'DEMO_DATA.txt'))) throw new Error('run-local DEMO DATA fixture is unavailable');

  const results = runUsageCommands(plan.commands, fixtureHome);
  const metrics = extractUsageMetrics(results);
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'sdtk-terminal-record-'));
  let browser;
  try {
    const { chromium } = loadPlaywright();
    browser = await chromium.launch(browserLaunchOptions(process.env.SDTK_MARKETING_CHROMIUM_EXECUTABLE));
    const context = await browser.newContext({
      viewport: { width: 1920, height: 1080 },
      deviceScaleFactor: 1,
      recordVideo: { dir: work, size: { width: 1920, height: 1080 } },
    });
    const page = await context.newPage();
    const video = page.video();
    await page.setContent(buildTerminalHtml(), { waitUntil: 'load' });
    await page.evaluate((items) => window.setMetrics(items), metrics);
    await page.waitForTimeout(3000);
    for (const result of results) {
      await revealCommand(page, result);
      await page.evaluate(() => window.setTerminal(''));
      await page.waitForTimeout(1200);
    }
    await page.evaluate(() => window.setTerminal('Capture complete.\n\nReal command output recorded under the DEMO DATA boundary.'));
    await page.waitForTimeout(3000);
    await context.close();
    await browser.close();
    browser = null;
    const recorded = await video.path();
    fs.mkdirSync(path.dirname(output), { recursive: true });
    const converted = spawnSync('ffmpeg', [
      '-y', '-i', recorded,
      '-vf', 'fps=30,scale=1920:1080:flags=lanczos',
      '-c:v', 'libx264', '-preset', 'medium', '-crf', '18',
      '-pix_fmt', 'yuv420p', '-an', '-movflags', '+faststart', output,
    ], { stdio: ['ignore', 'ignore', 'pipe'] });
    if (converted.status !== 0 || !fs.existsSync(output)) throw new Error('ffmpeg normalization failed');
    process.stdout.write('terminal evidence captured: ' + output + '\n');
  } finally {
    if (browser) await browser.close().catch(() => {});
    fs.rmSync(work, { recursive: true, force: true });
  }
}

if (require.main === module) main().catch((error) => fail(error.message || String(error)));
module.exports = { main, revealCommand };
