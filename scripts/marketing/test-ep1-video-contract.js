#!/usr/bin/env node
'use strict';

const assert = require('assert');
const contract = require('./ep1-video-contract');

assert.strictEqual(contract.fps, 30);
assert.deepStrictEqual(contract.longForm.size, {width: 1920, height: 1080});
assert.strictEqual(contract.longForm.durationSeconds, 300);
assert.ok(contract.longForm.showcaseCutSeconds >= 3 && contract.longForm.showcaseCutSeconds <= 5);
assert.ok(contract.motion.maxStaticSeconds <= 5);
assert.deepStrictEqual(contract.shortForm.size, {width: 1440, height: 2560});
assert.strictEqual(contract.shortForm.durationSeconds, 55);
assert.strictEqual(contract.shortForm.actionSeconds + contract.shortForm.ctaSeconds, 55);
assert.strictEqual(contract.shortForm.ctaSeconds, 3);
assert.ok(contract.shortForm.minCaptionFontSize >= 72);
assert.ok(contract.shortForm.minCtaFontSize >= 72);
assert.deepStrictEqual(
  contract.downloadChapter.stages.map(({id, start, end}) => [id, start, end]),
  [
    ['landing', 0, 18],
    ['download', 18, 30],
    ['unzip', 30, 55],
    ['offline', 55, 90],
  ],
);
assert.strictEqual(
  contract.downloadChapter.stages.reduce((total, stage) => total + stage.end - stage.start, 0),
  contract.downloadChapter.durationSeconds,
);

assert.deepStrictEqual(
  contract.longForm.shots.map(({id, start, end}) => [id, start, end]),
  [
    ['cold-open', 0, 3],
    ['bumper', 3, 5],
    ['showcase', 5, 45],
    ['get-the-pack', 45, 135],
    ['reskin', 135, 225],
    ['honest-proof', 225, 270],
    ['cta', 270, 300],
  ],
);

assert.deepStrictEqual(
  contract.heroes.map(({id}) => id),
  ['aurora', 'orbit', 'liquid', 'constellation', 'scrollfilm', 'kinetic'],
);
assert.strictEqual(contract.palettes.length, 6);
assert.deepStrictEqual(contract.themes, ['lantern-night', 'daybreak']);
assert.strictEqual(
  contract.ctaUrl,
  'https://sdtk.dev/heroes?utm_source=youtube&utm_medium=video&utm_campaign=tutorials-s1',
);
assert.strictEqual(contract.music.license, 'CC0-1.0');
assert.match(contract.music.source, /operator-generated/i);

process.stdout.write('ep1 video contract: OK\n');
