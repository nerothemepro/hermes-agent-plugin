#!/usr/bin/env node
'use strict';
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn, execFileSync } = require('child_process');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'hf-tunnel-provider-'));
const bin = path.join(temp, 'bin');
const ledger = path.join(temp, 'ledger');
const root = path.join(ledger, 'provider', 'hyperframes');
const wrapper = path.join(__dirname, 'hyperframes-provider.js');
fs.mkdirSync(bin, { recursive: true });
fs.mkdirSync(root, { recursive: true });
fs.writeFileSync(path.join(root, 'index.html'), '<!doctype html>');
const port = 4857;
const server = spawn(process.execPath, ['-e', "require('http').createServer((q,s)=>s.end('ok')).listen(" + port + ",'127.0.0.1')"]);
function wait(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }
(async () => {
  await wait(250);
  const hf = "#!/usr/bin/env node\nconst fs=require('fs');const a=process.argv.slice(2);if(a.includes('--version')){console.log('hyperframes 0.8.8');process.exit(0)}if(a.includes('doctor')){console.log(JSON.stringify({checks:[{name:'Node.js',ok:true},{name:'Chrome',ok:true},{name:'FFmpeg',ok:true},{name:'/dev/shm',ok:true}]}));process.exit(0)}if(a.includes('preview')&&a.includes('--background')){fs.writeFileSync(process.env.PREVIEW_STARTED,'1');process.exit(0)}if(a.includes('preview')&&a.includes('--status')){const running=fs.existsSync(process.env.PREVIEW_STARTED);console.log(JSON.stringify({result:{state:running?'running':'not-running',pid:Number(process.env.PREVIEW_PID)}}));process.exit(0)}process.exit(0);\n";
  const cf = "#!/usr/bin/env node\nif(process.argv.includes('--version')){console.log('cloudflared test');process.exit(0)}console.error('INF tunnel https://orange-field-123.trycloudflare.com');setInterval(()=>{},1000);process.on('SIGTERM',()=>process.exit(0));\n";
  fs.writeFileSync(path.join(bin, 'hyperframes'), hf, { mode: 0o755 });
  fs.writeFileSync(path.join(bin, 'cloudflared'), cf, { mode: 0o755 });
  const env = { ...process.env, PATH: bin + path.delimiter + process.env.PATH, HOME: temp, PREVIEW_PID: String(server.pid), PREVIEW_STARTED: path.join(temp, 'preview-started') };
  const preview = JSON.parse(execFileSync('node', [wrapper, 'preview', '--project', ledger, '--mode', 'timeline', '--port', String(port), '--tunnel', 'true'], { env, encoding: 'utf8' }));
  assert.equal(preview.tunnel.public_url, 'https://orange-field-123.trycloudflare.com');
  assert.ok(preview.tunnel.pid > 0);
  await wait(200);
  process.kill(preview.tunnel.pid, 0);
  const stopped = JSON.parse(execFileSync('node', [wrapper, 'stop', '--project', ledger, '--session-id', preview.session_id, '--pid', String(preview.pid), '--ownership-token', preview.ownership_token, '--tunnel-pid', String(preview.tunnel.pid), '--tunnel-ownership-token', preview.tunnel.ownership_token], { env, encoding: 'utf8' }));
  assert.equal(stopped.tunnel_stopped, true);
  await wait(150);
  let alive = true; try { process.kill(preview.tunnel.pid, 0); } catch { alive = false; }
  assert.equal(alive, false, 'tunnel process must stop');
  server.kill('SIGTERM'); fs.rmSync(temp, { recursive: true, force: true });
  console.log('ok - HyperFrames Quick Tunnel is owned and stopped offline');
})().catch((error) => { try { server.kill('SIGTERM'); } catch {} console.error(error.stack || error); process.exit(1); });
