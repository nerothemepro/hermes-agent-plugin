'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  extractGithubRepos,
  normalizeGithubRepoUrl,
  slugify,
  writeFacebookCapture,
} = require('../src/facebookCaptureToWikiInbox');

describe('facebook capture helpers', () => {
  it('normalizes GitHub repo URLs', () => {
    assert.equal(
      normalizeGithubRepoUrl('https://github.com/NVIDIA/NeMo?utm_source=facebook'),
      'https://github.com/NVIDIA/NeMo',
    );
    assert.equal(
      normalizeGithubRepoUrl('https://github.com/browser-use/browser-use/blob/main/README.md'),
      'https://github.com/browser-use/browser-use',
    );
    assert.equal(normalizeGithubRepoUrl('https://example.com/nope'), null);
  });

  it('extracts GitHub repos from links and post text', () => {
    const repos = extractGithubRepos({
      links: ['https://github.com/browser-use/browser-use?x=1'],
      post_text: 'Also see https://github.com/microsoft/autogen. Thanks.',
    });
    assert.deepEqual(repos, [
      'https://github.com/browser-use/browser-use',
      'https://github.com/microsoft/autogen',
    ]);
  });

  it('slugifies readable text', () => {
    assert.equal(slugify('KTX context layer for AI agents'), 'ktx-context-layer-for-ai-agents');
  });
});

describe('writeFacebookCapture', () => {
  it('writes a raw markdown capture under raw/inbox', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wiki-capture-'));
    const result = writeFacebookCapture({
      source_url: 'https://www.facebook.com/groups/aieverydayvn/permalink/1312873573587474/',
      captured_at: '2026-06-24T03:30:00.000Z',
      title: 'AI Everyday | ktx context layer | Facebook',
      heading: 'AI Everyday',
      group: 'AI Everyday',
      post_text: 'ktx helps agents use data warehouse context. Repo: https://github.com/kartaca/ktx',
      links: ['https://github.com/kartaca/ktx'],
      notes: 'Candidate concept: context layer',
    }, { wikiRoot: root });

    assert.equal(result.status, 'completed');
    assert.equal(result.github_repos[0], 'https://github.com/kartaca/ktx');
    assert.ok(result.raw_path.startsWith(path.join(root, 'raw', 'inbox')));
    assert.ok(fs.existsSync(result.raw_path));

    const md = fs.readFileSync(result.raw_path, 'utf-8');
    assert.match(md, /source_type: facebook_post/);
    assert.match(md, /github_repos:/);
    assert.match(md, /https:\/\/github.com\/kartaca\/ktx/);
    assert.match(md, /## Extracted post text/);
    assert.match(md, /## Notes for ingest/);
  });

  it('does not overwrite an existing capture filename', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wiki-capture-'));
    const input = {
      source_url: 'https://www.facebook.com/groups/test/permalink/1/',
      captured_at: '2026-06-24T03:30:00.000Z',
      title: 'Repeated title',
      post_text: 'No repo here',
    };
    const one = writeFacebookCapture(input, { wikiRoot: root });
    const two = writeFacebookCapture(input, { wikiRoot: root });
    assert.notEqual(one.raw_path, two.raw_path);
    assert.ok(two.raw_path.endsWith('-2.md'));
  });

  it('requires source_url', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wiki-capture-'));
    assert.throws(() => writeFacebookCapture({ post_text: 'missing url' }, { wikiRoot: root }), /source_url is required/);
  });
});
