'use strict';

const fs = require('fs');
const https = require('https');
const path = require('path');
const { MarketingWorkflowController } = require('./controller');
const { execute } = require('./production-entrypoint');
const { baselineNotifications, drainNotifications } = require('./notifier');

const DEFAULT_DATABASE_FILE = '/opt/data/hermes/control-plane/marketing-workflows/state.sqlite';
const DEFAULT_ARTIFACT_ROOT = '/opt/data/hermes/control-plane/marketing-workflows/artifacts';
const DEFAULT_STATE_FILE = '/opt/data/hermes/control-plane/marketing-workflows/monitor-state.json';

function boundedInterval(value) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 5 || parsed > 300) throw new Error('poll interval must be 5..300 seconds');
  return parsed;
}

function atomicJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const temporary = file + '.tmp';
  fs.writeFileSync(temporary, JSON.stringify(value, null, 2) + '\n', { mode: 0o600 });
  fs.renameSync(temporary, file);
}

function loadJson(file, fallback) {
  try { const value = JSON.parse(fs.readFileSync(file, 'utf8')); return value && typeof value === 'object' && !Array.isArray(value) ? value : fallback; } catch { return fallback; }
}

function sendTelegram(text, environment = process.env) {
  const token = environment.TELEGRAM_BOT_TOKEN;
  const chatId = environment.TELEGRAM_HOME_CHANNEL;
  if (!token || !chatId) return Promise.reject(new Error('Telegram notifier environment is unavailable'));
  const data = new URLSearchParams({ chat_id: chatId, text }).toString();
  return new Promise((resolve, reject) => {
    const request = https.request({ hostname: 'api.telegram.org', path: `/bot${token}/sendMessage`, method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded', 'content-length': Buffer.byteLength(data) }, timeout: 15000 }, (response) => {
      response.resume();
      if (response.statusCode && response.statusCode < 300) resolve(); else reject(new Error('Telegram notification failed'));
    });
    request.once('timeout', () => request.destroy(new Error('Telegram notification timed out')));
    request.once('error', reject);
    request.end(data);
  });
}

class MarketingWorkflowMonitor {
  constructor(options = {}) {
    this.databaseFile = path.resolve(options.databaseFile || process.env.MARKETING_WORKFLOW_DATABASE_FILE || DEFAULT_DATABASE_FILE);
    this.artifactRoot = path.resolve(options.artifactRoot || process.env.MARKETING_WORKFLOW_ARTIFACT_ROOT || DEFAULT_ARTIFACT_ROOT);
    this.stateFile = path.resolve(options.stateFile || process.env.MARKETING_WORKFLOW_MONITOR_STATE_FILE || DEFAULT_STATE_FILE);
    this.intervalSeconds = boundedInterval(options.intervalSeconds || process.env.MARKETING_WORKFLOW_MONITOR_INTERVAL_SECONDS || 20);
    this.client = options.client;
    this.send = options.send || ((message) => sendTelegram(message));
  }

  _controller() { return new MarketingWorkflowController({ databaseFile: this.databaseFile, artifactRoot: this.artifactRoot }); }

  async _deliverIssues(reconciliation, state) {
    const next = {};
    let delivered = 0;
    for (const result of reconciliation.results || []) {
      if (result.status !== 'invalid_candidate') continue;
      const key = `${result.run_id}:invalid_candidate`;
      const digest = String(result.error || 'candidate validation failed');
      next[key] = digest;
      if (state.issues?.[key] !== digest) {
        await this.send(`Marketing workflow requires attention\nrun_id: ${result.run_id}\nstatus: invalid_candidate\nrecovery: inspect the canonical worker-result.json; no retry or approval was performed.`);
        delivered += 1;
      }
    }
    return { delivered, issues: next };
  }

  async tick() {
    const state = loadJson(this.stateFile, { bootstrapped: false, issues: {} });
    let baselined = false;
    if (!state.bootstrapped) {
      const controller = this._controller();
      try { baselineNotifications(controller.kernel); } finally { controller.close(); }
      state.bootstrapped = true;
      baselined = true;
    }
    const reconciliation = execute({ command: 'reconcile-all', databaseFile: this.databaseFile, artifactRoot: this.artifactRoot, runId: '' }, this.client ? { client: this.client } : {});
    const issueDelivery = await this._deliverIssues(reconciliation, state);
    state.issues = issueDelivery.issues;
    const controller = this._controller();
    let delivered = 0;
    try { delivered = await drainNotifications(controller.kernel, this.send); } finally { controller.close(); }
    state.updated_at = new Date().toISOString();
    atomicJson(this.stateFile, state);
    return { baselined, reconciled: reconciliation.results || [], delivered: delivered + issueDelivery.delivered };
  }

  async runForever() {
    for (;;) {
      try { console.log(JSON.stringify({ event: 'marketing_workflow_monitor_tick', ...(await this.tick()) })); } catch (error) { console.log(JSON.stringify({ event: 'marketing_workflow_monitor_error', error: error.message })); }
      await new Promise((resolve) => setTimeout(resolve, this.intervalSeconds * 1000));
    }
  }
}

function parseArgs(argv) {
  if (argv.length === 0) return { once: false };
  if (argv.length === 1 && argv[0] === '--once') return { once: true };
  throw new Error('exact monitor command is optional --once');
}

async function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  const monitor = new MarketingWorkflowMonitor();
  if (args.once) { process.stdout.write(JSON.stringify(await monitor.tick()) + '\n'); return; }
  await monitor.runForever();
}

module.exports = { MarketingWorkflowMonitor, atomicJson, loadJson, main, parseArgs, sendTelegram };
if (require.main === module) main().catch((error) => { process.stderr.write(JSON.stringify({ status: 'error', error: error.message }) + '\n'); process.exitCode = 1; });
