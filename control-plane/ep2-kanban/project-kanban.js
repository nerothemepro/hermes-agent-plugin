#!/usr/bin/env node
'use strict';

// Read-only projection of the fixed attended EP2 ledger into the Markdown
// files consumed by the installed SDTK-WIKI Kanban viewer.

const fs = require('fs');
const path = require('path');

const DEFAULT_FEATURE_KEY = 'HCP_MARKETING_VIDEO_EP_USAGE';
const DEFAULT_MANIFEST = path.join(__dirname, 'marketing-video-series.json');
const BACKLOG_STATUSES = new Set(['TODO', 'IN_PROGRESS', 'IN_REVIEW', 'BLOCKED', 'DONE']);
const ACTIVE_STATUSES = new Set(['running', 'submitted', 'running_external', 'waiting_external_evidence']);
const DONE_STATUSES = new Set(['completed', 'skipped']);
const PENDING_STATUSES = new Set(['waiting_for_approval', 'blocked', 'failed', 'cancelled', 'timed_out', 'timeout']);

const TASK_LABELS = Object.freeze({
  research_evidence: 'Research evidence',
  episode_lessons: 'Episode lessons',
  script_package: 'Script package',
  owner_script_review: 'Owner script review',
  product_capture: 'Product capture',
  owner_assets_review: 'Owner assets review',
  episode_render: 'Episode render',
  owner_picture_lock: 'Owner picture lock',
  social_package: 'Social package',
  owner_social_review: 'Owner social review',
  lessons_record: 'Lessons record',
  owner_lessons_review: 'Owner lessons review',
  final_report: 'Final report',
});

const ROLE_LABELS = Object.freeze({
  researcher: 'BA - HerResearch',
  wiki: 'ARCH - HerWiki',
  orchestrator: 'PM - HerOrches',
  developer: 'DEV - HerDev',
  video: 'DEV - HerVid',
  social: 'PM - HerSocial',
});

function statusProjection(rawStatus) {
  const status = String(rawStatus || '').trim();
  if (status === 'created') return { status: 'TODO', reason: '' };
  if (ACTIVE_STATUSES.has(status)) return { status: 'IN_PROGRESS', reason: '' };
  if (DONE_STATUSES.has(status)) return { status: 'DONE', reason: '' };
  if (status === 'waiting_for_approval') return { status: 'PENDING', reason: 'awaiting owner approval' };
  if (PENDING_STATUSES.has(status)) return { status: 'PENDING', reason: `ledger status: ${status}` };
  return { status: 'PENDING', reason: `unknown ledger status: ${status || 'missing'}` };
}

