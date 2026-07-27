#!/usr/bin/env node
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const {spawnSync} = require('child_process');
const {createRequire} = require('module');
const projectRequire = createRequire(path.resolve(__dirname, '../../media-pipeline/remotion/sdtk-tutorial/package.json'));
const {chromium} = projectRequire('playwright');
const contract = require('./ep1-video-contract');
const {buildConcatManifest, customizeConstellation} = require('./ep1-capture-lib');

const BASE = 'https://sdtk.dev';
const ZIP_URL = `${BASE}/downloads/sdtk-hero-pack1.zip`;
const HERO_HOLD_MS = 6666;
const PALETTES = contract.palettes;

function flag(name) {
  const index = process.argv.indexOf(name);
  return index === -1 ? '' : process.argv[index + 1] || '';
}

function fail(message) {
  process.stderr.write(`ep1 capture: ${message}\n`);
  process.exit(2);
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    encoding: options.encoding === null ? null : 'utf8',
    stdio: options.stdio || 'pipe',
  });
  if (result.error || result.status !== 0) {
    const detail = result.stderr ? String(result.stderr).trim().split('\n').slice(-2).join(' ') : '';
    fail(`${command} failed${detail ? `: ${detail}` : ''}`);
  }
  return result.stdout || '';
}

function durationSeconds(file) {
  return Number(run('ffprobe', [
    '-v', 'error',
    '-show_entries', 'format=duration',
    '-of', 'default=nokey=1:noprint_wrappers=1',
    file,
  ]).trim());
}

function normalizeRecording(rawFile, targetFile, duration) {
  const actual = durationSeconds(rawFile);
  if (!Number.isFinite(actual) || actual < duration - 0.5) {
    fail(`recording ${rawFile} is ${actual}s; expected at least ${duration - 0.5}s`);
  }
  const trimStart = Math.max(0, actual - duration);
  run('ffmpeg', [
    '-y', '-ss', trimStart.toFixed(3), '-i', rawFile,
    '-t', String(duration),
    '-vf', 'fps=30,scale=1920:1080:flags=lanczos',
    '-c:v', 'libx264', '-preset', 'medium', '-crf', '18',
    '-pix_fmt', 'yuv420p', '-an', '-movflags', '+faststart',
    targetFile,
  ]);
}

async function recordSegment(workDir, name, duration, action) {
  const recordDir = path.join(workDir, `record-${name}`);
  fs.mkdirSync(recordDir, {recursive: true});
  const browser = await chromium.launch({
    headless: true,
    args: ['--disable-dev-shm-usage', '--no-sandbox'],
  });
  const context = await browser.newContext({
    viewport: contract.longForm.size,
    deviceScaleFactor: 1,
    acceptDownloads: true,
    recordVideo: {dir: recordDir, size: contract.longForm.size},
  });
  const page = await context.newPage();
  const video = page.video();
  try {
    await action({browser, context, page});
  } finally {
    await context.close();
    await browser.close();
  }
  const recorded = await video.path();
  const output = path.join(workDir, `${name}.mp4`);
  normalizeRecording(recorded, output, duration);
  fs.rmSync(recordDir, {recursive: true, force: true});
  return output;
}

function fileUrl(file) {
  return `file://${file}`;
}

function heroPath(packRoot, id) {
  return path.join(packRoot, 'heroes', `hero-${id}.html`);
}

function liveShowcaseMarkup() {
  const frames = contract.heroes
    .map((hero, index) => `<iframe data-index="${index}" src="${BASE}${hero.path}" title="${hero.label}"></iframe>`)
    .join('');
  return `<style>
    html,body{margin:0;width:100%;height:100%;overflow:hidden;background:#0b111a}
    iframe{position:fixed;inset:0;width:100%;height:100%;border:0;display:none}
    iframe[data-active="true"]{display:block}
  </style>${frames}`;
}

async function waitForFrames(page) {
  await page.waitForFunction(
    () => [...document.querySelectorAll('iframe')]
      .every((frame) => frame.contentDocument && frame.contentDocument.readyState === 'complete'),
    null,
    {timeout: 45000},
  );
}

async function activateFrame(page, index) {
  await page.evaluate((target) => {
    document.querySelectorAll('iframe').forEach((frame, frameIndex) => {
      frame.dataset.active = frameIndex === target ? 'true' : 'false';
    });
  }, index);
}

