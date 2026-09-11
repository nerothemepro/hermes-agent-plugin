'use strict';

const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const test = require('node:test');
const { main } = require('./video-finalizer-cli');

const sha = (value) => crypto.createHash('sha256').update(value).digest('hex');
function freshRoot() { return fs.mkdtempSync(path.join(os.tmpdir(), 'marketing-video-finalizer-')); }

test('capture finalizer hashes only manifest-bound evidence and writes a result envelope', () => {
  const root = freshRoot();
  try {
    const capture = Buffer.from('capture bytes\n');
    const receipt = Buffer.from('capture receipt\n');
    fs.writeFileSync(path.join(root, 'capture.mp4'), capture);
    fs.writeFileSync(path.join(root, 'capture.txt'), receipt);
    fs.writeFileSync(path.join(root, 'capture-manifest.json'), JSON.stringify({
      captures: [{ artifact_path: 'capture.mp4', sha256: '0'.repeat(64) }],
      command_receipts: [{ artifact_path: 'capture.txt', sha256: '0'.repeat(64), exit_code: 0 }],
    }) + '\n');
    main(['--root', root, '--run-id', 'run_finalizer_001', '--task-id', 'capture_assets', '--attempt', '1']);
    const result = JSON.parse(fs.readFileSync(path.join(root, 'worker-result.json'), 'utf8'));
    assert.deepStrictEqual(result.artifacts.map((item) => item.path).sort(), ['capture-manifest.json', 'capture.mp4', 'capture.txt']);
    const manifest = JSON.parse(fs.readFileSync(path.join(root, 'capture-manifest.json'), 'utf8'));
    assert.strictEqual(manifest.captures[0].sha256, sha(capture));
    assert.strictEqual(manifest.command_receipts[0].sha256, sha(receipt));
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('assembly finalizer binds the package to the exact accepted capture context', () => {
  const root = freshRoot();
  try {
    const video = Buffer.from('master\n');
    const quality = Buffer.from(JSON.stringify({ status: 'pass' }) + '\n');
    const review = Buffer.from(JSON.stringify({ frames: [] }) + '\n');
    const captions = Buffer.from(JSON.stringify({ cues: [{ text: 'caption' }] }) + '\n');
    fs.writeFileSync(path.join(root, 'video-master.mp4'), video);
    fs.writeFileSync(path.join(root, 'quality-report.json'), quality);
    fs.writeFileSync(path.join(root, 'review-frames.json'), review);
    fs.writeFileSync(path.join(root, 'captions.json'), captions);
    fs.writeFileSync(path.join(root, 'accepted-capture.json'), JSON.stringify({ capture_envelope_sha256: 'a'.repeat(64), capture_manifest_sha256: 'b'.repeat(64) }) + '\n');
    main(['--root', root, '--run-id', 'run_finalizer_002', '--task-id', 'assemble_video', '--attempt', '1']);
    const pkg = JSON.parse(fs.readFileSync(path.join(root, 'video-quality-package.json'), 'utf8'));
    assert.strictEqual(pkg.capture_envelope_sha256, 'a'.repeat(64));
    assert.strictEqual(pkg.video_sha256, sha(video));
    assert.strictEqual(pkg.captions_sha256, sha(captions));
    const result = JSON.parse(fs.readFileSync(path.join(root, 'worker-result.json'), 'utf8'));
    assert.strictEqual(result.artifacts.length, 5);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
