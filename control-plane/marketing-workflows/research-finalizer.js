'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { validateProductionBrief } = require('./workflows');

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
  const candidate = {
    schema_version: 'sdtk.video-task-result.v1',
    run_id: runId,
    task_id: 'research_story',
    attempt,
    status: 'completed',
    artifacts: [{ path: 'production-brief.json', sha256: digest(briefFile), media_type: 'application/json' }],
    validation: { status: 'pass', validator: 'research-brief-finalizer-r1', evidence: ['episode-seed.json'] },
    summary: seed.episode_id + ' production brief ready for Story Lock',
    error: null,
  };
  fs.writeFileSync(contained(root, 'worker-result.json'), JSON.stringify(candidate, null, 2) + '\n', { mode: 0o600 });
  return candidate;
}

module.exports = { assertSeedBound, finalizeResearchBrief };
