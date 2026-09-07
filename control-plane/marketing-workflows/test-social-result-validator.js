'use strict';
const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const test = require('node:test');
const { MarketingWorkflowController } = require('./controller');
const { main } = require('./social-finalizer-cli');
const sha = (value) => crypto.createHash('sha256').update(value).digest('hex');
function handoffs() {
  const briefSha = 'a'.repeat(64); const videoSha = 'b'.repeat(64);
  const brief = { schema_version: 'sdtk.marketing-handoff.v1', workflow: 'research_and_story', episode_id: 'EP4', revision: 'r1', validation_status: 'pass', approval: { gate: 'story_lock', status: 'approved', artifact_sha256: briefSha } };
  const video = { schema_version: 'sdtk.marketing-handoff.v1', workflow: 'video_production', episode_id: 'EP4', revision: 'r1', validation_status: 'pass', approval: { gate: 'picture_lock', status: 'approved', artifact_sha256: videoSha }, inputs: [{ sha256: briefSha }] };
  return { brief, video };
}
test('prepare-only social finalizer binds all checked platform payloads and opens Social Ready', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'marketing-social-result-'));
  const runId = 'run_social_result001';
  const controller = new MarketingWorkflowController({ databaseFile: path.join(root, 'state.sqlite'), artifactRoot: path.join(root, 'artifacts') });
  try {
    const input = handoffs();
    const prepared = controller.prepare({ commandId: 'social:prepare', workflow: 'social_distribution', runId, input });
    controller.approveKickoff({ commandId: 'social:kickoff', runId, packetSha256: prepared.kickoff_packet_sha256 });
    controller.startTask({ runId, taskId: 'prepare_social', workerId: 'hersocial:1' });
    const dir = path.join(root, 'artifacts', runId); fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'approved-handoff.json'), JSON.stringify(input) + '\n');
    for (const platform of ['youtube', 'facebook', 'x']) fs.writeFileSync(path.join(dir, platform + '.json'), JSON.stringify({ schema_version: 'sdtk.marketing-social-payload.v1', platform, validation_status: 'pass', publish_authorized: false, brief_approval_sha256: input.brief.approval.artifact_sha256, video_approval_sha256: input.video.approval.artifact_sha256 }) + '\n');
    main(['--root', dir, '--run-id', runId, '--attempt', '1']);
    const candidate = JSON.parse(fs.readFileSync(path.join(dir, 'worker-result.json'), 'utf8'));
    const result = controller.completeTask({ runId, candidate });
    assert.strictEqual(result.state.waiting_gate, 'social_ready');
    assert.ok(!candidate.artifacts.some((item) => /publish|receipt/i.test(item.path)));
    assert.strictEqual(JSON.parse(fs.readFileSync(path.join(dir, 'social-payload-package.json'), 'utf8')).publish_authorized, false);
  } finally { controller.close(); fs.rmSync(root, { recursive: true, force: true }); }
});
test('social validator rejects a payload that authorizes publication', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'marketing-social-negative-'));
  const runId = 'run_social_result002'; const controller = new MarketingWorkflowController({ databaseFile: path.join(root, 'state.sqlite'), artifactRoot: path.join(root, 'artifacts') });
  try {
    const input = handoffs(); const prepared = controller.prepare({ commandId: 'social:negative', workflow: 'social_distribution', runId, input }); controller.approveKickoff({ commandId: 'social:negative-kickoff', runId, packetSha256: prepared.kickoff_packet_sha256 }); controller.startTask({ runId, taskId: 'prepare_social', workerId: 'hersocial:1' });
    const dir = path.join(root, 'artifacts', runId); fs.mkdirSync(dir, { recursive: true }); fs.writeFileSync(path.join(dir, 'approved-handoff.json'), JSON.stringify(input));
    const artifacts = [];
    for (const platform of ['youtube','facebook','x']) { const bytes = Buffer.from(JSON.stringify({ schema_version: 'sdtk.marketing-social-payload.v1', platform, validation_status: 'pass', publish_authorized: platform === 'x', brief_approval_sha256: input.brief.approval.artifact_sha256, video_approval_sha256: input.video.approval.artifact_sha256 }) + '\n'); fs.writeFileSync(path.join(dir, platform + '.json'), bytes); artifacts.push({ platform, artifact_path: platform + '.json', sha256: sha(bytes) }); }
    const pkg = Buffer.from(JSON.stringify({ schema_version: 'sdtk.marketing-social-payload-package.v1', run_id: runId, task_id: 'prepare_social', publish_authorized: false, brief_approval_sha256: input.brief.approval.artifact_sha256, video_approval_sha256: input.video.approval.artifact_sha256, payloads: artifacts }) + '\n'); fs.writeFileSync(path.join(dir, 'social-payload-package.json'), pkg);
    const candidate = { schema_version: 'sdtk.video-task-result.v1', run_id: runId, task_id: 'prepare_social', attempt: 1, status: 'completed', artifacts: [...artifacts.map((item) => ({ path: item.artifact_path, sha256: item.sha256, media_type: 'application/json' })), { path: 'social-payload-package.json', sha256: sha(pkg), media_type: 'application/json' }], validation: { status: 'pass', validator: 'test', evidence: [] }, summary: 'payloads prepared', error: null };
    assert.throws(() => controller.completeTask({ runId, candidate }), /not checked prepare-only output/);
  } finally { controller.close(); fs.rmSync(root, { recursive: true, force: true }); }
});
