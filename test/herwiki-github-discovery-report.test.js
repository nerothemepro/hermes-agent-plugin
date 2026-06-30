'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  DEFAULT_TOPIC_SEEDS,
  applyHardFilters,
  classifyDomainRelevance,
  collectKnownRepos,
  computeNovelty,
  computeRankedCandidates,
  generateGithubDiscoveryReport,
} = require('../src/herwikiGithubDiscoveryReport');

function mkWikiRoot() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'herwiki-github-discovery-'));
  fs.mkdirSync(path.join(root, 'wiki', 'maintenance'), { recursive: true });
  fs.mkdirSync(path.join(root, 'workspace', 'reports'), { recursive: true });
  fs.mkdirSync(path.join(root, 'raw', 'inbox'), { recursive: true });
  fs.mkdirSync(path.join(root, 'wiki', 'sources'), { recursive: true });
  return root;
}

function mockSearchResponse(items) {
  return {
    statusCode: 200,
    headers: { 'x-ratelimit-remaining': '50' },
    data: { items },
  };
}

function buildRepo(overrides = {}) {
  return Object.assign({
    html_url: 'https://github.com/example/agent-stack',
    full_name: 'example/agent-stack',
    name: 'agent-stack',
    description: 'A multi-agent framework for advanced RAG workflows.',
    topics: ['ai-agents', 'multi-agent', 'rag'],
    language: 'TypeScript',
    stargazers_count: 42000,
    forks_count: 5500,
    open_issues_count: 12,
    watchers_count: 42000,
    default_branch: 'main',
    created_at: '2025-01-01T00:00:00Z',
    updated_at: '2026-06-29T00:00:00Z',
    pushed_at: '2026-06-29T00:00:00Z',
    owner: { login: 'example' },
    homepage: 'https://example.com',
    archived: false,
    disabled: false,
    license: { spdx_id: 'MIT' },
  }, overrides);
}

describe('domain relevance and hard filters', () => {
  it('classifies a strongly relevant repo', () => {
    const repo = {
      full_name: 'example/agent-stack',
      description: 'A multi-agent framework for advanced RAG workflows.',
      topics: ['ai-agents', 'multi-agent', 'rag'],
      language: 'TypeScript',
    };
    const relevance = classifyDomainRelevance(repo);
    assert.equal(relevance.passes, true);
    assert.ok(relevance.labels.length >= 2);
  });

  it('rejects a repo with weak domain relevance even if star counts are high', () => {
    const repo = {
      stars: 50000,
      forks: 6000,
      archived: false,
      disabled: false,
      full_name: 'example/non-ai-tool',
      description: 'A CSS reset and frontend utility toolkit.',
      topics: ['css', 'frontend'],
      language: 'CSS',
    };
    const relevance = classifyDomainRelevance(repo);
    const reasons = applyHardFilters(repo, relevance);
    assert.ok(reasons.includes('domain_relevance_failed'));
  });
});

describe('novelty detection', () => {
  it('detects repo URLs already represented in wiki markdown', () => {
    const root = mkWikiRoot();
    const sourcePath = path.join(root, 'wiki', 'sources', '2026-06-30-known-repo.md');
    fs.writeFileSync(sourcePath, '# Known repo\n\n- https://github.com/example/agent-stack\n', 'utf-8');

    const knownRepos = collectKnownRepos(root);
    const novelty = computeNovelty('https://github.com/example/agent-stack', knownRepos);
    assert.equal(novelty.already_known, true);
    assert.equal(novelty.score, 0);
    assert.ok(novelty.known_paths[0].includes('wiki/sources/2026-06-30-known-repo.md'));
  });
});

