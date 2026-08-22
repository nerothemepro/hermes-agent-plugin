#!/usr/bin/env node
'use strict';

const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'hf-provider-'));
const binDir = path.join(temp, 'bin');
const ledger = path.join(temp, 'ledger-demo');
const provider = path.join(ledger, 'provider', 'hyperframes');
const wrapper = path.join(__dirname, 'hyperframes-provider.js');
const sha = 'a'.repeat(64);
fs.mkdirSync(binDir, { recursive: true });
fs.mkdirSync(provider, { recursive: true });
fs.writeFileSync(path.join(provider, 'index.html'), '<!doctype html>');
fs.writeFileSync(path.join(provider, 'snapshot-times.json'), JSON.stringify({
  schema_version: 'sdtk.hyperframes-snapshot-times.v1',
  source_sha256: sha,
  scenes: [{ scene_id: 'SC01', times: { entry: 0, representative: 1.5, final: 3 } }],
}));
const fakeHyperframes = path.join(binDir, 'hyperframes');
fs.writeFileSync(fakeHyperframes, String.raw`#!/usr/bin/env node
const fs=require('fs'); const path=require('path');
const args=process.argv.slice(2);
if (args.includes('--version')) { process.stdout.write('hyperframes 0.8.8\\n'); process.exit(0); }
if (args.includes('doctor')) { process.stdout.write(JSON.stringify({ok:process.env.SHM_OK !== 'false',checks:[{name:'Node.js',ok:true},{name:'Chrome',ok:true},{name:'FFmpeg',ok:true},{name:'/dev/shm',ok:process.env.SHM_OK !== 'false',detail:'512 MB'}]})); process.exit(0); }
if (args.includes('snapshot')) { const out=args[args.indexOf('--output')+1]; fs.mkdirSync(out,{recursive:true}); fs.writeFileSync(path.join(out,'frame.png'),'real-pixels'); process.exit(0); }
if (args.includes('check')) { if(process.env.CHECK_FAIL==='true') process.stdout.write(JSON.stringify({ok:false,layout:{errors:[{code:'content_overlap',message:'title covers product'}]}})); else process.stdout.write(JSON.stringify({ok:true,layout:{errors:[]}})); process.exit(process.env.CHECK_FAIL==='true'?1:0); }
process.exit(0);
`, { mode: 0o755 });

function run(args, extra = {}) {
  return execFileSync('node', [wrapper, ...args], { encoding: 'utf8', env: { ...process.env, ...extra, HOME: temp, PATH: binDir + path.delimiter + '/usr/local/bin' + path.delimiter + '/usr/bin' } });
}
const doctor = JSON.parse(run(['doctor']));
assert.equal(doctor.requirements.shm, true);
assert.equal(doctor.local_only, true);
const doctorLowShm = JSON.parse(run(['doctor'], { SHM_OK: 'false' }));
assert.equal(doctorLowShm.requirements.shm, false);
const snapshot = JSON.parse(run(['snapshot', '--project', ledger, '--scene', 'SC01', '--phase', 'representative', '--source-sha256', sha]));
assert.equal(snapshot.path, 'production/evidence/snapshots/SC01/representative.png');
const snapshotPath = path.join(ledger, snapshot.path);
assert.equal(snapshot.sha256, crypto.createHash('sha256').update(fs.readFileSync(snapshotPath)).digest('hex'));
const check = JSON.parse(run(['check', '--project', ledger, '--source-sha256', sha]));
assert.deepEqual(check.findings, []);
const failedCheck = JSON.parse(run(['check', '--project', ledger, '--source-sha256', sha], { CHECK_FAIL: 'true' }));
assert.equal(failedCheck.findings[0].rule, 'unapproved-overlap');
assert.equal(failedCheck.findings[0].scene_id, 'SC01');
fs.rmSync(temp, { recursive: true, force: true });
console.log('ok - local HyperFrames provider adapter');
