#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const childProcess = require('child_process');

const DEFAULT_PROJECT_PATH = '/workspace/hermes-agent-plugin';
const RUN_ID_PATTERN = /^run_[a-z0-9]+_[a-z0-9]+$/;
const SUPPORTED_COMMANDS = new Set(['inspect', 'next', 'reconcile', 'continue', 'defect-record', 'defect-close']);

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
  if (command === 'defect') {
    command = `defect-${argv[1] || ''}`;
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
    else throw new Error(`unknown or incomplete argument: ${arg}`);
  }
  if (args.command === 'continue' && !args.confirm) throw new Error('continue requires --confirm');
  if (args.command !== 'continue' && args.confirm) throw new Error('--confirm is valid only for continue');
  if (args.command === 'defect-record') {
    requireRunId(args.runId);
    if (!args.defectId || !args.title || !args.severity || !args.taskId || !args.blockerClass || !args.nextAction) {
      throw new Error('defect record requires all bounded fields');
    }
  } else if (args.command === 'defect-close') {
    if (!args.defectId || !args.verification) throw new Error('defect close requires verification evidence');
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

function main() {
  const args = parseArgs(process.argv.slice(2));
  let result;
  if (args.command === 'defect-record') {
    result = recordDefect(args.projectPath, {
      defect_id: args.defectId,
      title: args.title,
      severity: args.severity,
      run_id: args.runId,
      task_id: args.taskId,
      blocker_class: args.blockerClass,
      next_action: args.nextAction,
    });
  } else if (args.command === 'defect-close') {
    result = closeDefect(args.projectPath, args.defectId, args.verification);
  } else {
    const inspection = inspectRun(args.projectPath, args.runId);
    if (args.command === 'inspect') result = inspection;
    else if (args.command === 'next') result = recommendNext(inspection);
    else result = { preflight: recommendNext(inspection), execution: runSdtk(args) };
  }
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

module.exports = { closeDefect, inspectRun, parseArgs, readDefectLedger, readState, recommendNext, recordDefect, runSdtk };
