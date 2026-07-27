#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const {spawnSync} = require('child_process');
const {createRequire} = require('module');
const projectRequire = createRequire(path.resolve(__dirname, '../../media-pipeline/remotion/sdtk-tutorial/package.json'));
const {chromium} = projectRequire('playwright');

const BASE = 'https://sdtk.dev';
const HEROES = [
  {label: 'ember aurora', path: '/packs/hero1/hero-aurora.html'},
  {label: 'floating 3D product', path: '/packs/hero1/hero-orbit.html'},
  {label: 'liquid metal', path: '/packs/hero1/hero-liquid.html'},
  {label: 'particle swarm', path: '/packs/hero1/hero-constellation.html'},
  {label: 'scroll-driven film', path: '/packs/hero1/hero-scrollfilm.html', scroll: true},
  {label: 'kinetic type', path: '/packs/hero1/hero-kinetic.html'},
];
const HERO_HOLD_MS = 8000;
const RESKIN_HOLD_MS = 12000;
const FINAL_DURATION_S = (HEROES.length * HERO_HOLD_MS + RESKIN_HOLD_MS) / 1000;

function flag(name) {
  const index = process.argv.indexOf(name);
  return index === -1 ? '' : process.argv[index + 1] || '';
}

function fail(message) {
  process.stderr.write('hero showcase capture: ' + message + '\n');
  process.exit(2);
}

function run(command, args, encoding) {
  const result = spawnSync(command, args, {encoding: encoding || 'utf8'});
  if (result.error || result.status !== 0) fail(command + ' failed');
  return result.stdout || '';
}

function durationSeconds(file) {
  return Number(run('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=nokey=1:noprint_wrappers=1', file]).trim());
}

function captureMarkup() {
  const frames = HEROES.map((hero, index) => '<iframe data-index="' + index + '" src="' + BASE + hero.path + '" title="' + hero.label + '"></iframe>').join('');
  return '<style>html,body{margin:0;width:100%;height:100%;overflow:hidden;background:#0b111a}iframe{position:fixed;inset:0;width:100%;height:100%;border:0;display:none}iframe[data-active="true"]{display:block}</style>' + frames;
}

async function activate(page, index) {
  await page.evaluate((next) => {
    document.querySelectorAll('iframe').forEach((frame, frameIndex) => {
      frame.dataset.active = frameIndex === next ? 'true' : 'false';
    });
  }, index);
}

async function scrollHero(page, index) {
  await page.evaluate((target) => {
    const frame = document.querySelector('iframe[data-index="' + target + '"]');
    frame.contentWindow.scrollBy(0, 900);
  }, index);
  await page.waitForTimeout(900);
  await page.evaluate((target) => {
    const frame = document.querySelector('iframe[data-index="' + target + '"]');
    frame.contentWindow.scrollTo(0, 0);
  }, index);
}

async function setAccent(page, color) {
  await page.evaluate((value) => {
    const active = document.querySelector('iframe[data-active="true"]');
    active.contentDocument.documentElement.style.setProperty('--accent', value);
  }, color);
}

async function main() {
  const out = flag('--out');
  if (!out) fail('--out is required');
  if (HEROES.some((hero) => !hero.path.startsWith('/packs/hero1/'))) fail('hero source allowlist is invalid');

  const absoluteOut = path.resolve(out);
  const recordDir = path.join(path.dirname(absoluteOut), '.hero-showcase-recording');
  const rawOut = path.join(recordDir, 'capture.webm');
  fs.mkdirSync(recordDir, {recursive: true});

  const browser = await chromium.launch({headless: true, args: ['--disable-dev-shm-usage']});
  const context = await browser.newContext({
    viewport: {width: 1920, height: 1080},
    deviceScaleFactor: 1,
    recordVideo: {dir: recordDir, size: {width: 1920, height: 1080}},
  });
  const page = await context.newPage();
  const video = page.video();
  try {
    await page.goto(BASE + HEROES[0].path, {waitUntil: 'domcontentloaded', timeout: 45000});
    await page.evaluate((markup) => { document.body.innerHTML = markup; }, captureMarkup());
    await page.waitForFunction(() => [...document.querySelectorAll('iframe')].every((frame) => frame.contentDocument && frame.contentDocument.readyState === 'complete'), null, {timeout: 45000});

    for (let index = 0; index < HEROES.length; index += 1) {
      await activate(page, index);
      if (HEROES[index].scroll) {
        await page.waitForTimeout(2400);
        await scrollHero(page, index);
        await page.waitForTimeout(HERO_HOLD_MS - 3300);
      } else {
        await page.waitForTimeout(HERO_HOLD_MS);
      }
    }
    await setAccent(page, '#16c8c1');
    await page.waitForTimeout(RESKIN_HOLD_MS / 2);
    await setAccent(page, '#9060ff');
    await page.waitForTimeout(RESKIN_HOLD_MS / 2);
  } finally {
    await context.close();
    await browser.close();
  }

  const recorded = await video.path();
  fs.renameSync(recorded, rawOut);
  const trimStart = Math.max(0, durationSeconds(rawOut) - FINAL_DURATION_S);
  run('ffmpeg', ['-y', '-i', rawOut, '-ss', trimStart.toFixed(3), '-t', String(FINAL_DURATION_S), '-c:v', 'libx264', '-preset', 'medium', '-crf', '18', '-an', '-movflags', '+faststart', absoluteOut], null);
  fs.rmSync(recordDir, {recursive: true, force: true});
  process.stdout.write('hero showcase capture recorded: ' + absoluteOut + '\n');
  process.stdout.write('schedule: ' + HEROES.length + ' heroes x ' + (HERO_HOLD_MS / 1000) + 's + reskin ' + (RESKIN_HOLD_MS / 1000) + 's\n');
}

main().catch((error) => fail(error.message));
