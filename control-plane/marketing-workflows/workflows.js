'use strict';

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
    stages: Object.freeze(['generating_payloads', 'validating_payloads', 'awaiting_platform_approvals', 'publishing_platform', 'verifying_permalink']),
    owner_gates: Object.freeze(['youtube_publish', 'facebook_publish', 'x_publish']), output: 'publish-receipts.json',
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
module.exports = { WORKFLOW_DEFINITIONS, resolveWorkflow, validateProductionBrief, validateHandoff, validateSocialInput };
