'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { resolveWorkflow } = require('./workflows');

const BOARD = /^[a-z0-9][a-z0-9-]{2,63}$/;
const NATIVE_TASK = /^t_[a-z0-9_]+$/;

function requireText(value, name) {
  const result = String(value || '').trim();
  if (!result) throw new Error(`${name} is required`);
  return result;
}

function parseJson(stdout, label) {
  try { return JSON.parse(String(stdout || '')); } catch { throw new Error(`${label} returned invalid JSON`); }
}

function nativeTaskId(payload) {
  const id = payload?.id || payload?.task?.id;
  if (!NATIVE_TASK.test(String(id || ''))) throw new Error('native create did not return a bounded task id');
  return String(id);
}

class NativeKanbanAdapter {
  constructor(options) {
    this.controller = options.controller;
    if (!this.controller || typeof this.controller.nextTask !== 'function') throw new Error('controller is required');
    this.client = options.client;
    if (!this.client || typeof this.client.run !== 'function') throw new Error('native command client is required');
    this.hermesBin = options.hermesBin || '/workspace/.venvs/hermes-agent/bin/hermes';
    this.profileHome = path.resolve(requireText(options.profileHome, 'profile home'));
    this.board = requireText(options.board, 'board');
    if (!BOARD.test(this.board)) throw new Error('invalid staging board');
    this.workflow = options.workflow || 'video_production';
    this.assignee = options.assignee || resolveWorkflow(this.workflow).owner;
    if (this.assignee !== resolveWorkflow(this.workflow).owner) throw new Error('native adapter assignee does not match workflow owner');
  }

  _env() {
    return { HERMES_HOME: this.profileHome, HERMES_KANBAN_HOME: '/opt/data/hermes', PATH: process.env.PATH || '' };
  }

  _run(argv) {
    const result = this.client.run(argv, { env: this._env() });
    if (!result || !Number.isInteger(result.returncode)) throw new Error('native command returned an invalid result');
    return result;
  }

  _assertOk(result, action) {
    if (result.returncode !== 0) throw new Error(`native ${action} failed`);
    return result;
  }

  _key(runId, taskId, attempt) {
    return `sdtk-marketing:${runId}:${taskId}:${attempt}`;
  }

  _materializeHandoff(runId) {
    const artifactRoot = path.join(this.controller.artifactRoot, runId);
    const handoffPath = path.join(artifactRoot, 'approved-handoff.json');
    const content = `${JSON.stringify(this.controller.input(runId), null, 2)}\n`;
    fs.mkdirSync(artifactRoot, { recursive: true, mode: 0o700 });
    fs.writeFileSync(handoffPath, content, { mode: 0o600 });
    return { path: handoffPath, sha256: crypto.createHash('sha256').update(content).digest('hex'), input: this.controller.input(runId) };
  }

  _materializeResearchInstructions(runId, handoff, scaffold, attempt) {
    const artifactRoot = path.join(this.controller.artifactRoot, runId);
    const instructionPath = path.join(artifactRoot, 'research-instructions.md');
    const input = handoff.input || {};
    const content = [
      '# Workflow A evidence-bound story task',
      '',
      'Execution budget: this is not open-ended discovery. Do not browse, search the repo, or create supplemental evidence unless a controller-supplied source receipt exists in this artifact root.',
      'Complete only the supplied template, preserve its evidence array exactly, run the deterministic finalizer once, then mark the native task complete.',
      '',
      `Episode: ${input.episode_id || 'EP4'} revision: ${input.revision || 'r1'}`,
      `Episode seed: ${scaffold.seedPath}`,
      `Starter template: ${scaffold.templatePath}`,
      `Language: ${input.language || 'English'}`,
      `Approved audience: ${input.audience || 'Not supplied'}`,
      `Approved pain point: ${input.pain_point || 'Not supplied'}`,
      `Required product proof: ${input.product_proof || 'Not supplied'}`,
      `CTA boundary: ${input.cta || 'Not supplied'}`,
      '',
      'Allowed research policy:',
      ...(Array.isArray(input.source_policy) ? input.source_policy.map((item) => `- ${item}`) : ['- No source policy supplied.']),
      '',
      'Forbidden claims:',
      ...(Array.isArray(input.forbidden_claims) ? input.forbidden_claims.map((item) => `- ${item}`) : ['- Do not invent product metrics, customer results, testimonials, or production claims.']),
      '',
      'Required production-brief coverage:',
      ...(Array.isArray(input.required_brief_outputs) ? input.required_brief_outputs.map((item) => `- ${item}`) : []),
      '',
      'Research boundary:',
      '- No controller-supplied source receipt is present. Use only episode-seed.json and the supplied template for this task.',
      '- Do not call web, browser, terminal repository search, or create supplemental source files.',
      '- Do not substitute a different industry, audience, or product scenario.',
      '',
      'Required output:',
      '- Copy the starter template to production-brief.json and replace only its empty story fields with grounded English content.',
      '- Keep episode_id, revision, audience, pain_point, and cta byte-for-byte equivalent to the supplied seed values.',
      '- Evidence invariant: evidence must remain exactly ["episode-seed.json"]. Do not add absolute paths, objects, inferred files, or new evidence.',
      '- Write production-brief.json in this workspace using schema sdtk.marketing-production-brief.v1.',
      '- Include audience, pain_point, hook, narration, cta, shot_list, claim_ledger, and evidence.',
      `- Run exactly after production-brief.json is valid: node ${path.join(__dirname, 'research-finalizer-cli.js')} --root ${artifactRoot} --run-id ${runId} --attempt ${attempt} --seed-file episode-seed.json`,
      '- Do not handwrite worker-result.json; the deterministic finalizer creates it.',
      '',
      `Approved handoff: ${handoff.path}`,
      `Artifact root: ${artifactRoot}`,
    ].join('\n') + '\n';
    fs.writeFileSync(instructionPath, content, { mode: 0o600 });
    return { path: instructionPath, sha256: crypto.createHash('sha256').update(content).digest('hex') };
  }

