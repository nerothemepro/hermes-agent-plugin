'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  classifyItem,
  detectLoginWall,
  processBatch,
} = require('../src/facebookBatchCaptureToWikiInbox');

describe('facebook batch capture classification', () => {
  it('detects Facebook login walls', () => {
    assert.equal(detectLoginWall({
      title: 'Facebook Login Required',
      post_text: 'Log in to Facebook to start sharing and connecting.',
    }), true);
    assert.equal(classifyItem({
      source_url: 'https://www.facebook.com/reel/1',
      status: 'captured',
      title: 'Facebook Login Required',
      post_text: 'Log in to Facebook to start sharing and connecting.',
    }).reason, 'login_required');
  });

  it('rejects empty completed captures', () => {
    const result = classifyItem({
      source_url: 'https://www.facebook.com/groups/x/permalink/y',
      status: 'completed',
      title: 'Some page',
    });
    assert.equal(result.action, 'failed');
    assert.equal(result.reason, 'empty_capture');
  });
});

describe('processBatch', () => {
  it('writes captured items and reports blocked links without raw files', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wiki-batch-capture-'));
    const result = processBatch({
      items: [
        {
          source_url: 'https://www.facebook.com/groups/aieverydayvn/permalink/1/',
          status: 'captured',
          captured_at: '2026-06-24T08:00:00.000Z',
          title: 'AI Everyday post',
          post_text: 'Useful repo in comments: https://github.com/browser-use/browser-use',
          links: ['https://github.com/browser-use/browser-use'],
        },
        {
          source_url: 'https://www.facebook.com/reel/2',
          status: 'login_required',
          reason: 'Facebook login wall',
        },
      ],
    }, { wikiRoot: root });

    assert.equal(result.status, 'completed');
    assert.equal(result.total_count, 2);
    assert.equal(result.completed_count, 1);
    assert.equal(result.failed_count, 1);
    assert.equal(result.completed[0].github_repos[0], 'https://github.com/browser-use/browser-use');
    assert.ok(fs.existsSync(result.completed[0].raw_path));
    assert.equal(result.failed[0].reason, 'login_required');

    const files = fs.readdirSync(path.join(root, 'raw', 'inbox'));
    assert.equal(files.length, 1);
  });

  it('returns blocked when nothing is captured', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wiki-batch-capture-'));
    const result = processBatch({
      items: [
        {
          source_url: 'https://www.facebook.com/story.php?story_fbid=1',
          status: 'blocked',
          reason: 'login_required',
        },
      ],
    }, { wikiRoot: root });

    assert.equal(result.status, 'blocked');
    assert.equal(result.completed_count, 0);
    assert.equal(result.failed_count, 1);
    assert.match(result.errors[0], /No Facebook link/);
  });
});
