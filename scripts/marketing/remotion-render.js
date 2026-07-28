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
const configuredComposition = process.env.SDTK_MARKETING_REMOTION_COMPOSITION || 'IntroBrand';
// Capture workflows default to the tutorial composition. A caller can select a different
// evidence composition without changing the default non-capture intro configuration.
const captureComposition = process.env.SDTK_MARKETING_REMOTION_CAPTURE_COMPOSITION || '';
const composition = capture ? (captureComposition || configuredComposition) : configuredComposition;

if (capture && !fs.statSync(capture, { throwIfNoEntry: false })?.isFile()) fail('--capture must point to a real file when supplied');
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

let captureProp = '';
if (capture) {
  const captureName = path.basename(capture);
  const publicCapture = path.join(project, 'public', 'captures', captureName);
  fs.mkdirSync(path.dirname(publicCapture), { recursive: true });
  fs.copyFileSync(capture, publicCapture);
  captureProp = `captures/${captureName}`;
}

let props = { capture: captureProp, input };
if (composition === 'OneSpine' || composition === 'OneSpineVertical') {
  if (!input) fail('one-spine render requires --input <capture-manifest.json>');
  let manifest;
  try {
    manifest = JSON.parse(fs.readFileSync(input, 'utf8'));
  } catch {
    fail('one-spine render input must be readable JSON');
  }
  if (!manifest.captures || typeof manifest.captures !== 'object') {
    fail('one-spine render input must declare a captures object');
  }
  const mappedCaptures = {};
  for (const [key, source] of Object.entries(manifest.captures)) {
    if (typeof source !== 'string' || !fs.statSync(source, { throwIfNoEntry: false })?.isFile()) {
      fail(`one-spine capture "${key}" is missing or is not a file`);
    }
    const extension = path.extname(source) || '.mp4';
    const relative = path.join('captures', 'one-spine', `${key}${extension}`);
    const destination = path.join(project, 'public', relative);
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.copyFileSync(source, destination);
    mappedCaptures[key] = relative.replaceAll(path.sep, '/');
  }
  props = { captures: mappedCaptures, facts: manifest.facts || {} };
}

fs.mkdirSync(path.dirname(out), { recursive: true });
const serializedProps = JSON.stringify(props);
const result = spawnSync(
  remotion,
  ['render', entryPoint, composition, out, '--props', serializedProps],
  { cwd: project, stdio: 'inherit', env: process.env },
);
if (result.error) fail(`renderer could not start: ${result.error.code || result.error.message}`);
if (result.status !== 0) process.exit(result.status || 1);
if (!fs.statSync(out, { throwIfNoEntry: false })?.isFile()) fail('renderer exited successfully but did not create the requested output');