  _materializeResearchScaffold(runId, handoff) {
    const artifactRoot = path.join(this.controller.artifactRoot, runId);
    const seedPath = path.join(artifactRoot, 'episode-seed.json');
    const templatePath = path.join(artifactRoot, 'production-brief.template.json');
    const seed = handoff.input || {};
    fs.writeFileSync(seedPath, JSON.stringify(seed, null, 2) + '\n', { mode: 0o600 });
    const template = {
      schema_version: 'sdtk.marketing-production-brief.v1',
      episode_id: seed.episode_id,
      revision: seed.revision,
      audience: seed.audience,
      pain_point: seed.pain_point,
      hook: '',
      narration: '',
      cta: seed.cta,
      shot_list: [],
      claim_ledger: [],
      evidence: ['episode-seed.json'],
    };
    fs.writeFileSync(templatePath, JSON.stringify(template, null, 2) + '\n', { mode: 0o600 });
    return { seedPath, templatePath };
  }

  _materializeStagingSmokeCompletion(runId, taskId, attempt) {
    const artifactRoot = path.join(this.controller.artifactRoot, runId);
    const scriptPath = path.join(artifactRoot, 'complete-staging-smoke.js');
    const source = [
      "'use strict';",
      "const crypto = require('crypto');",
      "const fs = require('fs');",
      "const path = require('path');",
      `const root = ${JSON.stringify(artifactRoot)};`,
      `const runId = ${JSON.stringify(runId)};`,
      `const taskId = ${JSON.stringify(taskId)};`,
      `const attempt = ${Number(attempt)};`,
      "const evidenceName = `${taskId}-smoke-evidence.txt`;",
      "const evidencePath = path.join(root, evidenceName);",
      "fs.writeFileSync(evidencePath, `Workflow B disposable staging smoke evidence for ${taskId}.\\n`, { mode: 0o600 });",
      "const sha256 = crypto.createHash('sha256').update(fs.readFileSync(evidencePath)).digest('hex');",
      "const candidate = { schema_version: 'sdtk.video-task-result.v1', run_id: runId, task_id: taskId, attempt, status: 'completed', artifacts: [{ path: evidenceName, sha256, media_type: 'text/plain' }], validation: { status: 'pass', validator: 'workflow-b-staging-smoke-v1', evidence: [evidenceName] }, summary: `Disposable staging smoke evidence created for ${taskId}`, error: null };",
      "fs.writeFileSync(path.join(root, 'worker-result.json'), JSON.stringify(candidate, null, 2) + '\\n', { mode: 0o600 });",
      "process.stdout.write('WORKFLOW_B_STAGING_SMOKE_CANDIDATE_READY\\n');",
    ].join('\n');
    fs.writeFileSync(scriptPath, source, { mode: 0o700 });
    return scriptPath;
  }

  _taskBody(runId, taskId, attempt, handoff, researchInstructions) {
    const artifactRoot = path.join(this.controller.artifactRoot, runId);
    const base = [
      `Controller-owned ${this.workflow} staging task.`,
      `Run: ${runId}`,
      `Task: ${taskId} attempt ${attempt}`,
      `Read the approved handoff: ${handoff.path}`,
      `Approved handoff SHA-256: ${handoff.sha256}`,
      `Write candidate artifacts under: ${artifactRoot}`,
      `Write exactly one result candidate to: ${path.join(artifactRoot, 'worker-result.json')}`,
    ];
    if (this.workflow === 'research_and_story' && handoff.input.staging_smoke !== true) {
      return base.concat([
        `Read the bounded task instructions: ${researchInstructions.path}`,
        `Task instructions SHA-256: ${researchInstructions.sha256}`,
        'Use schema sdtk.video-task-result.v1 with hashes for every artifact.',
        'The required artifact is production-brief.json with schema sdtk.marketing-production-brief.v1.',
        'The brief must include audience, pain_point, hook, narration, cta, shot_list, claim_ledger, and evidence.',
        'Do not invent product metrics or imply production/customer results without evidence.',
        'After worker-result.json is written, mark this native card complete with a concise summary.',
        'Do not publish, message external services, create child tasks, or open a controller gate.',
        'The controller validates the candidate and exclusively owns workflow state and the Story Lock transition.',
      ]).join('\n');
    }
    if (handoff.input.staging_smoke === true) {
      const scriptPath = this._materializeStagingSmokeCompletion(runId, taskId, attempt);
      return base.concat([
        'This is a disposable staging smoke. Do not capture, render, browse, or publish.',
        `Run exactly: node ${scriptPath}`,
        'After the command succeeds, mark this native card complete with a concise summary.',
        'Do not publish, message external services, or open a controller gate.',
        'The controller validates the candidate and exclusively owns workflow state and every owner-gate transition.',
      ]).join('\n');
    }
    return base.concat([
      'Use schema sdtk.video-task-result.v1 with hashes for every artifact.',
      'After worker-result.json is written, mark this native card complete with a concise summary.',
      'Do not publish, message external services, create child tasks, or open a controller gate.',
      'The controller validates the candidate and exclusively owns workflow state and every owner-gate transition.',
    ]).join('\n');
  }

