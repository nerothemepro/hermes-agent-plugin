#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const childProcess = require('child_process');

const { buildEp2Workflow } = require('../../src/hermesControlPlaneEp2');

const DEFAULT_PROJECT_PATH = '/workspace/hermes-agent-plugin';
const RUN_ID_PATTERN = /^run_[a-z0-9]+_[a-z0-9]+$/;
const SUPPORTED_COMMANDS = new Set(['inspect', 'next', 'reconcile', 'continue', 'story-bind', 'capture-amend', 'capture-accept', 'render-verify', 'handoff-prepare', 'handoff-deliver', 'defect-record', 'defect-close']);
const HERMES_BIN = '/workspace/.venvs/hermes-agent/bin/hermes';
const HERMES_DISPATCH_HOME = '/opt/data/hermes';
const HANDOFF_COMMENT_MARKER = 'SDTK_CAPTURE_HANDOFF_V1';
const CAPTURE_HANDOFF_ASSETS = new Set([
  'demo_fixture/DEMO_DATA.txt',
  'capture_table_output.txt',
  'capture_json_output.txt',
  'evidence_summary.txt',
  'asset_manifest.txt',
]);

function requireRunId(value) {
  if (!RUN_ID_PATTERN.test(String(value || ''))) throw new Error('invalid run id');
  return value;
}

function statePath(projectPath, runId) {
  return path.join(path.resolve(projectPath), '.sdtk', 'agent-runtime', 'runs', requireRunId(runId), 'state.json');
}

function readState(projectPath, runId) {
  const filePath = statePath(projectPath, runId);
  const state = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  if (state.run_id !== runId || !state.tasks || typeof state.tasks !== 'object') {
    throw new Error('canonical run ledger is invalid');
  }
  return state;
}

function inspectRun(projectPath, runId) {
  const state = readState(projectPath, runId);
  const tasks = Object.entries(state.tasks).map(([taskId, task]) => ({
    task_id: taskId,
    type: task.type || 'task',
    role: task.role || null,
    status: task.status || 'unknown',
    attempt: Number(task.attempt || task.attempt_count || 0),
    external_task_id: task.external_ids && task.external_ids.hermes_task_id || null,
    last_heartbeat: task.last_heartbeat || task.updated_at || state.updated_at || null,
    artifact_path: task.output && task.output.path || task.result && task.result.path || null,
    blocker: task.blocked_reason || task.last_error || null,
  }));
  const ready = tasks.filter((task) => task.type === 'task' && task.status === 'ready');
  const ownerGate = tasks.find((task) => task.type === 'human_gate' && task.status === 'waiting_for_approval');
  return {
    run_id: runId,
    status: state.status,
    updated_at: state.updated_at || null,
    ready_dispatch_count: ready.length,
    ready_roles: [...new Set(ready.map((task) => task.role).filter(Boolean))].sort(),
    owner_gate: state.waiting_gate_id || state.waiting_gate || ownerGate && ownerGate.task_id || null,
    tasks,
  };
}

function recommendNext(inspection) {
  if (inspection.owner_gate) {
    if (inspection.owner_gate === 'owner_picture_lock') {
      return { action: 'render_output_verification_required', task_id: 'episode_render', mutates_state: false };
    }
    return { action: 'owner_approval_required', gate_id: inspection.owner_gate, mutates_state: false };
  }
  if (['blocked', 'cancelled', 'completed', 'failed'].includes(inspection.status)) {
    return { action: 'terminal_no_continue', status: inspection.status, mutates_state: false };
  }
  if (inspection.ready_dispatch_count > 0) {
    return {
      action: 'owner_confirmed_continue_required',
      dispatch_count: inspection.ready_dispatch_count,
      roles: inspection.ready_roles,
      mutates_state: false,
    };
  }
  const active = inspection.tasks.filter((task) => ['running', 'running_external', 'submitted', 'waiting_external_evidence'].includes(task.status));
  if (active.length) {
    return { action: 'monitor_active_tasks', task_ids: active.map((task) => task.task_id), mutates_state: false };
  }
  return { action: 'reconcile_readiness', mutates_state: false };
}

