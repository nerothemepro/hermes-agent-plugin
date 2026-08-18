'use strict';

const fs = require('fs');
const path = require('path');

const EP2_TEMPLATE_ID = 'marketing_video_ep_usage';
const EP2_PROFILES = ['herresearch', 'herwiki', 'herorches', 'herdev', 'hervid', 'hersocial'];
const HERMES_BIN = '/workspace/.venvs/hermes-agent/bin/hermes';
const HERMES_PROFILE_BASE = '/opt/data/hermes-profiles';
const DEFAULT_SERIES_MANIFEST = path.join(__dirname, '..', 'control-plane', 'ep2-kanban', 'marketing-video-series.json');

function loadEpisodeSpec(episodeId = 'EP2', manifestPath = DEFAULT_SERIES_MANIFEST) {
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  if (manifest.schema_version !== 'hermes.marketing-video-series.v1' || !Array.isArray(manifest.episodes)) {
    throw new Error('Marketing video series manifest is invalid.');
  }
  const episode = manifest.episodes.find((entry) => entry.episode === episodeId);
  if (!episode || !episode.dogfood || !episode.dogfood.pain_point || !episode.dogfood.product_proof || !episode.dogfood.cta) {
    throw new Error(`Episode ${episodeId} is not enabled for controller-led dogfood.`);
  }
  return episode;
}

function task(id, role, instruction, depends_on = []) {
  return { id, type: 'task', role, ...(depends_on.length ? { depends_on } : {}), params: { instruction }, retry: { max: 0 } };
}

function gate(id, depends_on, prompt) {
  return { id, type: 'human_gate', depends_on, prompt };
}

function instruction(stage, projectPath, episode) {
  const outputRoot = `${projectPath}/.sdtk/agent-runtime/runs/<run_id>/reports`;
  const shared = 'Do not publish, send external messages, use credentials, or create child tasks. Complete the native Hermes Kanban card with a non-empty summary and structured metadata: validation_status success, path, run_id, task_id, idempotency_key, and either verification_evidence or findings. Each finding must include claim, evidence, and source. Do not put canonical evidence only inside prose.';
  const identity = `${episode.episode}, "${episode.title}"`;
  switch (stage) {
    case 'research_evidence':
      return `Build a bounded public evidence pack for ${identity}. Pain point: ${episode.dogfood.pain_point} Separate supported public facts, source URLs, observations, unknowns, and claims that must not be used. Do not claim product outcomes or metrics without direct evidence. Use one structured finding per supported claim. ${shared}`;
    case 'episode_lessons':
      return `Work from the controller project workspace at ${projectPath}. Retrieve only accepted lessons relevant to ${identity}: product capture dominance, narration, readable layout, honest claims, motion, and attended publishing. Search the project-local SDTK-WIKI first, including docs/HERMES_GENVIDEO_RUNBOOK.md and docs/HERMES_GENVIDEO_IMPROVEMENT_PLAN.md when present. Cite canonical local artifact paths used. Return unknown when no accepted lesson exists. ${shared}`;
    case 'script_package':
      return `Synthesize the English script package for ${identity} from completed evidence and lessons. Required product proof: ${episode.dogfood.product_proof} Include claim ledger, shot list, narration draft, CTA ${episode.dogfood.cta}, and a list of evidence files expected under ${outputRoot}. Do not render, publish, or approve anything. ${shared}`;
    case 'product_capture':
      return `Create only real, reproducible product-capture evidence for the owner-approved ${identity} script. Required product proof: ${episode.dogfood.product_proof} Produce an asset manifest with paths and SHA-256 values. Do not fabricate UI, render final video, publish, or approve. ${shared}`;
    case 'episode_render':
      return `Render the owner-approved ${identity} video from real captures and the approved script package. Run the established sdtk-marketing video-quality checks and record factual pass/fail evidence, output paths, dimensions, duration, audio evidence, and SHA-256. Stop at render/review; do not publish. ${shared}`;
    case 'social_package':
      return `Prepare checked English YouTube, Facebook, and X payloads for ${identity} from the owner picture-locked script and rendered-video evidence. Use CTA ${episode.dogfood.cta}. Run sdtk-marketing checks and produce immutable approval packets. Do not upload, publish, approve, or alter any social account. ${shared}`;
    case 'lessons_record':
      return `Record candidate ${identity} lessons only from completed workflow evidence and owner decisions. Separate observed facts from proposed improvements. Do not mark a lesson accepted, publish, or mutate unrelated wiki content. ${shared}`;
    default:
      throw new Error(`Unknown marketing video task stage: ${stage}`);
  }
}

function buildEp2Workflow(projectPath, episodeId = 'EP2', options = {}) {
  const episode = loadEpisodeSpec(episodeId, options.seriesManifestPath);
  return {
    schema_version: 'sdtk.agent-workflow.v1',
    workflow_id: `hermes_marketing_video_${episode.episode.toLowerCase()}_r3`,
    stages: [
      task('research_evidence', 'researcher', instruction('research_evidence', projectPath, episode)),
      task('episode_lessons', 'wiki', instruction('episode_lessons', projectPath, episode)),
      task('script_package', 'orchestrator', instruction('script_package', projectPath, episode), ['research_evidence', 'episode_lessons']),
      gate('owner_story_lock', ['script_package'], 'Owner reviews and locks the story, claim ledger, narration, and CTA before capture.'),
      task('product_capture', 'developer', instruction('product_capture', projectPath, episode), ['owner_story_lock']),
      task('episode_render', 'video', instruction('episode_render', projectPath, episode), ['product_capture']),
      gate('owner_picture_lock', ['episode_render'], 'Owner reviews the controller-verified rendered video before social preparation.'),
      task('social_package', 'social', instruction('social_package', projectPath, episode), ['owner_picture_lock']),
      gate('owner_publish_approval', ['social_package'], 'Owner reviews exact social payload hashes. External publication remains separately SHA-gated.'),
      task('lessons_record', 'wiki', instruction('lessons_record', projectPath, episode), ['owner_publish_approval']),
      { id: 'final_report', type: 'report', depends_on: ['lessons_record'], output: { path: 'reports/final_report.md' } },
    ],
  };
}

function role(profile, runtime, options = {}) {
  return {
    adapter: 'hermes-live',
    module: 'sdtk-agent-hermes-adapter',
    mode: 'live',
    config: {
      backend: 'kanban-cli',
      profile,
      hermes_bin: HERMES_BIN,
      env: { HERMES_HOME: `${HERMES_PROFILE_BASE}/${profile}` },
      board: runtime.board,
      live_ack: true,
      cancel_action: runtime.cancel_action,
      deadline_ms: runtime.deadline_ms,
      ...(options.workspace ? { workspace: options.workspace } : {}),
    },
  };
}

function buildEp2RuntimeMap(runtime) {
  return {
    schema_version: 'sdtk.agent-runtime-map.v1',
    environment_id: 'hermes-native-kanban-attended',
    hermes: { profiles_source: HERMES_PROFILE_BASE },
    roles: {
      researcher: role('herresearch', runtime),
      wiki: role('herwiki', runtime, { workspace: 'project_path' }),
      orchestrator: role('herorches', runtime),
      developer: role('herdev', runtime),
      video: role('hervid', runtime),
      social: role('hersocial', runtime),
    },
  };
}

module.exports = { DEFAULT_SERIES_MANIFEST, EP2_PROFILES, EP2_TEMPLATE_ID, buildEp2RuntimeMap, buildEp2Workflow, loadEpisodeSpec };
