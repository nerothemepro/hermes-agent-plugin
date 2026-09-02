'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const SECRET_OR_PRIVATE = [
  { code: 'SECRET_LITERAL', pattern: /\b(?:api[_-]?key|access[_-]?token|refresh[_-]?token|password|secret)\s*[:=]/i },
  { code: 'TELEGRAM_IDENTIFIER', pattern: /(?:telegram:\s*)?-?100\d{6,}/i },
  { code: 'PRIVATE_HOME_PATH', pattern: /(?:\/home\/|\/root\/|C:\\Users\\|\/opt\/data\/hermes-profiles\/)/i },
];

function sha256(bytes) { return crypto.createHash('sha256').update(bytes).digest('hex'); }
function canonicalRoot(projectPath, runId, taskId) { return path.join(path.resolve(projectPath), '.sdtk', 'agent-runtime', 'runs', runId, 'artifacts', taskId); }
function isInside(root, candidate) { const resolved = path.resolve(candidate); return resolved.startsWith(path.resolve(root) + path.sep); }

function validateEvidence(input) {
  const { projectPath, runId, taskId, evidence } = input;
  const issues = [];
  if (!evidence || evidence.schema_version !== 'sdtk.agent-evidence.v1') issues.push({ code: 'EVIDENCE_SCHEMA_INVALID' });
  if (evidence?.run_id !== runId || evidence?.task_id !== taskId) issues.push({ code: 'EVIDENCE_IDENTITY_MISMATCH' });
  const root = canonicalRoot(projectPath, runId, taskId);
  for (const artifact of Array.isArray(evidence?.artifacts) ? evidence.artifacts : []) {
    if (!artifact || typeof artifact.path !== 'string' || !/^[a-f0-9]{64}$/.test(artifact.sha256 || '')) { issues.push({ code: 'ARTIFACT_CONTRACT_INVALID' }); continue; }
    if (!isInside(root, artifact.path) || !fs.existsSync(artifact.path) || fs.lstatSync(artifact.path).isSymbolicLink()) { issues.push({ code: 'ARTIFACT_PATH_INVALID', path: artifact.path }); continue; }
    const bytes = fs.readFileSync(artifact.path);
    if (sha256(bytes) !== artifact.sha256) issues.push({ code: 'ARTIFACT_SHA_MISMATCH', path: artifact.path });
    const text = bytes.toString('utf8');
    for (const rule of SECRET_OR_PRIVATE) if (rule.pattern.test(text)) issues.push({ code: rule.code, path: artifact.path });
  }
  if (input.requireDemoLabel && evidence?.fields?.data_classification !== 'demo_only') issues.push({ code: 'DEMO_LABEL_MISSING' });
  return { ok: issues.length === 0, root, issues };
}

function quarantineFailedEvidence(projectPath, runId, taskId, result) {
  const root = path.join(path.resolve(projectPath), '.sdtk', 'agent-runtime', 'runs', runId, 'quarantine');
  fs.mkdirSync(root, { recursive: true, mode: 0o700 });
  const target = path.join(root, `${taskId}.evidence-policy.json`);
  fs.writeFileSync(target, JSON.stringify({ schema_version: 'sdtk.marketing-video-quarantine.v1', run_id: runId, task_id: taskId, result, quarantined_at: new Date().toISOString() }, null, 2) + '\n', { mode: 0o600 });
  return target;
}

module.exports = { canonicalRoot, quarantineFailedEvidence, validateEvidence };