function parseArgs(argv) {
  let command = argv[0] || '';
  let startIndex = 1;
  if (command === 'defect' || command === 'story' || command === 'capture' || command === 'render' || command === 'handoff') {
    command = `${command}-${argv[1] || ''}`;
    startIndex = 2;
  }
  const args = {
    command,
    projectPath: DEFAULT_PROJECT_PATH,
    runId: '',
    confirm: false,
    defectId: '',
    title: '',
    severity: '',
    taskId: '',
    blockerClass: '',
    nextAction: '',
    verification: '',
    storySha: '',
  };
  if (!SUPPORTED_COMMANDS.has(args.command)) throw new Error('unsupported command');
  for (let index = startIndex; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--run-id' && argv[index + 1]) args.runId = argv[++index];
    else if (arg === '--project-path' && argv[index + 1]) args.projectPath = argv[++index];
    else if (arg === '--confirm') args.confirm = true;
    else if (arg === '--defect-id' && argv[index + 1]) args.defectId = argv[++index];
    else if (arg === '--title' && argv[index + 1]) args.title = argv[++index];
    else if (arg === '--severity' && argv[index + 1]) args.severity = argv[++index];
    else if (arg === '--task-id' && argv[index + 1]) args.taskId = argv[++index];
    else if (arg === '--blocker-class' && argv[index + 1]) args.blockerClass = argv[++index];
    else if (arg === '--next-action' && argv[index + 1]) args.nextAction = argv[++index];
    else if (arg === '--verification' && argv[index + 1]) args.verification = argv[++index];
    else if (arg === '--story-sha' && argv[index + 1]) args.storySha = argv[++index];
    else throw new Error(`unknown or incomplete argument: ${arg}`);
  }
  if ((args.command === 'continue' || args.command === 'story-bind' || args.command === 'capture-amend' || args.command === 'capture-accept' || args.command === 'render-verify' || args.command === 'handoff-prepare' || args.command === 'handoff-deliver') && !args.confirm) throw new Error(args.command + ' requires --confirm');
  if (args.command !== 'continue' && args.command !== 'story-bind' && args.command !== 'capture-amend' && args.command !== 'capture-accept' && args.command !== 'render-verify' && args.command !== 'handoff-prepare' && args.command !== 'handoff-deliver' && args.confirm) throw new Error('--confirm is valid only for continue, story bind, capture amend, capture accept, render verify, or handoff operations');
  if (args.command === 'defect-record') {
    requireRunId(args.runId);
    if (!args.defectId || !args.title || !args.severity || !args.taskId || !args.blockerClass || !args.nextAction) {
      throw new Error('defect record requires all bounded fields');
    }
  } else if (args.command === 'defect-close') {
    if (!args.defectId || !args.verification) throw new Error('defect close requires verification evidence');
  } else if (args.command === 'story-bind') {
    requireRunId(args.runId);
    if (!/^[a-f0-9]{64}$/.test(args.storySha)) throw new Error('story bind requires a sha256 Story Lock artifact');
  } else if (args.command === 'capture-amend') {
    requireRunId(args.runId);
    if (!/^[a-f0-9]{64}$/.test(args.storySha)) throw new Error('capture amend requires a sha256 Story Lock artifact');
  } else if (args.command === 'capture-accept' || args.command === 'render-verify' || args.command === 'handoff-prepare' || args.command === 'handoff-deliver') {
    requireRunId(args.runId);
  } else {
    requireRunId(args.runId);
  }
  return args;
}

function runSdtk(args, commandRunner = childProcess.spawnSync) {
  const command = [
    'sdtk-agent', 'run', args.command,
    '--project-path', path.resolve(args.projectPath),
    '--run-id', args.runId,
    '--json',
  ];
  if (args.command === 'continue') command.push('--confirm');
  const result = commandRunner(command[0], command.slice(1), {
    encoding: 'utf8',
    env: Object.fromEntries(Object.entries(process.env).filter(([key]) => key !== 'HERMES_KANBAN_HOME')),
  });
  let payload;
  try {
    payload = JSON.parse(result.stdout || '{}');
  } catch (_) {
    payload = { status: 'error', error: 'sdtk-agent returned invalid JSON' };
  }
  return { command, exit_code: result.status, payload };
}

function defectLedgerPath(projectPath) {
  return path.join(path.resolve(projectPath), '.sdtk', 'video-dogfood', 'defects.json');
}

function readDefectLedger(projectPath) {
  const filePath = defectLedgerPath(projectPath);
  try {
    const ledger = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    if (ledger.schema_version !== 'hermes.video-dogfood-defects.v1' || !Array.isArray(ledger.defects)) {
      throw new Error('defect ledger schema is invalid');
    }
    return ledger;
  } catch (error) {
    if (error.code === 'ENOENT') return { schema_version: 'hermes.video-dogfood-defects.v1', defects: [] };
    throw error;
  }
}

function writeDefectLedger(projectPath, ledger) {
  const filePath = defectLedgerPath(projectPath);
  fs.mkdirSync(path.dirname(filePath), { recursive: true, mode: 0o700 });
  const tempPath = filePath + '.' + process.pid + '.tmp';
  fs.writeFileSync(tempPath, JSON.stringify(ledger, null, 2) + '\n', { mode: 0o600 });
  fs.renameSync(tempPath, filePath);
}

function requireText(value, label, maxLength = 240) {
  const text = String(value || '').trim();
  if (!text || text.length > maxLength || /[\u0000-\u001f\u007f]/.test(text)) throw new Error(`invalid ${label}`);
  return text;
}

