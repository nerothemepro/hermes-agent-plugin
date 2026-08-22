#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const launcher = fs.readFileSync(path.join(__dirname, '..', '..', 'control-plane', 'hersocial-marketing-video', 'start-hersocial-marketing-video.sh'), 'utf8');
for (const name of [
  'SDTK_MARKETING_VIDEO_PROVIDER_HYPERFRAMES_DOCTOR_CMD',
  'SDTK_MARKETING_VIDEO_CMD_HYPERFRAMES_PREVIEW',
  'SDTK_MARKETING_VIDEO_CMD_HYPERFRAMES_PREVIEW_STOP',
  'SDTK_MARKETING_VIDEO_CMD_HYPERFRAMES_SNAPSHOT',
  'SDTK_MARKETING_VIDEO_CMD_HYPERFRAMES_CHECK',
  'SDTK_MARKETING_VIDEO_CMD_HYPERFRAMES',
  'SDTK_MARKETING_VIDEO_AGENT_LMSTUDIO_DOCTOR_CMD',
  'SDTK_MARKETING_VIDEO_AGENT_LMSTUDIO_EXECUTE_CMD',
  'SDTK_MARKETING_VIDEO_LOCAL_MODELS',
  'SDTK_MARKETING_VIDEO_LMSTUDIO_STRUCTURED_MODELS',
  'SDTK_MARKETING_RENDER_LEASE_VERIFY_EVIDENCE_CMD',
  'SDTK_MARKETING_RENDER_LEASE_UNLOAD_LLM_CMD',
  'SDTK_MARKETING_RENDER_LEASE_FREE_CACHE_CMD',
  'SDTK_MARKETING_RENDER_LEASE_RENDER_CMD',
  'SDTK_MARKETING_RENDER_LEASE_BANK_OUTPUT_CMD',
]) assert.match(launcher, new RegExp('\\b' + name + '\\b'));
assert.match(launcher, /exec env -i "\$\{env_args\[@\]\}" sdtk-marketing/);
console.log('ok - high-quality video runtime env is explicitly forwarded');
