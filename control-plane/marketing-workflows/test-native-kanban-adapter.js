'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const test = require('node:test');
const { MarketingWorkflowController } = require('./controller');
const { NativeKanbanAdapter } = require('./native-kanban-adapter');

function setup() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'marketing-native-kanban-'));
  return {
    root,
    controller: new MarketingWorkflowController({ databaseFile: path.join(root, 'state.sqlite'), artifactRoot: path.join(root, 'artifacts') }),
  };
}

function approvedBrief() {
  return {
    schema_version: 'sdtk.marketing-handoff.v1', episode_id: 'EP4', revision: 'r1', workflow: 'research_and_story', validation_status: 'pass',
    approval: { gate: 'story_lock', status: 'approved', artifact_sha256: 'a'.repeat(64) },
    outputs: [{ path: 'research/production-brief.json', sha256: 'c'.repeat(64), media_type: 'application/json' }],
  };
}

test('native Kanban adapter creates one blocked HerVid card with a deterministic idempotency key before release and dispatch', () => {
  const env = setup();
  const calls = [];
  const client = {
    run(argv, options) {
      calls.push({ argv, options });
      if (argv.includes('create')) return { returncode: 0, stdout: JSON.stringify({ id: 't_video_001', status: 'blocked', assignee: 'hervid' }), stderr: '' };
      if (argv.includes('unblock')) return { returncode: 0, stdout: 'Unblocked t_video_001\n', stderr: '' };
      if (argv.includes('dispatch')) return { returncode: 0, stdout: JSON.stringify({ spawned: ['t_video_001'] }), stderr: '' };
      throw new Error('unexpected command');
    },
  };
  try {
    const prepared = env.controller.prepare({ commandId: 'telegram:601', workflow: 'video_production', runId: 'run_mkt_video001', input: approvedBrief() });
    env.controller.approveKickoff({ commandId: 'telegram:602', runId: prepared.run_id, packetSha256: prepared.kickoff_packet_sha256 });
    const adapter = new NativeKanbanAdapter({
      controller: env.controller,
      client,
      hermesBin: '/workspace/.venvs/hermes-agent/bin/hermes',
      profileHome: '/opt/data/hermes-profiles/hervid',
      board: 'marketing-video-staging',
    });

    const dispatched = adapter.dispatchReadyTask({ runId: prepared.run_id });

    assert.strictEqual(dispatched.native_task_id, 't_video_001');
    const state = env.controller.status(prepared.run_id);
    assert.strictEqual(state.status, 'external_pending');
    assert.deepStrictEqual(state.tasks.capture_assets, {
      status: 'external_released', attempt: 1, native_task_id: 't_video_001',
      idempotency_key: 'sdtk-marketing:run_mkt_video001:capture_assets:1', board: 'marketing-video-staging',
    });
    assert.deepStrictEqual(calls.map((entry) => entry.argv.slice(0, 5)), [
      ['/workspace/.venvs/hermes-agent/bin/hermes', 'kanban', '--board', 'marketing-video-staging', 'create'],
      ['/workspace/.venvs/hermes-agent/bin/hermes', 'kanban', '--board', 'marketing-video-staging', 'unblock'],
      ['/workspace/.venvs/hermes-agent/bin/hermes', 'kanban', '--board', 'marketing-video-staging', 'dispatch'],
    ]);
    assert.strictEqual(calls[0].argv[calls[0].argv.indexOf('--idempotency-key') + 1], 'sdtk-marketing:run_mkt_video001:capture_assets:1');
    assert.strictEqual(calls[0].argv[calls[0].argv.indexOf('--initial-status') + 1], 'blocked');
    assert.strictEqual(calls[0].options.env.HERMES_HOME, '/opt/data/hermes-profiles/hervid');
    assert.strictEqual(calls[0].options.env.HERMES_KANBAN_HOME, '/opt/data/hermes-profiles/hervid');
    assert.ok(!calls[1].argv.includes('--json'));
    assert.ok(calls[2].argv.includes('--json'));
  } finally {
    env.controller.close();
    fs.rmSync(env.root, { recursive: true, force: true });
  }
});

test('native Kanban adapter preserves a registered native card after dispatch fails and does not create a duplicate on recovery', () => {
  const env = setup();
  let createCount = 0;
  let dispatchAttempt = 0;
  const client = {
    run(argv) {
      if (argv.includes('create')) {
        createCount += 1;
        return { returncode: 0, stdout: JSON.stringify({ id: 't_video_002', status: 'blocked', assignee: 'hervid' }), stderr: '' };
      }
      if (argv.includes('unblock')) return { returncode: 0, stdout: 'Unblocked t_video_002\n', stderr: '' };
      if (argv.includes('dispatch')) {
        dispatchAttempt += 1;
        return dispatchAttempt === 1
          ? { returncode: 1, stdout: '', stderr: 'dispatcher unavailable' }
          : { returncode: 0, stdout: JSON.stringify({ spawned: ['t_video_002'] }), stderr: '' };
      }
      throw new Error('unexpected command');
    },
  };
  try {
    const prepared = env.controller.prepare({ commandId: 'telegram:611', workflow: 'video_production', runId: 'run_mkt_video002', input: approvedBrief() });
    env.controller.approveKickoff({ commandId: 'telegram:612', runId: prepared.run_id, packetSha256: prepared.kickoff_packet_sha256 });
    const adapter = new NativeKanbanAdapter({ controller: env.controller, client, profileHome: '/opt/data/hermes-profiles/hervid', board: 'marketing-video-staging' });

    assert.throws(() => adapter.dispatchReadyTask({ runId: prepared.run_id }), /native dispatcher failed/);
    const state = env.controller.status(prepared.run_id);
    assert.strictEqual(state.status, 'external_pending');
    assert.strictEqual(state.tasks.capture_assets.native_task_id, 't_video_002');
    assert.strictEqual(createCount, 1);

    const recovered = adapter.dispatchReadyTask({ runId: prepared.run_id });
    assert.strictEqual(recovered.native_task_id, 't_video_002');
    assert.strictEqual(createCount, 1);
    assert.strictEqual(dispatchAttempt, 2);
  } finally {
    env.controller.close();
    fs.rmSync(env.root, { recursive: true, force: true });
  }
});