async function recordColdOpen(workDir, packRoot) {
  return recordSegment(workDir, '00-cold-open', 3, async ({page}) => {
    await page.goto(fileUrl(heroPath(packRoot, 'constellation')), {waitUntil: 'domcontentloaded', timeout: 45000});
    await page.waitForTimeout(8000);
  });
}

async function recordShowcase(workDir, packRoot) {
  return recordSegment(workDir, '01-showcase', 45, async ({page}) => {
    const constellation = heroPath(packRoot, 'constellation');
    await page.goto(fileUrl(constellation), {waitUntil: 'domcontentloaded', timeout: 45000});
    await page.waitForTimeout(5000);

    await page.goto(`${BASE}${contract.heroes[0].path}`, {waitUntil: 'domcontentloaded', timeout: 45000});
    await page.evaluate((markup) => { document.body.innerHTML = markup; }, liveShowcaseMarkup());
    await waitForFrames(page);
    for (let index = 0; index < contract.heroes.length; index += 1) {
      await activateFrame(page, index);
      if (contract.heroes[index].id === 'scrollfilm') {
        await page.waitForTimeout(2400);
        await page.evaluate((target) => {
          const frame = document.querySelector(`iframe[data-index="${target}"]`);
          frame.contentWindow.scrollBy(0, 900);
        }, index);
        await page.waitForTimeout(900);
        await page.evaluate((target) => {
          const frame = document.querySelector(`iframe[data-index="${target}"]`);
          frame.contentWindow.scrollTo(0, 0);
        }, index);
        await page.waitForTimeout(HERO_HOLD_MS - 3300);
      } else {
        await page.waitForTimeout(HERO_HOLD_MS);
      }
    }
  });
}

async function recordDownload(workDir) {
  return recordSegment(workDir, '02-download-offline', 90, async ({context, page}) => {
    await page.goto(`${BASE}/heroes`, {waitUntil: 'networkidle', timeout: 60000});
    await page.waitForTimeout(12000);

    const downloadPromise = page.waitForEvent('download', {timeout: 45000});
    await page.locator('a[href="/downloads/sdtk-hero-pack1.zip"]').first().click();
    const download = await downloadPromise;
    const zipFile = path.join(workDir, 'browser-downloaded-sdtk-hero-pack1.zip');
    await download.saveAs(zipFile);
    await page.waitForTimeout(8000);

    const extracted = path.join(workDir, 'browser-unzipped');
    fs.mkdirSync(extracted, {recursive: true});
    run('unzip', ['-q', '-o', zipFile, '-d', extracted]);
    const packRoot = path.join(extracted, 'sdtk-hero-pack1');
    const directory = path.join(packRoot, 'heroes');
    await page.goto(fileUrl(`${directory}/`), {waitUntil: 'domcontentloaded', timeout: 30000});
    await page.waitForTimeout(12000);

    let remoteRequestCount = 0;
    await context.route(/^https?:\/\//, async (route) => {
      remoteRequestCount += 1;
      await route.abort();
    });
    const link = page.locator('a[href="hero-constellation.html"]');
    if (await link.count()) {
      await link.dblclick();
    } else {
      await page.goto(fileUrl(heroPath(packRoot, 'constellation')), {waitUntil: 'domcontentloaded'});
    }
    await page.waitForTimeout(58000);
    if (remoteRequestCount !== 0) {
      fail(`offline hero attempted ${remoteRequestCount} network request(s)`);
    }
  });
}

async function recordReskin(workDir, packRoot) {
  const target = heroPath(packRoot, 'constellation');
  const original = fs.readFileSync(target, 'utf8');
  return recordSegment(workDir, '03-reskin', 90, async ({page}) => {
    await page.goto(`view-source:${fileUrl(target)}`, {waitUntil: 'domcontentloaded', timeout: 30000});
    await page.waitForTimeout(12000);

    await page.goto(fileUrl(target), {waitUntil: 'domcontentloaded', timeout: 30000});
    await page.evaluate(() => document.documentElement.removeAttribute('data-palette'));
    await page.waitForTimeout(12000);

    fs.writeFileSync(target, customizeConstellation(original, {word: 'SDTK', accent: '#16c8c1'}));
    await page.reload({waitUntil: 'domcontentloaded'});
    await page.evaluate(() => document.documentElement.removeAttribute('data-palette'));
    await page.waitForTimeout(12000);

    for (const palette of PALETTES) {
      await page.locator(`[data-p="${palette}"]`).click();
      await page.waitForTimeout(6000);
    }
    await page.locator('#themeToggle').click();
    await page.waitForTimeout(9000);
    await page.locator('#themeToggle').click();
    await page.waitForTimeout(9000);
  });
}

