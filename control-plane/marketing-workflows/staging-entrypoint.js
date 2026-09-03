'use strict';

const childProcess = require('child_process');
const path = require('path');
const { MarketingWorkflowController } = require('./controller');
const { NativeKanbanAdapter } = require('./native-kanban-adapter');
const { WorkerResultBridge } = require('./worker-result-bridge');

const STAGING_BOARD = 'marketing-video-staging';
const HERVID_HOME = '/opt/data/hermes-profiles/hervid';
const HERMES_BIN = '/workspace/.venvs/hermes-agent/bin/hermes';

function requireText(value, name) {
  const result = String(value || '').trim();
  if (!result) throw new Error(`${name} is required`);
  return result;
}
function absolute(value, name) {
  const input = requireText(value, name);
  if (!path.isAbsolute(input)) throw new Error(`${name} must be absolute`);
  return path.resolve(input);
}
function parseArgs(argv) {
  const [command, ...rest] = argv;
  if (!['dispatch', 'submit'].includes(command)) throw new Error('exact staging command required: dispatch | submit');
  const values = {};
  for (let index = 0; index < rest.length; index += 1) {
    const flag = rest[index];
    if (!['--database-file', '--artifact-root', '--run-id', '--task-id', '--native-task-id', '--candidate-file'].includes(flag) || !rest[index + 1] || rest[index + 1].startsWith('--')) throw new Error(`unknown or incomplete argument: ${flag}`);
    values[flag.slice(2).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase())] = rest[++index];
  }
  for (const name of ['databaseFile', 'artifactRoot', 'runId']) requireText(values[name], name);
  if (command === 'submit') for (const name of ['taskId', 'nativeTaskId', 'candidateFile']) requireText(values[name], name);
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
  if (process.env.SDTK_MARKETING_WORKFLOW_MODE !== 'staging') throw new Error('staging mode is not enabled');
  const controller = dependencies.controller || new MarketingWorkflowController({ databaseFile: absolute(args.databaseFile, 'database file'), artifactRoot: absolute(args.artifactRoot, 'artifact root') });
  const client = dependencies.client || nativeClient(dependencies.spawnSync);
  const shared = { controller, client, hermesBin: HERMES_BIN, profileHome: HERVID_HOME, board: STAGING_BOARD };
  try {
    if (args.command === 'dispatch') return new NativeKanbanAdapter(shared).dispatchReadyTask({ runId: args.runId });
    return new WorkerResultBridge(shared).submit({ runId: args.runId, taskId: args.taskId, nativeTaskId: args.nativeTaskId, candidateFile: args.candidateFile });
  } finally {
    if (!dependencies.controller) controller.close();
  }
}
function main(argv = process.argv.slice(2)) {
  const result = execute(parseArgs(argv));
  process.stdout.write(`${JSON.stringify(result)}\n`);
  return result;
}
module.exports = { HERMES_BIN, HERVID_HOME, STAGING_BOARD, execute, main, nativeClient, parseArgs };
if (require.main === module) {
  try { main(); } catch (error) { process.stderr.write(`${JSON.stringify({ status: 'error', error: error.message })}\n`); process.exitCode = 1; }
}
