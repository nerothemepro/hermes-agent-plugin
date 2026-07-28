#!/usr/bin/env node
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const {spawn, spawnSync} = require('child_process');
const {createRequire} = require('module');
const projectRequire = createRequire(path.resolve(__dirname, '../../media-pipeline/remotion/sdtk-tutorial/package.json'));
const {chromium} = projectRequire('playwright');

const VIEWPORT = {width: 2560, height: 1440};
const PROJECT_PATH = process.env.ONE_SPINE_PROJECT_PATH || '/workspace/sdtk-internal';
const DESIGN_PORT = Number(process.env.ONE_SPINE_DESIGN_PORT || 3241);
const ATLAS_PORT = Number(process.env.ONE_SPINE_ATLAS_PORT || 8785);
const KANBAN_PORT = Number(process.env.ONE_SPINE_KANBAN_PORT || 7655);

function value(name) {
  const index = process.argv.indexOf(name);
  return index === -1 ? '' : process.argv[index + 1] || '';
}

function fail(message) {
  throw new Error("one spine capture: " + message);
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {encoding: 'utf8', stdio: options.stdio || 'pipe', env: options.env || process.env});
  if (result.error || result.status !== 0) {
    const detail = String(result.stderr || result.error || '').trim().split('\n').slice(-2).join(' ');
    fail(command + ' failed' + (detail ? ': ' + detail : ''));
  }
  return result.stdout || '';
}

function startServer(name, command, args, logsDir) {
  const fd = fs.openSync(path.join(logsDir, name + '.log'), 'a');
  const child = spawn(command, args, {stdio: ['ignore', fd, fd]});
  return {child, fd};
}

async function waitFor(url, label) {
  const deadline = Date.now() + 45000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch (_) {}
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  fail(label + ' did not become reachable: ' + url);
}

function normalize(raw, output, seconds) {
  run('ffmpeg', ['-y', '-i', raw, '-t', String(seconds), '-vf', 'fps=30,scale=2560:1440:flags=lanczos', '-c:v', 'libx264', '-preset', 'medium', '-crf', '18', '-pix_fmt', 'yuv420p', '-an', '-movflags', '+faststart', output]);
}

