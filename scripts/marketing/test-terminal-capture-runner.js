'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  browserLaunchOptions,
  buildTerminalHtml,
  redactOutput,
  validateUsageCommands,
} = require('./terminal-capture-runner');
const { loadPlaywright } = require('./record-terminal-evidence');

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

const moduleRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'sdtk-playwright-module-'));
fs.writeFileSync(path.join(moduleRoot, 'package.json'), JSON.stringify({ name: 'playwright', main: 'index.js' }));
fs.writeFileSync(path.join(moduleRoot, 'index.js'), 'module.exports={chromium:{fixture:true}};\n');
const priorModule = process.env.SDTK_MARKETING_PLAYWRIGHT_MODULE;
try {
  process.env.SDTK_MARKETING_PLAYWRIGHT_MODULE = moduleRoot;
  assert.equal(loadPlaywright().chromium.fixture, true);
  process.env.SDTK_MARKETING_PLAYWRIGHT_MODULE = 'relative/playwright';
  assert.throws(() => loadPlaywright(), /must be absolute/);
} finally {
  if (priorModule == null) delete process.env.SDTK_MARKETING_PLAYWRIGHT_MODULE;
  else process.env.SDTK_MARKETING_PLAYWRIGHT_MODULE = priorModule;
  fs.rmSync(moduleRoot, { recursive: true, force: true });
}

assert.equal(validateUsageCommands([
  { argv: ['sdtk', 'usage'], hold_seconds: 14 },
  { argv: ['sdtk', 'usage', '--json'], hold_seconds: 14 },
]).ok, true);
assert.equal(validateUsageCommands([{ argv: ['sh', '-c', 'sdtk usage'], hold_seconds: 14 }]).ok, false);
assert.equal(validateUsageCommands([{ argv: ['sdtk', 'publish'], hold_seconds: 14 }]).ok, false);

assert.equal(path.basename(require.resolve('./record-terminal-evidence')), 'record-terminal-evidence.js');
process.stdout.write('ok - Playwright real-command terminal composite contract\n');
