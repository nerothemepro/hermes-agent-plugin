'use strict';

const EP2_TEMPLATE_ID = 'marketing_video_ep_usage';
const EP2_PROFILES = ['herresearch', 'herwiki', 'herorches', 'herdev', 'hervid', 'hersocial'];
const HERMES_BIN = '/workspace/.venvs/hermes-agent/bin/hermes';
const HERMES_HOME = '/opt/data/hermes';

function task(id, role, instruction, depends_on = []) {
  return {
    id,
    type: 'task',
    role,
    ...(depends_on.length ? { depends_on } : {}),
    params: { instruction },
    retry: { max: 0 },
  };
}

function gate(id, depends_on, prompt) {
  return { id, type: 'human_gate', depends_on, prompt };
}

function instruction(stage, projectPath) {
  const outputRoot = `${projectPath}/.sdtk/agent-runtime/runs/<run_id>/reports`;
  const shared = 'Do not publish, send external messages, use credentials, or create child tasks. Record only factual evidence in the assigned task result and native Hermes Kanban lifecycle.';
  switch (stage) {
    case 'research_evidence':
      return `Build a bounded public evidence pack for Episode 2, "See Your Real AI Cost in One Command". Identify the solo-founder or technical-lead pain point around unknown AI spend, traceability, and usage visibility. Separate supported public facts, source URLs, observations, unknowns, and claims that must not be used. Do not claim product outcomes or metrics without direct evidence. ${shared}`;
    case 'episode_lessons':
      return `Retrieve only accepted lessons relevant to the prior SDTK marketing-video episode: product capture dominance, narration, readable layout, honest claims, motion, and attended publishing. Cite the canonical local artifact paths used. Return unknown when no accepted lesson exists. ${shared}`;
    case 'script_package':
      return `Synthesize the Episode 2 English script package from the completed evidence and lessons tasks. The product proof must show the real sdtk usage command and its factual output. Include claim ledger, shot list, narration draft, CTA, and a list of evidence files expected under ${outputRoot}. Do not render, publish, or approve anything. ${shared}`;
    case 'product_capture':
      return `Create only real, reproducible product-capture evidence for the owner-approved Episode 2 script: the sdtk usage command, terminal output, and any required screen capture. Produce an asset manifest with paths and SHA-256 values. Do not fabricate UI, render final video, publish, or approve. ${shared}`;
    case 'episode_render':
      return `Render the owner-approved Episode 2 video from real captures and the approved script package. Run the established sdtk-marketing video-quality checks and record factual pass/fail evidence, output paths, dimensions, duration, audio evidence, and SHA-256. Stop at render/review; do not publish. ${shared}`;
    case 'social_package':
      return `Prepare checked English YouTube, Facebook, and X payloads from the approved Episode 2 script and rendered-video evidence. Run sdtk-marketing checks and produce immutable approval packets. Do not upload, publish, approve, or alter any social account. ${shared}`;
    case 'lessons_record':
      return `Record candidate Episode 2 lessons only from completed workflow evidence and owner decisions. Separate observed facts from proposed improvements. Do not mark a lesson accepted, publish, or mutate unrelated wiki content. ${shared}`;
    default:
      throw new Error(`Unknown EP2 task stage: ${stage}`);
  }
}

function buildEp2Workflow(projectPath) {
  return {
    schema_version: 'sdtk.agent-workflow.v1',
    workflow_id: 'hermes_marketing_video_ep_usage_r1',
    stages: [
      task('research_evidence', 'researcher', instruction('research_evidence', projectPath)),
      task('episode_lessons', 'wiki', instruction('episode_lessons', projectPath)),
      task('script_package', 'orchestrator', instruction('script_package', projectPath), ['research_evidence', 'episode_lessons']),
      gate('owner_script_review', ['script_package'], 'Owner reviews the Episode 2 script, claim ledger, and CTA before any capture.'),
      task('product_capture', 'developer', instruction('product_capture', projectPath), ['owner_script_review']),
      gate('owner_assets_review', ['product_capture'], 'Owner reviews real product captures and the asset manifest before rendering.'),
      task('episode_render', 'video', instruction('episode_render', projectPath), ['owner_assets_review']),
      gate('owner_picture_lock', ['episode_render'], 'Owner reviews the rendered Episode 2 video and quality evidence before social preparation.'),
      task('social_package', 'social', instruction('social_package', projectPath), ['owner_picture_lock']),
      gate('owner_social_review', ['social_package'], 'Owner reviews checked social payloads; publication remains separately SHA-gated.'),
      task('lessons_record', 'wiki', instruction('lessons_record', projectPath), ['owner_social_review']),
      gate('owner_lessons_review', ['lessons_record'], 'Owner accepts or rejects the proposed Episode 2 lessons before close.'),
      { id: 'final_report', type: 'report', depends_on: ['owner_lessons_review'], output: { path: 'reports/final_report.md' } },
    ],
  };
}

function role(profile, runtime) {
  return {
    adapter: 'hermes-live',
    module: 'sdtk-agent-hermes-adapter',
    mode: 'live',
    config: {
      backend: 'kanban-cli',
      profile,
      hermes_bin: HERMES_BIN,
      env: { HERMES_HOME },
      board: runtime.board,
      live_ack: true,
      cancel_action: runtime.cancel_action,
      deadline_ms: runtime.deadline_ms,
    },
  };
}

function buildEp2RuntimeMap(runtime) {
  return {
    schema_version: 'sdtk.agent-runtime-map.v1',
    environment_id: 'hermes-native-kanban-attended',
    hermes: { profiles_source: '/opt/data/hermes/profiles' },
    roles: {
      researcher: role('herresearch', runtime),
      wiki: role('herwiki', runtime),
      orchestrator: role('herorches', runtime),
      developer: role('herdev', runtime),
      video: role('hervid', runtime),
      social: role('hersocial', runtime),
    },
  };
}

module.exports = { EP2_PROFILES, EP2_TEMPLATE_ID, buildEp2RuntimeMap, buildEp2Workflow };
