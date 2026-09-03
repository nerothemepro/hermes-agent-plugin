'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const test = require('node:test');

const { WorkflowKernel } = require('./kernel');

function temporaryDatabase() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'marketing-workflow-kernel-'));
  return { root, file: path.join(root, 'kernel.sqlite') };
}

test('command and initial run events commit once with one outbox notification', () => {
  const temp = temporaryDatabase();
  try {
    const kernel = new WorkflowKernel(temp.file);
    const first = kernel.acceptCommand({ commandId: 'telegram:100:200', workflow: 'video_production', runId: 'run_video_001', payload: { brief_sha256: 'a'.repeat(64) } });
    const duplicate = kernel.acceptCommand({ commandId: 'telegram:100:200', workflow: 'video_production', runId: 'run_video_duplicate', payload: { brief_sha256: 'a'.repeat(64) } });
    assert.strictEqual(first.duplicate, false);
    assert.strictEqual(duplicate.duplicate, true);
    assert.strictEqual(duplicate.run_id, 'run_video_001');
    assert.deepStrictEqual(kernel.currentState('run_video_001'), { run_id: 'run_video_001', workflow: 'video_production', status: 'prepared', revision: 1, tasks: {} });
    assert.strictEqual(kernel.events('run_video_001').length, 1);
    assert.strictEqual(kernel.pendingOutbox().length, 1);
    kernel.close();
  } finally { fs.rmSync(temp.root, { recursive: true, force: true }); }
});

test('event replay is deterministic across process restart', () => {
  const temp = temporaryDatabase();
  try {
    let kernel = new WorkflowKernel(temp.file);
    kernel.acceptCommand({ commandId: 'telegram:1', workflow: 'research_and_story', runId: 'run_research_001', payload: {} });
    kernel.appendEvent('run_research_001', 'task_started', { task_id: 'research_story', attempt: 1 }, { expectedRevision: 1 });
    kernel.appendEvent('run_research_001', 'task_completed', { task_id: 'research_story', attempt: 1 }, { expectedRevision: 2 });
    const before = kernel.currentState('run_research_001');
    kernel.close();
    kernel = new WorkflowKernel(temp.file);
    assert.deepStrictEqual(kernel.currentState('run_research_001'), before);
    assert.throws(() => kernel.appendEvent('run_research_001', 'run_cancelled', {}, { expectedRevision: 1 }), /revision conflict/);
    kernel.close();
  } finally { fs.rmSync(temp.root, { recursive: true, force: true }); }
});

test('task lease heartbeat is compare-and-swap protected and expires deterministically', () => {
  const temp = temporaryDatabase();
  try {
    const kernel = new WorkflowKernel(temp.file);
    kernel.acceptCommand({ commandId: 'telegram:lease', workflow: 'video_production', runId: 'run_video_lease', payload: {} });
    const lease = kernel.acquireLease({ runId: 'run_video_lease', taskId: 'capture_and_render', attempt: 1, workerId: 'hervid:worker-1', ttlMs: 30000, now: '2026-09-03T00:00:00.000Z' });
    assert.strictEqual(lease.expires_at, '2026-09-03T00:00:30.000Z');
    assert.throws(() => kernel.acquireLease({ runId: 'run_video_lease', taskId: 'capture_and_render', attempt: 1, workerId: 'hervid:worker-2', ttlMs: 30000, now: '2026-09-03T00:00:01.000Z' }), /lease is active/);
    const heartbeat = kernel.heartbeat({ runId: 'run_video_lease', taskId: 'capture_and_render', attempt: 1, workerId: 'hervid:worker-1', ttlMs: 30000, now: '2026-09-03T00:00:20.000Z' });
    assert.strictEqual(heartbeat.expires_at, '2026-09-03T00:00:50.000Z');
    assert.deepStrictEqual(kernel.expiredLeases('2026-09-03T00:00:49.000Z'), []);
    assert.strictEqual(kernel.expiredLeases('2026-09-03T00:00:51.000Z').length, 1);
    kernel.close();
  } finally { fs.rmSync(temp.root, { recursive: true, force: true }); }
});
