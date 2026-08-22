#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'render-lease-'));
const script = path.join(__dirname, 'run-video-render-lease.sh');
const lease = path.join(temp, 'lease.json');
fs.writeFileSync(lease, JSON.stringify({
  schema_version: 'sdtk.marketing-video-render-lease-request.v1',
  state: 'REQUESTED',
  provider: 'hyperframes',
  project_id: 'lease-demo',
  output_reference: path.join(temp, 'out.mp4'),
  creative_directive_sha256: 'a'.repeat(64),
  motion_map_sha256: 'b'.repeat(64),
}));

const env = {
  ...process.env,
  SDTK_MARKETING_RENDER_LEASE_VERIFY_EVIDENCE_CMD: 'true',
  SDTK_MARKETING_RENDER_LEASE_UNLOAD_LLM_CMD: 'true',
  SDTK_MARKETING_RENDER_LEASE_FREE_CACHE_CMD: 'true',
  SDTK_MARKETING_RENDER_LEASE_RENDER_CMD: 'true',
  SDTK_MARKETING_RENDER_LEASE_BANK_OUTPUT_CMD: 'true',
};
const dry = execFileSync('bash', [script, '--lease', lease, '--dry-run'], { env, encoding: 'utf8' });
assert.match(dry, /DRY_RUN phase=unload_local_llm/);
const live = execFileSync('bash', [script, '--lease', lease], { env, encoding: 'utf8' });
const receipt = JSON.parse(live);
assert.equal(receipt.status, 'completed');
assert.equal(receipt.project_id, 'lease-demo');
assert.equal(receipt.output_reference, path.join(temp, 'out.mp4'));

let missing = false;
try {
  execFileSync('bash', [script, '--lease', lease], { env: { ...process.env }, stdio: 'pipe' });
} catch (error) {
  missing = error.status === 2;
}
assert.equal(missing, true);

for (const [name, failedPhase] of [
  ['SDTK_MARKETING_RENDER_LEASE_UNLOAD_LLM_CMD', 'unload_local_llm'],
  ['SDTK_MARKETING_RENDER_LEASE_RENDER_CMD', 'render'],
]) {
  let failure;
  try {
    execFileSync('bash', [script, '--lease', lease], { env: { ...env, [name]: 'false' }, encoding: 'utf8', stdio: 'pipe' });
  } catch (error) {
    failure = JSON.parse(error.stdout);
  }
  assert.equal(failure.status, 'failed');
  assert.equal(failure.failed_phase, failedPhase);
}

fs.rmSync(temp, { recursive: true, force: true });
console.log('ok - bounded operator render lease wrapper');
