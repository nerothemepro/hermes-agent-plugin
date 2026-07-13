'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const childProcess = require('child_process');

const DEFAULT_PROJECT_PATH = '/workspace/hermes-agent-plugin';
const DEFAULT_TEMPLATE_ROOT = path.join(DEFAULT_PROJECT_PATH, 'control-plane', 'templates');
const DEFAULT_REGISTRY_DIR = '/opt/data/hermes/control-plane/runs';
const HERMES_BIN = '/workspace/.venvs/hermes-agent/bin/hermes';
const HERMES_HOME = '/opt/data/hermes';
const RUN_ID_PATTERN = /^run_[a-z0-9]+_[a-z0-9]+$/;
const CONTROL_CHAR_PATTERN = /[\u0000-\u001f\u007f]/;

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function assertInside(parent, candidate) {
  const root = path.resolve(parent);
  const target = path.resolve(candidate);
  if (target !== root && !target.startsWith(root + path.sep)) {
    throw new Error(`Unsafe path outside ${root}: ${target}`);
  }
  return target;
}

function loadTemplate(templateId, options = {}) {
  if (!/^[a-z_]+$/.test(templateId || '')) {
    throw new Error('Template id must contain lowercase letters and underscores only.');
  }
  const root = path.resolve(options.templateRoot || DEFAULT_TEMPLATE_ROOT);
  const filePath = assertInside(root, path.join(root, templateId, 'template.json'));
  if (!fs.existsSync(filePath)) {
    throw new Error(`Unknown control-plane template: ${templateId}`);
  }
  const template = readJson(filePath);
  if (template.schema_version !== 'hermes.control-plane-template.v1' || template.template_id !== templateId) {
    throw new Error(`Invalid control-plane template bundle: ${filePath}`);
  }
  return { template, filePath };
}

function parseParams(value) {
  if (!value) return {};
  if (typeof value === 'object' && !Array.isArray(value)) return value;
  try {
    const parsed = JSON.parse(value);
    if (!parsed || Array.isArray(parsed) || typeof parsed !== 'object') {
      throw new Error('Parameters must be a JSON object.');
    }
    return parsed;
  } catch (error) {
    throw new Error(`Invalid params JSON: ${error.message}`);
  }
}

function validateParams(template, rawParams, options = {}) {
  const params = parseParams(rawParams);
  const schema = template.params || {};
  const unknown = Object.keys(params).filter((key) => !Object.prototype.hasOwnProperty.call(schema, key));
  if (unknown.length) {
    throw new Error(`Unknown or forbidden parameter(s): ${unknown.join(', ')}`);
  }

  const normalized = {};
  for (const [key, rule] of Object.entries(schema)) {
    let value = params[key];
    if (value === undefined && Object.prototype.hasOwnProperty.call(rule, 'default')) value = rule.default;
    if ((value === undefined || value === null || value === '') && rule.required) {
      throw new Error(`Missing required parameter: ${key}`);
    }
    if (value === undefined || value === null || value === '') continue;

    if (rule.type === 'enum') {
      if (typeof value !== 'string' || !rule.values.includes(value)) {
        throw new Error(`Invalid ${key}; allowed values: ${rule.values.join(', ')}`);
      }
    } else if (rule.type === 'bounded_text') {
      if (typeof value !== 'string' || CONTROL_CHAR_PATTERN.test(value) || value.trim().length < rule.min_length || value.trim().length > rule.max_length) {
        throw new Error(`Invalid ${key}; expected printable text between ${rule.min_length} and ${rule.max_length} characters.`);
      }
      value = value.trim();
    } else if (rule.type === 'run_id') {
      if (typeof value !== 'string' || !RUN_ID_PATTERN.test(value)) {
        throw new Error(`Invalid ${key}; expected an SDTK run id.`);
      }
      const projectPath = path.resolve(options.projectPath || DEFAULT_PROJECT_PATH);
      const reportPath = path.join(projectPath, '.sdtk', 'agent-runtime', 'runs', value, 'reports', 'final_report.md');
      const statePath = path.join(projectPath, '.sdtk', 'agent-runtime', 'runs', value, 'state.json');
      if (!fs.existsSync(reportPath) || !fs.existsSync(statePath)) {
        throw new Error(`Status source is unavailable for ${value}; canonical state.json and final_report.md must both exist.`);
      }
    } else {
      throw new Error(`Unsupported parameter rule for ${key}.`);
    }
    normalized[key] = value;
  }
  return normalized;
}

function renderInstruction(templateId, params, projectPath) {
  switch (templateId) {
    case 'site_audit':
      return 'Perform a bounded read-only audit of https://sdtk.dev and https://docs.sdtk.dev. Find no more than 5 high-confidence issues involving stale package/version information, inconsistent Free/Pro descriptions, broken or misleading links, CLI examples that do not match the current CLI, unclear onboarding UX, or conflicting claims. For every finding provide the page URL, section or heading, concise description, evidence or a short page fragment, severity high/medium/low, and recommended correction. Public read-only browsing only. Do not login, modify any website or repository, create issues or pull requests, send messages, expose credentials, or dispatch child tasks. Add one concise Kanban comment and complete or block the task through the native Hermes Kanban lifecycle.';
    case 'research_brief':
      return `Create a concise, source-backed research brief about the bounded topic ${JSON.stringify(params.topic)}. Use only public, read-only sources. Separate verified facts, source URLs, assumptions, and unknowns. Do not login, modify websites or repositories, send messages, dispatch child tasks, write to the wiki, publish anything, or make unsourced claims. Add one concise Kanban comment and complete or block the task through the native Hermes Kanban lifecycle.`;
    case 'status': {
      const runRoot = path.join(path.resolve(projectPath), '.sdtk', 'agent-runtime', 'runs', params.run_id);
      const statePath = path.join(runRoot, 'state.json');
      const reportPath = path.join(runRoot, 'reports', 'final_report.md');
      return `Read only these explicit canonical SDTK paths for run ${params.run_id}: ${statePath} and ${reportPath}. Return a concise status summary with every claim tied to one of those paths. If a value is absent or contradictory, report it as unknown or conflicting; never infer state. Do not browse, dispatch child tasks, modify files, send messages, publish, or alter any account. Add one concise Kanban comment and complete or block the task through the native Hermes Kanban lifecycle.`;
    }
    default:
      throw new Error(`No instruction renderer for ${templateId}.`);
  }
}

