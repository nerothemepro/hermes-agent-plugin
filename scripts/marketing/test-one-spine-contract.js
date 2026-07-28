#!/usr/bin/env node
'use strict';

const assert = require('assert');
const contract = require('./one-spine-contract');

assert.strictEqual(contract.fps, 30);
assert.strictEqual(contract.longForm.durationSeconds, 75);
assert.deepStrictEqual(contract.longForm.size, {width: 1920, height: 1080});
assert.strictEqual(contract.vertical.durationSeconds, 45);
assert.deepStrictEqual(contract.vertical.size, {width: 1080, height: 1920});
assert.strictEqual(contract.camera.zoomPerFrame, 0.0018);
assert.strictEqual(contract.camera.minimumPanPixelsOn3840Canvas, 380);
assert.strictEqual(contract.shots.find((shot) => shot.id === 'flip').durationFrames, 1);
assert.strictEqual(contract.shots.find((shot) => shot.id === 'flip').transition, 'hard-cut');
assert.strictEqual(contract.shots.find((shot) => shot.id === 'gate').maxStaticSeconds, 4);
assert.strictEqual(contract.truth.kanbanOwner, 'sdtk-wiki');
assert.match(contract.truth.kanbanDescription, /SHARED_PLANNING\.md/);
assert.ok(!/sdtk-agent.?dashboard/i.test(contract.truth.kanbanDescription));

process.stdout.write('one spine contract: OK\n');