function recordDefect(projectPath, input, now = new Date().toISOString()) {
  const allowed = new Set(['defect_id', 'title', 'severity', 'run_id', 'task_id', 'blocker_class', 'next_action']);
  const unknown = Object.keys(input || {}).filter((key) => !allowed.has(key));
  if (unknown.length) throw new Error(`unsupported defect field: ${unknown.join(', ')}`);
  const defect = {
    defect_id: requireText(input.defect_id, 'defect id', 64),
    title: requireText(input.title, 'defect title', 160),
    severity: requireText(input.severity, 'severity', 2),
    status: 'OPEN',
    run_id: requireRunId(input.run_id),
    task_id: requireText(input.task_id, 'task id', 80),
    blocker_class: requireText(input.blocker_class, 'blocker class', 40),
    next_action: requireText(input.next_action, 'next action'),
    created_at: now,
    updated_at: now,
  };
  if (!/^DEF-[A-Z0-9-]+$/.test(defect.defect_id)) throw new Error('invalid defect id');
  if (!/^P[0-3]$/.test(defect.severity)) throw new Error('invalid severity');
  const ledger = readDefectLedger(projectPath);
  if (ledger.defects.some((item) => item.defect_id === defect.defect_id)) throw new Error('duplicate defect id');
  ledger.defects.push(defect);
  writeDefectLedger(projectPath, ledger);
  return defect;
}

function closeDefect(projectPath, defectId, verification, now = new Date().toISOString()) {
  const evidence = requireText(verification, 'verification evidence', 500);
  const ledger = readDefectLedger(projectPath);
  const defect = ledger.defects.find((item) => item.defect_id === defectId);
  if (!defect) throw new Error('defect not found');
  defect.status = 'CLOSED';
  defect.verification = evidence;
  defect.updated_at = now;
  writeDefectLedger(projectPath, ledger);
  return defect;
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function writeJsonAtomic(filePath, value, mode = 0o600) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true, mode: 0o700 });
  const tempPath = filePath + '.' + process.pid + '.tmp';
  fs.writeFileSync(tempPath, JSON.stringify(value, null, 2) + '\n', { mode });
  fs.renameSync(tempPath, filePath);
}

function appendRunEvent(runRoot, runId, type, data, now) {
  fs.appendFileSync(path.join(runRoot, 'events.ndjson'), JSON.stringify({ ts: now, run_id: runId, type, data }) + '\n', { mode: 0o600 });
}

function bindStoryToCapture(projectPath, runId, storySha, now = new Date().toISOString()) {
  const root = path.join(path.resolve(projectPath), '.sdtk', 'agent-runtime', 'runs', requireRunId(runId));
  const reviewPath = path.join(root, 'reports', 'script_package.controller-reviewed.md');
  const evidencePath = path.join(root, 'evidence', 'script_package.evidence.json');
  const bindingPath = path.join(root, 'reports', 'product_capture.story-binding.json');
  let review;
  let evidence;
  try {
    const stat = fs.lstatSync(reviewPath);
    if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('not a regular file');
    review = fs.readFileSync(reviewPath);
    evidence = JSON.parse(fs.readFileSync(evidencePath, 'utf8'));
  } catch (_) {
    throw new Error('controller-reviewed Story Lock artifact or evidence is unavailable');
  }
  if (sha256(review) !== storySha) throw new Error('Story Lock artifact sha256 does not match');
  if (!evidence || evidence.run_id !== runId || evidence.task_id !== 'script_package'
    || !evidence.fields || evidence.fields.story_lock_sha256 !== storySha
    || evidence.fields.private_usage_data_used !== false
    || evidence.fields.demo_fixture_required !== true
    || evidence.fields.isolated_home_required !== true
    || !Array.isArray(evidence.artifacts)
    || !evidence.artifacts.some((item) => item && item.path === reviewPath && item.sha256 === storySha)) {
    throw new Error('controller-reviewed Story Lock evidence contract is invalid');
  }
  try {
    const existing = JSON.parse(fs.readFileSync(bindingPath, 'utf8'));
    const existingState = readState(projectPath, runId);
    const existingInstruction = String(existingState.tasks.product_capture && existingState.tasks.product_capture.params && existingState.tasks.product_capture.params.instruction || '');
    if (existing.run_id === runId && existing.story_lock_sha256 === storySha
      && sha256(existingInstruction) === existing.bound_instruction_sha256) {
      return Object.assign({}, existing, { reused: true });
    }
    throw new Error('existing Story Lock binding does not match canonical capture state');
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }

  const state = readState(projectPath, runId);
  const workflowPath = path.join(root, 'workflow.json');
  const workflow = JSON.parse(fs.readFileSync(workflowPath, 'utf8'));
  const storyLock = state.tasks.owner_story_lock;
  const capture = state.tasks.product_capture;
  const stage = Array.isArray(workflow.stages) && workflow.stages.find((item) => item && item.id === 'product_capture');
  if (state.status !== 'waiting_for_approval' || !storyLock || storyLock.status !== 'waiting_for_approval') {
    throw new Error('Story Lock binding requires the pending owner_story_lock gate');
  }
  if (!capture || capture.status !== 'waiting_for_dependency' || !stage || !stage.params
    || workflow.workflow_id !== 'hermes_marketing_video_ep2_r3') {
    throw new Error('Story Lock binding supports only an undispatched EP2 R3 product_capture task');
  }
  const baseInstruction = buildEp2Workflow(path.resolve(projectPath), 'EP2').stages.find((item) => item.id === 'product_capture').params.instruction;
  if (!baseInstruction.includes('HOME environment must resolve inside that fixture')
    || !baseInstruction.includes('--dir alone does not isolate the default HOME scan')
    || !baseInstruction.includes('Never run bare')) {
    throw new Error('Story Lock binding source contract lacks isolated HOME safeguards');
  }
  const boundInstruction = baseInstruction + ' Controller-bound Story Lock: read ' + reviewPath + ', verify SHA-256 ' + storySha + ' before doing any capture work, and use it as the only story/claim source. If the file or hash differs, block without capture.';
  const previousInstruction = String((capture.params && capture.params.instruction) || '');
  const binding = {
    schema_version: 'hermes.video-dogfood.story-capture-binding.v1',
    run_id: runId,
    source_task_id: 'script_package',
    target_task_id: 'product_capture',
    story_lock_path: reviewPath,
    story_lock_sha256: storySha,
    previous_instruction_sha256: sha256(previousInstruction),
    bound_instruction_sha256: sha256(boundInstruction),
    bound_at: now,
    reused: false,
  };
  stage.params.instruction = boundInstruction;
  capture.params = Object.assign({}, capture.params, { instruction: boundInstruction });
  state.updated_at = now;
  writeJsonAtomic(workflowPath, workflow);
  writeJsonAtomic(statePath(projectPath, runId), state);
  writeJsonAtomic(bindingPath, binding);
  appendRunEvent(root, runId, 'controller_story_bound_to_capture', binding, now);
  return binding;
}

