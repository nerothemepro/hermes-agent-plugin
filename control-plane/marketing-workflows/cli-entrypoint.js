'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { execute } = require('./cli');
const { parseTelegramCommand } = require('./command-parser');

const SHA256 = /^[a-f0-9]{64}$/;

function requireValue(args, name) {
  const value = String(args[name] || '').trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function parseArgs(argv) {
  const args = { command: '', databaseFile: '', artifactRoot: '', commandId: '', runId: '', text: '', handoffFile: '' };
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (!args.command && !value.startsWith('--')) {
      args.command = value;
      continue;
    }
    const names = {
      '--database-file': 'databaseFile', '--artifact-root': 'artifactRoot', '--command-id': 'commandId',
      '--run-id': 'runId', '--text': 'text', '--handoff-file': 'handoffFile',
    };
    const name = names[value];
    if (!name || !argv[index + 1] || argv[index + 1].startsWith('--')) throw new Error(`unknown or incomplete argument: ${value}`);
    args[name] = argv[++index];
  }
  if (args.command !== 'telegram') throw new Error('exact command required: telegram');
  for (const name of ['databaseFile', 'artifactRoot', 'commandId', 'text']) requireValue(args, name);
  return args;
}

function derivedRunId(commandId) {
  return `run_mkt_${crypto.createHash('sha256').update(commandId).digest('hex').slice(0, 12)}`;
}

function assertInside(root, candidate) {
  const base = path.resolve(root);
  const target = path.resolve(candidate);
  if (target !== base && !target.startsWith(`${base}${path.sep}`)) throw new Error('handoff file is outside canonical artifact root');
  return target;
}

function readJsonFile(root, file, unavailableMessage) {
  const absolute = assertInside(root, file);
  if (!fs.existsSync(absolute) || !fs.lstatSync(absolute).isFile()) throw new Error(unavailableMessage);
  const realRoot = fs.realpathSync(root);
  const realFile = fs.realpathSync(absolute);
  assertInside(realRoot, realFile);
  try {
    const value = JSON.parse(fs.readFileSync(realFile, 'utf8'));
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('handoff must be a JSON object');
    return value;
  } catch (error) {
    throw new Error(`invalid handoff JSON: ${error.message}`);
  }
}

function readHandoff(args) {
  if (!args.handoffFile) return undefined;
  return readJsonFile(args.artifactRoot, args.handoffFile, 'handoff file is unavailable');
}

function resolveHandoff(args, requestedSha) {
  if (!SHA256.test(String(requestedSha || ''))) throw new Error('invalid requested handoff sha256');
  const file = path.join(path.resolve(args.artifactRoot), 'handoffs', `${requestedSha}.json`);
  const handoff = readJsonFile(args.artifactRoot, file, 'handoff is unavailable');
  if (handoff.approval?.artifact_sha256 !== requestedSha) throw new Error('handoff sha256 does not match requested artifact');
  return handoff;
}

function resolvedPrepareInput(args, command) {
  if (command.workflow === 'research_and_story') return undefined;
  if (args.handoffFile) return readHandoff(args);
  if (command.workflow === 'video_production') return resolveHandoff(args, command.brief_sha256);
  return {
    brief: resolveHandoff(args, command.brief_sha256),
    video: resolveHandoff(args, command.video_sha256),
  };
}

function run(args) {
  const command = parseTelegramCommand(args.text);
  const runId = args.runId || (command.action === 'prepare' ? derivedRunId(args.commandId) : '');
  return execute({
    databaseFile: args.databaseFile,
    artifactRoot: args.artifactRoot,
    commandId: args.commandId,
    runId,
    text: args.text,
    handoff: command.action === 'prepare' ? resolvedPrepareInput(args, command) : undefined,
  });
}

function main(argv = process.argv.slice(2)) {
  const result = run(parseArgs(argv));
  process.stdout.write(`${JSON.stringify(result)}\n`);
  return result;
}

module.exports = { assertInside, derivedRunId, main, parseArgs, readHandoff, resolveHandoff, resolvedPrepareInput, run };
