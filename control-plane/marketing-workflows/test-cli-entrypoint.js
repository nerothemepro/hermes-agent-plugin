'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const test = require('node:test');
const { parseArgs, run } = require('./cli-entrypoint');

function setup() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'marketing-workflow-cli-entry-'));
  return { root, databaseFile: path.join(root, 'state.sqlite'), artifactRoot: path.join(root, 'artifacts') };
}

test('CLI entrypoint derives a stable run id from one Telegram command id and never accepts unknown flags', () => {
  const env = setup();
  try {
    const args = parseArgs(['telegram', '--database-file', env.databaseFile, '--artifact-root', env.artifactRoot, '--command-id', 'telegram:500', '--text', '/marketing-research prepare EP4']);
    const prepared = run(args);
    assert.match(prepared.run_id, /^run_mkt_[a-f0-9]{12}$/);
    const repeated = run(args);
    assert.strictEqual(repeated.status, 'duplicate');
    assert.strictEqual(repeated.run_id, prepared.run_id);
    assert.throws(() => parseArgs(['telegram', '--database-file', env.databaseFile, '--artifact-root', env.artifactRoot, '--command-id', 'telegram:501', '--text', '/marketing-research prepare EP4', '--unsafe']), /unknown or incomplete argument/);
  } finally { fs.rmSync(env.root, { recursive: true, force: true }); }
});

test('CLI entrypoint accepts handoff files only from the canonical artifact root', () => {
  const env = setup();
  try {
    fs.mkdirSync(env.artifactRoot, { recursive: true });
    const outside = path.join(env.root, 'outside.json');
    fs.writeFileSync(outside, '{}\n');
    const args = parseArgs(['telegram', '--database-file', env.databaseFile, '--artifact-root', env.artifactRoot, '--command-id', 'telegram:502', '--text', `/marketing-video prepare ${'a'.repeat(64)}`, '--handoff-file', outside]);
    assert.throws(() => run(args), /handoff file is outside canonical artifact root/);
  } finally { fs.rmSync(env.root, { recursive: true, force: true }); }
});

test('CLI entrypoint does not invent a run id for a read-only status command', () => {
  const env = setup();
  try {
    const prepared = run(parseArgs(['telegram', '--database-file', env.databaseFile, '--artifact-root', env.artifactRoot, '--command-id', 'telegram:510', '--text', '/marketing-research prepare EP4']));
    const status = run(parseArgs(['telegram', '--database-file', env.databaseFile, '--artifact-root', env.artifactRoot, '--command-id', 'telegram:511', '--text', `/marketing-research status ${prepared.run_id}`]));
    assert.strictEqual(status.run_id, prepared.run_id);
    assert.strictEqual(status.status, 'awaiting_kickoff');
  } finally { fs.rmSync(env.root, { recursive: true, force: true }); }
});

test('CLI entrypoint resolves video and social handoffs only from hash-addressed files under the canonical artifact root', () => {
  const env = setup();
  const briefSha = 'a'.repeat(64);
  const videoSha = 'b'.repeat(64);
  const brief = {
    schema_version: 'sdtk.marketing-handoff.v1', episode_id: 'EP4', revision: 'r1',
    workflow: 'research_and_story', validation_status: 'pass',
    approval: { gate: 'story_lock', status: 'approved', artifact_sha256: briefSha },
  };
  const video = {
    schema_version: 'sdtk.marketing-handoff.v1', episode_id: 'EP4', revision: 'r1',
    workflow: 'video_production', validation_status: 'pass',
    approval: { gate: 'picture_lock', status: 'approved', artifact_sha256: videoSha },
    inputs: [{ sha256: briefSha }],
  };
  try {
    const handoffDir = path.join(env.artifactRoot, 'handoffs');
    fs.mkdirSync(handoffDir, { recursive: true });
    fs.writeFileSync(path.join(handoffDir, `${briefSha}.json`), JSON.stringify(brief));
    fs.writeFileSync(path.join(handoffDir, `${videoSha}.json`), JSON.stringify(video));

    const videoArgs = parseArgs(['telegram', '--database-file', env.databaseFile, '--artifact-root', env.artifactRoot, '--command-id', 'telegram:520', '--text', `/marketing-video prepare ${briefSha}`]);
    const preparedVideo = run(videoArgs);
    assert.strictEqual(preparedVideo.workflow, 'video_production');

    const socialArgs = parseArgs(['telegram', '--database-file', env.databaseFile, '--artifact-root', env.artifactRoot, '--command-id', 'telegram:521', '--text', `/marketing-social prepare ${briefSha} ${videoSha}`]);
    const preparedSocial = run(socialArgs);
    assert.strictEqual(preparedSocial.workflow, 'social_distribution');
  } finally { fs.rmSync(env.root, { recursive: true, force: true }); }
});

test('CLI entrypoint fails closed when a hash-addressed handoff is absent or does not match the requested SHA', () => {
  const env = setup();
  const briefSha = 'c'.repeat(64);
  try {
    const missing = parseArgs(['telegram', '--database-file', env.databaseFile, '--artifact-root', env.artifactRoot, '--command-id', 'telegram:530', '--text', `/marketing-video prepare ${briefSha}`]);
    assert.throws(() => run(missing), /handoff is unavailable/);

    const handoffDir = path.join(env.artifactRoot, 'handoffs');
    fs.mkdirSync(handoffDir, { recursive: true });
    fs.writeFileSync(path.join(handoffDir, `${briefSha}.json`), JSON.stringify({ approval: { artifact_sha256: 'd'.repeat(64) } }));
    assert.throws(() => run(missing), /handoff sha256 does not match requested artifact/);
  } finally { fs.rmSync(env.root, { recursive: true, force: true }); }
});
