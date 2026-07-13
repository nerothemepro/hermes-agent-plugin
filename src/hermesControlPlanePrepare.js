'use strict';

const fs = require('fs');
const path = require('path');
const childProcess = require('child_process');

const {
  DEFAULT_PROJECT_PATH,
  DEFAULT_REGISTRY_DIR,
  previewTemplate,
} = require('./hermesControlPlane');

const RUN_ID_PATTERN = /^run_[a-z0-9]+_[a-z0-9]+$/;

function buildRegistryRecord(preview, runId, projectPath) {
  const runRoot = path.join(path.resolve(projectPath), '.sdtk', 'agent-runtime', 'runs', runId);
  return {
    schema_version: 'hermes.control-plane-run-reference.v1',
    run_id: runId,
    template_id: preview.template_id,
    template_version: preview.template_version,
    template_sha256: preview.template_sha256,
    ledger_path: runRoot,
    state_path: path.join(runRoot, 'state.json'),
    canonical_report_path: path.join(runRoot, 'reports', 'final_report.md'),
    created_at: new Date().toISOString(),
  };
}

function prepareTemplate(templateId, rawParams, options = {}) {
  const projectPath = path.resolve(options.projectPath || DEFAULT_PROJECT_PATH);
  const registryDir = path.resolve(options.registryDir || DEFAULT_REGISTRY_DIR);
  const preview = previewTemplate(templateId, rawParams, { ...options, projectPath });
  const stagingRoot = path.join(projectPath, '.sdtk');
  fs.mkdirSync(stagingRoot, { recursive: true, mode: 0o700 });
  const stagingDir = fs.mkdtempSync(path.join(stagingRoot, 'control-plane-stage-'));
  const workflowPath = path.join(stagingDir, 'workflow.json');
  const runtimeMapPath = path.join(stagingDir, 'runtime-map.json');
  fs.writeFileSync(workflowPath, JSON.stringify(preview.workflow, null, 2) + '\n', { mode: 0o600 });
  fs.writeFileSync(runtimeMapPath, JSON.stringify(preview.runtime_map, null, 2) + '\n', { mode: 0o600 });
  const env = { ...process.env };
  delete env.HERMES_KANBAN_HOME;

  try {
    const result = childProcess.spawnSync('sdtk-agent', [
      'run', 'start',
      '--workflow', workflowPath,
      '--runtime-map', runtimeMapPath,
      '--feature-key', `HCP_${templateId.toUpperCase()}`,
      '--goal', `Hermes Control Plane Phase A fixed template: ${templateId}`,
      '--project-path', projectPath,
      '--json',
    ], { encoding: 'utf8', env });
    const stdout = (result.stdout || '').trim();
    const stderr = (result.stderr || '').trim();
    if (result.error || result.status !== 0) {
      throw new Error(stderr || stdout || result.error?.message || 'sdtk-agent run start failed');
    }
    let started;
    try {
      started = JSON.parse(stdout);
    } catch (_error) {
      throw new Error('sdtk-agent run start returned invalid JSON');
    }
    if (!RUN_ID_PATTERN.test(started.run_id || '')) {
      throw new Error('sdtk-agent run start did not return a valid run_id');
    }

    fs.mkdirSync(registryDir, { recursive: true, mode: 0o700 });
    const record = buildRegistryRecord(preview, started.run_id, projectPath);
    const recordPath = path.join(registryDir, `${started.run_id}.json`);
    if (path.dirname(recordPath) !== registryDir) throw new Error('Unsafe registry path.');
    fs.writeFileSync(recordPath, JSON.stringify(record, null, 2) + '\n', { encoding: 'utf8', mode: 0o600, flag: 'wx' });

    return {
      status: 'prepared_waiting_for_exact_dispatch_approval',
      run_id: started.run_id,
      registry_path: recordPath,
      registry_record: record,
      exact_dispatch_approval: `APPROVE DISPATCH ${started.run_id}`,
      preview,
    };
  } finally {
    fs.rmSync(stagingDir, { recursive: true, force: true });
  }
}

module.exports = { buildRegistryRecord, prepareTemplate };
