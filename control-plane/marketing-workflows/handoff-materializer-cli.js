#!/usr/bin/env node
'use strict';
const path = require('path');
const { MarketingWorkflowController } = require('./controller');
function parseArgs(argv) {
  const values = {};
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    if (!['--database-file', '--artifact-root', '--run-id'].includes(flag) || !argv[i + 1] || argv[i + 1].startsWith('--')) throw new Error('exact arguments required: --database-file --artifact-root --run-id');
    values[flag.slice(2).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase())] = argv[++i];
  }
  for (const key of ['databaseFile', 'artifactRoot', 'runId']) if (!values[key]) throw new Error(key + ' is required');
  if (!path.isAbsolute(values.databaseFile) || !path.isAbsolute(values.artifactRoot) || !/^run_[a-z0-9_]+$/.test(values.runId)) throw new Error('invalid handoff materializer arguments');
  return values;
}
function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  const controller = new MarketingWorkflowController({ databaseFile: args.databaseFile, artifactRoot: args.artifactRoot });
  try {
    const result = controller.materializeHandoff(args.runId);
    if (!result) throw new Error('run has no accepted final handoff');
    process.stdout.write(JSON.stringify({ status: result.wrote ? 'materialized' : 'already_materialized', path: result.path, approval: result.handoff.approval }) + '\n');
    return result;
  } finally { controller.close(); }
}
if (require.main === module) { try { main(); } catch (error) { process.stderr.write(JSON.stringify({ status: 'error', error: error.message }) + '\n'); process.exitCode = 1; } }
module.exports = { main, parseArgs };
