'use strict';

const fs = require('fs');
const path = require('path');
const { canonicalJson, finalizeTaskResult } = require('./result-contract');

const FINAL_HANDOFFS = Object.freeze({
  research_and_story: { gate: 'story_lock', task: 'research_story' },
  video_production: { gate: 'picture_lock', task: 'assemble_video' },
});

function requireText(value, label) { const text = String(value || '').trim(); if (!text) throw new Error(label + ' is required'); return text; }
function atomicWrite(file, content) {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  if (fs.existsSync(file)) {
    const current = fs.readFileSync(file, 'utf8');
    if (current !== content) throw new Error('approved handoff conflict');
    return false;
  }
  const temporary = file + '.tmp-' + process.pid;
  fs.writeFileSync(temporary, content, { mode: 0o600 });
  fs.renameSync(temporary, file);
  return true;
}
function materializeApprovedHandoff(options) {
  const runId = requireText(options?.runId, 'run id');
  const state = options?.state;
  const input = options?.input;
  const definition = FINAL_HANDOFFS[state?.workflow];
  if (!definition || state.status !== 'completed') return null;
  const task = state.tasks?.[definition.task];
  if (!task?.envelope_sha256 || task.status !== 'completed') throw new Error('completed final task evidence is unavailable');
  const root = path.resolve(requireText(options.artifactRoot, 'artifact root'), runId);
  const acceptedPath = path.join(root, 'accepted-results', definition.task + '.attempt-' + task.attempt + '.json');
  const candidatePath = fs.existsSync(acceptedPath) ? acceptedPath : path.join(root, 'worker-result.json');
  let candidate;
  try { candidate = JSON.parse(fs.readFileSync(candidatePath, 'utf8')); } catch { throw new Error('final worker result is unavailable'); }
  const finalized = finalizeTaskResult(candidate, { root, expected: { run_id: runId, task_id: definition.task, attempt: task.attempt } });
  if (finalized.status !== 'completed' || finalized.envelope_sha256 !== task.envelope_sha256) throw new Error('final worker evidence does not match accepted task');
  const approval = { gate: definition.gate, status: 'approved', artifact_sha256: task.envelope_sha256 };
  const handoff = {
    schema_version: 'sdtk.marketing-handoff.v1', workflow: state.workflow,
    episode_id: requireText(input?.episode_id, 'handoff episode id'), revision: requireText(input?.revision, 'handoff revision'),
    validation_status: 'pass', source_run_id: runId, approval,
    inputs: state.workflow === 'video_production' ? [{ sha256: requireText(input?.approval?.artifact_sha256, 'video input approval sha256') }] : [],
    outputs: finalized.artifacts.map((artifact) => ({ path: artifact.path, sha256: artifact.sha256, media_type: artifact.media_type })),
  };
  const content = JSON.stringify(handoff, null, 2) + '\n';
  const file = path.resolve(options.artifactRoot, 'handoffs', approval.artifact_sha256 + '.json');
  const wrote = atomicWrite(file, content);
  return { path: file, handoff, wrote };
}
module.exports = { FINAL_HANDOFFS, materializeApprovedHandoff };
