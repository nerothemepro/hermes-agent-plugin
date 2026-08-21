'use strict';

const assert = require('assert');
const path = require('path');
const {
  browserLaunchOptions,
  buildTerminalHtml,
  redactOutput,
  validateUsageCommands,
} = require('./terminal-capture-runner');

const fixture = '/tmp/run/fixtures/usage-demo';
assert.equal(redactOutput('source=' + fixture + '/.claude', fixture), 'source=~/.demo/.claude');
const html = buildTerminalHtml();
assert.match(html, /COMPOSITED FROM REAL COMMAND OUTPUT/);
assert.doesNotMatch(html, /ttyd/i);

const browser = browserLaunchOptions('/tmp/chrome');
assert.equal(browser.headless, true);
assert.equal(browser.executablePath, '/tmp/chrome');
assert.ok(browser.args.includes('--no-sandbox'), 'Playwright explicitly bypasses unsupported container sandbox');
assert.ok(browser.args.includes('--disable-dev-shm-usage'));

assert.equal(validateUsageCommands([
  { argv: ['sdtk', 'usage'], hold_seconds: 14 },
  { argv: ['sdtk', 'usage', '--json'], hold_seconds: 14 },
]).ok, true);
assert.equal(validateUsageCommands([{ argv: ['sh', '-c', 'sdtk usage'], hold_seconds: 14 }]).ok, false);
assert.equal(validateUsageCommands([{ argv: ['sdtk', 'publish'], hold_seconds: 14 }]).ok, false);

assert.equal(path.basename(require.resolve('./record-terminal-evidence')), 'record-terminal-evidence.js');
process.stdout.write('ok - Playwright real-command terminal composite contract\n');
