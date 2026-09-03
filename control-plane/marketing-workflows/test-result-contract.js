'use strict';

const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const test = require('node:test');
const { finalizeTaskResult } = require('./result-contract');

const digest = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'marketing-result-'));
  fs.mkdirSync(path.join(root, 'reports'));
  const bytes = Buffer.from('# Evidence\n');
  fs.writeFileSync(path.join(root, 'reports', 'evidence.md'), bytes);
  return { root, result: { schema_version: 'sdtk.video-task-result.v1', run_id: 'run_research_001', task_id: 'research_story', attempt: 1, status: 'completed', artifacts: [{ path: 'reports/evidence.md', sha256: digest(bytes), media_type: 'text/markdown' }], validation: { status: 'pass', validator: 'research-story-r1', evidence: [] }, summary: 'Evidence complete', error: null } };
}

test('finalizer accepts only hash-pinned artifacts inside canonical root', () => {
  const item = fixture();
  try {
    const finalized = finalizeTaskResult(item.result, { root: item.root, expected: { run_id: 'run_research_001', task_id: 'research_story', attempt: 1 } });
    assert.strictEqual(finalized.validation_status, 'pass');
    assert.strictEqual(finalized.artifacts[0].absolute_path, path.join(item.root, 'reports', 'evidence.md'));
    assert.match(finalized.envelope_sha256, /^[a-f0-9]{64}$/);
  } finally { fs.rmSync(item.root, { recursive: true, force: true }); }
});

test('finalizer rejects identity mismatch, path escape, missing file, and stale hash', () => {
  const item = fixture();
  try {
    assert.throws(() => finalizeTaskResult({ ...item.result, run_id: 'run_wrong' }, { root: item.root, expected: { run_id: 'run_research_001', task_id: 'research_story', attempt: 1 } }), /identity mismatch/);
    assert.throws(() => finalizeTaskResult({ ...item.result, artifacts: [{ ...item.result.artifacts[0], path: '../escape.md' }] }, { root: item.root, expected: { run_id: 'run_research_001', task_id: 'research_story', attempt: 1 } }), /outside canonical root/);
    assert.throws(() => finalizeTaskResult({ ...item.result, artifacts: [{ ...item.result.artifacts[0], path: 'reports/missing.md' }] }, { root: item.root, expected: { run_id: 'run_research_001', task_id: 'research_story', attempt: 1 } }), /artifact missing/);
    assert.throws(() => finalizeTaskResult({ ...item.result, artifacts: [{ ...item.result.artifacts[0], sha256: 'b'.repeat(64) }] }, { root: item.root, expected: { run_id: 'run_research_001', task_id: 'research_story', attempt: 1 } }), /artifact sha256 mismatch/);
  } finally { fs.rmSync(item.root, { recursive: true, force: true }); }
});
