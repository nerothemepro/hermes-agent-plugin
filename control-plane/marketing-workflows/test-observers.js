'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const test = require('node:test');
const { WorkflowKernel } = require('./kernel');
const { drainNotifications, formatNotification } = require('./notifier');
const { projectWorkflowChain } = require('./projector');

test('notification outbox delivers each material event once', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'marketing-notifier-'));
  const kernel = new WorkflowKernel(path.join(root, 'state.sqlite'));
  try {
    kernel.acceptCommand({ commandId: 'tg:notify', workflow: 'research_and_story', runId: 'run_notify_1', payload: {} });
    const sent = [];
    assert.strictEqual(await drainNotifications(kernel, async (message) => sent.push(message)), 1);
    assert.match(sent[0], /Research and Story.*prepared/);
    assert.strictEqual(await drainNotifications(kernel, async (message) => sent.push(message)), 0);
  } finally { kernel.close(); fs.rmSync(root, { recursive: true, force: true }); }
});

test('Story Lock notification carries the exact hash-pinned Telegram approval grammar', () => {
  const packet = 'a'.repeat(64);
  const message = formatNotification({ run_id: 'run_mkt_abc123def456', sequence: 7, event_type: 'gate_waiting', payload: { gate_id: 'story_lock', packet_sha256: packet } }, 'research_and_story');
  assert.match(message, /Research and Story waiting for owner approval/);
  assert.match(message, new RegExp('APPROVE STORY LOCK run_mkt_abc123def456 ' + packet));
});

test('Kanban projection is a read-only chain of three independent runs', () => {
  const projection = projectWorkflowChain([
    { run_id: 'run_a', workflow: 'research_and_story', status: 'completed', revision: 4, tasks: {} },
    { run_id: 'run_b', workflow: 'video_production', status: 'waiting_for_approval', waiting_gate: 'picture_lock', revision: 7, tasks: {} },
  ]);
  assert.deepStrictEqual(projection.map((item) => item.lane), ['Research and Story', 'Video Production', 'Social Distribution']);
  assert.strictEqual(projection[1].status, 'IN_REVIEW');
  assert.strictEqual(projection[1].next_action, 'Approve picture_lock');
  assert.strictEqual(projection[2].status, 'NOT_STARTED');
});
