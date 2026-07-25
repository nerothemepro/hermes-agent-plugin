#!/usr/bin/env node
'use strict';

const assert = require('assert');
const { normalizePermalink } = require('./fb-video-upload');

assert.strictEqual(normalizePermalink('/reel/1704213034211650/', 'ignored'), 'https://www.facebook.com/reel/1704213034211650/');
assert.strictEqual(normalizePermalink('https://www.facebook.com/videos/123', 'ignored'), 'https://www.facebook.com/videos/123');
assert.strictEqual(normalizePermalink('', '123'), 'https://www.facebook.com/123');

console.log('fb-video-upload permalink tests: 3 passed');
