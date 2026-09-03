'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const SHA256 = /^[a-f0-9]{64}$/;
const STATUSES = new Set(['completed', 'failed']);

function digest(value) { return crypto.createHash('sha256').update(value).digest('hex'); }
function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
}
function requiredString(value, name) {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${name} is required`);
  return value.trim();
}
function containedPath(root, relative) {
  if (path.isAbsolute(relative)) throw new Error('artifact path is outside canonical root');
  const absolute = path.resolve(root, relative);
  const prefix = `${path.resolve(root)}${path.sep}`;
  if (!absolute.startsWith(prefix)) throw new Error('artifact path is outside canonical root');
  return absolute;
}

function finalizeTaskResult(candidate, options) {
  if (!candidate || typeof candidate !== 'object') throw new Error('result must be an object');
  if (candidate.schema_version !== 'sdtk.video-task-result.v1') throw new Error('unsupported result schema');
  const expected = options?.expected || {};
  if (candidate.run_id !== expected.run_id || candidate.task_id !== expected.task_id || Number(candidate.attempt) !== Number(expected.attempt)) throw new Error('result identity mismatch');
  if (!STATUSES.has(candidate.status)) throw new Error('invalid result status');
  if (!Array.isArray(candidate.artifacts)) throw new Error('artifacts must be an array');
  if (!candidate.validation || !['pass', 'fail'].includes(candidate.validation.status)) throw new Error('invalid validation status');
  if (candidate.status === 'completed' && candidate.validation.status !== 'pass') throw new Error('completed result requires passing validation');
  const root = path.resolve(requiredString(options?.root, 'canonical root'));
  const artifacts = candidate.artifacts.map((artifact) => {
    const relative = requiredString(artifact?.path, 'artifact path');
    const absolute = containedPath(root, relative);
    if (!fs.existsSync(absolute) || !fs.statSync(absolute).isFile()) throw new Error(`artifact missing: ${relative}`);
    if (!SHA256.test(String(artifact.sha256 || ''))) throw new Error('invalid artifact sha256');
    const actual = digest(fs.readFileSync(absolute));
    if (actual !== artifact.sha256) throw new Error(`artifact sha256 mismatch: ${relative}`);
    return { path: relative, absolute_path: absolute, sha256: actual, media_type: requiredString(artifact.media_type, 'artifact media type'), bytes: fs.statSync(absolute).size };
  });
  const envelope = {
    schema_version: candidate.schema_version,
    run_id: candidate.run_id,
    task_id: candidate.task_id,
    attempt: Number(candidate.attempt),
    status: candidate.status,
    artifacts,
    validation_status: candidate.validation.status,
    validator: requiredString(candidate.validation.validator, 'validator'),
    verification_evidence: Array.isArray(candidate.validation.evidence) ? candidate.validation.evidence.slice() : [],
    summary: requiredString(candidate.summary, 'summary'),
    error: candidate.error || null,
  };
  return Object.assign(envelope, { envelope_sha256: digest(canonicalJson(envelope)) });
}

module.exports = { canonicalJson, finalizeTaskResult };
