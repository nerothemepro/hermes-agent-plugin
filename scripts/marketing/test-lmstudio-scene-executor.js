#!/usr/bin/env node
'use strict';

const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

function runPython(args, env) {
  return new Promise((resolve) => {
    const child = spawn('python3', args, { env });
    let stdout = ''; let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('close', (code) => resolve({ code, stdout, stderr }));
  });
}

(async () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'lmstudio-scene-'));
  const task = {
    schema_version: 'sdtk.marketing-video-scene-task.v1', project_id: 'demo', provider: 'hyperframes',
    scene: { id: 'SC01', blueprint_id: 'evidence-reveal' }, allowed_media_ids: ['terminal-capture'], allowed_motion_ids: ['evidence-reveal'],
  };
  const taskSha = crypto.createHash('sha256').update(JSON.stringify(task, null, 2) + '\n').digest('hex');
  const taskFile = path.join(temp, 'task.json');
  fs.writeFileSync(taskFile, JSON.stringify(task, null, 2) + '\n');
  let unsafe = false;
  const server = http.createServer((req, res) => {
    if (req.url === '/v1/models') return res.end(JSON.stringify({ data: [{ id: 'qwen-local' }] }));
    if (req.url === '/v1/chat/completions') {
      let raw = ''; req.on('data', (chunk) => { raw += chunk; }); req.on('end', () => {
        const sent = JSON.parse(raw); assert.equal(sent.response_format.type, 'json_schema');
        const fragment = unsafe ? 'curl https://example.invalid' : '<div data-hf-id="proof">terminal proof</div>';
        const result = { schema_version: 'sdtk.marketing-video-local-executor-result.v1', task_sha256: taskSha, model_id: 'qwen-local', fragments: [{ scene_id: 'SC01', kind: 'provider_source_fragment', content: { operation: 'propose_provider_fragment', motion_id: 'evidence-reveal', source_fragment: fragment, approved_media_ids: ['terminal-capture'] } }] };
        res.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify(result) } }] }));
      }); return;
    }
    res.statusCode = 404; res.end();
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  const script = path.join(__dirname, 'lmstudio-scene-executor.py');
  const env = { ...process.env, LMSTUDIO_BASE_URL: 'http://127.0.0.1:' + port, SDTK_MARKETING_VIDEO_LOCAL_MODELS: 'qwen-local', SDTK_MARKETING_VIDEO_LMSTUDIO_STRUCTURED_MODELS: 'qwen-local' };
  const doctorRun = await runPython([script, '--doctor'], env);
  assert.equal(doctorRun.code, 0, doctorRun.stderr);
  const doctor = JSON.parse(doctorRun.stdout);
  assert.deepEqual(doctor.models, [{ id: 'qwen-local', structured_output: true }]);
  const resultRun = await runPython([script, '--task', taskFile, '--model', 'qwen-local'], env);
  assert.equal(resultRun.code, 0, resultRun.stderr);
  const result = JSON.parse(resultRun.stdout);
  assert.equal(result.task_sha256, taskSha);
  assert.equal(result.fragments[0].content.approved_media_ids[0], 'terminal-capture');
  unsafe = true;
  const unsafeRun = await runPython([script, '--task', taskFile, '--model', 'qwen-local'], env);
  assert.equal(unsafeRun.code, 1);
  await new Promise((resolve) => server.close(resolve));
  fs.rmSync(temp, { recursive: true, force: true });
  console.log('ok - bounded LM Studio scene executor');
})().catch((error) => { console.error(error); process.exit(1); });
