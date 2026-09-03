'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const test = require('node:test');
const { execute } = require('./cli');

function setup() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'marketing-workflow-cli-'));
  return {
    root,
    databaseFile: path.join(root, 'state.sqlite'),
    artifactRoot: path.join(root, 'artifacts'),
  };
}

test('CLI prepares a research run, returns a SHA-pinned kickoff packet, and deduplicates the Telegram update', () => {
  const env = setup();
  try {
    const prepared = execute({
      databaseFile: env.databaseFile,
      artifactRoot: env.artifactRoot,
      commandId: 'telegram:100',
      runId: 'run_research_300',
      text: '/marketing-research prepare EP4',
    });
    assert.strictEqual(prepared.status, 'awaiting_kickoff');
    assert.strictEqual(prepared.run_id, 'run_research_300');
    assert.match(prepared.kickoff_packet_sha256, /^[a-f0-9]{64}$/);

    const duplicate = execute({
      databaseFile: env.databaseFile,
      artifactRoot: env.artifactRoot,
      commandId: 'telegram:100',
      runId: 'run_research_300',
      text: '/marketing-research prepare EP4',
    });
    assert.strictEqual(duplicate.status, 'duplicate');
    assert.strictEqual(duplicate.state.revision, prepared.state.revision);

    const kickoff = execute({
      databaseFile: env.databaseFile,
      artifactRoot: env.artifactRoot,
      commandId: 'telegram:101',
      text: `APPROVE RESEARCH KICKOFF run_research_300 ${prepared.kickoff_packet_sha256}`,
    });
    assert.strictEqual(kickoff.status, 'ready_for_worker_dispatch');
    assert.strictEqual(kickoff.state.status, 'ready');
  } finally { fs.rmSync(env.root, { recursive: true, force: true }); }
});

test('CLI rejects unexpected arguments and a supplied run id that conflicts with an exact Telegram command', () => {
  const env = setup();
  try {
    assert.throws(() => execute({ databaseFile: env.databaseFile, artifactRoot: env.artifactRoot, commandId: 'telegram:102', runId: 'run_research_301', text: '/marketing-video prepare' }), /exact Telegram marketing command required/);
    assert.throws(() => execute({ databaseFile: env.databaseFile, artifactRoot: env.artifactRoot, commandId: 'telegram:103', runId: 'run_other_301', text: `APPROVE RESEARCH KICKOFF run_research_301 ${'a'.repeat(64)}` }), /run id conflicts with Telegram command/);
  } finally { fs.rmSync(env.root, { recursive: true, force: true }); }
});

test('CLI rejects a valid command grammar when its workflow prefix does not match the canonical run', () => {
  const env = setup();
  try {
    const prepared = execute({ databaseFile: env.databaseFile, artifactRoot: env.artifactRoot, commandId: 'telegram:110', runId: 'run_research_310', text: '/marketing-research prepare EP4' });
    assert.throws(
      () => execute({ databaseFile: env.databaseFile, artifactRoot: env.artifactRoot, commandId: 'telegram:111', text: `/marketing-video status ${prepared.run_id}` }),
      /workflow does not match canonical run/,
    );
    assert.throws(
      () => execute({ databaseFile: env.databaseFile, artifactRoot: env.artifactRoot, commandId: 'telegram:112', text: `CANCEL VIDEO RUN ${prepared.run_id}` }),
      /workflow does not match canonical run/,
    );
  } finally { fs.rmSync(env.root, { recursive: true, force: true }); }
});