function buildWorkflow(template, params, options = {}) {
  const projectPath = path.resolve(options.projectPath || DEFAULT_PROJECT_PATH);
  const instruction = renderInstruction(template.template_id, params, projectPath);
  const taskId = template.template_id === 'status' ? 'status_summary' : template.template_id;
  const role = template.template_id === 'status' ? 'orchestrator' : 'researcher';
  const stages = [{
    id: taskId,
    type: 'task',
    role,
    params: { instruction },
    retry: { max: 0 },
  }];
  if (template.human_gate) {
    stages.push({
      id: template.human_gate.id,
      type: 'human_gate',
      depends_on: [taskId],
      prompt: template.human_gate.prompt,
    });
  }
  stages.push({
    id: 'final_report',
    type: 'report',
    depends_on: [template.human_gate ? template.human_gate.id : taskId],
    output: { path: 'reports/final_report.md' },
  });
  return {
    schema_version: 'sdtk.agent-workflow.v1',
    workflow_id: `hermes_control_plane_${template.template_id}_${template.version}`,
    stages,
  };
}

function buildRuntimeMap(template) {
  const role = template.template_id === 'status' ? 'orchestrator' : 'researcher';
  return {
    schema_version: 'sdtk.agent-runtime-map.v1',
    environment_id: 'hermes-native-kanban-attended',
    hermes: { profiles_source: '/opt/data/hermes/profiles' },
    roles: {
      [role]: {
        adapter: 'hermes-live',
        module: 'sdtk-agent-hermes-adapter',
        mode: 'live',
        config: {
          backend: 'kanban-cli',
          profile: template.allowed_profile,
          hermes_bin: HERMES_BIN,
          env: { HERMES_HOME },
          board: template.runtime.board,
          live_ack: true,
          cancel_action: template.runtime.cancel_action,
          deadline_ms: template.runtime.deadline_ms,
        },
      },
    },
  };
}

function previewTemplate(templateId, rawParams, options = {}) {
  const { template, filePath } = loadTemplate(templateId, options);
  const params = validateParams(template, rawParams, options);
  const workflow = buildWorkflow(template, params, options);
  const runtimeMap = buildRuntimeMap(template);
  const taskCount = workflow.stages.filter((stage) => stage.type === 'task').length;
  const gateCount = workflow.stages.filter((stage) => stage.type === 'human_gate').length;
  return {
    status: 'held_for_exact_dispatch_approval',
    template_id: template.template_id,
    template_version: template.version,
    template_path: filePath,
    template_sha256: sha256(fs.readFileSync(filePath)),
    params,
    task_count: taskCount,
    gate_count: gateCount,
    dispatch_count: taskCount,
    profile: template.allowed_profile,
    deadline_ms: template.runtime.deadline_ms,
    deadline_minutes: template.runtime.deadline_ms / 60000,
    cost_band: template.cost_band,
    allowed_side_effects: template.side_effects.allowed,
    forbidden_side_effects: template.side_effects.forbidden,
    exact_dispatch_approval: 'APPROVE DISPATCH <run_id>',
    workflow,
    runtime_map: runtimeMap,
  };
}

function validateTemplate(templateId, options = {}) {
  const preview = previewTemplate(templateId, options.params || {}, options);
  const tempRoot = fs.mkdtempSync(path.join('/tmp/', `hermes-control-plane-${templateId}-`));
  const workflowPath = path.join(tempRoot, 'workflow.json');
  fs.writeFileSync(workflowPath, JSON.stringify(preview.workflow, null, 2) + '\n', { mode: 0o600 });
  try {
    const result = childProcess.spawnSync('sdtk-agent', ['workflow', 'validate', '--file', workflowPath, '--json'], {
      encoding: 'utf8',
      env: { ...process.env, HERMES_KANBAN_HOME: undefined },
    });
    return {
      status: result.status === 0 ? 'completed' : 'error',
      template_id: templateId,
      command: ['sdtk-agent', 'workflow', 'validate', '--file', workflowPath, '--json'],
      exit_code: result.status,
      stdout: (result.stdout || '').trim(),
      stderr: (result.stderr || '').trim(),
      preview,
    };
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
}

module.exports = {
  DEFAULT_PROJECT_PATH,
  DEFAULT_REGISTRY_DIR,
  DEFAULT_TEMPLATE_ROOT,
  buildRuntimeMap,
  buildWorkflow,
  loadTemplate,
  parseParams,
  previewTemplate,
  renderInstruction,
  sha256,
  validateParams,
  validateTemplate,
};