describe('ranking and degraded mode', () => {
  it('keeps a valid ranking in degraded mode when OSS Insight is unavailable', () => {
    const knownRepos = new Map();
    const { selected, degradedWarnings } = computeRankedCandidates([
      {
        repo_url: 'https://github.com/example/agent-stack',
        full_name: 'example/agent-stack',
        description: 'A multi-agent framework for advanced RAG workflows.',
        topics: ['ai-agents', 'multi-agent', 'rag'],
        language: 'TypeScript',
        stars: 42000,
        forks: 5500,
        open_issues: 12,
        default_branch: 'main',
        homepage: 'https://example.com',
        license: 'MIT',
        archived: false,
        disabled: false,
        updated_at: '2026-06-29T00:00:00Z',
        pushed_at: '2026-06-29T00:00:00Z',
      },
    ], {
      knownRepos,
      hasOssInsight: false,
      ossMomentum: {},
      now: new Date('2026-06-30T00:00:00Z'),
    });

    assert.equal(selected.length, 1);
    assert.ok(degradedWarnings.some((msg) => msg.includes('OSS Insight')));
    assert.equal(selected[0].score_total > 0, true);
  });
});

describe('generateGithubDiscoveryReport', () => {
  it('writes markdown/json reports and suppresses raw batch when repo already exists in wiki', async () => {
    const root = mkWikiRoot();
    fs.writeFileSync(
      path.join(root, 'wiki', 'sources', '2026-06-30-known-repo.md'),
      '# Known repo\n\n- https://github.com/example/agent-stack\n',
      'utf-8',
    );

    const fetchJson = async () => mockSearchResponse([buildRepo()]);
    const result = await generateGithubDiscoveryReport({
      wikiRoot: root,
      generatedAt: '2026-06-30T06:00:00Z',
      topicSeeds: DEFAULT_TOPIC_SEEDS.slice(0, 1),
      keywordQueries: ['AI agent framework'],
      fetchJson,
    });

    assert.equal(result.status, 'degraded');
    assert.equal(result.top_recommendations.length, 1);
    assert.equal(result.top_recommendations[0].novelty.already_known, true);
    assert.ok(fs.existsSync(result.artifacts.markdown_report_path));
    assert.ok(fs.existsSync(result.artifacts.json_report_path));
    assert.equal(result.artifacts.raw_batch_path, null);
  });

  it('writes a raw batch when there is at least one reviewable new repo', async () => {
    const root = mkWikiRoot();
    const fetchJson = async () => mockSearchResponse([
      buildRepo({ html_url: 'https://github.com/example/new-agent-stack', full_name: 'example/new-agent-stack', name: 'new-agent-stack' }),
    ]);

    const result = await generateGithubDiscoveryReport({
      wikiRoot: root,
      generatedAt: '2026-06-30T06:00:00Z',
      topicSeeds: DEFAULT_TOPIC_SEEDS.slice(0, 1),
      keywordQueries: ['AI agent framework'],
      fetchJson,
    });

    assert.equal(result.top_recommendations.length, 1);
    assert.equal(result.top_recommendations[0].novelty.already_known, false);
    assert.ok(result.artifacts.raw_batch_path);
    assert.ok(fs.existsSync(result.artifacts.raw_batch_path));
  });

  it('produces a no-op report when no repo passes filters', async () => {
    const root = mkWikiRoot();
    const fetchJson = async () => mockSearchResponse([
      buildRepo({
        html_url: 'https://github.com/example/css-reset',
        full_name: 'example/css-reset',
        name: 'css-reset',
        description: 'A CSS reset toolkit.',
        topics: ['css', 'frontend'],
        stargazers_count: 50000,
        forks_count: 9000,
      }),
    ]);

    const result = await generateGithubDiscoveryReport({
      wikiRoot: root,
      generatedAt: '2026-06-30T06:00:00Z',
      topicSeeds: DEFAULT_TOPIC_SEEDS.slice(0, 1),
      keywordQueries: ['AI agent framework'],
      fetchJson,
    });

    assert.equal(result.top_recommendations.length, 0);
    assert.ok(fs.existsSync(result.artifacts.markdown_report_path));
    assert.ok(fs.existsSync(result.artifacts.json_report_path));
    assert.equal(result.artifacts.raw_batch_path, null);
  });
});
