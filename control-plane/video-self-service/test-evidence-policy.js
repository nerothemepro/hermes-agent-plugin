'use strict';
const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const test = require('node:test');
const { canonicalRoot, quarantineFailedEvidence, validateEvidence } = require('./evidence-policy');
function digest(bytes) { return crypto.createHash('sha256').update(bytes).digest('hex'); }
function fixture(text = 'DEMO DATA\n') {
  const project = fs.mkdtempSync(path.join(os.tmpdir(), 'evidence-policy-'));
  const runId = 'run_abc123_def456'; const taskId = 'product_capture'; const root = canonicalRoot(project, runId, taskId);
  fs.mkdirSync(root, { recursive: true }); const asset = path.join(root, 'capture.txt'); fs.writeFileSync(asset, text);
  return { projectPath: project, runId, taskId, asset, evidence: { schema_version: 'sdtk.agent-evidence.v1', run_id: runId, task_id: taskId, fields: { data_classification: 'demo_only' }, artifacts: [{ path: asset, sha256: digest(fs.readFileSync(asset)) }] } };
}
test('canonical demo artifact with matching hash passes privacy and path policy', (t) => { const f = fixture(); t.after(() => fs.rmSync(f.projectPath, { recursive: true, force: true })); assert.equal(validateEvidence({ ...f, requireDemoLabel: true }).ok, true); });
test('private paths/secrets or an altered artifact fail and can be quarantined without deletion', (t) => { const f = fixture('api_key=secret\n/home/owner/private\n'); t.after(() => fs.rmSync(f.projectPath, { recursive: true, force: true })); const result = validateEvidence(f); assert.equal(result.ok, false); assert.ok(result.issues.some((item) => item.code === 'SECRET_LITERAL')); assert.ok(result.issues.some((item) => item.code === 'PRIVATE_HOME_PATH')); const receipt = quarantineFailedEvidence(f.projectPath, f.runId, f.taskId, result); assert.ok(fs.existsSync(receipt)); assert.ok(fs.existsSync(f.asset)); });
