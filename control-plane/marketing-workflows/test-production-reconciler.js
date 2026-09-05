'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const test = require('node:test');
const { MarketingWorkflowController } = require('./controller');
const { resolveEpisodeSeed } = require('./episode-seeds');
const { finalizeResearchBrief } = require('./research-finalizer');
const { ResearchProductionReconciler } = require('./production-reconciler');

function setup() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'marketing-production-reconcile-'));
  const controller = new MarketingWorkflowController({ databaseFile: path.join(root, 'state.sqlite'), artifactRoot: path.join(root, 'artifacts') });
  const runId = 'run_mkt_reconcile001';
  const seed = resolveEpisodeSeed('EP4');
  const prepared = controller.prepare({ commandId: 'test:prepare', workflow: 'research_and_story', runId, input: seed });
  controller.approveKickoff({ commandId: 'test:kickoff', runId, packetSha256: prepared.kickoff_packet_sha256 });
  controller.registerExternalTask({ runId, taskId: 'research_story', attempt: 1, nativeTaskId: 't_research_001', idempotencyKey: 'sdtk-marketing:run_mkt_reconcile001:research_story:1', board: 'default' });
  controller.releaseExternalTask({ runId, taskId: 'research_story', attempt: 1, nativeTaskId: 't_research_001' });
  const runRoot = path.join(root, 'artifacts', runId);
  fs.mkdirSync(runRoot, { recursive: true });
  fs.writeFileSync(path.join(runRoot, 'episode-seed.json'), JSON.stringify(seed, null, 2) + '\n');
  return { root, controller, runId, seed, runRoot };
}

function writeCandidate(env) {
  const brief = {
    schema_version: 'sdtk.marketing-production-brief.v1', episode_id: env.seed.episode_id, revision: env.seed.revision,
    audience: env.seed.audience, pain_point: env.seed.pain_point, hook: 'A raw customer request is not a reviewable plan.',
    narration: 'Use the approved requirement to make decisions and handoffs visible before implementation.', cta: env.seed.cta,
    shot_list: [{ id: 'shot_1', visual: 'real requirement evidence' }], claim_ledger: [{ claim: 'The workflow has a human review gate.', status: 'supported', evidence: 'episode-seed.json' }], evidence: ['episode-seed.json'],
  };
  fs.writeFileSync(path.join(env.runRoot, 'production-brief.json'), JSON.stringify(brief, null, 2) + '\n');
  finalizeResearchBrief({ root: env.runRoot, runId: env.runId, attempt: 1, seed: env.seed });
}

function nativeClient(calls) {
  return { run(argv) {
    calls.push(argv);
    if (argv.includes('show')) return { returncode: 0, stdout: JSON.stringify({ task: { id: 't_research_001', assignee: 'herresearch', status: 'done' } }), stderr: '' };
    if (argv.includes('complete')) return { returncode: 0, stdout: '', stderr: '' };
    throw new Error('unexpected native command');
  } };
}

test('production reconciler bridges only a valid mapped HerResearch candidate into Story Lock', () => {
  const env = setup(); const calls = [];
  try {
    writeCandidate(env);
    const result = new ResearchProductionReconciler({ controller: env.controller, client: nativeClient(calls), profileHome: '/opt/data/hermes-profiles/herresearch', board: 'default' }).reconcile(env.runId);
    assert.strictEqual(result.status, 'bridged');
    assert.strictEqual(result.state.waiting_gate, 'story_lock');
    assert.ok(calls.some((argv) => argv.includes('complete')));
  } finally { env.controller.close(); fs.rmSync(env.root, { recursive: true, force: true }); }
});

test('production reconciler leaves a released task untouched until its canonical candidate exists', () => {
  const env = setup(); const calls = [];
  try {
    const result = new ResearchProductionReconciler({ controller: env.controller, client: nativeClient(calls), profileHome: '/opt/data/hermes-profiles/herresearch', board: 'default' }).reconcile(env.runId);
    assert.strictEqual(result.status, 'pending_candidate');
    assert.strictEqual(env.controller.status(env.runId).tasks.research_story.status, 'external_released');
    assert.strictEqual(calls.length, 0);
  } finally { env.controller.close(); fs.rmSync(env.root, { recursive: true, force: true }); }
});