function compactEp2CaptureRetryInstruction(projectPath, runId, storySha) {
  const storyPath = path.join(path.resolve(projectPath), '.sdtk', 'agent-runtime', 'runs', runId, 'reports', 'script_package.controller-reviewed.md');
  return [
    'Compact retry contract for EP2 product capture.',
    'This retry replaces a stalled attempt that exceeded its context budget before a canonical manifest existed.',
    `Read only ${storyPath}; verify SHA-256 ${storySha}, then read only its Truth Boundary, Capture Contract, and Claims Not To Use sections.`,
    'Do not read repository files, runtime configuration, or prior Kanban workspaces.',
    'Use only a dedicated local DEMO DATA fixture. HOME must resolve inside that fixture. Never run bare sdtk usage, inspect an operator home, or expose private account, model, token, rate-limit, credential, or identifier data.',
    'Limit every terminal response to 160 lines or 12 KiB. Do not request recursive listings or full JSON outside the DEMO fixture.',
    'Write the required DEMO-only files and manifest only under the canonical artifact root supplied in this task. The manifest must list every asset path, SHA-256, byte count, purpose, command_run, exit_code, and data_classification demo_only.',
    'If the fixture or command cannot be verified within those bounds, call kanban_block with a concise transient reason and stop. Do not render, publish, create child tasks, or inspect unrelated files.',
  ].join(' ');
}

function amendCaptureContract(projectPath, runId, storySha, now = new Date().toISOString()) {
  const root = path.join(path.resolve(projectPath), '.sdtk', 'agent-runtime', 'runs', requireRunId(runId));
  const state = readState(projectPath, runId);
  const workflowPath = path.join(root, 'workflow.json');
  const workflow = JSON.parse(fs.readFileSync(workflowPath, 'utf8'));
  const reviewPath = path.join(root, 'reports', 'script_package.controller-reviewed.md');
  const review = fs.readFileSync(reviewPath);
  const storyLock = state.tasks.owner_story_lock;
  const capture = state.tasks.product_capture;
  const stage = Array.isArray(workflow.stages) && workflow.stages.find((item) => item && item.id === 'product_capture');
  if (state.status !== 'blocked' || !capture || capture.status !== 'failed') throw new Error('capture amend requires a blocked run with failed product_capture');
  if (!storyLock || storyLock.status !== 'completed') throw new Error('capture amend requires completed owner_story_lock');
  if (workflow.workflow_id !== 'hermes_marketing_video_ep2_r3' || !stage || !stage.params) throw new Error('capture amend supports only the fixed EP2 R3 workflow');
  if (sha256(review) !== storySha) throw new Error('capture amend Story Lock hash does not match the reviewed artifact');
  const replacement = compactEp2CaptureRetryInstruction(projectPath, runId, storySha);
  if (!replacement.includes('dedicated local DEMO DATA fixture') || !replacement.includes('Limit every terminal response to 160 lines or 12 KiB')) {
    throw new Error('capture amend source contract is not fail-closed');
  }
  const oldInstruction = String((capture.params && capture.params.instruction) || '');
  const amendment = {
    schema_version: 'hermes.video-dogfood.capture-contract-amendment.v1',
    run_id: runId,
    task_id: 'product_capture',
    approved_story_lock_sha256: storySha,
    previous_instruction_sha256: sha256(oldInstruction),
    replacement_instruction_sha256: sha256(replacement),
    source: 'controller_compact_ep2_demo_capture_retry_contract',
    amended_at: now,
  };
  writeJsonAtomic(path.join(root, 'reports', 'product_capture.contract-amendment.json'), amendment);
  stage.params.instruction = replacement;
  capture.params = Object.assign({}, capture.params, { instruction: replacement });
  state.updated_at = now;
  writeJsonAtomic(workflowPath, workflow);
  writeJsonAtomic(statePath(projectPath, runId), state);
  appendRunEvent(root, runId, 'controller_capture_contract_amended', amendment, now);
  return amendment;
}


