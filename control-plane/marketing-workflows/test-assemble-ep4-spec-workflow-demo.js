'use strict';

const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const test = require('node:test');
const { parseArgs, readInputs, buildCaptionCues, escapeDrawText } = require('./assemble-ep4-spec-workflow-demo');

function sha256(file) { return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'); }
function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ep4-assembly-runner-'));
  fs.mkdirSync(path.join(root, 'captures'), { recursive: true });
  fs.writeFileSync(path.join(root, 'captures', 'ep4-spec-workflow-demo.mp4'), 'real-capture-bytes');
  const capture = path.join(root, 'captures', 'ep4-spec-workflow-demo.mp4');
  const manifest = { schema_version: 'sdtk.marketing-capture-manifest.v1', captures: [{ artifact_path: 'captures/ep4-spec-workflow-demo.mp4', sha256: sha256(capture), kind: 'screen_recording', viewport: { width: 1440, height: 900 } }] };
  fs.writeFileSync(path.join(root, 'capture-manifest.json'), JSON.stringify(manifest));
  const plan = { schema_version: 'sdtk.marketing-assembly-plan.v1', episode_id: 'EP4', revision: 'r1', data_classification: 'demo_only', runner_id: 'ep4_spec_workflow_demo_assembly', inputs: { capture_manifest: 'capture-manifest.json', capture: 'captures/ep4-spec-workflow-demo.mp4' }, artifacts: { video: 'video-master.mp4', quality_report: 'quality-report.json', review_frames: 'review-frames.json' }, output: { width: 1920, height: 1080, min_duration_seconds: 60, max_duration_seconds: 120 } };
  fs.writeFileSync(path.join(root, 'approved-assembly-plan.json'), JSON.stringify(plan));
  fs.writeFileSync(path.join(root, 'approved-production-brief.json'), JSON.stringify({ schema_version: 'sdtk.marketing-production-brief.v1', episode_id: 'EP4', revision: 'r1', audience: 'founders', pain_point: 'unclear requests', hook: 'Review it.', narration: 'Review the plan.', cta: 'https://sdtk.dev/', shot_list: [{ id: 's1' }], claim_ledger: [{ claim: 'demo only' }], evidence: ['episode-seed.json'] }));
  fs.writeFileSync(path.join(root, 'accepted-capture.json'), JSON.stringify({ capture_manifest_sha256: sha256(path.join(root, 'capture-manifest.json')), capture_envelope_sha256: 'a'.repeat(64) }));
  return { root, capture };
}

test('assembly runner escapes drawtext punctuation before constructing ffmpeg filters', () => {
  assert.equal(escapeDrawText('One Requirement, A Reviewable Plan: EP4'), 'One Requirement\\, A Reviewable Plan\\: EP4');
});

test('assembly runner produces seven timed caption cues from the locked narration', () => {
  const cues = buildCaptionCues(64);
  assert.equal(cues.length, 7);
  assert.equal(cues[0].start_seconds, 0);
  assert.equal(cues.at(-1).end_seconds, 64);
  assert.ok(cues.every((cue) => cue.text && cue.end_seconds > cue.start_seconds));
});

test('assembly runner rejects non-exact arguments', () => {
  assert.throws(() => parseArgs(['--root', '/tmp/a', '--run-id', 'run_a', '--attempt', '1', '--extra']), /exact arguments/);
});

test('assembly runner binds the approved plan to a capture-manifest hash', () => {
  const input = fixture();
  const result = readInputs({ root: input.root, runId: 'run_ep4assembly_01', attempt: 1, preflight: false });
  assert.equal(result.capture.path, input.capture);
  assert.equal(result.capture.sha256, sha256(input.capture));
  assert.equal(result.plan.output.width, 1920);
});

test('assembly runner rejects a manifest whose capture hash differs from disk', () => {
  const input = fixture();
  const manifestPath = path.join(input.root, 'capture-manifest.json');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  manifest.captures[0].sha256 = '0'.repeat(64);
  fs.writeFileSync(manifestPath, JSON.stringify(manifest));
  assert.throws(() => readInputs({ root: input.root, runId: 'run_ep4assembly_02', attempt: 1, preflight: false }), /capture sha256 mismatch/);
});
