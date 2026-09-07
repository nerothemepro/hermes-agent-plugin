'use strict';

const fs = require('fs');

const HASH = /^[a-f0-9]{64}$/;

function requireObject(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(label + ' must be an object');
  return value;
}

function requireArray(value, label) {
  if (!Array.isArray(value) || value.length === 0) throw new Error(label + ' is required');
  return value;
}

function requireSha(value, label) {
  if (!HASH.test(String(value || ''))) throw new Error(label + ' must be a sha256');
  return String(value);
}

function parseJsonArtifact(finalized, artifactPath, label) {
  const artifact = finalized.artifacts.find((item) => item.path === artifactPath);
  if (!artifact) throw new Error(label + ' artifact is required');
  let value;
  try { value = JSON.parse(fs.readFileSync(artifact.absolute_path, 'utf8')); } catch { throw new Error(label + ' is not valid JSON'); }
  return { artifact, value: requireObject(value, label) };
}

function artifactIndex(finalized) {
  return new Map(finalized.artifacts.map((artifact) => [artifact.path, artifact]));
}

function requireBoundArtifact(index, reference, label, mediaPattern) {
  const value = requireObject(reference, label);
  const artifactPath = String(value.artifact_path || '');
  const artifact = index.get(artifactPath);
  if (!artifact) throw new Error(label + ' must bind an emitted artifact');
  if (artifact.sha256 !== requireSha(value.sha256, label + ' sha256')) throw new Error(label + ' sha256 does not match emitted artifact');
  if (mediaPattern && !mediaPattern.test(artifact.media_type)) throw new Error(label + ' has an invalid media type');
  return artifact;
}

function validateCaptureManifest(finalized, state) {
  const { artifact, value } = parseJsonArtifact(finalized, 'capture-manifest.json', 'capture manifest');
  if (value.schema_version !== 'sdtk.marketing-capture-manifest.v1') throw new Error('unsupported capture manifest schema');
  if (value.run_id !== state.run_id || value.task_id !== 'capture_assets') throw new Error('capture manifest identity mismatch');
  if (value.capture_mode !== 'real_product_evidence') throw new Error('capture manifest must declare real product evidence');
  if (value.privacy?.status !== 'pass') throw new Error('capture manifest privacy gate must pass');
  if (value.truth_boundary?.product_behavior !== 'real' || value.truth_boundary?.generated_visuals !== false || value.truth_boundary?.fabricated_product_behavior !== false) {
    throw new Error('capture manifest truth boundary is not evidence-bound');
  }
  const index = artifactIndex(finalized);
  for (const capture of requireArray(value.captures, 'capture manifest captures')) {
    const bound = requireBoundArtifact(index, capture, 'capture manifest capture', /^(video|image)\//);
    if (!['screen_recording', 'screenshot', 'terminal_recording'].includes(capture.kind)) throw new Error('capture manifest capture kind is invalid');
    if (!Number.isInteger(capture.viewport?.width) || capture.viewport.width < 320 || !Number.isInteger(capture.viewport?.height) || capture.viewport.height < 240) {
      throw new Error('capture manifest capture viewport is invalid');
    }
    if (bound.bytes < 1) throw new Error('capture manifest capture is empty');
  }
  for (const receipt of requireArray(value.command_receipts, 'capture manifest command receipts')) {
    requireBoundArtifact(index, receipt, 'capture manifest command receipt', /^(text|application)\//);
    if (!Number.isInteger(receipt.exit_code) || receipt.exit_code !== 0) throw new Error('capture manifest command receipt did not pass');
  }
  return { capture_manifest_sha256: artifact.sha256 };
}

function validateVideoQualityPackage(finalized, state) {
  const capture = state.tasks?.capture_assets;
  if (!capture?.envelope_sha256 || !capture?.capture_manifest_sha256) throw new Error('accepted capture evidence is unavailable');
  const { artifact: packageArtifact, value: pkg } = parseJsonArtifact(finalized, 'video-quality-package.json', 'video quality package');
  if (pkg.schema_version !== 'sdtk.marketing-video-quality-package.v1') throw new Error('unsupported video quality package schema');
  if (pkg.run_id !== state.run_id || pkg.task_id !== 'assemble_video') throw new Error('video quality package identity mismatch');
  if (pkg.capture_envelope_sha256 !== capture.envelope_sha256 || pkg.capture_manifest_sha256 !== capture.capture_manifest_sha256) {
    throw new Error('video quality package is not bound to the accepted capture evidence');
  }
  const index = artifactIndex(finalized);
  const video = index.get('video-master.mp4');
  if (!video || !/^video\//.test(video.media_type) || video.sha256 !== requireSha(pkg.video_sha256, 'video quality package video sha256')) throw new Error('video master is not bound to the quality package');
  const { artifact: qualityArtifact, value: quality } = parseJsonArtifact(finalized, 'quality-report.json', 'quality report');
  const review = index.get('review-frames.json');
  if (!review || review.sha256 !== requireSha(pkg.review_frames_sha256, 'video quality package review frames sha256')) throw new Error('review frames are not bound to the quality package');
  if (quality.schema_version !== 'sdtk.marketing-video-quality-report.v1' || quality.run_id !== state.run_id || quality.task_id !== 'assemble_video' || quality.status !== 'pass') {
    throw new Error('quality report does not pass');
  }
  if (qualityArtifact.sha256 !== requireSha(pkg.quality_report_sha256, 'video quality package quality report sha256')) throw new Error('quality report is not bound to the quality package');
  for (const gate of ['capture_truth', 'visual', 'audio', 'captions']) {
    if (quality.gates?.[gate] !== 'pass') throw new Error('quality gate did not pass: ' + gate);
  }
  if (!Number.isInteger(quality.output?.width) || quality.output.width < 1280 || !Number.isInteger(quality.output?.height) || quality.output.height < 720 || !(Number(quality.output?.duration_seconds) > 0)) {
    throw new Error('quality report output metadata is invalid');
  }
  return { video_quality_package_sha256: packageArtifact.sha256, video_master_sha256: video.sha256 };
}

function validateStagingSmoke(finalized) {
  const expectedPath = finalized.task_id + '-smoke-evidence.txt';
  if (finalized.validation_status !== 'pass' || finalized.validator !== 'workflow-b-staging-smoke-v1' || finalized.artifacts.length !== 1) throw new Error('invalid Workflow B staging smoke result');
  const artifact = finalized.artifacts[0];
  if (artifact.path !== expectedPath || artifact.media_type !== 'text/plain' || artifact.bytes < 1) throw new Error('invalid Workflow B staging smoke artifact');
  return finalized.task_id === 'capture_assets' ? { capture_manifest_sha256: artifact.sha256 } : {};
}

function validateVideoProductionResult(finalized, state, options = {}) {
  if (state.workflow !== 'video_production') return null;
  if (options.stagingSmoke === true) return validateStagingSmoke(finalized);
  if (finalized.task_id === 'capture_assets') return validateCaptureManifest(finalized, state);
  if (finalized.task_id === 'assemble_video') return validateVideoQualityPackage(finalized, state);
  throw new Error('unsupported video production task');
}

module.exports = { validateVideoProductionResult };
