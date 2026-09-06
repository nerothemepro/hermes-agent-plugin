'use strict';

const fs = require('fs');
const HASH = /^[a-f0-9]{64}$/;
const PLATFORMS = ['youtube', 'facebook', 'x'];

function parseJson(finalized, artifactPath, label) {
  const artifact = finalized.artifacts.find((item) => item.path === artifactPath);
  if (!artifact) throw new Error(label + ' artifact is required');
  try { return { artifact, value: JSON.parse(fs.readFileSync(artifact.absolute_path, 'utf8')) }; } catch { throw new Error(label + ' is not valid JSON'); }
}
function requireObject(value, label) { if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(label + ' must be an object'); return value; }
function requireHash(value, label) { if (!HASH.test(String(value || ''))) throw new Error(label + ' must be a sha256'); return String(value); }

function validateSocialPreparationResult(finalized, state, input) {
  if (state.workflow !== 'social_distribution' || finalized.task_id !== 'prepare_social') throw new Error('unsupported social task');
  const { artifact, value: pkg } = parseJson(finalized, 'social-payload-package.json', 'social payload package');
  requireObject(pkg, 'social payload package');
  if (pkg.schema_version !== 'sdtk.marketing-social-payload-package.v1' || pkg.run_id !== state.run_id || pkg.task_id !== 'prepare_social') throw new Error('social payload package identity mismatch');
  if (pkg.publish_authorized !== false) throw new Error('social payload package must remain prepare-only');
  if (pkg.brief_approval_sha256 !== input.brief?.approval?.artifact_sha256 || pkg.video_approval_sha256 !== input.video?.approval?.artifact_sha256) throw new Error('social payload package is not bound to approved handoffs');
  const records = Array.isArray(pkg.payloads) ? pkg.payloads : [];
  if (records.length !== PLATFORMS.length || records.map((item) => item.platform).sort().join(',') !== PLATFORMS.slice().sort().join(',')) throw new Error('social payload package must contain Youtube, Facebook, and X');
  const index = new Map(finalized.artifacts.map((item) => [item.path, item]));
  for (const record of records) {
    const artifactRef = index.get(record.artifact_path);
    if (!artifactRef || artifactRef.sha256 !== requireHash(record.sha256, 'social payload sha256') || artifactRef.media_type !== 'application/json') throw new Error('social payload package has an unbound payload');
    const { value: payload } = parseJson(finalized, record.artifact_path, record.platform + ' payload');
    requireObject(payload, record.platform + ' payload');
    if (payload.schema_version !== 'sdtk.marketing-social-payload.v1' || payload.platform !== record.platform || payload.validation_status !== 'pass' || payload.publish_authorized !== false) throw new Error('social payload is not checked prepare-only output');
    if (payload.video_approval_sha256 !== pkg.video_approval_sha256 || payload.brief_approval_sha256 !== pkg.brief_approval_sha256) throw new Error('social payload handoff binding mismatch');
  }
  if (artifact.bytes < 1) throw new Error('social payload package is empty');
  return { social_payload_package_sha256: artifact.sha256 };
}
module.exports = { validateSocialPreparationResult };