  _create(runId, taskId, attempt) {
    const key = this._key(runId, taskId, attempt);
    const handoff = this._materializeHandoff(runId);
    const researchScaffold = this.workflow === 'research_and_story' && handoff.input.staging_smoke !== true
      ? this._materializeResearchScaffold(runId, handoff)
      : null;
    const researchInstructions = researchScaffold
      ? this._materializeResearchInstructions(runId, handoff, researchScaffold, attempt)
      : null;
    const result = this._assertOk(this._run([
      this.hermesBin, 'kanban', '--board', this.board, 'create',
      `Workflow ${this.workflow} ${runId} ${taskId}`,
      '--assignee', this.assignee,
      '--workspace', `dir:${path.join(this.controller.artifactRoot, runId)}`,
      '--idempotency-key', key,
      '--max-runtime', '2h',
      '--max-retries', '1',
      '--created-by', 'marketing-workflow-controller',
      '--initial-status', 'blocked',
      '--body', this._taskBody(runId, taskId, attempt, handoff, researchInstructions),
      '--json',
    ]), 'create');
    const payload = parseJson(result.stdout, 'native create');
    if (payload.assignee !== this.assignee || payload.status !== 'blocked') throw new Error('native create returned an unexpected task identity');
    return { native_task_id: nativeTaskId(payload), idempotency_key: key };
  }

  _unblock(nativeTaskIdValue) {
    this._assertOk(this._run([
      this.hermesBin, 'kanban', '--board', this.board, 'unblock', nativeTaskIdValue,
    ]), 'unblock');
  }

  _dispatch(nativeTaskIdValue) {
    const result = this._assertOk(this._run([
      this.hermesBin, 'kanban', '--board', this.board, 'dispatch', '--max', '1', '--json',
    ]), 'dispatcher');
    const payload = parseJson(result.stdout, 'native dispatcher');
    const spawned = Array.isArray(payload.spawned) ? payload.spawned.map((item) => typeof item === 'string' ? item : item?.task_id || item?.id) : [];
    if (spawned.includes(nativeTaskIdValue)) return 'claimed_by_cli';

    // The HerVid gateway also owns an embedded dispatcher. It can claim this
    // card between the explicit CLI kick and JSON response processing. Trust
    // only the card's authoritative native state, never an empty response.
    const lookup = this._assertOk(this._run([
      this.hermesBin, 'kanban', '--board', this.board, 'show', nativeTaskIdValue, '--json',
    ]), 'native task lookup');
    const task = parseJson(lookup.stdout, 'native task lookup').task;
    if (task?.id === nativeTaskIdValue && task.assignee === 'hervid' && ['running', 'done'].includes(task.status)) return 'claimed_by_gateway';
    throw new Error('native dispatcher did not claim the registered task');
  }

  dispatchReadyTask(input) {
    const runId = requireText(input.runId, 'run id');
    const next = this.controller.nextTask(runId);
    const state = next.state;
    if (state.workflow !== this.workflow) throw new Error('native adapter workflow does not match run');
    const taskId = next.task_id;
    if (!taskId) throw new Error('workflow has no ready task');
    let task = state.tasks[taskId];
    let attempt = task?.attempt || 1;
    if (!task) {
      const created = this._create(runId, taskId, attempt);
      this.controller.registerExternalTask({
        runId, taskId, attempt, nativeTaskId: created.native_task_id, idempotencyKey: created.idempotency_key, board: this.board,
      });
      task = this.controller.status(runId).tasks[taskId];
    }
    if (task.status === 'external_registered') {
      this._unblock(task.native_task_id);
      this.controller.releaseExternalTask({ runId, taskId, attempt, nativeTaskId: task.native_task_id });
      task = this.controller.status(runId).tasks[taskId];
    }
    if (task.status !== 'external_released') throw new Error('external task is not releasable');
    this._dispatch(task.native_task_id);
    return { run_id: runId, task_id: taskId, native_task_id: task.native_task_id, attempt, board: this.board };
  }
}

module.exports = { NativeKanbanAdapter };
