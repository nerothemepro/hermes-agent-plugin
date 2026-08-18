'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const test = require('node:test');

const { loadDogfoodDefects, renderBacklog, renderPlanning, selectRun, statusProjection } = require('./project-kanban');

test('active-run selection ignores a newer blocked run', () => {
  const selected = selectRun([
    {
      run_id: 'run_blocked_newer',
      feature_key: 'HCP_MARKETING_VIDEO_EP_USAGE',
      status: 'blocked',
      updated_at: '2026-08-18T02:00:00Z',
    },
    {
      run_id: 'run_running_older',
      feature_key: 'HCP_MARKETING_VIDEO_EP_USAGE',
      status: 'running',
      updated_at: '2026-08-18T01:00:00Z',
    },
  ]);

  assert.strictEqual(selected.run_id, 'run_running_older');
});

test('blocked is projected as terminal BLOCKED rather than pending work', () => {
  assert.deepStrictEqual(statusProjection('blocked'), { status: 'BLOCKED', reason: 'ledger status: blocked' });
});

test('backlog renders linked toolchain defects separately from episode cards', () => {
  const manifest = { episodes: [{ backlog_id: 'BK-39902', episode: 'EP2', title: 'Cost proof', status: 'IN_PROGRESS' }] };
  const output = renderBacklog(manifest, '2026-08-18T03:00:00Z', [{
    defect_id: 'DEF-EP2-001',
    title: 'Blocked run reused',
    severity: 'P1',
    status: 'OPEN',
    run_id: 'run_blocked_abc123',
    task_id: 'script_package',
    next_action: 'Fix terminal-state reuse',
  }]);
  assert.match(output, /DEF-EP2-001/);
  assert.ok(output.includes('run_blocked_abc123 / script_package'));
  assert.match(output, /Fix terminal-state reuse/);
});

test('planning exposes attempt heartbeat blocker class and next action', () => {
  const output = renderPlanning({
    run_id: 'run_running_abc123',
    feature_key: 'HCP_MARKETING_VIDEO_EP_USAGE',
    status: 'running',
    updated_at: '2026-08-18T03:00:00Z',
    tasks: {
      episode_render: {
        type: 'task', role: 'video', status: 'running_external', attempt: 2,
        last_heartbeat: '2026-08-18T02:59:00Z', blocker_class: 'RECOVERABLE_RUNTIME',
        next_action: 'Monitor native card',
      },
    },
  }, '2026-08-18T03:00:00Z');
  assert.match(output, /\| 2 \| 2026-08-18T02:59:00Z \|/);
  assert.match(output, /RECOVERABLE_RUNTIME/);
  assert.match(output, /Monitor native card/);
});

test('defect loader returns project-local validated defect records', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'video-dogfood-projector-'));
  const defectPath = path.join(root, 'defects.json');
  fs.writeFileSync(defectPath, JSON.stringify({ schema_version: 'hermes.video-dogfood-defects.v1', defects: [{ defect_id: 'DEF-EP2-001', status: 'OPEN' }] }));
  try {
    assert.strictEqual(loadDogfoodDefects(defectPath)[0].defect_id, 'DEF-EP2-001');
    assert.deepStrictEqual(loadDogfoodDefects(path.join(root, 'missing.json')), []);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});


test('dependency wait is projected as PENDING rather than an unknown blocker', () => {
  assert.deepStrictEqual(statusProjection('waiting_for_dependency'), { status: 'PENDING', reason: '' });
});
