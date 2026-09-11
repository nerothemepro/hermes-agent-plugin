'use strict';
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const test = require('node:test');
const { MarketingWorkflowController } = require('./controller');
const { resolveEpisodeSeed } = require('./episode-seeds');
const { finalizeResearchBrief } = require('./research-finalizer');
const { MarketingWorkflowMonitor } = require('./marketing-workflow-monitor');

function prepare(root) {
  const databaseFile = path.join(root, 'state.sqlite'); const artifactRoot = path.join(root, 'artifacts'); const controller = new MarketingWorkflowController({ databaseFile, artifactRoot });
  const runId = 'run_mkt_monitor001'; const seed = resolveEpisodeSeed('EP4');
  const prepared = controller.prepare({ commandId: 'test:prepare', workflow: 'research_and_story', runId, input: seed });
  controller.approveKickoff({ commandId: 'test:kickoff', runId, packetSha256: prepared.kickoff_packet_sha256 });
  controller.registerExternalTask({ runId, taskId: 'research_story', attempt: 1, nativeTaskId: 't_monitor_001', idempotencyKey: 'sdtk-marketing:run_mkt_monitor001:research_story:1', board: 'default' });
  controller.releaseExternalTask({ runId, taskId: 'research_story', attempt: 1, nativeTaskId: 't_monitor_001' });
  const runRoot = path.join(artifactRoot, runId); fs.mkdirSync(runRoot, { recursive: true }); fs.writeFileSync(path.join(runRoot, 'episode-seed.json'), JSON.stringify(seed, null, 2) + '\n'); fs.writeFileSync(path.join(runRoot, 'capture-plan.json'), JSON.stringify(seed.capture_plan, null, 2) + '\n'); fs.writeFileSync(path.join(runRoot, 'assembly-plan.json'), JSON.stringify(seed.assembly_plan, null, 2) + '\n');
  const brief = { schema_version: 'sdtk.marketing-production-brief.v1', episode_id: seed.episode_id, revision: seed.revision, audience: seed.audience, pain_point: seed.pain_point, hook: 'A requirement needs review before implementation.', narration: 'Make the plan and the human review visible before code starts.', cta: seed.cta, shot_list: [{ id: 'shot_1', visual: 'real requirement' }], claim_ledger: [{ claim: 'The flow includes a review gate.', status: 'supported', evidence: 'episode-seed.json' }], evidence: ['episode-seed.json'] };
  fs.writeFileSync(path.join(runRoot, 'production-brief.json'), JSON.stringify(brief, null, 2) + '\n'); finalizeResearchBrief({ root: runRoot, runId, attempt: 1, seed }); controller.close();
  return { databaseFile, artifactRoot, runId };
}
function client() { return { run(argv) { if (argv.includes('show')) return { returncode: 0, stdout: JSON.stringify({ task: { id: 't_monitor_001', assignee: 'herresearch', status: 'done' } }), stderr: '' }; if (argv.includes('complete')) return { returncode: 0, stdout: '', stderr: '' }; throw new Error('unexpected native command'); } }; }

test('monitor baselines historical events then delivers a new Story Lock exactly once after reconciliation', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'marketing-monitor-')); const sent = [];
  try {
    const env = prepare(root); const monitor = new MarketingWorkflowMonitor({ ...env, stateFile: path.join(root, 'monitor-state.json'), client: client(), send: async (message) => sent.push(message) });
    const first = await monitor.tick();
    assert.strictEqual(first.baselined, true); assert.strictEqual(first.delivered, 3);
    assert.ok(sent.some((message) => message.includes('APPROVE STORY LOCK ' + env.runId)));
    const second = await monitor.tick(); assert.strictEqual(second.delivered, 0); assert.strictEqual(sent.length, 3);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
