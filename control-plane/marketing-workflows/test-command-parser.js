'use strict';
const assert = require('assert');
const test = require('node:test');
const { parseTelegramCommand } = require('./command-parser');
const HASH_A = 'a'.repeat(64);
const HASH_B = 'b'.repeat(64);

test('parser accepts only exact three-workflow command grammar', () => {
  assert.deepStrictEqual(parseTelegramCommand('/marketing-research prepare EP4'), { action: 'prepare', workflow: 'research_and_story', episode_id: 'EP4' });
  assert.deepStrictEqual(parseTelegramCommand(`/marketing-video prepare ${HASH_A}`), { action: 'prepare', workflow: 'video_production', brief_sha256: HASH_A });
  assert.deepStrictEqual(parseTelegramCommand(`/marketing-social prepare ${HASH_A} ${HASH_B}`), { action: 'prepare', workflow: 'social_distribution', brief_sha256: HASH_A, video_sha256: HASH_B });
  assert.deepStrictEqual(parseTelegramCommand('APPROVE STORY LOCK run_alpha_123456 ' + HASH_A), { action: 'approve_gate', workflow: 'research_and_story', run_id: 'run_alpha_123456', gate_id: 'story_lock', packet_sha256: HASH_A });
});

test('parser fails closed on partial, extra, or natural-language commands', () => {
  for (const value of ['/marketing-video prepare', `/marketing-video prepare ${HASH_A} extra`, 'please render EP4', 'APPROVE STORY LOCK run_bad aaaa']) {
    assert.throws(() => parseTelegramCommand(value), /exact Telegram marketing command required/);
  }
});

test('parser accepts exact owner rejection grammar with a bounded reason code', () => {
  assert.deepStrictEqual(
    parseTelegramCommand('REJECT STORY LOCK run_alpha_123456 CLAIM_EVIDENCE_MISSING'),
    { action: 'reject_gate', workflow: 'research_and_story', run_id: 'run_alpha_123456', gate_id: 'story_lock', reason_code: 'CLAIM_EVIDENCE_MISSING' },
  );
  assert.throws(() => parseTelegramCommand('REJECT STORY LOCK run_alpha_123456 reason in prose'), /exact Telegram marketing command required/);
});
