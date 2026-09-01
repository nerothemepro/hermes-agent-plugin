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
