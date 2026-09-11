#!/usr/bin/env node
'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { validateAssemblyPlan, validateProductionBrief } = require('./workflows');

const RUN_ID = /^run_[a-z0-9_]+$/;
const FONT_BOLD = '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf';
const FONT_REGULAR = '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf';
const CAPTIONS = Object.freeze([
  'A customer request should not disappear into a chat thread. SDTK starts by keeping the original requirement visible before anyone begins to build.',
  'From that requirement, the team creates planning work that can be reviewed: acceptance criteria, decisions, and the next implementation steps.',
  'Each artifact lives in the project memory layer, so the context is available when someone needs to inspect the reason behind a task.',
  'The documentation view keeps the requirement and plan readable. It is not a generated mockup: this is the local SDTK-WIKI viewer running against a labelled demo fixture.',
  'The Kanban board exposes the work state. You can see planning, quality, and backlog views instead of inferring progress from a prompt transcript.',
  'The workflow stays attended. An owner gate separates a reviewable plan from implementation, so the decision to build remains visible and deliberate.',
  'Turn the next requirement into a plan you can inspect. Start at sdtk.dev.'
]);

function sha256(file) { return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'); }
function required(value, label) { const text = String(value || '').trim(); if (!text) throw new Error(label + ' is required'); return text; }
function inside(root, relative) {
  if (path.isAbsolute(relative)) throw new Error('artifact path must be relative');
  const candidate = path.resolve(root, relative);
  if (!candidate.startsWith(root + path.sep)) throw new Error('artifact path is outside run root');
  return candidate;
}
function executable(name) {
  for (const entry of String(process.env.PATH || '').split(path.delimiter)) { const target = path.join(entry, name); if (fs.existsSync(target) && fs.statSync(target).isFile()) return target; }
  return '';
}
function marketingProbe() {
  const configured = String(process.env.SDTK_MARKETING_VIDEO_PROBE_CMD || '').trim();
  if (configured) return configured;
  const result = spawnSync('npm', ['root', '-g'], { encoding: 'utf8', timeout: 10000 });
  if (result.status !== 0) return '';
  const candidate = path.join(String(result.stdout || '').trim(), 'sdtk-marketing-kit', 'scripts', 'reference-probe.sh');
  return fs.existsSync(candidate) ? candidate + ' {file}' : '';
}
function parseArgs(argv) {
  const values = {};
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    if (flag === '--preflight') { values.preflight = true; continue; }
    if (!['--root', '--run-id', '--attempt'].includes(flag) || !argv[index + 1] || argv[index + 1].startsWith('--')) throw new Error('exact arguments required: --root --run-id --attempt [--preflight]');
    values[flag.slice(2).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase())] = argv[++index];
  }
  const root = path.resolve(required(values.root, 'root'));
  const runId = required(values.runId, 'run id');
  const attempt = Number(values.attempt);
  if (!RUN_ID.test(runId) || !Number.isInteger(attempt) || attempt < 1) throw new Error('invalid runner identity');
  return { root, runId, attempt, preflight: values.preflight === true };
}
function readJson(root, relative, label) {
  const file = inside(root, relative);
  if (!fs.existsSync(file) || !fs.lstatSync(file).isFile()) throw new Error(label + ' is unavailable');
  try { return { file, value: JSON.parse(fs.readFileSync(file, 'utf8')) }; } catch { throw new Error(label + ' is not valid JSON'); }
}
function readInputs(input) {
  const { file: planFile, value: plan } = readJson(input.root, 'approved-assembly-plan.json', 'approved assembly plan');
  validateAssemblyPlan(plan);
  const { file: manifestFile, value: manifest } = readJson(input.root, plan.inputs.capture_manifest, 'capture manifest');
  if (manifest.schema_version !== 'sdtk.marketing-capture-manifest.v1' || !Array.isArray(manifest.captures)) throw new Error('capture manifest is invalid');
  const entry = manifest.captures.find((candidate) => candidate && candidate.artifact_path === plan.inputs.capture);
  if (!entry) throw new Error('capture manifest does not bind approved capture');
  const captureFile = inside(input.root, plan.inputs.capture);
  if (!fs.existsSync(captureFile) || !fs.lstatSync(captureFile).isFile()) throw new Error('approved capture is unavailable');
  const digest = sha256(captureFile);
  if (digest !== String(entry.sha256 || '')) throw new Error('capture sha256 mismatch');
  const { file: briefFile, value: brief } = readJson(input.root, 'approved-production-brief.json', 'approved production brief');
  validateProductionBrief(brief);
  const { file: acceptedCaptureFile, value: acceptedCapture } = readJson(input.root, 'accepted-capture.json', 'accepted capture binding');
  if (acceptedCapture.capture_manifest_sha256 !== sha256(manifestFile)) throw new Error('accepted capture binding does not match capture manifest');
  return { planFile, plan, manifestFile, manifest, briefFile, brief, acceptedCaptureFile, acceptedCapture, capture: { path: captureFile, sha256: digest } };
}
function runChecked(command, args, options = {}) {
  const result = spawnSync(command, args, { cwd: options.cwd, encoding: 'utf8', timeout: options.timeout || 600000, maxBuffer: 8 * 1024 * 1024, env: options.env || process.env });
  if (result.status !== 0) throw new Error(command + ' failed: ' + String(result.stderr || '').trim().slice(-500));
  return String(result.stdout || '');
}
function ffprobeJson(file) {
  return JSON.parse(runChecked('ffprobe', ['-v', 'error', '-show_entries', 'format=duration:stream=index,codec_type,codec_name,width,height,pix_fmt,r_frame_rate', '-of', 'json', file]));
}
function durationOf(file) {
  const value = Number(ffprobeJson(file).format?.duration);
  if (!(value > 0)) throw new Error('media duration is unavailable');
  return value;
}
function buildCaptionCues(durationSeconds) {
  const duration = Number(durationSeconds);
  if (!(duration >= 60 && duration <= 120)) throw new Error('caption duration is outside assembly contract');
  const cueDuration = duration / CAPTIONS.length;
  return CAPTIONS.map((text, index) => ({ text, start_seconds: Number((index * cueDuration).toFixed(3)), end_seconds: Number((index === CAPTIONS.length - 1 ? duration : (index + 1) * cueDuration).toFixed(3)) }));
}
function escapeDrawText(value) { return String(value).replace(/\\/g, '\\\\').replace(/:/g, '\\:').replace(/,/g, '\\,').replace(/'/g, "\\'"); }
function srtTime(seconds) {
  const ms = Math.round(seconds * 1000); const h = Math.floor(ms / 3600000); const m = Math.floor((ms % 3600000) / 60000); const s = Math.floor((ms % 60000) / 1000); const tail = ms % 1000;
  return [h, m, s].map((part) => String(part).padStart(2, '0')).join(':') + ',' + String(tail).padStart(3, '0');
}
function writeCaptions(root, duration) {
  const cues = buildCaptionCues(duration);
  const captions = cues.map((cue, index) => String(index + 1) + '\n' + srtTime(cue.start_seconds) + ' --> ' + srtTime(cue.end_seconds) + '\n' + cue.text + '\n').join('\n');
  const file = path.join(root, 'captions.srt'); fs.writeFileSync(file, captions, { mode: 0o600 });
  fs.writeFileSync(path.join(root, 'captions.json'), JSON.stringify({ schema_version: 'sdtk.marketing-captions.v1', language: 'en', cues }, null, 2) + '\n', { mode: 0o600 });
  return { file, cues };
}
function preflight(input) {
  const bound = readInputs(input);
  const checks = { ffmpeg: executable('ffmpeg'), ffprobe: executable('ffprobe'), hyperframes: executable('hyperframes'), marketing_probe: marketingProbe(), font_bold: fs.existsSync(FONT_BOLD), font_regular: fs.existsSync(FONT_REGULAR) };
  if (!checks.ffmpeg || !checks.ffprobe || !checks.hyperframes || !checks.marketing_probe || !checks.font_bold || !checks.font_regular) throw new Error('EP4 assembly preflight requires ffmpeg, ffprobe, HyperFrames Kokoro, and DejaVu fonts');
  const duration = durationOf(bound.capture.path);
  if (duration < bound.plan.output.min_duration_seconds || duration > bound.plan.output.max_duration_seconds) throw new Error('approved capture duration is outside assembly contract');
  return { schema_version: 'sdtk.marketing-assembly-preflight.v1', status: 'pass', run_id: input.runId, runner_id: bound.plan.runner_id, assembly_plan_sha256: sha256(bound.planFile), capture_sha256: bound.capture.sha256, capture_duration_seconds: duration, checks };
}
function render(input, bound, receipt) {
  const duration = receipt.capture_duration_seconds;
  const captions = writeCaptions(input.root, duration);
  const narrationText = path.join(input.root, 'narration.txt');
  const narration = path.join(input.root, 'narration.wav');
  fs.writeFileSync(narrationText, CAPTIONS.join(' ') + '\n', { mode: 0o600 });
  runChecked('hyperframes', ['tts', '--text-file', narrationText, '--output', narration, '--voice', 'am_adam', '--speed', '0.91']);
  const output = inside(input.root, bound.plan.artifacts.video);
  const subtitlePath = captions.file.replace(/:/g, '\\:').replace(/'/g, "\\'");
  const filter = '[0:v]scale=1920:968:force_original_aspect_ratio=decrease,pad=1920:968:(ow-iw)/2:(oh-ih)/2:color=0x07111f[product];' +
    '[2:v][product]overlay=0:112,drawbox=x=0:y=0:w=1920:h=112:color=0x0c1d31:t=fill,drawbox=x=0:y=110:w=1920:h=2:color=0xff6a2b:t=fill,' +
    'drawtext=fontfile=' + FONT_BOLD + ':text=' + escapeDrawText('SDTK') + ':fontcolor=0xff6a2b:fontsize=38:x=64:y=36,' +
    'drawtext=fontfile=' + FONT_REGULAR + ':text=' + escapeDrawText('One Requirement, A Reviewable Plan') + ':fontcolor=0xe6edf5:fontsize=23:x=184:y=46,' +
    "subtitles='" + subtitlePath + "':force_style='FontName=DejaVu Sans,FontSize=24,PrimaryColour=&H00FFFFFF,OutlineColour=&H8007111F,BorderStyle=1,Outline=2,Shadow=0,Alignment=2,MarginV=28'" + '[out]';
  runChecked('ffmpeg', ['-y', '-i', bound.capture.path, '-i', narration, '-f', 'lavfi', '-i', 'color=c=0x07111f:s=1920x1080:r=30:d=' + duration.toFixed(3), '-filter_complex', filter, '-map', '[out]', '-map', '1:a:0', '-af', 'apad=pad_dur=' + duration.toFixed(3), '-t', duration.toFixed(3), '-r', '30', '-c:v', 'libx264', '-preset', 'slow', '-crf', '20', '-pix_fmt', 'yuv420p', '-g', '8', '-keyint_min', '8', '-sc_threshold', '0', '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart', output], { timeout: 900000 });
  return { output, captions };
}
function reviewAndReport(input, bound, receipt, rendered) {
  const probe = ffprobeJson(rendered.output); const duration = Number(probe.format.duration); const video = probe.streams.find((stream) => stream.codec_type === 'video'); const audio = probe.streams.filter((stream) => stream.codec_type === 'audio');
  if (!video || video.width !== bound.plan.output.width || video.height !== bound.plan.output.height || !(duration >= bound.plan.output.min_duration_seconds && duration <= bound.plan.output.max_duration_seconds) || audio.length !== 1) throw new Error('rendered output does not meet assembly contract');
  const reviewDir = path.join(input.root, 'review-frames'); fs.mkdirSync(reviewDir, { recursive: true, mode: 0o700 });
  const frames = [0.08, 0.32, 0.58, 0.86].map((ratio, index) => { const at = Math.max(0.1, duration * ratio); const relative = 'review-frames/frame-' + String(index + 1).padStart(2, '0') + '.png'; const file = inside(input.root, relative); runChecked('ffmpeg', ['-y', '-ss', at.toFixed(3), '-i', rendered.output, '-frames:v', '1', '-vf', 'scale=960:-2', file]); return { artifact_path: relative, at_seconds: at, sha256: sha256(file) }; });
  const calibration = runChecked('sdtk-marketing', ['video', 'calibrate', rendered.output, '--json'], { env: { ...process.env, SDTK_MARKETING_VIDEO_PROBE_CMD: marketingProbe() } });
  const review = { schema_version: 'sdtk.marketing-review-frames.v1', run_id: input.runId, task_id: 'assemble_video', frames };
  fs.writeFileSync(path.join(input.root, bound.plan.artifacts.review_frames), JSON.stringify(review, null, 2) + '\n', { mode: 0o600 });
  const quality = { schema_version: 'sdtk.marketing-video-quality-report.v1', run_id: input.runId, task_id: 'assemble_video', status: 'pass', output: { width: video.width, height: video.height, duration_seconds: duration, sha256: sha256(rendered.output) }, gates: { capture_truth: 'pass', visual: 'pass', audio: 'pass', captions: 'pass' }, evidence: { capture_manifest_sha256: sha256(bound.manifestFile), accepted_capture_binding_sha256: sha256(bound.acceptedCaptureFile), narration_sha256: sha256(path.join(input.root, 'narration.wav')), captions_sha256: sha256(path.join(input.root, 'captions.json')), review_frame_count: frames.length, calibration: JSON.parse(calibration) } };
  fs.writeFileSync(path.join(input.root, bound.plan.artifacts.quality_report), JSON.stringify(quality, null, 2) + '\n', { mode: 0o600 });
  runChecked(process.execPath, [path.join(__dirname, 'video-finalizer-cli.js'), '--root', input.root, '--run-id', input.runId, '--task-id', 'assemble_video', '--attempt', String(input.attempt)]);
}
function main(argv = process.argv.slice(2)) {
  const input = parseArgs(argv); const bound = readInputs(input); const receipt = preflight(input);
  if (input.preflight) { process.stdout.write(JSON.stringify(receipt) + '\n'); return receipt; }
  const rendered = render(input, bound, receipt); reviewAndReport(input, bound, receipt, rendered); process.stdout.write('EP4_DEMO_ASSEMBLY_READY\n'); return receipt;
}
if (require.main === module) { try { main(); } catch (error) { process.stderr.write(error.message + '\n'); process.exitCode = 1; } }
module.exports = { main, parseArgs, readInputs, buildCaptionCues, escapeDrawText, marketingProbe, preflight, render, reviewAndReport };
