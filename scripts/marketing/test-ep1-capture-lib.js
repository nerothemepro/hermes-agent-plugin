#!/usr/bin/env node
'use strict';

const assert = require('assert');
const {
  buildConcatManifest,
  customizeConstellation,
  validateSegments,
} = require('./ep1-capture-lib');

const source = `
:root { --accent:#c8461a; --glow:#e8862f; }
<h1>NEBULA</h1>
var HERO_CONFIG = {
  word: 'NEBULA',
  count: 9000
};
`;
const customized = customizeConstellation(source, {word: 'SDTK', accent: '#16c8c1'});
assert.match(customized, /word: 'SDTK'/);
assert.match(customized, /--accent:#16c8c1/);
assert.doesNotMatch(customized, /NEBULA/);

const segments = [
  {file: '/tmp/a.mp4', duration: 45},
  {file: '/tmp/b.mp4', duration: 90},
  {file: '/tmp/c.mp4', duration: 90},
  {file: '/tmp/d.mp4', duration: 45},
];
assert.strictEqual(validateSegments(segments), 270);
assert.strictEqual(
  buildConcatManifest(segments),
  "file '/tmp/a.mp4'\nfile '/tmp/b.mp4'\nfile '/tmp/c.mp4'\nfile '/tmp/d.mp4'\n",
);
assert.throws(() => validateSegments([{file: '/tmp/a.mp4', duration: 44}]), /270 seconds/);

process.stdout.write('ep1 capture helpers: OK\n');
