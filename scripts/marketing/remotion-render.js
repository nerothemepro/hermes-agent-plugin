#!/usr/bin/env node
'use strict';

const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

function value(flag) {
  const index = process.argv.indexOf(flag);
  return index === -1 ? '' : process.argv[index + 1] || '';
}

function fail(message) {
  process.stderr.write(`remotion delegate: ${message}\n`);
  process.exit(2);
}

const capture = value('--capture');
const input = value('--input');
const out = value('--out');
const project = process.env.SDTK_MARKETING_REMOTION_PROJECT || '';
const composition = process.env.SDTK_MARKETING_REMOTION_COMPOSITION || 'SdtkTutorial';

if (!capture || !fs.statSync(capture, { throwIfNoEntry: false })?.isFile()) fail('a real --capture file is required');
if (!out) fail('--out is required');
if (!project || !fs.statSync(project, { throwIfNoEntry: false })?.isDirectory()) {
  fail('SDTK_MARKETING_REMOTION_PROJECT is missing or not a directory');
}

const remotion = path.join(project, 'node_modules', '.bin', 'remotion');
const entryPoint = path.join(project, 'src', 'index.jsx');
if (!fs.statSync(remotion, { throwIfNoEntry: false })?.isFile()) {
  fail('Remotion project dependencies are unavailable; run npm ci in SDTK_MARKETING_REMOTION_PROJECT');
}
if (!fs.statSync(entryPoint, { throwIfNoEntry: false })?.isFile()) {
  fail('Remotion project entrypoint src/index.jsx is missing');
}

const captureName = path.basename(capture);
const publicCapture = path.join(project, 'public', 'captures', captureName);
fs.mkdirSync(path.dirname(publicCapture), { recursive: true });
fs.copyFileSync(capture, publicCapture);

fs.mkdirSync(path.dirname(out), { recursive: true });
const props = JSON.stringify({ capture: `captures/${captureName}`, input });
const result = spawnSync(
  remotion,
  ['render', entryPoint, composition, out, '--props', props],
  { cwd: project, stdio: 'inherit', env: process.env },
);
if (result.error) fail(`renderer could not start: ${result.error.code || result.error.message}`);
if (result.status !== 0) process.exit(result.status || 1);
if (!fs.statSync(out, { throwIfNoEntry: false })?.isFile()) fail('renderer exited successfully but did not create the requested output');
