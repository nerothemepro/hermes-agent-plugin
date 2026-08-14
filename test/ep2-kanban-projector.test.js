'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const test = require('node:test');

const {
  projectKanban,
  selectRun,
  statusProjection,
} = require('../control-plane/ep2-kanban/project-kanban');

const SERIES_MANIFEST = path.join(__dirname, '..', 'control-plane', 'ep2-kanban', 'marketing-video-series.json');

function fixtureState(overrides = {}) {
  return {
    run_id: 'run_test_123456',
    feature_key: 'HCP_MARKETING_VIDEO_EP_USAGE',
    status: 'running',
    updated_at: '2026-08-14T05:00:00.000Z',
    tasks: {
      research_evidence: { id: 'research_evidence', type: 'task', status: 'running_external', role: 'researcher', depends_on: [] },
      episode_lessons: { id: 'episode_lessons', type: 'task', status: 'completed', role: 'wiki', depends_on: [] },
      script_package: { id: 'script_package', type: 'task', status: 'created', role: 'orchestrator', depends_on: ['research_evidence'] },
      owner_script_review: { id: 'owner_script_review', type: 'human_gate', status: 'created', depends_on: ['script_package'], prompt: 'Owner reviews the script.' },
      product_capture: { id: 'product_capture', type: 'task', status: 'created', role: 'developer', depends_on: ['owner_script_review'] },
      owner_assets_review: { id: 'owner_assets_review', type: 'human_gate', status: 'created', depends_on: ['product_capture'], prompt: 'Owner reviews assets.' },
      episode_render: { id: 'episode_render', type: 'task', status: 'created', role: 'video', depends_on: ['owner_assets_review'] },
      owner_picture_lock: { id: 'owner_picture_lock', type: 'human_gate', status: 'created', depends_on: ['episode_render'], prompt: 'Owner reviews picture.' },
      social_package: { id: 'social_package', type: 'task', status: 'created', role: 'social', depends_on: ['owner_picture_lock'] },
      owner_social_review: { id: 'owner_social_review', type: 'human_gate', status: 'created', depends_on: ['social_package'], prompt: 'Owner reviews social.' },
      lessons_record: { id: 'lessons_record', type: 'task', status: 'created', role: 'wiki', depends_on: ['owner_social_review'] },
      owner_lessons_review: { id: 'owner_lessons_review', type: 'human_gate', status: 'created', depends_on: ['lessons_record'], prompt: 'Owner reviews lessons.' },
      final_report: { id: 'final_report', type: 'report', status: 'created', depends_on: ['owner_lessons_review'], output: { path: 'reports/final_report.md' } },
    },
    ...overrides,
  };
}

test('status projection is fail-closed', () => {
  assert.deepStrictEqual(statusProjection('created'), { status: 'TODO', reason: '' });
  assert.deepStrictEqual(statusProjection('running_external'), { status: 'IN_PROGRESS', reason: '' });
  assert.deepStrictEqual(statusProjection('completed'), { status: 'DONE', reason: '' });
  assert.deepStrictEqual(statusProjection('waiting_for_approval'), { status: 'PENDING', reason: 'awaiting owner approval' });
  assert.deepStrictEqual(statusProjection('unknown_vendor_state'), { status: 'PENDING', reason: 'unknown ledger status: unknown_vendor_state' });
});

test('projector renders the ten-episode backlog and active pipeline without sensitive task data', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ep2-projector-'));
  const run = fixtureState();
  const statePath = path.join(root, '.sdtk', 'agent-runtime', 'runs', run.run_id, 'state.json');
  fs.mkdirSync(path.dirname(statePath), { recursive: true });
  fs.writeFileSync(statePath, JSON.stringify(run));

  try {
    const result = projectKanban({ projectPath: root, runId: run.run_id, seriesManifestPath: SERIES_MANIFEST, now: new Date('2026-08-14T05:01:00.000Z') });
    assert.strictEqual(result.runId, run.run_id);
    assert.match(fs.readFileSync(path.join(root, 'governance/ai/core/IMPROVEMENT_BACKLOG.md'), 'utf8'), /\| BK-39901 \| Stop Describing UI Bugs to AI \|/);
    const planning = fs.readFileSync(path.join(root, 'SHARED_PLANNING.md'), 'utf8');
    assert.match(planning, /\| 1\. Research evidence \| IN_PROGRESS \| BA - HerResearch \|/);
    assert.match(planning, /\| 4\. Owner script review \| TODO \| Owner \|/);
    assert.doesNotMatch(planning, /instruction|external_ids|idempotency_key|prompt/i);
    const quality = fs.readFileSync(path.join(root, 'QUALITY_CHECKLIST.md'), 'utf8');
    assert.match(quality, /PHASE 4: Owner Script Review CHECKLIST/);
    assert.match(quality, /Owner approval recorded in the canonical ledger/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('waiting owner gate and malformed input preserve a prior valid projection', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ep2-projector-'));
  const run = fixtureState();
  run.tasks.owner_script_review.status = 'waiting_for_approval';
  const statePath = path.join(root, '.sdtk', 'agent-runtime', 'runs', run.run_id, 'state.json');
  fs.mkdirSync(path.dirname(statePath), { recursive: true });
  fs.writeFileSync(statePath, JSON.stringify(run));

  try {
    projectKanban({ projectPath: root, runId: run.run_id, seriesManifestPath: SERIES_MANIFEST });
    const planning = fs.readFileSync(path.join(root, 'SHARED_PLANNING.md'), 'utf8');
    assert.match(planning, /PENDING: awaiting owner approval/);
    assert.match(planning, /## CURRENT BLOCKERS[\s\S]*Owner script review: awaiting owner approval/);

    const before = fs.readFileSync(path.join(root, 'SHARED_PLANNING.md'), 'utf8');
    fs.writeFileSync(statePath, '{not json');
    assert.throws(() => projectKanban({ projectPath: root, runId: run.run_id, seriesManifestPath: SERIES_MANIFEST }), /invalid JSON/);
    assert.strictEqual(fs.readFileSync(path.join(root, 'SHARED_PLANNING.md'), 'utf8'), before);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('run selection prefers the active fixed-template ledger', () => {
  const selected = selectRun([
    { run_id: 'run_old', feature_key: 'HCP_MARKETING_VIDEO_EP_USAGE', status: 'completed', updated_at: '2026-08-14T04:00:00.000Z' },
    { run_id: 'run_active', feature_key: 'HCP_MARKETING_VIDEO_EP_USAGE', status: 'running', updated_at: '2026-08-14T05:00:00.000Z' },
    { run_id: 'run_other', feature_key: 'OTHER', status: 'running', updated_at: '2026-08-14T06:00:00.000Z' },
  ]);
  assert.strictEqual(selected.run_id, 'run_active');
});
