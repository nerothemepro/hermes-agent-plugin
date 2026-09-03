'use strict';

const HASH = '[a-f0-9]{64}';
const RUN = 'run_[a-z0-9]+_[a-z0-9]+';
const REASON = '[A-Z][A-Z0-9_]{2,48}';

function parseTelegramCommand(value) {
  const text = String(value || '').trim();
  let match;
  if ((match = text.match(/^\/marketing-research prepare (EP[1-9][0-9]*)$/))) return { action: 'prepare', workflow: 'research_and_story', episode_id: match[1] };
  if ((match = text.match(new RegExp('^/marketing-video prepare (' + HASH + ')$')))) return { action: 'prepare', workflow: 'video_production', brief_sha256: match[1] };
  if ((match = text.match(new RegExp('^/marketing-social prepare (' + HASH + ') (' + HASH + ')$')))) return { action: 'prepare', workflow: 'social_distribution', brief_sha256: match[1], video_sha256: match[2] };
  if ((match = text.match(new RegExp('^APPROVE RESEARCH KICKOFF (' + RUN + ') (' + HASH + ')$')))) return { action: 'kickoff', workflow: 'research_and_story', run_id: match[1], packet_sha256: match[2] };
  if ((match = text.match(new RegExp('^APPROVE VIDEO KICKOFF (' + RUN + ') (' + HASH + ')$')))) return { action: 'kickoff', workflow: 'video_production', run_id: match[1], packet_sha256: match[2] };
  if ((match = text.match(new RegExp('^APPROVE SOCIAL KICKOFF (' + RUN + ') (' + HASH + ')$')))) return { action: 'kickoff', workflow: 'social_distribution', run_id: match[1], packet_sha256: match[2] };
  const approvals = [
    ['STORY LOCK', 'research_and_story', 'story_lock'], ['ASSET LOCK', 'video_production', 'asset_lock'], ['PICTURE LOCK', 'video_production', 'picture_lock'],
    ['YOUTUBE POST', 'social_distribution', 'youtube_publish'], ['FACEBOOK POST', 'social_distribution', 'facebook_publish'], ['X POST', 'social_distribution', 'x_publish'],
  ];
  for (const [label, workflow, gateId] of approvals) {
    match = text.match(new RegExp('^APPROVE ' + label + ' (' + RUN + ') (' + HASH + ')$'));
    if (match) return { action: 'approve_gate', workflow, run_id: match[1], gate_id: gateId, packet_sha256: match[2] };
    match = text.match(new RegExp('^REJECT ' + label + ' (' + RUN + ') (' + REASON + ')$'));
    if (match) return { action: 'reject_gate', workflow, run_id: match[1], gate_id: gateId, reason_code: match[2] };
  }
  if ((match = text.match(new RegExp('^/marketing-(research|video|social) status (' + RUN + ')$')))) {
    return { action: 'status', workflow: { research: 'research_and_story', video: 'video_production', social: 'social_distribution' }[match[1]], run_id: match[2] };
  }
  if ((match = text.match(new RegExp('^CANCEL (RESEARCH|VIDEO|SOCIAL) RUN (' + RUN + ')$')))) {
    return { action: 'cancel', workflow: { RESEARCH: 'research_and_story', VIDEO: 'video_production', SOCIAL: 'social_distribution' }[match[1]], run_id: match[2] };
  }
  throw new Error('exact Telegram marketing command required');
}

module.exports = { parseTelegramCommand };