function safeText(value, fallback = '') {
  const text = String(value == null ? fallback : value)
    .replace(/[\r\n|]/g, ' ')
    .replace(/`/g, '')
    .trim();
  return text || fallback;
}

function requireSafeRunId(runId) {
  if (!/^run_[a-z0-9_]+$/i.test(String(runId || ''))) {
    throw new Error('invalid run id');
  }
  return runId;
}

function readJson(filePath, label) {
  let text;
  try {
    text = fs.readFileSync(filePath, 'utf8');
  } catch (error) {
    throw new Error(`${label} unavailable: ${error.message}`);
  }
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new Error(`${label} contains invalid JSON: ${error.message}`);
  }
}

function loadSeriesManifest(manifestPath) {
  const manifest = readJson(manifestPath, 'series manifest');
  if (!manifest || manifest.schema_version !== 'hermes.marketing-video-series.v1' || !Array.isArray(manifest.episodes)) {
    throw new Error('series manifest schema is invalid');
  }
  if (manifest.episodes.length !== 10) throw new Error('series manifest must contain exactly ten episodes');
  const ids = new Set();
  for (const episode of manifest.episodes) {
    if (!episode || !/^BK-\d+$/.test(episode.backlog_id || '') || ids.has(episode.backlog_id)) {
      throw new Error('series manifest contains an invalid or duplicate backlog id');
    }
    if (!/^EP(?:10|[1-9])$/.test(episode.episode || '') || !safeText(episode.title) || !BACKLOG_STATUSES.has(episode.status)) {
      throw new Error('series manifest contains an invalid episode');
    }
    ids.add(episode.backlog_id);
  }
  return manifest;
}

function readRun(projectPath, runId) {
  const statePath = path.join(projectPath, '.sdtk', 'agent-runtime', 'runs', requireSafeRunId(runId), 'state.json');
  const run = readJson(statePath, 'run ledger');
  if (!run || run.run_id !== runId || !run.tasks || typeof run.tasks !== 'object') {
    throw new Error('run ledger schema is invalid');
  }
  return run;
}

function listRuns(projectPath) {
  const runsDir = path.join(projectPath, '.sdtk', 'agent-runtime', 'runs');
  let entries = [];
  try {
    entries = fs.readdirSync(runsDir, { withFileTypes: true });
  } catch (_) {
    return [];
  }
  return entries
    .filter((entry) => entry.isDirectory() && /^run_[a-z0-9_]+$/i.test(entry.name))
    .map((entry) => {
      try {
        return readRun(projectPath, entry.name);
      } catch (_) {
        return null;
      }
    })
    .filter(Boolean);
}

function selectRun(runs, featureKey = DEFAULT_FEATURE_KEY) {
  const matches = (runs || []).filter((run) => run.feature_key === featureKey);
  const active = matches.filter((run) => !['completed', 'failed', 'cancelled'].includes(run.status));
  const candidates = active.length ? active : matches;
  return candidates.sort((a, b) => String(b.updated_at || '').localeCompare(String(a.updated_at || '')))[0] || null;
}

function taskLabel(taskId) {
  return TASK_LABELS[taskId] || safeText(taskId, 'Unknown task');
}

function taskOwner(task) {
  if (task.type === 'human_gate') return 'Owner';
  return ROLE_LABELS[task.role] || safeText(task.role, 'System');
}

function renderBacklog(manifest, generatedAt) {
  const lines = [
    '# SDTK Build With Proof - Generated Series Backlog',
    '',
    '> GENERATED by `control-plane/ep2-kanban/project-kanban.js`. Do not edit; update the series manifest or canonical run ledger.',
    '',
    `- Generated at: ${generatedAt}`,
    '- Source: `control-plane/ep2-kanban/marketing-video-series.json`',
    '',
    '| ID | Title | Priority | Status | Owner | Notes |',
    '|---|---|---|---|---|---|',
  ];
  for (const item of manifest.episodes) {
    const owner = item.episode === 'EP2' ? 'HerOrches attended workflow' : 'Owner';
    const notes = item.episode === 'EP2' ? 'Active run projected from the canonical ledger.' : `${item.episode} of the approved Build With Proof series.`;
    lines.push(`| ${item.backlog_id} | ${safeText(item.title)} | P1 | ${item.status} | ${owner} | ${notes} |`);
  }
  return `${lines.join('\n')}\n`;
}

function renderPlanning(run, generatedAt) {
  const runStatus = statusProjection(run.status);
  const blockers = [];
  const lines = [
    '# SHARED PLANNING - Generated EP2 Projection',
    '',
    '> GENERATED by `control-plane/ep2-kanban/project-kanban.js`. The canonical execution state is `.sdtk/agent-runtime/runs/' + safeText(run.run_id) + '/state.json`.',
    '',
    `**Current Feature:** \`${safeText(run.feature_key, DEFAULT_FEATURE_KEY)}\``,
    '**Feature Name:** Episode 2 - What Is Your AI Coding Actually Costing?',
    `**Last Updated:** ${safeText(run.updated_at, generatedAt)}`,
    `**Pipeline Status:** ${runStatus.status === 'PENDING' ? 'IN_PROGRESS' : runStatus.status}`,
    `**Run ID:** \`${safeText(run.run_id)}\``,
    '',
    '| Phase | Status | Owner | Artifact | Notes |',
    '|---|---|---|---|---|',
  ];

  const entries = Object.entries(run.tasks);
  entries.forEach(([taskId, task], index) => {
    const mapped = statusProjection(task.status);
    const displayStatus = mapped.status === 'PENDING' ? 'IN_PROGRESS' : mapped.status;
    const artifact = task.output && task.output.path ? safeText(task.output.path) : 'Canonical run ledger';
    const notes = mapped.reason ? `PENDING: ${mapped.reason}` : task.status === 'created' ? 'Waiting on dependencies.' : 'Canonical ledger projection.';
    if (mapped.status === 'PENDING') blockers.push(`${taskLabel(taskId)}: ${mapped.reason}`);
    lines.push(`| ${index + 1}. ${taskLabel(taskId)} | ${displayStatus} | ${taskOwner(task)} | ${artifact} | ${notes} |`);
  });

  lines.push('', '## CURRENT BLOCKERS');
  if (blockers.length) {
    blockers.forEach((blocker) => lines.push(`- ${blocker}`));
  } else {
    lines.push('NO BLOCKERS');
  }
  return `${lines.join('\n')}\n`;
}