async function recordSegment(workDir, name, seconds, visit) {
  const rawDir = path.join(workDir, 'raw-' + name);
  fs.mkdirSync(rawDir, {recursive: true});
  const browser = await chromium.launch({headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage']});
  const context = await browser.newContext({viewport: VIEWPORT, recordVideo: {dir: rawDir, size: VIEWPORT}});
  const page = await context.newPage();
  const video = page.video();
  try {
    await visit(page);
  } finally {
    await context.close();
    await browser.close();
  }
  const raw = await video.path();
  const output = path.join(workDir, name + '.mp4');
  normalize(raw, output, seconds);
  fs.rmSync(rawDir, {recursive: true, force: true});
  return output;
}

async function clickFirst(page, selectors, label) {
  for (const selector of selectors) {
    const locator = page.locator(selector).first();
    if (await locator.count() && await locator.isVisible()) {
      await locator.click({timeout: 10000});
      return;
    }
  }
  fail('could not find ' + label);
}

async function recordDesign(workDir, designUrl) {
  return recordSegment(workDir, 'design', 13, async (page) => {
    await page.goto(designUrl, {waitUntil: 'networkidle', timeout: 60000});
    await clickFirst(page, ['#styles-btn'], 'Preview Studio Styles button');
    await page.waitForTimeout(2200);
    await clickFirst(page, ['.style-card'], 'Style Gallery card');
    await page.waitForTimeout(1800);
    await page.goto('https://sdtk.dev/packs/hero1/hero-constellation.html', {waitUntil: 'domcontentloaded', timeout: 60000});
    await page.waitForTimeout(1800);
    const paletteButtons = page.locator('[data-p]');
    const count = await paletteButtons.count();
    if (count < 6) fail('hero pack did not expose six real palette controls');
    for (let index = 0; index < 6; index += 1) {
      await paletteButtons.nth(index).click();
      await page.waitForTimeout(820);
    }
    await page.waitForTimeout(1200);
  });
}

async function recordGallery(workDir, designUrl) {
  return recordSegment(workDir, 'gallery', 10, async (page) => {
    await page.goto(designUrl, {waitUntil: 'networkidle', timeout: 60000});
    await clickFirst(page, ['#styles-btn'], 'Preview Studio Styles button');
    await page.waitForTimeout(1400);
    const gallery = page.locator('#gallery');
    if (!(await gallery.count())) fail('Style Gallery did not open');
    await gallery.hover();
    await page.mouse.wheel(0, 1100);
    await page.waitForTimeout(3000);
  });
}

async function recordGraphDocs(workDir, atlasUrl) {
  return recordSegment(workDir, 'graph-docs', 15, async (page) => {
    await page.goto(atlasUrl, {waitUntil: 'networkidle', timeout: 60000});
    await clickFirst(page, ['.nav-panel-btn[data-panel="graph"]'], 'Graph panel');
    await page.waitForTimeout(4200);
    let search = page.locator('#graph-search');
    if (!(await search.count()) || !(await search.isVisible())) {
      await clickFirst(page, ['#graph-toolbar-peek'], 'Graph search control');
      search = page.locator('#graph-search');
    }
    if (!(await search.count()) || !(await search.isVisible())) fail('Graph search input did not open');
    await search.fill('motion remix brand film');
    await page.waitForTimeout(1500);
    const result = page.locator('#graph-search-results .result-item').first();
    if (!(await result.count())) fail('Graph search did not return a real node');
    await result.click();
    await page.waitForTimeout(1600);
    const focusedTitle = (await page.locator('.graph-focus-doc-title').innerText()).trim();
    if (!focusedTitle) fail('Graph focus did not expose a document title');
    const fullDetail = page.getByRole('button', {name: 'Open Full Detail'});
    if (!(await fullDetail.count()) || !(await fullDetail.isVisible())) fail('Graph node did not expose Open Full Detail');
    await fullDetail.click();
    await page.waitForTimeout(1200);
    await clickFirst(page, ['.nav-panel-btn[data-panel="docs"]'], 'Docs panel');
    await page.waitForTimeout(800);
    const docsSearch = page.locator('#search');
    await docsSearch.fill(focusedTitle);
    await page.waitForTimeout(900);
    const docItem = page.locator('#doc-list .doc-item').first();
    if (!(await docItem.count()) || !(await docItem.isVisible())) fail('Docs panel did not show the selected document');
    await docItem.click();
    await page.waitForTimeout(1700);
    const detail = page.locator('#detail-panel.open');
    if (!(await detail.count()) || !(await detail.isVisible())) fail('Graph node did not open the Docs panel');
    await page.waitForTimeout(1600);
  });
}

async function recordAsk(workDir, atlasUrl) {
  return recordSegment(workDir, 'ask', 8, async (page) => {
    await page.goto(atlasUrl, {waitUntil: 'networkidle', timeout: 60000});
    await clickFirst(page, ['.nav-panel-btn[data-panel="graph"]'], 'Graph panel');
    await clickFirst(page, ['#atlas-ask-launch'], 'Ask launcher');
    const input = page.locator('#atlas-ask-input');
    if (!(await input.count())) fail('Ask input did not open');
    await input.fill('What does the One Spine brand film require?');
    await clickFirst(page, ['#atlas-ask-submit'], 'Ask submit button');
    const answer = page.locator('#atlas-ask-answer');
    await page.waitForFunction(() => {
      const element = document.querySelector('#atlas-ask-answer');
      return Boolean(element && element.textContent && element.textContent.trim().length > 80);
    }, null, {timeout: 60000});
    if (!(await answer.count())) fail('Ask answer panel is unavailable');
    await page.waitForTimeout(1200);
  });
}

async function recordKanban(workDir, kanbanUrl) {
  return recordSegment(workDir, 'kanban', 12, async (page) => {
    await page.goto(kanbanUrl, {waitUntil: 'networkidle', timeout: 60000});
    await page.waitForTimeout(2400);
    await clickFirst(page, ['#kanban-tab-quality'], 'Quality Gates tab');
    await page.waitForTimeout(2600);
    await clickFirst(page, ['#kanban-tab-pipeline'], 'Pipeline tab');
    await page.waitForTimeout(3400);
  });
}

function recordTerminal(workDir) {
  const tape = path.join(workDir, 'one-spine-terminal.tape');
  const helper = path.join(workDir, 'one-spine-terminal.sh');
  const output = path.join(workDir, 'terminal.mp4');
  fs.writeFileSync(helper, [
    '#!/usr/bin/env bash',
    "printf '%s' 'unedited screen recording' | sdtk-marketing check --stdin --strict",
    "printf 'exit=%s\\n' $?",
    "printf '%s' 'composited from real captures' | sdtk-marketing check --stdin --strict",
    "printf 'exit=%s\\n' $?",
  ].join("\n") + "\n", {mode: 0o700});
  fs.writeFileSync(tape, [
    'Output ' + JSON.stringify(output),
    'Set Width 2560',
    'Set Height 1440',
    'Set FontSize 34',
    'Set TypingSpeed 18ms',
    'Type ' + JSON.stringify("bash " + helper),
    'Enter',
    'Sleep 5s',
  ].join("\n") + "\n");
  run("vhs", [tape], {env: {...process.env, VHS_NO_SANDBOX: "1"}});
  if (!fs.existsSync(output)) fail("VHS did not produce terminal.mp4");
  return output;
}
async function main() {
  const out = value('--out');
  if (!out) fail('--out is required');
  const outputDir = path.resolve(out);
  fs.mkdirSync(outputDir, {recursive: true, mode: 0o700});
  const logsDir = path.join(outputDir, 'logs');
  fs.mkdirSync(logsDir, {recursive: true, mode: 0o700});
  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'one-spine-capture-'));
  const designUrl = 'http://127.0.0.1:' + DESIGN_PORT;
  const kanbanUrl = 'http://127.0.0.1:' + KANBAN_PORT;
  const atlasUrl = kanbanUrl;
  const servers = [];
  try {
    servers.push(startServer('design-preview', 'sdtk-design', ['preview', '--project-path', PROJECT_PATH, '--port', String(DESIGN_PORT), '--no-open'], logsDir));
    servers.push(startServer('wiki-kanban', 'sdtk-wiki', ['kanban', '--project', PROJECT_PATH, '--host', '127.0.0.1', '--port', String(KANBAN_PORT), '--no-open'], logsDir));
    await waitFor(designUrl, 'Preview Studio');
    await waitFor(kanbanUrl, 'Wiki kanban');
    const terminal = recordTerminal(workDir);
    const design = await recordDesign(workDir, designUrl);
    const gallery = await recordGallery(workDir, designUrl);
    const graphDocs = await recordGraphDocs(workDir, atlasUrl);
    const ask = await recordAsk(workDir, atlasUrl);
    const kanban = await recordKanban(workDir, kanbanUrl);
    const files = {terminal, design, gallery, graphDocs, ask, kanban};
    const manifest = {};
    const outputNames = {terminal: 'terminal.mp4', design: 'design.mp4', gallery: 'gallery.mp4', graphDocs: 'graph-docs.mp4', ask: 'ask.mp4', kanban: 'kanban.mp4'};
    for (const [key, source] of Object.entries(files)) {
      const destination = path.join(outputDir, outputNames[key]);
      fs.copyFileSync(source, destination);
      manifest[key] = destination;
    }
    fs.writeFileSync(path.join(outputDir, 'captures.json'), JSON.stringify({schema_version: 'sdtk.one-spine-captures.v1', viewport: VIEWPORT, fps: 30, captures: manifest}, null, 2) + '\n');
    process.stdout.write(JSON.stringify({ok: true, output: outputDir, captures: Object.keys(manifest)}, null, 2) + '\n');
  } finally {
    for (const server of servers) {
      server.child.kill('SIGTERM');
      fs.closeSync(server.fd);
    }
    fs.rmSync(workDir, {recursive: true, force: true});
  }
}

main().catch((error) => {
  process.stderr.write(String(error && error.message ? error.message : error) + "\n");
  process.exitCode = 2;
});
