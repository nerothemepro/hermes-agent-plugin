'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

function sha256(file) { return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'); }
function parseArgs(argv) {
  const values = {};
  for (let i = 0; i < argv.length; i += 1) {
    const key = argv[i];
    if (!['--root', '--run-id', '--task-id', '--attempt'].includes(key) || !argv[i + 1]) throw new Error('exact arguments required: --root --run-id --task-id --attempt');
    values[key.slice(2).replace(/-([a-z])/g, (_, char) => char.toUpperCase())] = argv[++i];
  }
  if (!path.isAbsolute(String(values.root || '')) || !/^run_[a-z0-9_]+$/.test(String(values.runId || '')) || !['capture_assets', 'assemble_video'].includes(values.taskId) || !Number.isInteger(Number(values.attempt)) || Number(values.attempt) < 1) throw new Error('invalid finalizer arguments');
  return { root: path.resolve(values.root), runId: values.runId, taskId: values.taskId, attempt: Number(values.attempt) };
}
function inside(root, relative) {
  if (path.isAbsolute(relative)) throw new Error('artifact path must be relative');
  const file = path.resolve(root, relative);
  if (!file.startsWith(root + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) throw new Error('required artifact is unavailable: ' + relative);
  return file;
}
function artifact(root, relative, mediaType) {
  const file = inside(root, relative);
  return { path: relative, sha256: sha256(file), media_type: mediaType };
}
function json(root, relative) { return JSON.parse(fs.readFileSync(inside(root, relative), 'utf8')); }
function finalizeCapture(input) {
  const manifest = json(input.root, 'capture-manifest.json');
  const artifacts = [];
  for (const capture of Array.isArray(manifest.captures) ? manifest.captures : []) {
    const item = artifact(input.root, capture.artifact_path, 'video/mp4');
    artifacts.push(item);
    capture.sha256 = item.sha256;
  }
  for (const receipt of Array.isArray(manifest.command_receipts) ? manifest.command_receipts : []) {
    const item = artifact(input.root, receipt.artifact_path, 'text/plain');
    artifacts.push(item);
    receipt.sha256 = item.sha256;
  }
  fs.writeFileSync(path.join(input.root, 'capture-manifest.json'), JSON.stringify(manifest, null, 2) + '\n', { mode: 0o600 });
  artifacts.push(artifact(input.root, 'capture-manifest.json', 'application/json'));
  return artifacts;
}
function finalizeVideo(input) {
  const capture = json(input.root, 'accepted-capture.json');
  const video = artifact(input.root, 'video-master.mp4', 'video/mp4');
  const quality = artifact(input.root, 'quality-report.json', 'application/json');
  const review = artifact(input.root, 'review-frames.json', 'application/json');
  const pkg = {
    schema_version: 'sdtk.marketing-video-quality-package.v1', run_id: input.runId, task_id: input.taskId,
    capture_envelope_sha256: capture.capture_envelope_sha256,
    capture_manifest_sha256: capture.capture_manifest_sha256,
    video_sha256: video.sha256, quality_report_sha256: quality.sha256, review_frames_sha256: review.sha256,
  };
  fs.writeFileSync(path.join(input.root, 'video-quality-package.json'), JSON.stringify(pkg, null, 2) + '\n', { mode: 0o600 });
  return [video, quality, review, artifact(input.root, 'video-quality-package.json', 'application/json')];
}
function main(argv = process.argv.slice(2)) {
  const input = parseArgs(argv);
  const artifacts = input.taskId === 'capture_assets' ? finalizeCapture(input) : finalizeVideo(input);
  const result = { schema_version: 'sdtk.video-task-result.v1', run_id: input.runId, task_id: input.taskId, attempt: input.attempt, status: 'completed', artifacts, validation: { status: 'pass', validator: 'sdtk-marketing-video-finalizer-r1', evidence: artifacts.map((item) => item.path) }, summary: input.taskId + ' evidence finalized', error: null };
  fs.writeFileSync(path.join(input.root, 'worker-result.json'), JSON.stringify(result, null, 2) + '\n', { mode: 0o600 });
  process.stdout.write('VIDEO_WORKER_RESULT_READY\n');
}
if (require.main === module) { try { main(); } catch (error) { process.stderr.write(error.message + '\n'); process.exitCode = 1; } }
module.exports = { main, parseArgs };