function verifiedCanonicalCaptureAsset(handoffRoot, asset) {
  if (!asset || typeof asset !== 'object' || typeof asset.path !== 'string' || typeof asset.sha256 !== 'string') {
    throw new Error('capture handoff asset metadata is invalid');
  }
  const relative = asset.path.replace(/\\/g, '/');
  if (!relative.startsWith('assets/')) throw new Error('capture handoff asset is outside canonical assets');
  const logicalPath = relative.slice('assets/'.length);
  if (!CAPTURE_HANDOFF_ASSETS.has(logicalPath)) throw new Error('capture handoff asset is not allowlisted: ' + logicalPath);
  if (!/^[a-f0-9]{64}$/.test(asset.sha256)) throw new Error('capture handoff asset sha256 is invalid');
  const absolute = path.resolve(handoffRoot, relative);
  const safeRelative = path.relative(handoffRoot, absolute);
  if (!safeRelative || safeRelative.startsWith('..' + path.sep) || path.isAbsolute(safeRelative)) throw new Error('capture handoff asset path escapes canonical storage');
  const stat = fs.lstatSync(absolute);
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('capture handoff asset must be a regular file');
  const content = fs.readFileSync(absolute);
  if (sha256(content) !== asset.sha256) throw new Error('capture handoff asset sha256 mismatch: ' + relative);
  if (Number.isInteger(asset.bytes) && asset.bytes !== content.length) throw new Error('capture handoff asset byte count mismatch: ' + relative);
  if (/\b(?:api[_-]?key|token|secret|password)\s*[:=]/i.test(content.toString('utf8'))) {
    throw new Error('capture handoff asset contains a credential-like value: ' + relative);
  }
  return { relative, absolute, sha256: asset.sha256, bytes: content.length, purpose: String(asset.purpose || '').slice(0, 160) };
}

function readCanonicalCaptureManifest(root, runId) {
  const handoffRoot = path.join(root, 'artifacts', 'product_capture');
  const manifestPath = path.join(handoffRoot, 'manifest.json');
  let bytes;
  let manifest;
  try {
    bytes = fs.readFileSync(manifestPath);
    manifest = JSON.parse(bytes);
  } catch (_) {
    throw new Error('capture handoff canonical manifest is unavailable');
  }
  if (!manifest || manifest.schema_version !== 'hermes.video-dogfood.capture-handoff.v1'
    || manifest.run_id !== runId || manifest.source_task_id !== 'product_capture'
    || manifest.data_classification !== 'demo_only' || manifest.exit_code !== 0
    || !Array.isArray(manifest.assets) || manifest.assets.length === 0) {
    throw new Error('capture handoff canonical manifest is invalid');
  }
  const accepted = manifest.assets.map((asset) => verifiedCanonicalCaptureAsset(handoffRoot, asset));
  const label = accepted.find((asset) => asset.relative === 'assets/demo_fixture/DEMO_DATA.txt');
  if (!label) throw new Error('capture handoff requires a DEMO DATA label asset');
  if (!/DEMO DATA/.test(fs.readFileSync(label.absolute, 'utf8'))) throw new Error('capture handoff DEMO DATA label is invalid');
  if (!accepted.some((asset) => asset.relative === 'assets/capture_table_output.txt')) throw new Error('capture handoff requires terminal table output');
  return { handoffRoot, manifestPath, manifest, manifestSha: sha256(bytes), assets: accepted };
}

function acceptDeterministicCapture(projectPath, runId, now = new Date().toISOString()) {
  const root = path.join(path.resolve(projectPath), '.sdtk', 'agent-runtime', 'runs', requireRunId(runId));
  const state = readState(projectPath, runId);
  const capture = state.tasks.product_capture;
  if (state.status !== 'running' || !capture || capture.status !== 'ready') {
    throw new Error('capture accept requires a running EP2 run with ready product_capture');
  }
  const canonical = readCanonicalCaptureManifest(root, runId);
  if (canonical.manifest.fixture_isolated_home !== true
    || typeof canonical.manifest.fixture_root !== 'string'
    || !path.resolve(canonical.manifest.fixture_root).startsWith(path.join(root, 'fixtures') + path.sep)
    || !String(canonical.manifest.command_run || '').includes('sdtk usage')) {
    throw new Error('capture accept requires an isolated local usage-demo fixture');
  }
  if (canonical.assets.length !== CAPTURE_HANDOFF_ASSETS.size
    || canonical.assets.some((asset) => !CAPTURE_HANDOFF_ASSETS.has(asset.relative.slice('assets/'.length)))) {
    throw new Error('capture accept requires the complete allowlisted capture asset set');
  }
  const evidencePath = path.join(root, 'evidence', 'product_capture.evidence.json');
  let evidence;
  try {
    const stat = fs.lstatSync(evidencePath);
    if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('not a regular file');
    evidence = JSON.parse(fs.readFileSync(evidencePath, 'utf8'));
  } catch (_) {
    throw new Error('capture accept requires submitted deterministic evidence');
  }
  if (!evidence || evidence.schema_version !== 'sdtk.agent-evidence.v1'
    || evidence.run_id !== runId || evidence.task_id !== 'product_capture'
    || !evidence.fields || evidence.fields.validation_status !== 'success'
    || evidence.fields.data_classification !== 'demo_only'
    || evidence.fields.fixture_isolated_home !== true
    || evidence.fields.manifest_sha256 !== canonical.manifestSha
    || evidence.fields.path !== canonical.manifestPath
    || !evidence.external_ids || evidence.external_ids.evidence_mode !== 'controller_deterministic_fixture_runner'
    || !Array.isArray(evidence.artifacts)
    || !evidence.artifacts.some((artifact) => artifact && artifact.path === canonical.manifestPath && artifact.sha256 === canonical.manifestSha)) {
    throw new Error('capture accept deterministic evidence contract is invalid');
  }
  const priorExternalTaskId = capture.external_ids && capture.external_ids.hermes_task_id || null;
  capture.status = 'completed';
  capture.completed_at = now;
  capture.blocked_reason = null;
  capture.last_error = null;
  capture.external_ids = {};
  capture.result = {
    path: canonical.manifestPath,
    sha256: canonical.manifestSha,
    source: 'controller_deterministic_fixture_runner',
    data_classification: 'demo_only',
  };
  state.updated_at = now;
  writeJsonAtomic(statePath(projectPath, runId), state);
  const result = {
    task_id: 'product_capture',
    manifest_path: canonical.manifestPath,
    manifest_sha256: canonical.manifestSha,
    asset_count: canonical.assets.length,
    prior_external_task_id: priorExternalTaskId,
    accepted_at: now,
  };
  appendRunEvent(root, runId, 'controller_deterministic_capture_accepted', result, now);
  return result;
}

