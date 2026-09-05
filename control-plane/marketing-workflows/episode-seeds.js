'use strict';

const fs = require('fs');
const path = require('path');

const SEED_FILE = path.join(__dirname, 'episode-seeds.json');

function requireText(value, name) {
  const result = String(value || '').trim();
  if (!result) throw new Error(`episode seed ${name} is required`);
  return result;
}

function loadEpisodeSeeds() {
  const parsed = JSON.parse(fs.readFileSync(SEED_FILE, 'utf8'));
  if (!parsed || parsed.schema_version !== 'sdtk.marketing-episode-seeds.v1' || !Array.isArray(parsed.episodes)) {
    throw new Error('invalid episode seed registry');
  }
  const seeds = new Map();
  for (const candidate of parsed.episodes) {
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) throw new Error('invalid episode seed');
    const episodeId = requireText(candidate.episode_id, 'episode_id');
    if (!/^EP[1-9][0-9]*$/.test(episodeId) || seeds.has(episodeId)) throw new Error('invalid or duplicate episode seed');
    for (const key of ['revision', 'language', 'audience', 'pain_point', 'product_proof', 'cta']) requireText(candidate[key], key);
    for (const key of ['source_policy', 'forbidden_claims', 'required_brief_outputs']) {
      if (!Array.isArray(candidate[key]) || candidate[key].length === 0 || candidate[key].some((item) => !String(item || '').trim())) {
        throw new Error(`episode seed ${key} is required`);
      }
    }
    seeds.set(episodeId, structuredClone(candidate));
  }
  return seeds;
}

function resolveEpisodeSeed(episodeId) {
  const seed = loadEpisodeSeeds().get(String(episodeId || ''));
  if (!seed) throw new Error('episode seed is not allowlisted');
  return structuredClone(seed);
}

module.exports = { SEED_FILE, loadEpisodeSeeds, resolveEpisodeSeed };
