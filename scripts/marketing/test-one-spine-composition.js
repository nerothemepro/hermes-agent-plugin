#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '../../media-pipeline/remotion/sdtk-tutorial/src');
const rootSource = fs.readFileSync(path.join(root, 'Root.jsx'), 'utf8');
const source = fs.readFileSync(path.join(root, 'OneSpine.jsx'), 'utf8');

assert.match(rootSource, /import \{OneSpine, OneSpineVertical\} from '\.\/OneSpine';/);
assert.match(rootSource, /id="OneSpine"[\s\S]*durationInFrames=\{2250\}[\s\S]*width=\{1920\}[\s\S]*height=\{1080\}/);
assert.match(rootSource, /id="OneSpineVertical"[\s\S]*durationInFrames=\{1350\}[\s\S]*width=\{1080\}[\s\S]*height=\{1920\}/);
assert.match(source, /rotateY\(-8deg\).*rotateX\(3deg\)/);
assert.match(source, /strokeDasharray/);
assert.match(source, /const MotionField/);
assert.match(source, /frame < frameAt\(4\)/);
assert.match(source, /0\.0048/);
assert.doesNotMatch(source, /if \(quietGate\) return null/);
assert.ok(source.lastIndexOf("<MotionField />") > source.lastIndexOf("frameAt(68)"));
assert.match(source, /hard-cut/);
assert.match(source, /sdtk-wiki kanban/);
assert.match(source, /const GatePass/);
assert.match(source, /GATE PASSED/);
assert.match(source, /frameAt\(12\)/);
assert.doesNotMatch(source, /sdtk-agent.?dashboard/i);

process.stdout.write('one spine composition contract: OK\n');