function prepareCaptureHandoff(projectPath, runId, now = new Date().toISOString()) {
  const root = path.join(path.resolve(projectPath), '.sdtk', 'agent-runtime', 'runs', requireRunId(runId));
  const state = readState(projectPath, runId);
  const capture = state.tasks.product_capture;
  const render = state.tasks.episode_render;
  if (!capture || capture.status !== 'completed' || !render || !['ready', 'running_external'].includes(render.status)) {
    throw new Error('capture handoff requires completed product_capture and an uncompleted episode_render');
  }
  const canonical = readCanonicalCaptureManifest(root, runId);
  const manifestRelative = path.relative(root, canonical.manifestPath).split(path.sep).join('/');
  const renderOutput = {
    video_path: path.join(root, 'artifacts', 'episode_render', 'episode.mp4'),
    quality_report_path: path.join(root, 'reports', 'episode_render.quality.json'),
  };
  const workflowPath = path.join(root, 'workflow.json');
  const workflow = JSON.parse(fs.readFileSync(workflowPath, 'utf8'));
  const stage = Array.isArray(workflow.stages) && workflow.stages.find((item) => item && item.id === 'episode_render');
  if (!stage || !stage.params || workflow.workflow_id !== 'hermes_marketing_video_ep2_r3') throw new Error('capture handoff supports only fixed EP2 R3 render stage');
  if (stage.params.capture_handoff && stage.params.capture_handoff.manifest_sha256 === canonical.manifestSha) {
    return { manifest_path: canonical.manifestPath, manifest_sha256: canonical.manifestSha, asset_count: canonical.assets.length, reused: true };
  }
  const clause = ' Use only canonical DEMO capture handoff ' + canonical.manifestPath + '; manifest SHA-256: ' + canonical.manifestSha + '. Verify every listed asset hash before rendering. Do not read the HerDev workspace. Write the rendered MP4 only to ' + renderOutput.video_path + ' and the factual quality report only to ' + renderOutput.quality_report_path + '. Do not complete this task without both files.';
  const instruction = String(stage.params.instruction || '').replace(/\s+$/, '') + clause;
  stage.params = Object.assign({}, stage.params, { instruction, capture_handoff: { manifest_path: canonical.manifestPath, manifest_sha256: canonical.manifestSha, data_classification: 'demo_only' }, render_output: renderOutput });
  render.params = Object.assign({}, render.params, stage.params);
  state.updated_at = now;
  writeJsonAtomic(workflowPath, workflow);
  writeJsonAtomic(statePath(projectPath, runId), state);
  appendRunEvent(root, runId, 'controller_capture_handoff_prepared', { task_id: 'episode_render', manifest_path: manifestRelative, manifest_sha256: canonical.manifestSha, asset_count: canonical.assets.length }, now);
  return { manifest_path: canonical.manifestPath, manifest_sha256: canonical.manifestSha, asset_count: canonical.assets.length, reused: false };
}

