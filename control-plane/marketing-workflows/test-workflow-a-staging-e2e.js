'use strict';
const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const test = require('node:test');
const { MarketingWorkflowController } = require('./controller');
const { execute } = require('./staging-entrypoint');
function client() {
  const tasks = new Map(); let n = 0;
  return { tasks, run(argv) {
    const action = argv[4];
    if (action === 'create') { const id = 't_research_' + String(++n).padStart(3, '0'); tasks.set(id, { id, assignee: 'herresearch', status: 'blocked' }); return { returncode: 0, stdout: JSON.stringify({ id, assignee: 'herresearch', status: 'blocked' }), stderr: '' }; }
    if (action === 'unblock') { tasks.get(argv[5]).status = 'ready'; return { returncode: 0, stdout: '', stderr: '' }; }
    if (action === 'dispatch') { const task = [...tasks.values()].find((item) => item.status === 'ready'); task.status = 'running'; return { returncode: 0, stdout: JSON.stringify({ spawned: [{ task_id: task.id, assignee: 'herresearch' }] }), stderr: '' }; }
    if (action === 'show') return { returncode: 0, stdout: JSON.stringify({ task: tasks.get(argv[5]) }), stderr: '' };
    if (action === 'complete') { tasks.get(argv[5]).status = 'done'; return { returncode: 0, stdout: '', stderr: '' }; }
    throw new Error('unexpected native command: ' + action);
  } };
}
function brief() { return { schema_version: 'sdtk.marketing-production-brief.v1', episode_id: 'EP4', revision: 'r1', audience: 'solo founders', pain_point: 'research is disconnected from production', hook: 'Turn evidence into a story.', narration: 'HerResearch turns a bounded pain point into an approved production brief.', cta: 'Build with proof at sdtk.dev.', shot_list: [{ id: 's1', visual: 'evidence-led story' }], claim_ledger: [{ claim: 'Evidence is recorded before production.', status: 'supported' }], evidence: ['sources.json'] }; }
test('Workflow A staging E2E routes HerResearch and reaches Story Lock', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'workflow-a-staging-e2e-')); const runId = 'run_e2e_research_001'; const databaseFile = path.join(root, 'state.sqlite'); const controller = new MarketingWorkflowController({ databaseFile, artifactRoot: root }); const native = client(); const old = process.env.SDTK_MARKETING_WORKFLOW_MODE; process.env.SDTK_MARKETING_WORKFLOW_MODE = 'staging';
  try {
    const prepared = controller.prepare({ commandId: 'staging:a:prepare', workflow: 'research_and_story', runId, input: { episode_id: 'EP4' } });
    controller.approveKickoff({ commandId: 'staging:a:kickoff', runId, packetSha256: prepared.kickoff_packet_sha256 });
    const common = { databaseFile, artifactRoot: root, runId }; const dispatch = execute({ command: 'dispatch', ...common }, { controller, client: native }); assert.strictEqual(dispatch.board, 'marketing-research-staging'); assert.strictEqual(native.tasks.get(dispatch.native_task_id).assignee, 'herresearch');
    const runRoot = path.join(root, runId); const briefBytes = Buffer.from(JSON.stringify(brief(), null, 2) + '\n'); fs.mkdirSync(runRoot, { recursive: true }); fs.writeFileSync(path.join(runRoot, 'production-brief.json'), briefBytes); const hash = crypto.createHash('sha256').update(briefBytes).digest('hex');
    const candidate = { schema_version: 'sdtk.video-task-result.v1', run_id: runId, task_id: 'research_story', attempt: 1, status: 'completed', artifacts: [{ path: 'production-brief.json', sha256: hash, media_type: 'application/json' }], validation: { status: 'pass', validator: 'workflow-a-staging-e2e-v1', evidence: ['production-brief.json'] }, summary: 'Bounded research brief ready for owner review', error: null }; fs.writeFileSync(path.join(runRoot, 'worker-result.json'), JSON.stringify(candidate, null, 2) + '\n'); native.tasks.get(dispatch.native_task_id).status = 'done';
    const submitted = execute({ command: 'submit', ...common, taskId: 'research_story', nativeTaskId: dispatch.native_task_id, candidateFile: path.join(runRoot, 'worker-result.json') }, { controller, client: native }); assert.strictEqual(submitted.state.waiting_gate, 'story_lock'); assert.match(submitted.packet_sha256, /^[a-f0-9]{64}$/);
    const complete = execute({ command: 'approve-gate', ...common, gateId: 'story_lock', packetSha256: submitted.packet_sha256, commandId: 'staging:a:story-lock' }, { controller, client: native }); assert.strictEqual(complete.state.status, 'completed'); assert.strictEqual(native.tasks.get(dispatch.native_task_id).status, 'done');
  } finally { if (old === undefined) delete process.env.SDTK_MARKETING_WORKFLOW_MODE; else process.env.SDTK_MARKETING_WORKFLOW_MODE = old; controller.close(); fs.rmSync(root, { recursive: true, force: true }); }
});