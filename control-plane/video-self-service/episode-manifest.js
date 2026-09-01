'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const DEFAULT_EPISODE_ROOT = path.join(__dirname, 'episodes');
const EPISODE_ID_PATTERN = /^EP[2-4]$/;
const REQUIRED_TEXT = ['episode_id', 'revision', 'title', 'language', 'pain_point', 'story', 'cta', 'workflow_template', 'quality_profile'];
const REQUIRED_ARRAYS = ['product_proof', 'source_boundaries', 'allowed_roles'];

function sha256(value) { return crypto.createHash('sha256').update(value).digest('hex'); }

function validateEpisodeManifest(manifest, episodeId) {
  if (!manifest || manifest.schema_version !== 'sdtk.marketing-video-episode.v1') throw new Error('Marketing video episode manifest schema is invalid.');
  if (manifest.episode_id !== episodeId) throw new Error(`Episode manifest identity mismatch for ${episodeId}.`);
  for (const key of REQUIRED_TEXT) if (typeof manifest[key] !== 'string' || !manifest[key].trim()) throw new Error(`Episode manifest field ${key} is required.`);
  for (const key of REQUIRED_ARRAYS) {
    if (!Array.isArray(manifest[key]) || manifest[key].length === 0 || manifest[key].some((item) => typeof item !== 'string' || !item.trim())) throw new Error(`Episode manifest field ${key} must be a non-empty string array.`);
  }
  if (!manifest.capture_contract || typeof manifest.capture_contract !== 'object') throw new Error('Episode manifest capture_contract must be an object.');
  if (typeof manifest.capture_contract.mode !== 'string' || !manifest.capture_contract.mode.trim()) throw new Error('Episode manifest capture_contract.mode is required.');
  if (typeof manifest.capture_contract.instruction !== 'string' || !manifest.capture_contract.instruction.trim()) throw new Error('Episode manifest capture_contract.instruction is required.');
  if (!manifest.toolchain || typeof manifest.toolchain !== 'object') throw new Error('Episode manifest toolchain policy is required.');
  return manifest;
}

function loadEpisodeManifest(episodeId, options = {}) {
  if (!EPISODE_ID_PATTERN.test(episodeId || '')) throw new Error(`Episode ${episodeId || '<empty>'} is not allowlisted.`);
  const root = path.resolve(options.episodeManifestRoot || DEFAULT_EPISODE_ROOT);
  const filePath = path.resolve(root, `${episodeId}.r1.json`);
  if (path.dirname(filePath) !== root || !fs.existsSync(filePath)) throw new Error(`Episode ${episodeId} manifest is unavailable.`);
  const bytes = fs.readFileSync(filePath);
  let manifest;
  try { manifest = JSON.parse(bytes.toString('utf8')); } catch (error) { throw new Error(`Episode ${episodeId} manifest is invalid JSON: ${error.message}`); }
  validateEpisodeManifest(manifest, episodeId);
  return { filePath, manifest, sha256: sha256(bytes) };
}

module.exports = { DEFAULT_EPISODE_ROOT, loadEpisodeManifest, validateEpisodeManifest };