function markRenderVerificationFailure(projectPath, runId, state, reason, now) {
  const root = path.join(path.resolve(projectPath), '.sdtk', 'agent-runtime', 'runs', runId);
  const render = state.tasks.episode_render;
  const pictureLock = state.tasks.owner_picture_lock;
  render.status = 'failed';
  render.failed_at = now;
  render.blocked_reason = reason;
  render.last_error = reason;
  render.last_errors = (Array.isArray(render.last_errors) ? render.last_errors : []).concat([{ code: 'HERMES_RENDER_OUTPUT_INVALID', detail: reason }]);
  if (pictureLock && pictureLock.status === 'waiting_for_approval') {
    pictureLock.status = 'blocked';
    pictureLock.blocked_by = 'episode_render';
    pictureLock.blocked_reason = reason;
  }
  for (const task of Object.values(state.tasks)) {
    if (task && task.status === 'waiting_for_dependency') {
      task.status = 'blocked';
      task.blocked_by = task.depends_on && task.depends_on[0] || 'episode_render';
    }
  }
  state.status = 'blocked';
  state.waiting_gate_id = null;
  state.waiting_task_id = null;
  state.blocker = 'episode_render: ' + reason;
  state.updated_at = now;
  writeJsonAtomic(statePath(projectPath, runId), state);
  appendRunEvent(root, runId, 'controller_render_output_rejected', { task_id: 'episode_render', reason }, now);
  return { valid: false, task_id: 'episode_render', reason };
}

function verifyRenderOutput(projectPath, runId, now = new Date().toISOString()) {
  const root = path.join(path.resolve(projectPath), '.sdtk', 'agent-runtime', 'runs', requireRunId(runId));
  const state = readState(projectPath, runId);
  const render = state.tasks.episode_render;
  const pictureLock = state.tasks.owner_picture_lock;
  if (state.status !== 'waiting_for_approval' || !render || render.status !== 'completed'
    || !pictureLock || pictureLock.status !== 'waiting_for_approval') {
    throw new Error('render verify requires completed episode_render awaiting owner_picture_lock');
  }
  const output = render.params && render.params.render_output;
  const expectedVideo = path.join(root, 'artifacts', 'episode_render', 'episode.mp4');
  const expectedReport = path.join(root, 'reports', 'episode_render.quality.json');
  if (!output || output.video_path !== expectedVideo || output.quality_report_path !== expectedReport) {
    return markRenderVerificationFailure(projectPath, runId, state, 'canonical render output contract is missing', now);
  }
  let videoBytes;
  let report;
  try {
    if (!fs.existsSync(expectedVideo)) throw new Error('rendered MP4 is missing or too small');
    const videoStat = fs.lstatSync(expectedVideo);
    if (!videoStat.isFile() || videoStat.isSymbolicLink() || videoStat.size < 65536) throw new Error('rendered MP4 is missing or too small');
    videoBytes = fs.readFileSync(expectedVideo);
    if (!fs.existsSync(expectedReport)) throw new Error('quality report is missing');
    const reportStat = fs.lstatSync(expectedReport);
    if (!reportStat.isFile() || reportStat.isSymbolicLink()) throw new Error('quality report is missing');
    report = JSON.parse(fs.readFileSync(expectedReport, 'utf8'));
  } catch (error) {
    return markRenderVerificationFailure(projectPath, runId, state, error.message, now);
  }
  const videoSha = sha256(videoBytes);
  if (!report || report.run_id !== runId || report.task_id !== 'episode_render'
    || report.video_path !== expectedVideo || report.video_sha256 !== videoSha
    || report.quality_status !== 'pass') {
    return markRenderVerificationFailure(projectPath, runId, state, 'quality report does not attest the canonical rendered MP4', now);
  }
  const verification = { task_id: 'episode_render', video_path: expectedVideo, video_sha256: videoSha, quality_report_path: expectedReport, verified_at: now };
  writeJsonAtomic(path.join(root, 'reports', 'episode_render.controller-verified.json'), verification);
  state.updated_at = now;
  writeJsonAtomic(statePath(projectPath, runId), state);
  appendRunEvent(root, runId, 'controller_render_output_verified', verification, now);
  return Object.assign({ valid: true }, verification);
}

function handoffComment(manifestRelative, manifestSha) {
  return [
    HANDOFF_COMMENT_MARKER,
    'Canonical DEMO capture handoff is ready for this render task.',
    'manifest: ' + manifestRelative,
    'sha256: ' + manifestSha,
    'Verify every listed asset hash before rendering. Do not read the HerDev workspace.',
  ].join('\n');
}