function renderQuality(run, generatedAt) {
  const lines = [
    '# QUALITY CHECKLIST - Generated EP2 Projection',
    '',
    '> GENERATED by `control-plane/ep2-kanban/project-kanban.js`. This file reports gates; it cannot approve them.',
    '',
    `**Current Feature:** \`${safeText(run.feature_key, DEFAULT_FEATURE_KEY)}\``,
    `**Last Updated:** ${safeText(run.updated_at, generatedAt)}`,
  ];
  const entries = Object.entries(run.tasks);
  entries.forEach(([taskId, task], index) => {
    if (task.type !== 'human_gate') return;
    const mapped = statusProjection(task.status);
    const checked = mapped.status === 'DONE';
    const note = mapped.reason || (checked ? 'Approval recorded in the canonical ledger.' : '');
    lines.push('', `## PHASE ${index + 1}: ${taskLabel(taskId).replace(/\b\w/g, (c) => c.toUpperCase())} CHECKLIST`);
    lines.push('| # | Criteria | Status | Verified By | Notes |');
    lines.push('|---|---|---|---|---|');
    lines.push(`| 1 | Dependencies complete in the canonical ledger | ${checked ? '[x]' : 'TODO'} | Projector | ${checked ? 'Ready for owner gate.' : ''} |`);
    lines.push(`| GATE | Owner approval recorded in the canonical ledger | ${checked ? '[x]' : 'TODO'} | Owner gate | ${note} |`);
  });
  return `${lines.join('\n')}\n`;
}

function writeAtomic(filePath, content) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  try {
    if (fs.readFileSync(filePath, 'utf8') === content) return false;
  } catch (_) {
    // First projection creates the file below.
  }
  const tempPath = path.join(path.dirname(filePath), `.${path.basename(filePath)}.${process.pid}.${Date.now()}.tmp`);
  fs.writeFileSync(tempPath, content, { mode: 0o644 });
  fs.renameSync(tempPath, filePath);
  return true;
}

function projectKanban({ projectPath, runId, featureKey = DEFAULT_FEATURE_KEY, seriesManifestPath = DEFAULT_MANIFEST, now = new Date() }) {
  const resolvedProject = path.resolve(projectPath || process.cwd());
  const manifest = loadSeriesManifest(path.resolve(seriesManifestPath));
  const run = runId ? readRun(resolvedProject, runId) : selectRun(listRuns(resolvedProject), featureKey);
  if (!run) throw new Error(`no run found for feature key: ${featureKey}`);
  const generatedAt = now.toISOString().replace(/\.\d{3}Z$/, 'Z');
  const outputs = [
    [path.join(resolvedProject, 'governance', 'ai', 'core', 'IMPROVEMENT_BACKLOG.md'), renderBacklog(manifest, generatedAt)],
    [path.join(resolvedProject, 'SHARED_PLANNING.md'), renderPlanning(run, generatedAt)],
    [path.join(resolvedProject, 'QUALITY_CHECKLIST.md'), renderQuality(run, generatedAt)],
  ];
  const changed = outputs.reduce((count, [filePath, content]) => count + (writeAtomic(filePath, content) ? 1 : 0), 0);
  return { runId: run.run_id, changed, generatedAt };
}

function parseArgs(argv) {
  const args = { projectPath: process.cwd(), runId: null, seriesManifestPath: DEFAULT_MANIFEST, featureKey: DEFAULT_FEATURE_KEY };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--project-path') args.projectPath = argv[++i];
    else if (arg === '--run-id') args.runId = argv[++i];
    else if (arg === '--series-manifest') args.seriesManifestPath = argv[++i];
    else if (arg === '--feature-key') args.featureKey = argv[++i];
    else if (arg === '--help') return null;
    else throw new Error(`unknown argument: ${arg}`);
  }
  if (!args.projectPath || !args.seriesManifestPath || !args.featureKey) throw new Error('missing argument value');
  return args;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args) {
    process.stdout.write('Usage: project-kanban.js [--project-path <dir>] [--run-id <id>] [--series-manifest <file>] [--feature-key <key>]\n');
    return;
  }
  const result = projectKanban(args);
  process.stdout.write(`EP2_KANBAN_PROJECTED run_id=${result.runId} changed=${result.changed}\n`);
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    process.stderr.write(`EP2_KANBAN_PROJECTOR_ERROR ${error.message}\n`);
    process.exitCode = 1;
  }
}

module.exports = { projectKanban, selectRun, statusProjection, loadSeriesManifest, renderBacklog, renderPlanning, renderQuality };
