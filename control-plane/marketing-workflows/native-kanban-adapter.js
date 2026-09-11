'use strict';

const crypto = require('crypto');
const childProcess = require('child_process');
const fs = require('fs');
const path = require('path');
const { resolveWorkflow, validateCapturePlan } = require('./workflows');

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
    this.capturePreflight = options.capturePreflight || null;
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
    const input = this.controller.input(runId);
    const handoffPath = path.join(artifactRoot, 'approved-handoff.json');
    const content = `${JSON.stringify(input, null, 2)}\n`;
    fs.mkdirSync(artifactRoot, { recursive: true, mode: 0o700 });
    fs.writeFileSync(handoffPath, content, { mode: 0o600 });
    const result = { path: handoffPath, sha256: crypto.createHash('sha256').update(content).digest('hex'), input };
    if (this.workflow !== 'video_production' || input.staging_smoke === true || !input.source_run_id) return result;
    if (!/^run_[a-z0-9_]+$/.test(String(input.source_run_id))) throw new Error('approved source run id is invalid');
    const sourceRoot = path.join(this.controller.artifactRoot, input.source_run_id);
    const outputs = Array.isArray(input.outputs) ? input.outputs : [];
    const expected = [
      { source: 'production-brief.json', target: 'approved-production-brief.json' },
      { source: 'capture-plan.json', target: 'approved-capture-plan.json' },
    ];
    const copied = {};
    for (const item of expected) {
      const output = outputs.find((candidate) => candidate?.path === item.source);
      if (!output || !/^[a-f0-9]{64}$/.test(String(output.sha256 || ''))) throw new Error('approved handoff missing ' + item.source);
      const source = path.resolve(sourceRoot, item.source);
      if (!source.startsWith(sourceRoot + path.sep) || !fs.existsSync(source) || !fs.lstatSync(source).isFile()) throw new Error('approved source artifact is unavailable: ' + item.source);
      const bytes = fs.readFileSync(source);
      const digest = crypto.createHash('sha256').update(bytes).digest('hex');
      if (digest !== output.sha256) throw new Error('approved source artifact sha256 mismatch: ' + item.source);
      const target = path.join(artifactRoot, item.target);
      fs.writeFileSync(target, bytes, { mode: 0o600 });
      copied[item.source] = { path: target, sha256: digest };
    }
    let plan;
    try { plan = JSON.parse(fs.readFileSync(copied['capture-plan.json'].path, 'utf8')); } catch { throw new Error('approved capture plan is not valid JSON'); }
    validateCapturePlan(plan);
    if (plan.episode_id !== input.episode_id || plan.revision !== input.revision) throw new Error('approved capture plan identity does not match handoff');
    result.capturePlan = { ...copied['capture-plan.json'], plan, runnerPath: path.join(__dirname, 'capture-ep4-spec-workflow-demo.js') };
    result.productionBrief = copied['production-brief.json'];
    return result;
  }

  _preflightCapture(runId, attempt, handoff) {
    if (!handoff.capturePlan) return null;
    const artifactRoot = path.join(this.controller.artifactRoot, runId);
    let receipt;
    if (this.capturePreflight) receipt = this.capturePreflight({ runId, attempt, artifactRoot, plan: handoff.capturePlan.plan, planPath: handoff.capturePlan.path, runnerPath: handoff.capturePlan.runnerPath });
    else {
      const result = childProcess.spawnSync(process.execPath, [handoff.capturePlan.runnerPath, '--root', artifactRoot, '--run-id', runId, '--attempt', String(attempt), '--preflight'], { encoding: 'utf8', timeout: 30000, maxBuffer: 1024 * 1024, env: process.env });
      if (result.status !== 0) throw new Error('video capture preflight failed');
      try { receipt = JSON.parse(String(result.stdout || '')); } catch { throw new Error('video capture preflight returned invalid JSON'); }
    }
    if (!receipt || receipt.status !== 'pass') throw new Error('video capture preflight did not pass');
    const file = path.join(artifactRoot, 'capture-preflight.json');
    fs.writeFileSync(file, JSON.stringify(receipt, null, 2) + '\n', { mode: 0o600 });
    return { path: file, sha256: crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex') };
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
      '- capture-plan.json is controller-owned and immutable. Do not edit, replace, or omit it; the finalizer binds it into Story Lock.',
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
    const capturePlanPath = path.join(artifactRoot, 'capture-plan.json');
    const seed = handoff.input || {};
    fs.writeFileSync(seedPath, JSON.stringify(seed, null, 2) + '\n', { mode: 0o600 });
    if (!seed.capture_plan) throw new Error('episode seed capture plan is unavailable');
    fs.writeFileSync(capturePlanPath, JSON.stringify(seed.capture_plan, null, 2) + '\n', { mode: 0o600 });
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
    return { seedPath, templatePath, capturePlanPath };
  }

  _materializeVideoContext(runId, taskId) {
    if (this.workflow !== 'video_production' || taskId !== 'assemble_video') return null;
    const state = this.controller.status(runId);
    const capture = state.tasks?.capture_assets;
    if (!capture?.envelope_sha256 || !capture?.capture_manifest_sha256) throw new Error('accepted capture evidence is unavailable for video assembly');
    const artifactRoot = path.join(this.controller.artifactRoot, runId);
    const contextPath = path.join(artifactRoot, 'accepted-capture.json');
    const value = { capture_envelope_sha256: capture.envelope_sha256, capture_manifest_sha256: capture.capture_manifest_sha256 };
    const content = JSON.stringify(value, null, 2) + '\n';
    fs.writeFileSync(contextPath, content, { mode: 0o600 });
    return { path: contextPath, sha256: crypto.createHash('sha256').update(content).digest('hex') };
  }

  _materializeVideoInstructions(runId, taskId, attempt, handoff, captureContext) {
    const artifactRoot = path.join(this.controller.artifactRoot, runId);
    const finalizer = path.join(__dirname, 'video-finalizer-cli.js');
    const base = [
      '# Workflow B evidence-bound video task',
      '',
      'Create only real, reproducible product evidence. Do not generate substitute screens, fake terminal output, or product behavior.',
      'Use the owner-approved story handoff as the only narrative authority. Never publish, upload, message external services, or approve an owner gate.',
      '',
      'Required tool boundary:',
      '- Use installed sdtk-marketing commands and local real product capture only.',
      '- Run the established sdtk-marketing quality checks before finalizing an assembly result.',
      '- Do not claim a capture, audio, caption, or visual gate passed unless the emitted report contains the actual result.',
      '',
      'Artifact root: ' + artifactRoot,
      'Approved handoff: ' + handoff.path,
      'Approved handoff SHA-256: ' + handoff.sha256,
    ];
    if (taskId === 'capture_assets' && handoff.capturePlan) {
      return base.concat([
        '',
        'Task: capture_assets',
        '- Controller-owned fixture only: all visible data must be labelled DEMO DATA and product behavior must come from the real local SDTK-WIKI runtime.',
        '- Do not edit approved-production-brief.json or approved-capture-plan.json.',
        'Approved capture plan: ' + handoff.capturePlan.path,
        'Approved capture plan SHA-256: ' + handoff.capturePlan.sha256,
        'Preflight receipt: ' + path.join(artifactRoot, 'capture-preflight.json'),
        'Run exactly: node ' + handoff.capturePlan.runnerPath + ' --root ' + artifactRoot + ' --run-id ' + runId + ' --attempt ' + attempt,
        '- The controller-owned runner writes the manifest and worker-result.json only after actual capture artifacts exist.',
        '- Mark the native card complete only after the exact command exits 0.',
      ]).join('\n') + '\n';
    }
    if (taskId === 'capture_assets') {
      return base.concat([
        '',
        'Task: capture_assets',
        '- Create real screen/terminal recordings that demonstrate the approved product proof.',
        '- Write capture-manifest.json with schema sdtk.marketing-capture-manifest.v1, run_id, task_id, capture_mode=real_product_evidence, privacy.status=pass, and truth_boundary { product_behavior: real, generated_visuals: false, fabricated_product_behavior: false }.',
        '- Each capture must name an artifact_path, kind (screen_recording, screenshot, or terminal_recording), and real viewport width/height.',
        '- Record every successful capture command in a text receipt and reference it in command_receipts with exit_code=0.',
        '- Run exactly after the manifest and referenced files exist: node ' + finalizer + ' --root ' + artifactRoot + ' --run-id ' + runId + ' --task-id capture_assets --attempt ' + attempt,
        '- Do not handwrite worker-result.json; the deterministic finalizer writes it.',
      ]).join('\n') + '\n';
    }
    return base.concat([
      '',
      'Task: assemble_video',
      'Accepted capture binding: ' + captureContext.path,
      'Accepted capture binding SHA-256: ' + captureContext.sha256,
      '- Assemble video-master.mp4 only from the owner-approved story and Asset-Locked real capture evidence.',
      '- Produce quality-report.json with schema sdtk.marketing-video-quality-report.v1, status=pass, output width/height/duration, and pass values for capture_truth, visual, audio, and captions.',
      '- Produce review-frames.json naming the extracted review frames used to inspect the render.',
      '- Run exactly after the video and reports exist: node ' + finalizer + ' --root ' + artifactRoot + ' --run-id ' + runId + ' --task-id assemble_video --attempt ' + attempt,
      '- Do not handwrite worker-result.json; the deterministic finalizer writes it.',
    ]).join('\n') + '\n';
  }

  _materializeSocialInstructions(runId, taskId, attempt, handoff) {
    if (this.workflow !== 'social_distribution' || taskId !== 'prepare_social') return null;
    const artifactRoot = path.join(this.controller.artifactRoot, runId);
    const finalizer = path.join(__dirname, 'social-finalizer-cli.js');
    const content = [
      '# Workflow C prepare-only social task',
      '',
      'Prepare checked English YouTube, Facebook, and X payloads from the supplied approved handoffs. This task has no upload, schedule, publish, external message, or credential use permission.',
      'Use installed sdtk-marketing social generation and validation commands or equivalent local deterministic helpers. Do not assert performance claims, testimonials, or product outcomes not supported by the approved brief.',
      '',
      'Artifact root: ' + artifactRoot,
      'Approved handoffs: ' + handoff.path,
      'Approved handoff SHA-256: ' + handoff.sha256,
      '',
      'Required output:',
      '- Write youtube.json, facebook.json, and x.json with schema sdtk.marketing-social-payload.v1.',
      '- Every payload must declare its exact platform, validation_status=pass, publish_authorized=false, and the bound brief_approval_sha256 and video_approval_sha256 from the supplied handoff.',
      '- Run exactly after all three checked payload files exist: node ' + finalizer + ' --root ' + artifactRoot + ' --run-id ' + runId + ' --attempt ' + attempt,
      '- Do not handwrite worker-result.json; the deterministic finalizer writes it.',
      '- Do not run any publisher, uploader, scheduler, browser login, or external messaging command.',
      '- Mark the native card complete only after the finalizer succeeds. The controller exclusively owns Social Ready.',
    ].join('\n') + '\n';
    const instructionPath = path.join(artifactRoot, 'social-instructions.md');
    fs.writeFileSync(instructionPath, content, { mode: 0o600 });
    return { path: instructionPath, sha256: crypto.createHash('sha256').update(content).digest('hex'), content };
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

  _taskBody(runId, taskId, attempt, handoff, researchInstructions, videoInstructions, socialInstructions) {
    const artifactRoot = path.join(this.controller.artifactRoot, runId);
    const base = [
      `Controller-owned ${this.workflow} task.`,
      `Run: ${runId}`,
      `Task: ${taskId} attempt ${attempt}`,
      `Read the approved handoff: ${handoff.path}`,
      `Approved handoff SHA-256: ${handoff.sha256}`,
      `Write candidate artifacts under: ${artifactRoot}`,
      `Write exactly one result candidate to: ${path.join(artifactRoot, 'worker-result.json')}`,
    ];
    if (this.workflow === 'video_production' && handoff.input.staging_smoke !== true) return videoInstructions.content;
    if (this.workflow === 'social_distribution' && handoff.input.staging_smoke !== true) return socialInstructions.content;
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
    const captureContext = this._materializeVideoContext(runId, taskId);
    const capturePreflight = this.workflow === 'video_production' && taskId === 'capture_assets' && handoff.input.staging_smoke !== true
      ? this._preflightCapture(runId, attempt, handoff)
      : null;
    const videoInstructions = this.workflow === 'video_production' && handoff.input.staging_smoke !== true
      ? { content: this._materializeVideoInstructions(runId, taskId, attempt, handoff, captureContext), capturePreflight }
      : null;
    const socialInstructions = this.workflow === 'social_distribution' && handoff.input.staging_smoke !== true
      ? this._materializeSocialInstructions(runId, taskId, attempt, handoff)
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
      '--body', this._taskBody(runId, taskId, attempt, handoff, researchInstructions, videoInstructions, socialInstructions),
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
    if (task?.id === nativeTaskIdValue && task.assignee === this.assignee && ['running', 'done'].includes(task.status)) return 'claimed_by_gateway';
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