function deliverCaptureHandoff(projectPath, runId, now = new Date().toISOString(), options = {}) {
  const root = path.join(path.resolve(projectPath), '.sdtk', 'agent-runtime', 'runs', requireRunId(runId));
  const state = readState(projectPath, runId);
  const render = state.tasks.episode_render;
  const cardId = render && render.external_ids && render.external_ids.hermes_task_id;
  if (!render || render.status !== 'running_external' || !/^t_[a-z0-9]+$/.test(String(cardId || ''))) {
    throw new Error('capture handoff delivery requires a submitted EP2 render card');
  }
  const manifestPath = path.join(root, 'artifacts', 'product_capture', 'manifest.json');
  const manifestBytes = fs.readFileSync(manifestPath);
  const manifest = JSON.parse(manifestBytes);
  const manifestSha = sha256(manifestBytes);
  if (manifest.run_id !== runId || manifest.source_task_id !== 'product_capture' || manifest.data_classification !== 'demo_only' || !Array.isArray(manifest.assets)) {
    throw new Error('capture handoff manifest is invalid');
  }
  const manifestRelative = path.relative(root, manifestPath).split(path.sep).join('/');
  const commandRunner = options.commandRunner || childProcess.spawnSync;
  const env = Object.assign({}, process.env, { HERMES_HOME: HERMES_DISPATCH_HOME });
  delete env.HERMES_KANBAN_HOME;
  const shown = commandRunner(HERMES_BIN, ['kanban', 'show', cardId, '--json'], { encoding: 'utf8', env });
  if (!shown || shown.status !== 0) throw new Error('capture handoff cannot inspect native render card');
  let native;
  try { native = JSON.parse(shown.stdout || '{}'); }
  catch (_) { throw new Error('capture handoff native render card is invalid JSON'); }
  const comments = Array.isArray(native.comments) ? native.comments : [];
  const marker = HANDOFF_COMMENT_MARKER + '\n';
  if (comments.some((comment) => String(comment.body || comment.text || comment.content || '').includes(marker) && String(comment.body || comment.text || comment.content || '').includes(manifestSha))) {
    return { task_id: cardId, manifest_path: manifestPath, manifest_sha256: manifestSha, delivered: true, reused: true };
  }
  const body = handoffComment(manifestPath, manifestSha);
  const commented = commandRunner(HERMES_BIN, ['kanban', 'comment', cardId, body, '--author', 'sdtk-controller'], { encoding: 'utf8', env });
  if (!commented || commented.status !== 0) throw new Error('capture handoff native comment failed');
  const verified = commandRunner(HERMES_BIN, ['kanban', 'show', cardId, '--json'], { encoding: 'utf8', env });
  if (!verified || verified.status !== 0) throw new Error('capture handoff cannot verify native comment');
  let verifiedNative;
  try { verifiedNative = JSON.parse(verified.stdout || '{}'); }
  catch (_) { throw new Error('capture handoff native verification is invalid JSON'); }
  const verifiedComments = Array.isArray(verifiedNative.comments) ? verifiedNative.comments : [];
  if (!verifiedComments.some((comment) => String(comment.body || comment.text || comment.content || '').includes(HANDOFF_COMMENT_MARKER) && String(comment.body || comment.text || comment.content || '').includes(manifestSha))) {
    throw new Error('capture handoff native comment did not persist');
  }
  render.capture_handoff = Object.assign({}, render.capture_handoff, {
    manifest_path: manifestRelative,
    manifest_sha256: manifestSha,
    native_comment_marker: HANDOFF_COMMENT_MARKER,
    native_comment_delivered_at: now,
  });
  state.updated_at = now;
  writeJsonAtomic(statePath(projectPath, runId), state);
  appendRunEvent(root, runId, 'controller_capture_handoff_delivered', { task_id: 'episode_render', native_task_id: cardId, manifest_path: manifestRelative, manifest_sha256: manifestSha }, now);
  return { task_id: cardId, manifest_path: manifestPath, manifest_sha256: manifestSha, delivered: true, reused: false };
}

function executeCommand(args, dependencies = {}) {
  const captureAccept = dependencies.acceptDeterministicCapture || acceptDeterministicCapture;
  const renderVerify = dependencies.verifyRenderOutput || verifyRenderOutput;
  const handoffPrepare = dependencies.prepareCaptureHandoff || prepareCaptureHandoff;
  const handoffDeliver = dependencies.deliverCaptureHandoff || deliverCaptureHandoff;
  if (args.command === 'story-bind') {
    return bindStoryToCapture(args.projectPath, args.runId, args.storySha);
  }
  if (args.command === 'capture-amend') {
    return amendCaptureContract(args.projectPath, args.runId, args.storySha);
  }
  if (args.command === 'capture-accept') {
    return captureAccept(args.projectPath, args.runId);
  }
  if (args.command === 'render-verify') {
    return renderVerify(args.projectPath, args.runId);
  }
  if (args.command === 'handoff-prepare') {
    return handoffPrepare(args.projectPath, args.runId);
  }
  if (args.command === 'handoff-deliver') {
    return handoffDeliver(args.projectPath, args.runId);
  }
  if (args.command === 'defect-record') {
    return recordDefect(args.projectPath, {
      defect_id: args.defectId,
      title: args.title,
      severity: args.severity,
      run_id: args.runId,
      task_id: args.taskId,
      blocker_class: args.blockerClass,
      next_action: args.nextAction,
    });
  }
  if (args.command === 'defect-close') {
    return closeDefect(args.projectPath, args.defectId, args.verification);
  }
  const inspection = inspectRun(args.projectPath, args.runId);
  if (args.command === 'inspect') return inspection;
  if (args.command === 'next') return recommendNext(inspection);
  return { preflight: recommendNext(inspection), execution: runSdtk(args) };
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const result = executeCommand(args);
  process.stdout.write(JSON.stringify(result, null, 2) + '\n');
  if (result.execution && result.execution.exit_code !== 0) process.exitCode = 1;
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    process.stderr.write(JSON.stringify({ status: 'error', error: error.message }) + '\n');
    process.exitCode = 1;
  }
}

module.exports = { acceptDeterministicCapture, amendCaptureContract, bindStoryToCapture, closeDefect, deliverCaptureHandoff, executeCommand, inspectRun, markRenderVerificationFailure, parseArgs, prepareCaptureHandoff, readDefectLedger, readState, recommendNext, recordDefect, runSdtk, verifyRenderOutput };
