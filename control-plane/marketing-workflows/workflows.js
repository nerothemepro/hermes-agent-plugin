'use strict';

const path = require('path');

const HASH = /^[a-f0-9]{64}$/;

const WORKFLOW_DEFINITIONS = Object.freeze({
  research_and_story: Object.freeze({
    owner: 'herresearch', workers: Object.freeze(['herresearch']),
    stages: Object.freeze(['researching', 'drafting_story', 'validating_brief']),
    owner_gates: Object.freeze(['story_lock']), output: 'production-brief.json',
  }),
  video_production: Object.freeze({
    owner: 'hervid', workers: Object.freeze(['hervid']),
    stages: Object.freeze(['capture_preflight', 'capturing', 'validating_assets', 'assembling', 'quality_checking']),
    owner_gates: Object.freeze(['asset_lock', 'picture_lock']), output: 'video-master.mp4',
  }),
  social_distribution: Object.freeze({
    owner: 'hersocial', workers: Object.freeze(['hersocial']),
    stages: Object.freeze(['generating_payloads', 'validating_payloads', 'preparing_owner_review']),
    owner_gates: Object.freeze(['social_ready']), output: 'social-payload-package.json',
  }),
});

function resolveWorkflow(name) {
  const definition = WORKFLOW_DEFINITIONS[String(name || '')];
  if (!definition) throw new Error('unsupported marketing workflow');
  return definition;
}

function validateHandoff(targetWorkflow, handoff) {
  resolveWorkflow(targetWorkflow);
  if (!handoff || handoff.schema_version !== 'sdtk.marketing-handoff.v1' || handoff.validation_status !== 'pass') throw new Error('invalid marketing handoff');
  if (!/^EP[0-9]+$/.test(String(handoff.episode_id || '')) || !/^r[1-9][0-9]*$/.test(String(handoff.revision || ''))) throw new Error('invalid handoff identity');
  const expected = targetWorkflow === 'video_production'
    ? { workflow: 'research_and_story', gate: 'story_lock' }
    : targetWorkflow === 'social_distribution'
      ? { workflow: 'video_production', gate: 'picture_lock' }
      : null;
  if (expected) {
    if (handoff.workflow !== expected.workflow || handoff.approval?.gate !== expected.gate || handoff.approval?.status !== 'approved' || !HASH.test(String(handoff.approval?.artifact_sha256 || ''))) {
      throw new Error(`workflow requires approved ${expected.gate} handoff`);
    }
  }
  return structuredClone(handoff);
}


function validateSocialInput(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('invalid social input');
  const brief = validateHandoff('video_production', input.brief);
  const video = validateHandoff('social_distribution', input.video);
  if (brief.episode_id !== video.episode_id || brief.revision !== video.revision) throw new Error('video handoff identity does not match approved research brief');
  if (!Array.isArray(video.inputs) || !video.inputs.some((item) => item && item.sha256 === brief.approval.artifact_sha256)) {
    throw new Error('video handoff is not bound to approved research brief');
  }
  return { brief, video };
}

function isRelativeArtifactPath(value) {
  return typeof value === 'string'
    && value.length > 0
    && !path.isAbsolute(value)
    && !value.split(/[\\/]+/).includes('..');
}

function validateCapturePlan(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || value.schema_version !== 'sdtk.marketing-capture-plan.v1') throw new Error('invalid capture plan');
  if (!/^EP[0-9]+$/.test(String(value.episode_id || '')) || !/^r[1-9][0-9]*$/.test(String(value.revision || ''))) throw new Error('invalid capture plan identity');
  if (value.data_classification !== 'demo_only') throw new Error('capture plan must be demo_only');
  if (value.runner_id !== 'ep4_spec_workflow_demo') throw new Error('unsupported capture runner');
  const artifacts = value.artifacts;
  if (!artifacts || !isRelativeArtifactPath(artifacts.capture) || !isRelativeArtifactPath(artifacts.receipt)) throw new Error('capture plan artifact paths must be relative');
  const viewport = value.viewport;
  if (!viewport || !Number.isInteger(viewport.width) || !Number.isInteger(viewport.height) || viewport.width < 640 || viewport.height < 360) throw new Error('invalid capture plan viewport');
  return structuredClone(value);
}

function validateAssemblyPlan(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || value.schema_version !== 'sdtk.marketing-assembly-plan.v1') throw new Error('invalid assembly plan');
  if (value.episode_id !== 'EP4' || value.revision !== 'r1' || value.data_classification !== 'demo_only') throw new Error('invalid assembly plan identity');
  if (value.runner_id !== 'ep4_spec_workflow_demo_assembly') throw new Error('unsupported assembly runner');
  const inputs = value.inputs;
  if (!inputs || !isRelativeArtifactPath(inputs.capture_manifest) || !isRelativeArtifactPath(inputs.capture)) throw new Error('assembly plan input paths must be relative');
  const artifacts = value.artifacts;
  if (!artifacts || !isRelativeArtifactPath(artifacts.video) || !isRelativeArtifactPath(artifacts.quality_report) || !isRelativeArtifactPath(artifacts.review_frames)) throw new Error('assembly plan artifact paths must be relative');
  const output = value.output;
  if (!output || !Number.isInteger(output.width) || output.width < 1280 || !Number.isInteger(output.height) || output.height < 720 || !Number.isInteger(output.min_duration_seconds) || !Number.isInteger(output.max_duration_seconds) || output.min_duration_seconds < 60 || output.max_duration_seconds > 120 || output.min_duration_seconds > output.max_duration_seconds) throw new Error('invalid assembly plan output');
  return structuredClone(value);
}

function validateProductionBrief(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || value.schema_version !== 'sdtk.marketing-production-brief.v1') throw new Error('invalid production brief');
  if (!/^EP[0-9]+$/.test(String(value.episode_id || '')) || !/^r[1-9][0-9]*$/.test(String(value.revision || ''))) throw new Error('invalid production brief identity');
  for (const field of ['audience', 'pain_point', 'hook', 'narration', 'cta']) {
    if (typeof value[field] !== 'string' || !value[field].trim()) throw new Error('production brief ' + field + ' is required');
  }
  for (const field of ['shot_list', 'claim_ledger', 'evidence']) {
    if (!Array.isArray(value[field]) || value[field].length === 0) throw new Error('production brief ' + field + ' is required');
  }
  return structuredClone(value);
}
module.exports = { WORKFLOW_DEFINITIONS, resolveWorkflow, validateCapturePlan, validateAssemblyPlan, validateProductionBrief, validateHandoff, validateSocialInput };
