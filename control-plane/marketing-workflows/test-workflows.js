'use strict';

const assert = require('assert');
const test = require('node:test');
const { WORKFLOW_DEFINITIONS, resolveWorkflow, validateHandoff } = require('./workflows');

test('three workflows each have one Hermes owner and immutable input/output boundaries', () => {
  assert.deepStrictEqual(Object.keys(WORKFLOW_DEFINITIONS), ['research_and_story', 'video_production', 'social_distribution']);
  assert.strictEqual(resolveWorkflow('research_and_story').owner, 'herresearch');
  assert.strictEqual(resolveWorkflow('video_production').owner, 'hervid');
  assert.strictEqual(resolveWorkflow('social_distribution').owner, 'hersocial');
  for (const workflow of Object.values(WORKFLOW_DEFINITIONS)) {
    assert.ok(workflow.stages.length >= 3);
    assert.ok(workflow.owner_gates.length >= 1);
    assert.ok(!workflow.workers.includes('herorches'));
    assert.ok(!workflow.workers.includes('herdev'));
  }
});

test('video accepts only an approved research handoff and social requires picture lock', () => {
  const brief = { schema_version: 'sdtk.marketing-handoff.v1', workflow: 'research_and_story', episode_id: 'EP4', revision: 'r1', validation_status: 'pass', approval: { gate: 'story_lock', status: 'approved', artifact_sha256: 'a'.repeat(64) } };
  assert.strictEqual(validateHandoff('video_production', brief).episode_id, 'EP4');
  assert.throws(() => validateHandoff('video_production', { ...brief, approval: { ...brief.approval, status: 'pending' } }), /approved story_lock/);
  const picture = { ...brief, workflow: 'video_production', approval: { gate: 'picture_lock', status: 'approved', artifact_sha256: 'b'.repeat(64) } };
  assert.strictEqual(validateHandoff('social_distribution', picture).approval.gate, 'picture_lock');
  assert.throws(() => validateHandoff('social_distribution', brief), /approved picture_lock/);
});
