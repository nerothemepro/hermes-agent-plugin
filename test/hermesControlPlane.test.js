'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const test = require('node:test');

const {
  buildRuntimeMap,
  buildWorkflow,
  loadTemplate,
  previewTemplate,
  validateParams,
} = require('../src/hermesControlPlane');

const TEMPLATE_ROOT = path.join(__dirname, '..', 'control-plane', 'templates');

test('Hermes control plane Phase A templates', async (t) => {
  await t.test('site_audit is fixed to herresearch and rejects scope widening', () => {
    const preview = previewTemplate('site_audit', '{}', { templateRoot: TEMPLATE_ROOT });
    assert.strictEqual(preview.profile, 'herresearch');
    assert.strictEqual(preview.task_count, 1);
    assert.strictEqual(preview.gate_count, 1);
    assert.strictEqual(preview.status, 'held_for_exact_dispatch_approval');
    assert.throws(() => previewTemplate('site_audit', '{"profile":"hersocial"}', { templateRoot: TEMPLATE_ROOT }), /Unknown or forbidden/);
  });

  await t.test('research_brief bounds topic input and does not permit side-effect params', () => {
    const preview = previewTemplate('research_brief', '{"topic":"Hermes Kanban lifecycle"}', { templateRoot: TEMPLATE_ROOT });
    assert.match(preview.workflow.stages[0].params.instruction, /Hermes Kanban lifecycle/);
    assert.throws(() => previewTemplate('research_brief', '{"topic":"x","publish":true}', { templateRoot: TEMPLATE_ROOT }), /Unknown or forbidden/);
    assert.throws(() => previewTemplate('research_brief', '{"topic":"a"}', { templateRoot: TEMPLATE_ROOT }), /Invalid topic/);
  });

  await t.test('status requires existing canonical state and report paths', () => {
    const projectPath = fs.mkdtempSync(path.join(os.tmpdir(), 'hermes-status-'));
    const runId = 'run_abc123_def456';
    const runRoot = path.join(projectPath, '.sdtk', 'agent-runtime', 'runs', runId);
    fs.mkdirSync(path.join(runRoot, 'reports'), { recursive: true });
    fs.writeFileSync(path.join(runRoot, 'state.json'), '{"status":"completed"}\n');
    fs.writeFileSync(path.join(runRoot, 'reports', 'final_report.md'), '# Final report\n');
    try {
      const preview = previewTemplate('status', JSON.stringify({ run_id: runId }), { templateRoot: TEMPLATE_ROOT, projectPath });
      assert.strictEqual(preview.profile, 'herorches');
      assert.strictEqual(preview.gate_count, 0);
      assert.match(preview.workflow.stages[0].params.instruction, /state\.json/);
      assert.throws(() => validateParams(loadTemplate('status', { templateRoot: TEMPLATE_ROOT }).template, { run_id: 'run_missing_000001' }, { projectPath }), /unavailable/);
    } finally {
      fs.rmSync(projectPath, { recursive: true, force: true });
    }
  });

  await t.test('runtime map pins the only supported native live adapter configuration', () => {
    const { template } = loadTemplate('site_audit', { templateRoot: TEMPLATE_ROOT });
    const runtimeMap = buildRuntimeMap(template);
    const config = runtimeMap.roles.researcher.config;
    assert.strictEqual(config.backend, 'kanban-cli');
    assert.strictEqual(config.profile, 'herresearch');
    assert.strictEqual(config.env.HERMES_HOME, '/opt/data/hermes');
    assert.strictEqual(config.live_ack, true);
    assert.ok(!Object.prototype.hasOwnProperty.call(config.env, 'HERMES_KANBAN_HOME'));
  });

  await t.test('rendered workflow has only the fixed profile role and report stage', () => {
    const { template } = loadTemplate('research_brief', { templateRoot: TEMPLATE_ROOT });
    const workflow = buildWorkflow(template, { topic: 'agent lifecycle' });
    assert.deepStrictEqual(workflow.stages.map((stage) => stage.type), ['task', 'human_gate', 'report']);
    assert.strictEqual(workflow.stages[0].role, 'researcher');
  });
});
