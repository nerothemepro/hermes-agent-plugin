#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const childProcess = require('child_process');

const { buildEp2Workflow } = require('../../src/hermesControlPlaneEp2');

const DEFAULT_PROJECT_PATH = '/workspace/hermes-agent-plugin';
const RUN_ID_PATTERN = /^run_[a-z0-9]+_[a-z0-9]+$/;
const SUPPORTED_COMMANDS = new Set(['inspect', 'next', 'reconcile', 'continue', 'capture-amend', 'handoff-prepare', 'handoff-deliver', 'defect-record', 'defect-close']);
const HERMES_BIN = '/workspace/.venvs/hermes-agent/bin/hermes';
const HERVID_PROFILE_HOME = '/opt/data/hermes-profiles/hervid';
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
  if (command === 'defect' || command === 'capture' || command === 'handoff') {
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
  if ((args.command === 'continue' || args.command === 'capture-amend' || args.command === 'handoff-prepare' || args.command === 'handoff-deliver') && !args.confirm) throw new Error(args.command + ' requires --confirm');
  if (args.command !== 'continue' && args.command !== 'capture-amend' && args.command !== 'handoff-prepare' && args.command !== 'handoff-deliver' && args.confirm) throw new Error('--confirm is valid only for continue, capture amend, or handoff prepare');
  if (args.command === 'defect-record') {
    requireRunId(args.runId);
    if (!args.defectId || !args.title || !args.severity || !args.taskId || !args.blockerClass || !args.nextAction) {
      throw new Error('defect record requires all bounded fields');
    }
  } else if (args.command === 'defect-close') {
    if (!args.defectId || !args.verification) throw new Error('defect close requires verification evidence');
  } else if (args.command === 'capture-amend') {
    requireRunId(args.runId);
    if (!/^[a-f0-9]{64}$/.test(args.storySha)) throw new Error('capture amend requires a sha256 Story Lock artifact');
  } else if (args.command === 'handoff-prepare' || args.command === 'handoff-deliver') {
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
  const replacement = buildEp2Workflow(path.resolve(projectPath), 'EP2').stages.find((item) => item.id === 'product_capture').params.instruction;
  if (!replacement.includes('dedicated local DEMO DATA fixture') || !replacement.includes('If no approved demo fixture is available, block the task before capture.')) {
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
    source: 'fixed_ep2_r3_demo_data_capture_contract',
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
  const workflowPath = path.join(root, 'workflow.json');
  const workflow = JSON.parse(fs.readFileSync(workflowPath, 'utf8'));
  const stage = Array.isArray(workflow.stages) && workflow.stages.find((item) => item && item.id === 'episode_render');
  if (!stage || !stage.params || workflow.workflow_id !== 'hermes_marketing_video_ep2_r3') throw new Error('capture handoff supports only fixed EP2 R3 render stage');
  if (stage.params.capture_handoff && stage.params.capture_handoff.manifest_sha256 === canonical.manifestSha) {
    return { manifest_path: canonical.manifestPath, manifest_sha256: canonical.manifestSha, asset_count: canonical.assets.length, reused: true };
  }
  const clause = ' Use only canonical DEMO capture handoff ' + manifestRelative + '; manifest SHA-256: ' + canonical.manifestSha + '. Verify every listed asset hash before rendering. Do not read the HerDev workspace.';
  const instruction = String(stage.params.instruction || '').replace(/\s+$/, '') + clause;
  stage.params = Object.assign({}, stage.params, { instruction, capture_handoff: { manifest_path: manifestRelative, manifest_sha256: canonical.manifestSha, data_classification: 'demo_only' } });
  render.params = Object.assign({}, render.params, stage.params);
  state.updated_at = now;
  writeJsonAtomic(workflowPath, workflow);
  writeJsonAtomic(statePath(projectPath, runId), state);
  appendRunEvent(root, runId, 'controller_capture_handoff_prepared', { task_id: 'episode_render', manifest_path: manifestRelative, manifest_sha256: canonical.manifestSha, asset_count: canonical.assets.length }, now);
  return { manifest_path: canonical.manifestPath, manifest_sha256: canonical.manifestSha, asset_count: canonical.assets.length, reused: false };
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
  const env = Object.assign({}, process.env, { HERMES_HOME: HERVID_PROFILE_HOME, HERMES_KANBAN_HOME: HERVID_PROFILE_HOME });
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
  const body = handoffComment(manifestRelative, manifestSha);
  const commented = commandRunner(HERMES_BIN, ['kanban', 'comment', cardId, body, '--author', 'sdtk-controller'], { encoding: 'utf8', env });
  if (!commented || commented.status !== 0) throw new Error('capture handoff native comment failed');
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
  const handoffPrepare = dependencies.prepareCaptureHandoff || prepareCaptureHandoff;
  const handoffDeliver = dependencies.deliverCaptureHandoff || deliverCaptureHandoff;
  if (args.command === 'capture-amend') {
    return amendCaptureContract(args.projectPath, args.runId, args.storySha);
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

module.exports = { amendCaptureContract, closeDefect, deliverCaptureHandoff, executeCommand, inspectRun, parseArgs, prepareCaptureHandoff, readDefectLedger, readState, recommendNext, recordDefect, runSdtk };
