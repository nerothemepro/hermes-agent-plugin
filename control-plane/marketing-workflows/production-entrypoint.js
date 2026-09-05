'use strict';

const childProcess = require('child_process');
const path = require('path');
const { MarketingWorkflowController } = require('./controller');
const { NativeKanbanAdapter } = require('./native-kanban-adapter');

const HERMES_BIN = '/workspace/.venvs/hermes-agent/bin/hermes';
const PRODUCTION_WORKFLOWS = Object.freeze({
  research_and_story: { board: 'default', profileHome: '/opt/data/hermes-profiles/herresearch', assignee: 'herresearch' },
});

function required(value, name) {
  const result = String(value || '').trim();
  if (!result || !path.isAbsolute(result)) throw new Error(name + ' must be an absolute path');
  return path.resolve(result);
}

function parseArgs(argv) {
  const [command, ...rest] = argv;
  if (command !== 'dispatch') throw new Error('exact production command required: dispatch');
  const values = {};
  for (let i = 0; i < rest.length; i += 1) {
    const flag = rest[i];
    if (!['--database-file', '--artifact-root', '--run-id'].includes(flag) || !rest[i + 1] || rest[i + 1].startsWith('--')) throw new Error('unknown or incomplete argument: ' + flag);
    values[flag.slice(2).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase())] = rest[++i];
  }
  for (const key of ['databaseFile', 'artifactRoot', 'runId']) if (!values[key]) throw new Error(key + ' is required');
  return { command, ...values };
}

function nativeClient(spawnSync = childProcess.spawnSync) {
  return {
    run(argv, options) {
      const result = spawnSync(argv[0], argv.slice(1), { encoding: 'utf8', timeout: 30000, maxBuffer: 1024 * 1024, env: options.env });
      return { returncode: result.status === null ? 1 : result.status, stdout: result.stdout || '', stderr: result.stderr || '' };
    },
  };
}

function execute(args, dependencies = {}) {
  const controller = dependencies.controller || new MarketingWorkflowController({ databaseFile: required(args.databaseFile, 'database file'), artifactRoot: required(args.artifactRoot, 'artifact root') });
  const client = dependencies.client || nativeClient(dependencies.spawnSync);
  try {
    const state = controller.status(args.runId);
    const profile = PRODUCTION_WORKFLOWS[state.workflow];
    if (!profile) throw new Error('production dispatch is not enabled for this workflow');
    if (state.status !== 'ready' && state.status !== 'external_released') throw new Error('run is not ready for production dispatch');
    const result = new NativeKanbanAdapter({ controller, client, hermesBin: HERMES_BIN, workflow: state.workflow, ...profile }).dispatchReadyTask({ runId: args.runId });
    return { status: 'dispatched', ...result, state: controller.status(args.runId) };
  } finally {
    if (!dependencies.controller) controller.close();
  }
}

function main(argv = process.argv.slice(2)) {
  const result = execute(parseArgs(argv));
  process.stdout.write(JSON.stringify(result) + '\n');
  return result;
}

module.exports = { PRODUCTION_WORKFLOWS, execute, main, nativeClient, parseArgs };
if (require.main === module) {
  try { main(); } catch (error) { process.stderr.write(JSON.stringify({ status: 'error', error: error.message }) + '\n'); process.exitCode = 1; }
}
