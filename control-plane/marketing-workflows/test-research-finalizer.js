'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const test = require('node:test');
const { finalizeResearchBrief } = require('./research-finalizer');
const { resolveEpisodeSeed } = require('./episode-seeds');

function setup() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'marketing-research-finalizer-'));
  const seed = resolveEpisodeSeed('EP4');
  fs.writeFileSync(path.join(root, 'episode-seed.json'), JSON.stringify(seed, null, 2) + '\n');
  fs.writeFileSync(path.join(root, 'capture-plan.json'), JSON.stringify(seed.capture_plan, null, 2) + '\n');
  fs.writeFileSync(path.join(root, 'assembly-plan.json'), JSON.stringify(seed.assembly_plan, null, 2) + '\n');
  return { root, seed };
}

function brief(seed) {
  return {
    schema_version: 'sdtk.marketing-production-brief.v1',
    episode_id: seed.episode_id,
    revision: seed.revision,
    audience: seed.audience,
    pain_point: seed.pain_point,
    hook: 'Turn a raw requirement into a plan your team can review.',
    narration: 'Start with the requirement. Make the plan visible before implementation begins.',
    cta: seed.cta,
    shot_list: [{ id: 's1', visual: 'real requirement and plan evidence' }],
    claim_ledger: [{ claim: 'The workflow produces a reviewable plan.', status: 'supported', evidence: 'episode-seed.json' }],
    evidence: ['episode-seed.json'],
  };
}

test('research finalizer creates a hash-bound candidate from a seed-bound production brief', () => {
  const env = setup();
  try {
    fs.writeFileSync(path.join(env.root, 'production-brief.json'), JSON.stringify(brief(env.seed), null, 2) + '\n');
    const result = finalizeResearchBrief({ root: env.root, runId: 'run_mkt_finalizer001', attempt: 1, seed: env.seed });
    assert.strictEqual(result.run_id, 'run_mkt_finalizer001');
    assert.strictEqual(result.task_id, 'research_story');
    assert.strictEqual(result.status, 'completed');
    assert.deepStrictEqual(result.artifacts.map((item) => item.path), ['production-brief.json', 'capture-plan.json', 'assembly-plan.json']);
    const candidate = JSON.parse(fs.readFileSync(path.join(env.root, 'worker-result.json'), 'utf8'));
    assert.strictEqual(candidate.artifacts[0].path, 'production-brief.json');
    assert.strictEqual(candidate.artifacts[1].path, 'capture-plan.json');
    assert.strictEqual(candidate.artifacts[2].path, 'assembly-plan.json');
    assert.match(candidate.artifacts[0].sha256, /^[a-f0-9]{64}$/);
  } finally { fs.rmSync(env.root, { recursive: true, force: true }); }
});

test('research finalizer rejects a brief that changes immutable episode scope', () => {
  const env = setup();
  try {
    const candidate = brief(env.seed);
    candidate.pain_point = 'A different market problem.';
    fs.writeFileSync(path.join(env.root, 'production-brief.json'), JSON.stringify(candidate, null, 2) + '\n');
    assert.throws(() => finalizeResearchBrief({ root: env.root, runId: 'run_mkt_finalizer002', attempt: 1, seed: env.seed }), /pain_point does not match episode seed/);
  } finally { fs.rmSync(env.root, { recursive: true, force: true }); }
});

test('research finalizer rejects inferred or structured evidence in place of the immutable seed receipt', () => {
  const env = setup();
  try {
    const candidate = brief(env.seed);
    candidate.evidence = [{ type: 'file', path: path.join(env.root, 'episode-seed.json') }];
    fs.writeFileSync(path.join(env.root, 'production-brief.json'), JSON.stringify(candidate, null, 2) + '\n');
    assert.throws(() => finalizeResearchBrief({ root: env.root, runId: 'run_mkt_finalizer003', attempt: 1, seed: env.seed }), /must cite episode-seed.json/);
  } finally { fs.rmSync(env.root, { recursive: true, force: true }); }
});


test('research finalizer binds an immutable controller capture plan beside the approved brief', () => {
  const env = setup();
  try {
    env.seed.capture_plan = {
      schema_version: 'sdtk.marketing-capture-plan.v1', episode_id: 'EP4', revision: 'r1',
      data_classification: 'demo_only', runner_id: 'ep4_spec_workflow_demo',
      artifacts: { capture: 'captures/ep4-spec-workflow-demo.mp4', receipt: 'receipts/ep4-spec-workflow-demo.txt' },
      viewport: { width: 1440, height: 900 },
    };
    fs.writeFileSync(path.join(env.root, 'episode-seed.json'), JSON.stringify(env.seed, null, 2) + '\n');
    fs.writeFileSync(path.join(env.root, 'production-brief.json'), JSON.stringify(brief(env.seed), null, 2) + '\n');
    fs.writeFileSync(path.join(env.root, 'capture-plan.json'), JSON.stringify(env.seed.capture_plan, null, 2) + '\n');
    fs.writeFileSync(path.join(env.root, 'assembly-plan.json'), JSON.stringify(env.seed.assembly_plan, null, 2) + '\n');
    const result = finalizeResearchBrief({ root: env.root, runId: 'run_mkt_finalizer004', attempt: 1, seed: env.seed });
    assert.deepStrictEqual(result.artifacts.map((item) => item.path), ['production-brief.json', 'capture-plan.json', 'assembly-plan.json']);
  } finally { fs.rmSync(env.root, { recursive: true, force: true }); }
});
