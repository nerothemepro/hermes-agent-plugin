'use strict';

const { spawnSync } = require('child_process');

const USAGE_COMMANDS = new Set([
  JSON.stringify(['sdtk', 'usage']),
  JSON.stringify(['sdtk', 'usage', '--json']),
]);

function validateUsageCommands(commands) {
  const findings = [];
  if (!Array.isArray(commands) || commands.length !== 2) {
    findings.push('exactly two usage commands are required');
  } else {
    const seen = new Set();
    commands.forEach((command) => {
      const encoded = command && Array.isArray(command.argv) ? JSON.stringify(command.argv) : '';
      if (!USAGE_COMMANDS.has(encoded)) findings.push('unsupported command argv');
      else seen.add(encoded);
      if (!Number.isFinite(command && command.hold_seconds) || command.hold_seconds < 1 || command.hold_seconds > 60) findings.push('invalid hold_seconds');
    });
    if (seen.size !== USAGE_COMMANDS.size) findings.push('both table and JSON usage commands are required');
  }
  return { ok: findings.length === 0, findings };
}

function browserLaunchOptions(executablePath) {
  return {
    headless: true,
    ...(executablePath ? { executablePath } : {}),
    args: ['--disable-dev-shm-usage', '--no-sandbox'],
  };
}

function redactOutput(value, fixtureHome) {
  return String(value || '').split(fixtureHome).join('~/.demo');
}

function runUsageCommands(commands, fixtureHome) {
  const validation = validateUsageCommands(commands);
  if (!validation.ok) throw new Error(validation.findings.join('; '));
  return commands.map((command) => {
    const result = spawnSync(command.argv[0], command.argv.slice(1), {
      cwd: fixtureHome,
      env: { ...process.env, HOME: fixtureHome, TERM: 'xterm-256color' },
      encoding: 'utf8',
      timeout: 30000,
      maxBuffer: 4 * 1024 * 1024,
    });
    if (result.error) throw result.error;
    if (result.status !== 0) throw new Error(command.argv.join(' ') + ' exited ' + result.status);
    const output = redactOutput((result.stdout || '') + (result.stderr || ''), fixtureHome).trim();
    if (!output) throw new Error(command.argv.join(' ') + ' produced no evidence output');
    return { argv: command.argv.slice(), hold_seconds: command.hold_seconds, output };
  });
}

function extractUsageMetrics(results) {
  const jsonResult = results.find((entry) => entry.argv.length === 3 && entry.argv[2] === '--json');
  if (!jsonResult) throw new Error('JSON usage evidence is unavailable');
  const parsed = JSON.parse(jsonResult.output);
  const account = parsed.accounts && parsed.accounts[0];
  const model = account && account.models && account.models[0];
  if (!account || !model) throw new Error('JSON usage evidence has no account/model data');
  const today = model.today || {};
  return [
    ['ACCOUNT', account.vendor],
    ['MODEL', model.model],
    ['INPUT', Number(today.input || 0).toLocaleString('en-US')],
    ['OUTPUT', Number(today.output || 0).toLocaleString('en-US')],
    ['CACHE READ', Number(today.cacheRead || 0).toLocaleString('en-US')],
    ['SOURCE', 'DEMO DATA'],
  ];
}

function buildTerminalHtml() {
  return `<!doctype html><html><head><meta charset="utf-8"><style>
*{box-sizing:border-box}body{margin:0;width:1920px;height:1080px;overflow:hidden;background:#1d3550;color:#f8fbff;font-family:Inter,Arial,sans-serif}.stage{height:100%;padding:64px 96px;background:radial-gradient(circle at 85% 10%,#294c6d 0,#1d3550 35%,#172b42 100%)}header{height:96px;display:flex;align-items:center;justify-content:space-between}.brand{font-size:46px;font-weight:800;color:#ff6a2b}.eyebrow{font:700 22px/1 ui-monospace,SFMono-Regular,monospace;color:#ffb07a}.shell{height:820px;border:1px solid #58728b;background:#10243a;box-shadow:0 28px 70px #07111faa;overflow:hidden}.bar{height:64px;background:#253f59;display:flex;align-items:center;padding:0 26px;gap:12px}.dot{width:14px;height:14px;border-radius:50%;background:#ff6a2b}.bar strong{margin-left:14px;font-size:20px}.truth{margin-left:auto;color:#c5d8e8;font:600 16px/1 ui-monospace,SFMono-Regular,monospace}.content{height:756px;display:grid;grid-template-columns:minmax(0,1fr) 390px}.terminal{height:756px;margin:0;padding:30px 34px;overflow:hidden;white-space:pre-wrap;color:#f8fbff;font:500 25px/1.46 ui-monospace,SFMono-Regular,Menlo,monospace}.metrics{border-left:1px solid #58728b;background:#18314b;padding:28px 24px;display:grid;grid-template-rows:repeat(6,1fr);gap:14px}.metric{border:1px solid #58728b;background:#213d58;padding:14px 18px;display:flex;flex-direction:column;justify-content:center}.metric-label{color:#9eb6ca;font:700 14px/1 ui-monospace,SFMono-Regular,monospace}.metric-value{margin-top:9px;color:#fff;font-size:27px;font-weight:750;overflow-wrap:anywhere}</style></head><body><main class="stage"><header><div class="brand">SDTK</div><div class="eyebrow">REAL USAGE | DEMO DATA</div></header><section class="shell"><div class="bar"><span class="dot"></span><span class="dot" style="opacity:.65"></span><span class="dot" style="opacity:.35"></span><strong>Usage evidence</strong><span class="truth">COMPOSITED FROM REAL COMMAND OUTPUT</span></div><div class="content"><pre id="terminal" class="terminal"></pre><aside id="metrics" class="metrics"></aside></div></section></main><script>const terminal=document.getElementById('terminal');const metrics=document.getElementById('metrics');window.setTerminal=(v)=>{terminal.textContent=v};window.appendTerminal=(v)=>{terminal.textContent+=v;terminal.scrollTop=terminal.scrollHeight};window.setMetrics=(items)=>{metrics.textContent='';for(const item of items){const card=document.createElement('div');card.className='metric';const label=document.createElement('div');label.className='metric-label';label.textContent=item[0];const value=document.createElement('div');value.className='metric-value';value.textContent=item[1];card.append(label,value);metrics.append(card)}};</script></body></html>`;
}

module.exports = {
  browserLaunchOptions,
  buildTerminalHtml,
  extractUsageMetrics,
  redactOutput,
  runUsageCommands,
  validateUsageCommands,
};
