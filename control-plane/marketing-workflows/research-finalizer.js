'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { validateCapturePlan, validateProductionBrief } = require('./workflows');
const { canonicalJson } = require('./result-contract');

function requiredText(value, name) {
  const result = String(value || '').trim();
  if (!result) throw new Error(name + ' is required');
  return result;
}

function contained(root, relative) {
  const base = path.resolve(requiredText(root, 'root'));
  const target = path.resolve(base, relative);
  if (target === base || !target.startsWith(base + path.sep)) throw new Error('artifact path is outside canonical root');
  return target;
}

function digest(file) { return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'); }

function assertSeedBound(brief, seed) {
  for (const key of ['episode_id', 'revision', 'audience', 'pain_point', 'cta']) {
    if (brief[key] !== seed[key]) throw new Error(key + ' does not match episode seed');
  }
  if (!brief.evidence.includes('episode-seed.json')) throw new Error('production brief must cite episode-seed.json');
}

function assertCapturePlanBound(root, seed) {
  if (!seed.capture_plan) return null;
  const file = contained(root, 'capture-plan.json');
  if (!fs.existsSync(file) || !fs.lstatSync(file).isFile()) throw new Error('capture-plan.json is unavailable');
  let plan;
  try { plan = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { throw new Error('capture-plan.json is not valid JSON'); }
  validateCapturePlan(plan);
  if (canonicalJson(plan) !== canonicalJson(seed.capture_plan)) throw new Error('capture plan does not match episode seed');
  return file;
}

function finalizeResearchBrief(input) {
  const root = path.resolve(requiredText(input.root, 'root'));
  const runId = requiredText(input.runId, 'run id');
  const attempt = Number(input.attempt);
  if (!Number.isInteger(attempt) || attempt < 1) throw new Error('attempt must be a positive integer');
  const seed = input.seed;
  if (!seed || typeof seed !== 'object' || Array.isArray(seed)) throw new Error('episode seed is required');
  const briefFile = contained(root, 'production-brief.json');
  if (!fs.existsSync(briefFile) || !fs.lstatSync(briefFile).isFile()) throw new Error('production-brief.json is unavailable');
  let brief;
  try { brief = JSON.parse(fs.readFileSync(briefFile, 'utf8')); } catch { throw new Error('production-brief.json is not valid JSON'); }
  validateProductionBrief(brief);
  assertSeedBound(brief, seed);
  const capturePlanFile = assertCapturePlanBound(root, seed);
  const artifacts = [{ path: 'production-brief.json', sha256: digest(briefFile), media_type: 'application/json' }];
  if (capturePlanFile) artifacts.push({ path: 'capture-plan.json', sha256: digest(capturePlanFile), media_type: 'application/json' });
  const candidate = {
    schema_version: 'sdtk.video-task-result.v1',
    run_id: runId,
    task_id: 'research_story',
    attempt,
    status: 'completed',
    artifacts,
    validation: { status: 'pass', validator: 'research-brief-finalizer-r1', evidence: ['episode-seed.json'] },
    summary: seed.episode_id + ' production brief ready for Story Lock',
    error: null,
  };
  fs.writeFileSync(contained(root, 'worker-result.json'), JSON.stringify(candidate, null, 2) + '\n', { mode: 0o600 });
  return candidate;
}

module.exports = { assertSeedBound, finalizeResearchBrief };
