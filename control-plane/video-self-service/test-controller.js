'use strict';
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const test = require('node:test');
const { kickoff, prepare } = require('./controller');

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'video-controller-'));
  const project = path.join(root, 'project');
  const registry = path.join(root, 'registry');
  const runId = 'run_abc123_def456';
  fs.mkdirSync(path.join(project, '.sdtk', 'agent-runtime', 'runs', runId), { recursive: true });
  fs.mkdirSync(registry, { recursive: true });
  fs.writeFileSync(path.join(project, '.sdtk', 'agent-runtime', 'runs', runId, 'state.json'), JSON.stringify({ run_id: runId, status: 'running', tasks: {} }));
  return { root, project, registry, runId };
}

test('prepare refuses before ledger creation when exact-context preflight fails', () => {
  let prepared = false;
  const result = prepare({ episode: 'EP2' }, {
    preflightEpisode() { return { ok: false, preflight_sha256: 'a'.repeat(64), checks: [{ name: 'tool:ffmpeg', ok: false }] }; },
    prepareTemplate() { prepared = true; },
  });
  assert.equal(result.status, 'preflight_failed');
  assert.equal(prepared, false);
});

test('prepare carries packet sha into exact owner kickoff approval', () => {
  const packet = { ok: true, preflight_sha256: 'a'.repeat(64), manifest_sha256: 'b'.repeat(64) };
  const result = prepare({ episode: 'EP2' }, {
    preflightEpisode() { return packet; },
    prepareTemplate(_template, _params, options) {
      assert.equal(options.preflightPacket, packet);
      return { status: 'prepared_waiting_for_exact_dispatch_approval', run_id: 'run_abc123_def456' };
    },
  });
  assert.equal(result.exact_kickoff_approval, `APPROVE VIDEO KICKOFF run_abc123_def456 ${'b'.repeat(64)}`);
});

test('kickoff requires matching preflight packet before one bounded dispatch', (t) => {
  const f = fixture();
  t.after(() => fs.rmSync(f.root, { recursive: true, force: true }));
  fs.writeFileSync(path.join(f.registry, f.runId + '.json'), JSON.stringify({ run_id: f.runId, episode_manifest_sha256: 'c'.repeat(64), preflight_sha256: 'e'.repeat(64) }));
  assert.throws(() => kickoff({ projectPath: f.project, registryDir: f.registry, runId: f.runId, manifestSha256: 'd'.repeat(64) }), /mismatched/);
  let argv = null;
  const result = kickoff({ projectPath: f.project, registryDir: f.registry, runId: f.runId, manifestSha256: 'c'.repeat(64) }, {
    commandRunner(_command, args) { argv = args; return { status: 0, stdout: JSON.stringify({ status: 'running' }) }; },
  });
  assert.equal(result.status, 'dispatched');
  assert.deepEqual(argv, ['run', 'continue', '--project-path', f.project, '--run-id', f.runId, '--confirm', '--json']);
});

test('approve gate validates the current exact gate and advances once with the packet hash', (t) => {
  const f = fixture();
  t.after(() => fs.rmSync(f.root, { recursive: true, force: true }));
  fs.writeFileSync(path.join(f.project, '.sdtk', 'agent-runtime', 'runs', f.runId, 'state.json'), JSON.stringify({ run_id: f.runId, status: 'waiting_for_approval', waiting_gate: 'owner_story_lock', tasks: { script_package: { params: { episode_manifest_sha256: 'b'.repeat(64) } } } }));
  const evidenceDir = path.join(f.project, '.sdtk', 'agent-runtime', 'runs', f.runId, 'evidence');
  fs.mkdirSync(evidenceDir, { recursive: true });
  fs.writeFileSync(path.join(evidenceDir, 'script_package.json'), JSON.stringify({ run_id: f.runId, task_id: 'script_package' }));
  const { approveGate, gatePacket } = require('./controller');
  const packet = gatePacket({ projectPath: f.project, runId: f.runId, gateId: 'story_lock' });
  const calls = [];
  const result = approveGate({ projectPath: f.project, runId: f.runId, gateId: 'story_lock', packetSha256: packet.packet_sha256 }, {
    commandRunner(_command, args) { calls.push(args); return { status: 0, stdout: JSON.stringify({ status: 'running' }) }; },
  });
  assert.equal(result.status, 'gate_approved_and_advanced');
  assert.deepEqual(calls[0], ['gate', 'approve', '--project-path', f.project, '--run-id', f.runId, '--gate', 'owner_story_lock', '--approved-by', 'owner', '--note', `packet_sha256=${packet.packet_sha256}`]);
  assert.deepEqual(calls[1], ['run', 'continue', '--project-path', f.project, '--run-id', f.runId, '--confirm', '--json']);
});

test('reject and cancel are fail-closed for a wrong state and terminal run', (t) => {
  const f = fixture();
  t.after(() => fs.rmSync(f.root, { recursive: true, force: true }));
  const { cancel, rejectGate } = require('./controller');
  assert.throws(() => rejectGate({ projectPath: f.project, runId: f.runId, gateId: 'story_lock', reasonCode: 'NEEDS_FIX' }), /not waiting/);
  fs.writeFileSync(path.join(f.project, '.sdtk', 'agent-runtime', 'runs', f.runId, 'state.json'), JSON.stringify({ run_id: f.runId, status: 'cancelled', tasks: {} }));
  assert.deepEqual(cancel({ projectPath: f.project, runId: f.runId }), { status: 'terminal_no_cancel', run_id: f.runId });
});

test('recovery permits one recoverable-worker retry only and never dispatches it', (t) => {
  const f = fixture();
  t.after(() => fs.rmSync(f.root, { recursive: true, force: true }));
  fs.writeFileSync(path.join(f.project, '.sdtk', 'agent-runtime', 'runs', f.runId, 'state.json'), JSON.stringify({ run_id: f.runId, status: 'blocked', tasks: { episode_render: { blocker_class: 'RECOVERABLE_WORKER', retry_count: 0 } } }));
  const { recover } = require('./controller');
  let args;
  const result = recover({ projectPath: f.project, runId: f.runId, taskId: 'episode_render' }, {
    commandRunner(_command, argv) { args = argv; return { status: 0, stdout: JSON.stringify({ status: 'ready' }) }; },
  });
  assert.equal(result.status, 'recovery_rereadied');
  assert.deepEqual(args, ['task', 'retry', '--project-path', f.project, '--run-id', f.runId, '--task', 'episode_render', '--max', '1', '--reason', 'recoverable_worker', '--json']);
  fs.writeFileSync(path.join(f.project, '.sdtk', 'agent-runtime', 'runs', f.runId, 'state.json'), JSON.stringify({ run_id: f.runId, status: 'blocked', tasks: { episode_render: { blocker_class: 'RECOVERABLE_WORKER', retry_count: 1 } } }));
  assert.throws(() => recover({ projectPath: f.project, runId: f.runId, taskId: 'episode_render' }), /budget exhausted/);
});
