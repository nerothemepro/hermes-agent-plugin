#!/usr/bin/env node
'use strict';

const fs = require('fs');

function normalizePermalink(permalink, videoId) {
  const value = permalink || `https://www.facebook.com/${videoId}`;
  return value.startsWith('http') ? value : `https://www.facebook.com${value}`;
}

function value(flag) {
  const index = process.argv.indexOf(flag);
  return index === -1 ? '' : process.argv[index + 1] || '';
}

function fail(code, message) {
  process.stderr.write(`facebook video upload: ${message}\n`);
  process.exit(code);
}

async function json(response, context) {
  if (!response.ok) fail(1, `${context}_http_${response.status}`);
  try { return await response.json(); } catch { fail(1, `${context}_invalid_json`); }
}

async function main() {
  const file = value('--file');
  const title = value('--title');
  const descriptionFile = value('--desc');
  const privacy = value('--privacy');
  const pageId = process.env.FACEBOOK_PAGE_ID || '';
  const token = process.env.FACEBOOK_PAGE_ACCESS_TOKEN || '';
  if (!file || !fs.statSync(file, { throwIfNoEntry: false })?.isFile()) fail(2, 'input video is missing');
  if (!title || !descriptionFile || !fs.statSync(descriptionFile, { throwIfNoEntry: false })?.isFile()) fail(2, 'title or description file is missing');
  if (!pageId || !token) fail(2, 'Facebook Page prerequisites are unavailable');

  const form = new FormData();
  form.set('title', title);
  form.set('description', fs.readFileSync(descriptionFile, 'utf8'));
  form.set('published', privacy === 'published' ? 'true' : 'false');
  form.set('access_token', token);
  form.set('source', new Blob([fs.readFileSync(file)], { type: 'video/mp4' }), file.split('/').pop());
  const created = await json(await fetch(`https://graph.facebook.com/v21.0/${encodeURIComponent(pageId)}/videos`, { method: 'POST', body: form }), 'facebook_upload');
  const videoId = created.id;
  if (!videoId) fail(1, 'facebook_upload_missing_video_id');
  const detail = await fetch(`https://graph.facebook.com/v21.0/${encodeURIComponent(videoId)}?fields=permalink_url&access_token=${encodeURIComponent(token)}`);
  const metadata = await json(detail, 'facebook_permalink');
  process.stdout.write(`${normalizePermalink(metadata.permalink_url, videoId)}\n`);
}

if (require.main === module) main().catch(() => fail(1, 'unexpected_failure'));

module.exports = { normalizePermalink };
