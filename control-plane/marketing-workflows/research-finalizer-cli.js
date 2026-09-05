'use strict';

const fs = require('fs');
const path = require('path');
const { finalizeResearchBrief } = require('./research-finalizer');

function parseArgs(argv) {
  const values = {};
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    if (!['--root', '--run-id', '--attempt', '--seed-file'].includes(flag) || !argv[index + 1] || argv[index + 1].startsWith('--')) throw new Error('unknown or incomplete argument: ' + flag);
    values[flag.slice(2).replace(/-([a-z])/g, (_, c) => c.toUpperCase())] = argv[++index];
  }
  for (const key of ['root', 'runId', 'attempt', 'seedFile']) if (!values[key]) throw new Error(key + ' is required');
  const root = path.resolve(values.root);
  const seedFile = path.resolve(root, values.seedFile);
  if (seedFile === root || !seedFile.startsWith(root + path.sep) || !fs.existsSync(seedFile)) throw new Error('seed file is unavailable');
  let seed;
  try { seed = JSON.parse(fs.readFileSync(seedFile, 'utf8')); } catch { throw new Error('seed file is not valid JSON'); }
  return { root, runId: values.runId, attempt: values.attempt, seed };
}

function main(argv = process.argv.slice(2)) {
  const result = finalizeResearchBrief(parseArgs(argv));
  process.stdout.write(JSON.stringify(result) + '\n');
  return result;
}

module.exports = { main, parseArgs };
if (require.main === module) {
  try { main(); } catch (error) { process.stderr.write(JSON.stringify({ status: 'error', error: error.message }) + '\n'); process.exitCode = 1; }
}
