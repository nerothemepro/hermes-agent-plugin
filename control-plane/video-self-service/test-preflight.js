'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const test = require('node:test');
const { preflightEpisode } = require('./preflight');

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'video-preflight-'));
  const project = path.join(root, 'project');
  const manifests = path.join(root, 'episodes');
  fs.mkdirSync(path.join(project, '.sdtk', 'agent-runtime', 'runs'), { recursive: true });
  fs.mkdirSync(manifests, { recursive: true });
  const manifest = {
    schema_version: 'sdtk.marketing-video-episode.v1', episode_id: 'EP2', revision: 'r1', title: 'Usage', language: 'en',
    pain_point: 'Unknown cost', story: 'Proof', cta: 'https://sdtk.dev/', workflow_template: 'marketing_video_episode_r1', quality_profile: 'evidence_bound_explainer_r1',
    product_proof: ['real command'], source_boundaries: ['demo only'], allowed_roles: ['researcher', 'video'],
    toolchain: { sdtk_marketing: '0.19.0', sdtk_agent: '0.5.4', hermes_adapter: '0.3.13' }, capture_contract: { mode: 'terminal', instruction: 'real terminal' },
  };
  fs.writeFileSync(path.join(manifests, 'EP2.r1.json'), JSON.stringify(manifest));
  const policy = { schema_version: 'sdtk.marketing-video-toolchain-policy.v1', quality_profiles: ['evidence_bound_explainer_r1'], required_tools: ['node', 'ffmpeg'], role_profiles: { researcher: 'herresearch', video: 'hervid' }, publish_policy: { external_publish: false, require_auto_post_disabled: true } };
  const policyPath = path.join(root, 'policy.json');
  fs.writeFileSync(policyPath, JSON.stringify(policy));
  return { root, project, manifests, policyPath };
}

function passingRunner() { return { status: 0, stdout: 'ok\n', stderr: '' }; }
function versions(name) { return { 'sdtk-marketing-kit': '0.19.0', 'sdtk-agent-kit': '0.5.4', 'sdtk-agent-hermes-adapter': '0.3.13' }[name] || null; }

test('preflight is read-only, hashes its bounded packet, and passes only exact context', (t) => {
  const f = fixture();
  t.after(() => fs.rmSync(f.root, { recursive: true, force: true }));
  const before = fs.readdirSync(path.join(f.project, '.sdtk', 'agent-runtime', 'runs'));
  const packet = preflightEpisode({ projectPath: f.project, episode: 'EP2', episodeManifestRoot: f.manifests, policyPath: f.policyPath, env: { HERSOCIAL_AUTO_POST_ENABLED: 'false' } }, { commandRunner: passingRunner, packageVersionResolver: versions });
  assert.equal(packet.ok, true);
  assert.match(packet.preflight_sha256, /^[a-f0-9]{64}$/);
  assert.deepEqual(fs.readdirSync(path.join(f.project, '.sdtk', 'agent-runtime', 'runs')), before);
});

test('preflight fails closed for stale package, profile/tool failure, auto publish, and duplicate active run', (t) => {
  const f = fixture();
  t.after(() => fs.rmSync(f.root, { recursive: true, force: true }));
  const runPath = path.join(f.project, '.sdtk', 'agent-runtime', 'runs', 'run_aaaa_bbbb');
  fs.mkdirSync(runPath, { recursive: true });
  fs.writeFileSync(path.join(runPath, 'state.json'), JSON.stringify({ run_id: 'run_aaaa_bbbb', status: 'running', episode_id: 'EP2', episode_revision: 'r1', tasks: {} }));
  fs.writeFileSync(path.join(runPath, 'workflow.json'), JSON.stringify({ stages: [{ type: 'task', params: { episode_id: 'EP2', episode_revision: 'r1' } }] }));
  const packet = preflightEpisode({ projectPath: f.project, episode: 'EP2', episodeManifestRoot: f.manifests, policyPath: f.policyPath, env: { HERSOCIAL_AUTO_POST_ENABLED: 'true' } }, {
    commandRunner(command, args) { return command === 'hermes' && args.includes('hervid') ? { status: 1, stderr: 'profile missing' } : passingRunner(); },
    packageVersionResolver(name) { return name === 'sdtk-agent-kit' ? '0.0.0' : versions(name); },
  });
  assert.equal(packet.ok, false);
  assert.equal(packet.checks.find((c) => c.name === 'duplicate_active_run').ok, false);
  assert.equal(packet.checks.find((c) => c.name === 'package:sdtk-agent-kit').ok, false);
  assert.equal(packet.checks.find((c) => c.name === 'role:video').ok, false);
  assert.equal(packet.checks.find((c) => c.name === 'publish_disabled').ok, false);
});
