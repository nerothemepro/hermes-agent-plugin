#!/usr/bin/env node
'use strict';

const fs = require('fs');
const { Readable } = require('stream');

function value(flag) {
  const index = process.argv.indexOf(flag);
  return index === -1 ? '' : process.argv[index + 1] || '';
}

function fail(code, message) {
  process.stderr.write(`youtube upload: ${message}\n`);
  process.exit(code);
}

async function responseJson(response, context) {
  if (!response.ok) fail(1, `${context}_http_${response.status}`);
  try { return await response.json(); } catch { fail(1, `${context}_invalid_json`); }
}

async function main() {
  const file = value('--file');
  const title = value('--title');
  const descriptionFile = value('--desc');
  const tags = value('--tags').split(',').map((tag) => tag.trim()).filter(Boolean);
  const privacy = value('--privacy');
  const clientId = process.env.YOUTUBE_CLIENT_ID || '';
  const clientSecret = process.env.YOUTUBE_CLIENT_SECRET || '';
  const refreshToken = process.env.YOUTUBE_REFRESH_TOKEN || '';
  if (!file || !fs.statSync(file, { throwIfNoEntry: false })?.isFile()) fail(2, 'input video is missing');
  if (!title || !descriptionFile || !fs.statSync(descriptionFile, { throwIfNoEntry: false })?.isFile()) fail(2, 'title or description file is missing');
  if (!clientId || !clientSecret || !refreshToken) fail(2, 'YouTube OAuth prerequisites are unavailable');

  const tokenBody = new URLSearchParams({ client_id: clientId, client_secret: clientSecret, refresh_token: refreshToken, grant_type: 'refresh_token' });
  const token = await responseJson(await fetch('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: tokenBody }), 'oauth');
  if (!token.access_token) fail(1, 'oauth_response_missing_access_token');

  const metadata = { snippet: { title, description: fs.readFileSync(descriptionFile, 'utf8'), tags }, status: { privacyStatus: privacy } };
  const size = fs.statSync(file).size;
  const session = await fetch('https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status', {
    method: 'POST',
    headers: { authorization: `Bearer ${token.access_token}`, 'content-type': 'application/json; charset=UTF-8', 'x-upload-content-length': String(size), 'x-upload-content-type': 'video/mp4' },
    body: JSON.stringify(metadata),
  });
  if (!session.ok) fail(1, `youtube_resumable_start_http_${session.status}`);
  const uploadUrl = session.headers.get('location');
  if (!uploadUrl) fail(1, 'youtube_resumable_start_missing_location');
  const upload = await fetch(uploadUrl, { method: 'PUT', headers: { authorization: `Bearer ${token.access_token}`, 'content-length': String(size), 'content-type': 'video/mp4' }, duplex: 'half', body: Readable.toWeb(fs.createReadStream(file)) });
  const result = await responseJson(upload, 'youtube_upload');
  if (!result.id) fail(1, 'youtube_upload_missing_video_id');
  process.stdout.write(`https://www.youtube.com/watch?v=${result.id}\n`);
}

main().catch(() => fail(1, 'unexpected_failure'));