async function recordReducedMotion(workDir, packRoot) {
  const target = heroPath(packRoot, 'constellation');
  return recordSegment(workDir, '04-reduced-motion', 45, async ({page}) => {
    await page.emulateMedia({reducedMotion: 'no-preference'});
    await page.goto(fileUrl(target), {waitUntil: 'domcontentloaded', timeout: 30000});
    await page.waitForTimeout(15000);

    await page.emulateMedia({reducedMotion: 'reduce'});
    await page.reload({waitUntil: 'domcontentloaded'});
    const proof = await page.evaluate(() => ({
      matches: matchMedia('(prefers-reduced-motion: reduce)').matches,
      canvasDisplay: getComputedStyle(document.querySelector('.fx canvas')).display,
    }));
    if (!proof.matches || proof.canvasDisplay !== 'none') {
      fail(`reduced-motion proof failed: ${JSON.stringify(proof)}`);
    }
    await page.waitForTimeout(30000);
  });
}

function preparePack(workDir) {
  const zipFile = path.join(workDir, 'sdtk-hero-pack1.zip');
  run('curl', ['-fsSL', '--retry', '3', '--max-time', '120', ZIP_URL, '-o', zipFile]);
  const extractRoot = path.join(workDir, 'pack');
  run('unzip', ['-q', '-o', zipFile, '-d', extractRoot]);
  const packRoot = path.join(extractRoot, 'sdtk-hero-pack1');
  const constellation = heroPath(packRoot, 'constellation');
  const customized = customizeConstellation(
    fs.readFileSync(constellation, 'utf8'),
    {word: 'SDTK', accent: '#ff6a2b'},
  );
  fs.writeFileSync(constellation, customized);
  return packRoot;
}

async function main() {
  const out = flag('--out');
  const coldOut = flag('--cold-out');
  if (!out && !coldOut) fail('--out or --cold-out is required');
  const absoluteOut = path.resolve(out || coldOut);
  fs.mkdirSync(path.dirname(absoluteOut), {recursive: true});
  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sdtk-ep1-capture-'));
  try {
    const packRoot = preparePack(workDir);
    if (coldOut) {
      const coldFile = await recordColdOpen(workDir, packRoot);
      fs.copyFileSync(coldFile, absoluteOut);
      process.stdout.write(`Ep1 particle-SDTK cold-open recorded: ${absoluteOut}\n`);
      return;
    }
    const segments = [
      {file: await recordShowcase(workDir, packRoot), duration: 45},
      {file: await recordDownload(workDir), duration: 90},
      {file: await recordReskin(workDir, packRoot), duration: 90},
      {file: await recordReducedMotion(workDir, packRoot), duration: 45},
    ];
    const manifest = path.join(workDir, 'concat.txt');
    fs.writeFileSync(manifest, buildConcatManifest(segments));
    const joined = path.join(workDir, 'joined.mp4');
    run('ffmpeg', [
      '-y', '-f', 'concat', '-safe', '0', '-i', manifest,
      '-c', 'copy', '-movflags', '+faststart', joined,
    ]);
    run('ffmpeg', [
      '-y', '-i', joined, '-vf', 'tpad=stop_mode=clone:stop_duration=1,fps=30',
      '-t', '270', '-c:v', 'libx264', '-preset', 'medium', '-crf', '18',
      '-pix_fmt', 'yuv420p', '-an', '-movflags', '+faststart', absoluteOut,
    ]);
    const duration = durationSeconds(absoluteOut);
    if (Math.abs(duration - 270) > 0.01) fail(`final capture duration is ${duration}s, expected 270s`);
    process.stdout.write(`Ep1 evidence capture recorded: ${absoluteOut}\n`);
    process.stdout.write('segments: showcase=45s download/offline=90s reskin=90s reduced-motion=45s\n');
    process.stdout.write('offline proof: downloaded ZIP, unzipped locally, opened bundled hero with HTTP(S) blocked\n');
  } finally {
    fs.rmSync(workDir, {recursive: true, force: true});
  }
}

main().catch((error) => fail(error.stack || error.message));
