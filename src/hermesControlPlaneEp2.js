'use strict';

const path = require('path');
const { DEFAULT_EPISODE_ROOT, loadEpisodeManifest } = require('../control-plane/video-self-service/episode-manifest');

const EP2_TEMPLATE_ID = 'marketing_video_ep_usage';
const EP2_PROFILES = ['herresearch', 'herwiki', 'herorches', 'herdev', 'hervid', 'hersocial'];
const HERMES_BIN = '/workspace/.venvs/hermes-agent/bin/hermes';
const HERMES_PROFILE_BASE = '/opt/data/hermes-profiles';
const HERMES_DISPATCH_HOME = '/opt/data/hermes';
const DEFAULT_SERIES_MANIFEST = path.join(__dirname, '..', 'control-plane', 'ep2-kanban', 'marketing-video-series.json');

function loadEpisodeSpec(episodeId = 'EP2', manifestRoot = DEFAULT_EPISODE_ROOT) {
  const loaded = loadEpisodeManifest(episodeId, { episodeManifestRoot: manifestRoot });
  return {
    episode: loaded.manifest.episode_id,
    title: loaded.manifest.title,
    dogfood: {
      pain_point: loaded.manifest.pain_point,
      product_proof: loaded.manifest.product_proof,
      cta: loaded.manifest.cta,
    },
    episode_manifest: loaded.manifest,
    episode_manifest_path: loaded.filePath,
    episode_manifest_sha256: loaded.sha256,
    capture_contract: loaded.manifest.capture_contract,
  };
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
      return `Work from the controller project workspace at ${projectPath}. Retrieve only accepted lessons relevant to ${identity}: product capture dominance, narration, readable layout, honest claims, motion, and attended publishing. Search the project-local SDTK-WIKI first, including docs/HERMES_GENVIDEO_RUNBOOK.md and docs/HERMES_GENVIDEO_IMPROVEMENT_PLAN.md when present. Cite canonical local artifact paths used. Return unknown when no accepted lesson exists. Your summary and each finding claim must identify ${identity}. ${shared}`;
    case 'script_package':
      return `Synthesize the English script package for ${identity} from completed evidence and lessons. Required product proof: ${episode.dogfood.product_proof} Include claim ledger, shot list, narration draft, CTA ${episode.dogfood.cta}, and a list of evidence files expected under ${outputRoot}. Do not render, publish, or approve anything. ${shared}`;
    case 'product_capture':
      return `Create only real, reproducible product-capture evidence for the owner-approved ${identity} script. Required product proof: ${episode.dogfood.product_proof} Use only a dedicated local DEMO DATA fixture visibly labelled DEMO DATA. The HOME environment must resolve inside that fixture for every usage command; --dir alone does not isolate the default HOME scan. Never run bare \`sdtk usage\` in the operator environment. Do not expose owner home paths, account names, model usage totals, rate-limit values, token values, credentials, or private IDs. If no approved demo fixture is available, block the task before capture. Before completion, write only approved DEMO capture assets and a SHA-256 manifest into the canonical artifact directory supplied in the native worker request; do not leave the only evidence in a Kanban scratch workspace. Do not fabricate UI, render final video, publish, or approve. ${shared}`;
    case 'episode_render':
      return `Render the owner-approved ${identity} video from real captures and the approved script package. Capture contract (${episode.capture_contract.mode}): ${episode.capture_contract.instruction} Do not substitute a legacy recorder, stale capture, or another episode composition. Build the final editorial composition with HyperFrames, preserving readable terminal evidence, narration, and the approved story duration. Run the established sdtk-marketing video-quality checks and record factual pass/fail evidence, output paths, dimensions, duration, audio evidence, and SHA-256. Stop at render/review; do not publish. ${shared}`;
    case 'social_package':
      return `Prepare checked English YouTube, Facebook, and X payloads for ${identity} from the owner picture-locked script and rendered-video evidence. Use CTA ${episode.dogfood.cta}. Run sdtk-marketing checks and produce immutable approval packets. Do not upload, publish, approve, or alter any social account. ${shared}`;
    case 'lessons_record':
      return `Record candidate ${identity} lessons only from completed workflow evidence and owner decisions. Separate observed facts from proposed improvements. Do not mark a lesson accepted, publish, or mutate unrelated wiki content. ${shared}`;
    default:
      throw new Error(`Unknown marketing video task stage: ${stage}`);
  }
}

function buildEp2Workflow(projectPath, episodeId = 'EP2', options = {}) {
  const episode = loadEpisodeSpec(episodeId, options.episodeManifestRoot);
  const workflow = {
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
  for (const stage of workflow.stages) {
    if (stage.type === 'task') {
      stage.params = Object.assign({}, stage.params, {
        episode_id: episode.episode,
        episode_revision: episode.episode_manifest.revision,
        episode_manifest_sha256: episode.episode_manifest_sha256,
      });
      if (stage.id === "episode_lessons") {
        stage.params.evidence_contract = {
          schema_version: "sdtk.hermes-evidence-contract.v1",
          required_text: [episode.episode, episode.title],
          require_structured_findings: true,
        };
      }
    }
  }
  return workflow;
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
      // The adapter resolves cards from the dispatcher board; --assignee routes the worker profile.
      env: { HERMES_HOME: HERMES_DISPATCH_HOME },
      board: runtime.board,
      live_ack: true,
      cancel_action: runtime.cancel_action,
      deadline_ms: runtime.deadline_ms,
      preflight_timeout_ms: 30000,
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

module.exports = { DEFAULT_EPISODE_ROOT, DEFAULT_SERIES_MANIFEST, EP2_PROFILES, EP2_TEMPLATE_ID, buildEp2RuntimeMap, buildEp2Workflow, loadEpisodeSpec };
