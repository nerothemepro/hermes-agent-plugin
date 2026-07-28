#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const source = fs.readFileSync('scripts/marketing/remotion-render.js', 'utf8');

assert.match(source, /captureComposition || configuredComposition/);
assert.match(source, /OneSpine/);
assert.match(source, /one-spine render requires --input/);
assert.match(source, /manifest.captures/);
assert.match(source, /props = { captures: mappedCaptures, facts: manifest.facts || {} }/);
process.stdout.write('one spine Remotion delegate contract: OK\n');
