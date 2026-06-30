'use strict';

const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');
const {
  DEFAULT_WIKI_ROOT,
  normalizeGithubRepoUrl,
  slugify,
} = require('./facebookCaptureToWikiInbox');

const DEFAULT_TOPIC_SEEDS = [
  'ai-agents',
  'multi-agent',
  'rag',
  'knowledge-base',
  'second-brain',
  'llm-framework',
];

const DEFAULT_KEYWORD_QUERIES = [
  'AI agent framework',
  'multi-agent framework',
  'advanced RAG workflow',
  'AI knowledge base',
  'AI second brain',
];

const DEFAULT_REPORT_ROOTS = {
  maintenanceDir: path.join(DEFAULT_WIKI_ROOT, 'wiki', 'maintenance'),
  reportsDir: path.join(DEFAULT_WIKI_ROOT, 'workspace', 'reports'),
  rawInboxDir: path.join(DEFAULT_WIKI_ROOT, 'raw', 'inbox'),
};

const DOMAIN_RULES = [
  {
    key: 'ai_agent_framework',
    label: 'AI agent framework',
    topics: ['agent', 'agents', 'ai-agents', 'multi-agent', 'llm-framework'],
    keywords: ['agent framework', 'ai agent', 'coding agent', 'assistant agent'],
  },
  {
    key: 'multi_agent',
    label: 'Multi-agent system',
    topics: ['multi-agent', 'agent', 'agents'],
    keywords: ['multi-agent', 'multi agent', 'agent orchestration', 'agent team'],
  },
  {
    key: 'advanced_rag',
    label: 'Advanced RAG workflow',
    topics: ['rag', 'retrieval-augmented-generation', 'knowledge-base'],
    keywords: ['advanced rag', 'rag workflow', 'retrieval augmented', 'knowledge graph'],
  },
  {
    key: 'second_brain',
    label: 'Personal knowledge base / second brain with AI',
    topics: ['second-brain', 'knowledge-base', 'personal-knowledge-management'],
    keywords: ['second brain', 'knowledge base', 'personal knowledge', 'pkm'],
  },
];

function nowIso() {
  return new Date().toISOString();
}

function datePart(iso) {
  const m = String(iso || '').match(/^(\d{4}-\d{2}-\d{2})/);
  return m ? m[1] : nowIso().slice(0, 10);
}

function asArray(value) {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}

function unique(values) {
  const seen = new Set();
  const out = [];
  for (const value of values) {
    const normalized = String(value || '').trim();
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    out.push(normalized);
  }
  return out;
}

function ensureInside(parent, child) {
  const p = path.resolve(parent);
  const c = path.resolve(child);
  if (c !== p && !c.startsWith(p + path.sep)) {
    throw new Error(`Unsafe output path outside ${p}: ${c}`);
  }
}

function nextAvailablePath(dir, baseName) {
  let candidate = path.join(dir, baseName);
  if (!fs.existsSync(candidate)) return candidate;
  const ext = path.extname(baseName);
  const stem = baseName.slice(0, -ext.length);
  for (let i = 2; i < 1000; i++) {
    candidate = path.join(dir, `${stem}-${i}${ext}`);
    if (!fs.existsSync(candidate)) return candidate;
  }
  throw new Error(`Could not find available filename for ${baseName}`);
}

function safeJson(value) {
  return JSON.stringify(String(value == null ? '' : value));
}

function requestJson(url, opts = {}) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const mod = parsed.protocol === 'https:' ? https : http;
    const headers = Object.assign(
      {
        'User-Agent': 'HerWiki-GitHub-Discovery/1.0',
        Accept: 'application/vnd.github+json',
      },
      opts.headers || {},
    );
    const req = mod.request(
      {
        method: 'GET',
        hostname: parsed.hostname,
        port: parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
        path: parsed.pathname + parsed.search,
        headers,
      },
      (res) => {
        const chunks = [];
        res.on('data', (chunk) => chunks.push(chunk));
        res.on('end', () => {
          const body = Buffer.concat(chunks).toString('utf-8');
          let data = null;
          try {
            data = body ? JSON.parse(body) : null;
          } catch (err) {
            reject(new Error(`Invalid JSON from ${url}: ${err.message}`));
            return;
          }
          resolve({
            statusCode: res.statusCode,
            headers: res.headers,
            data,
          });
        });
      },
    );
    req.on('error', reject);
    req.setTimeout(opts.timeoutMs || 30000, () => {
      req.destroy(new Error(`Request timed out after ${opts.timeoutMs || 30000}ms`));
    });
    req.end();
  });
}

function buildGithubHeaders(token) {
  const headers = {
    'X-GitHub-Api-Version': '2022-11-28',
  };
  if (token) headers.Authorization = `Bearer ${token}`;
  return headers;
}

function buildSearchQueries(opts = {}) {
  const topicSeeds = unique(opts.topicSeeds && opts.topicSeeds.length ? opts.topicSeeds : DEFAULT_TOPIC_SEEDS);
  const keywordQueries = unique(opts.keywordQueries && opts.keywordQueries.length ? opts.keywordQueries : DEFAULT_KEYWORD_QUERIES);
  const queries = [];

  for (const topic of topicSeeds) {
    queries.push({
      source: 'github_search',
      kind: 'topic',
      label: topic,
      q: `topic:${topic} stars:>=20000 forks:>=2000 archived:false`,
    });
  }
  for (const keyword of keywordQueries) {
    queries.push({
      source: 'github_search',
      kind: 'keyword',
      label: keyword,
      q: `"${keyword}" in:name,description,readme stars:>=20000 forks:>=2000 archived:false`,
    });
  }
  return queries;
}

function normalizeGithubRepo(item, queryMeta) {
  const repoUrl = normalizeGithubRepoUrl(item.html_url || item.clone_url || '');
  const topics = unique(asArray(item.topics).map((topic) => String(topic || '').toLowerCase()));
  return {
    repo_url: repoUrl,
    owner: item.owner && item.owner.login ? item.owner.login : '',
    repo: item.name || '',
    full_name: item.full_name || '',
    title: item.full_name || item.name || '',
    description: item.description || '',
    topics,
    language: item.language || '',
    stars: Number(item.stargazers_count || 0),
    forks: Number(item.forks_count || 0),
    open_issues: Number(item.open_issues_count || 0),
    watchers: Number(item.watchers_count || 0),
    default_branch: item.default_branch || '',
    created_at: item.created_at || '',
    updated_at: item.updated_at || '',
    pushed_at: item.pushed_at || '',
    homepage: item.homepage || '',
    archived: Boolean(item.archived),
    disabled: Boolean(item.disabled),
    license: item.license && item.license.spdx_id ? item.license.spdx_id : '',
    source_queries: [queryMeta.label],
  };
}

async function searchGithubRepositories(opts = {}) {
  const queries = buildSearchQueries(opts);
  const fetchJson = opts.fetchJson || requestJson;
  const token = opts.githubToken || '';
  const perPage = opts.perPage || 20;
  const baseUrl = opts.githubApiBaseUrl || 'https://api.github.com';
  const candidates = new Map();
  const queryDiagnostics = [];
  const warnings = [];
  const failures = [];

  for (const query of queries) {
    const url = `${baseUrl}/search/repositories?q=${encodeURIComponent(query.q)}&sort=stars&order=desc&per_page=${perPage}`;
    try {
      const response = await fetchJson(url, {
        headers: buildGithubHeaders(token),
        timeoutMs: opts.timeoutMs || 30000,
      });

      if (response.statusCode !== 200) {
        const message = response.data && response.data.message ? response.data.message : `HTTP ${response.statusCode}`;
        failures.push(`GitHub search failed for "${query.label}": ${message}`);
        queryDiagnostics.push({
          label: query.label,
          kind: query.kind,
          query: query.q,
          count: 0,
          error: message,
        });
        continue;
      }

      const items = asArray(response.data && response.data.items);
      queryDiagnostics.push({
        label: query.label,
        kind: query.kind,
        query: query.q,
        count: items.length,
      });

      const remaining = response.headers['x-ratelimit-remaining'];
      if (remaining != null && Number(remaining) <= 5) {
        warnings.push(`GitHub API remaining rate limit is low: ${remaining}`);
      }

      for (const item of items) {
        const normalized = normalizeGithubRepo(item, query);
        if (!normalized.repo_url) continue;
        const existing = candidates.get(normalized.repo_url);
        if (!existing) {
          candidates.set(normalized.repo_url, normalized);
        } else {
          existing.source_queries = unique(existing.source_queries.concat(normalized.source_queries));
          existing.topics = unique(existing.topics.concat(normalized.topics));
        }
      }
    } catch (err) {
      failures.push(`GitHub search failed for "${query.label}": ${err.message}`);
      queryDiagnostics.push({
        label: query.label,
        kind: query.kind,
        query: query.q,
        count: 0,
        error: err.message,
      });
    }
  }

  if (!candidates.size && failures.length) {
    throw new Error(failures.join(' | '));
  }
  if (failures.length) {
    warnings.push(...failures);
  }

  return {
    candidates: Array.from(candidates.values()),
    queryDiagnostics,
    warnings,
  };
}

function textBlob(repo) {
  return [
    repo.full_name,
    repo.description,
    repo.language,
    ...asArray(repo.topics),
  ].join('\n').toLowerCase();
}

function classifyDomainRelevance(repo) {
  const haystack = textBlob(repo);
  const matched = [];
  for (const rule of DOMAIN_RULES) {
    const topicHit = rule.topics.some((topic) => haystack.includes(String(topic).toLowerCase()));
    const keywordHit = rule.keywords.some((keyword) => haystack.includes(String(keyword).toLowerCase()));
    if (topicHit || keywordHit) {
      matched.push(rule.label);
    }
  }
  const uniqueMatched = unique(matched);
  const rawScore = Math.min(1, uniqueMatched.length / 2);
  return {
    labels: uniqueMatched,
    score: rawScore,
    passes: uniqueMatched.length > 0,
  };
}

function daysSince(value, now = new Date()) {
  if (!value) return 9999;
  const ts = new Date(value);
  if (Number.isNaN(ts.getTime())) return 9999;
  return Math.max(0, (now.getTime() - ts.getTime()) / 86400000);
}

function computeActivityScore(repo, now = new Date()) {
  const pushedDays = daysSince(repo.pushed_at, now);
  const updatedDays = daysSince(repo.updated_at, now);
  let score = 0;
  if (pushedDays <= 3) score += 0.55;
  else if (pushedDays <= 14) score += 0.35;
  else if (pushedDays <= 30) score += 0.2;

  if (updatedDays <= 3) score += 0.2;
  else if (updatedDays <= 14) score += 0.1;

  if (repo.open_issues > 0) score += 0.05;
  if (repo.default_branch) score += 0.05;
  if (repo.license && repo.license !== 'NOASSERTION') score += 0.05;
  if (repo.homepage) score += 0.05;
  if (repo.language) score += 0.05;

  return Math.min(1, score);
}

function computeCommunityScore(repo) {
  const starsScore = Math.min(1, repo.stars / 100000);
  const forksScore = Math.min(1, repo.forks / 10000);
  return Math.min(1, (starsScore * 0.45) + (forksScore * 0.55));
}

function extractGithubReposFromMarkdown(content) {
  const matches = content.match(/https?:\/\/(?:www\.)?github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+/g) || [];
  return unique(matches.map(normalizeGithubRepoUrl).filter(Boolean));
}

function collectKnownRepos(wikiRoot) {
  const wikiDir = path.join(wikiRoot, 'wiki');
  const known = new Map();
  const excludedTopLevelDirs = new Set(['maintenance', 'queries']);

  function walk(dir, relDir = '') {
    const entries = fs.existsSync(dir) ? fs.readdirSync(dir, { withFileTypes: true }) : [];
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (!relDir && excludedTopLevelDirs.has(entry.name)) continue;
        walk(fullPath, relDir ? path.join(relDir, entry.name) : entry.name);
        continue;
      }
      if (!entry.isFile() || !entry.name.endsWith('.md')) continue;
      const relPath = path.relative(wikiRoot, fullPath);
      const content = fs.readFileSync(fullPath, 'utf-8');
      const repos = extractGithubReposFromMarkdown(content);
      for (const repoUrl of repos) {
        if (!known.has(repoUrl)) known.set(repoUrl, []);
        known.get(repoUrl).push(relPath);
      }
    }
  }

  walk(wikiDir);
  return known;
}

function computeNovelty(repoUrl, knownRepos) {
  const paths = knownRepos.get(repoUrl) || [];
  return {
    known_paths: paths,
    already_known: paths.length > 0,
    score: paths.length > 0 ? 0 : 1,
  };
}

function applyHardFilters(repo, relevance) {
  const reasons = [];
  if (repo.stars < 20000) reasons.push('stars_below_threshold');
  if (repo.forks <= 2000) reasons.push('forks_below_threshold');
  if (!relevance.passes) reasons.push('domain_relevance_failed');
  if (repo.archived) reasons.push('archived');
  if (repo.disabled) reasons.push('disabled');
  return reasons;
}

function computeRankedCandidates(candidates, opts = {}) {
  const now = opts.now || new Date();
  const knownRepos = opts.knownRepos || new Map();
  const ossMomentum = opts.ossMomentum || {};
  const degradedWarnings = [];
  const selected = [];
  const rejected = [];
  const hasOssInsight = Boolean(opts.hasOssInsight);

  if (!hasOssInsight) {
    degradedWarnings.push('OSS Insight signal unavailable; using GitHub-only scoring.');
  }

  for (const repo of candidates) {
    const relevance = classifyDomainRelevance(repo);
    const novelty = computeNovelty(repo.repo_url, knownRepos);
    const filterReasons = applyHardFilters(repo, relevance);
    const momentum = ossMomentum[repo.repo_url] || { score24h: 0, score7d: 0, window: 'none' };
    const activityScore = computeActivityScore(repo, now);
    const communityScore = computeCommunityScore(repo);
    const momentumScore = momentum.score24h > 0 ? momentum.score24h : momentum.score7d;
    const score =
      (momentumScore * 0.35) +
      (relevance.score * 0.25) +
      (activityScore * 0.20) +
      (communityScore * 0.10) +
      (novelty.score * 0.10);

    const summary = {
      ...repo,
      relevance_labels: relevance.labels,
      filter_reasons: filterReasons,
      novelty,
      score_breakdown: {
        momentum: Number(momentumScore.toFixed(4)),
        domain_relevance: Number(relevance.score.toFixed(4)),
        maintenance_activity: Number(activityScore.toFixed(4)),
        community_scale: Number(communityScore.toFixed(4)),
        wiki_novelty: Number(novelty.score.toFixed(4)),
      },
      score_total: Number(score.toFixed(4)),
      momentum_window: momentum.window,
    };

    if (filterReasons.length > 0) {
      rejected.push(summary);
      continue;
    }
    selected.push(summary);
  }

  selected.sort((a, b) => b.score_total - a.score_total || b.stars - a.stars || a.full_name.localeCompare(b.full_name));
  rejected.sort((a, b) => b.stars - a.stars || a.full_name.localeCompare(b.full_name));

  return {
    selected,
    rejected,
    degradedWarnings,
  };
}

function buildMarkdownReport(result) {
  const lines = [];
  lines.push('# GitHub Trending Discovery Report');
  lines.push('');
  lines.push(`- Generated at: ${result.generated_at}`);
  lines.push(`- Status: ${result.status}`);
  lines.push(`- Timezone: ${result.operator_timezone}`);
  lines.push(`- Candidate count: ${result.summary.candidate_count}`);
  lines.push(`- Selected count: ${result.summary.selected_count}`);
  lines.push(`- Rejected count: ${result.summary.rejected_count}`);
  lines.push('');

  if (result.warnings.length) {
    lines.push('## Warnings');
    lines.push('');
    for (const warning of result.warnings) lines.push(`- ${warning}`);
    lines.push('');
  }

  lines.push('## Queries');
  lines.push('');
  for (const query of result.query_diagnostics) {
    lines.push(`- ${query.label} (${query.kind}): ${query.count} result(s)`);
  }
  lines.push('');

  lines.push('## Top 5');
  lines.push('');
  if (!result.top_recommendations.length) {
    lines.push('_No repositories passed all hard filters in this run._');
    lines.push('');
  } else {
    lines.push('| Rank | Repo | Score | Stars | Forks | Relevance | Already in wiki | Recommendation |');
    lines.push('| --- | --- | --- | --- | --- | --- | --- | --- |');
    result.top_recommendations.forEach((repo, index) => {
      const recommendation = repo.novelty.already_known ? 'monitor' : 'review_for_ingest';
      lines.push(`| ${index + 1} | ${repo.full_name} | ${repo.score_total} | ${repo.stars} | ${repo.forks} | ${repo.relevance_labels.join(', ') || 'n/a'} | ${repo.novelty.already_known ? 'yes' : 'no'} | ${recommendation} |`);
    });
    lines.push('');
  }

  lines.push('## Notable rejects');
  lines.push('');
  if (!result.notable_rejects.length) {
    lines.push('_No notable rejects._');
    lines.push('');
  } else {
    for (const repo of result.notable_rejects) {
      lines.push(`- ${repo.full_name}: ${repo.filter_reasons.join(', ')}`);
    }
    lines.push('');
  }

  lines.push('## Next actions');
  lines.push('');
  if (!result.top_recommendations.length) {
    lines.push('- No manual ingest action recommended today.');
  } else {
    for (const repo of result.top_recommendations) {
      if (repo.novelty.already_known) {
        lines.push(`- ${repo.full_name}: already represented in wiki; monitor unless momentum increases further.`);
      } else {
        lines.push(`- ${repo.full_name}: eligible for manual HerWiki ingest review.`);
      }
    }
  }
  lines.push('');

  return lines.join('\n');
}

function buildRawBatchMarkdown(result) {
  const lines = [];
  lines.push('---');
  lines.push('source_type: github_trending_batch');
  lines.push(`captured_at: ${safeJson(result.generated_at)}`);
  lines.push(`title: ${safeJson(`GitHub trending discovery batch ${datePart(result.generated_at)}`)}`);
  lines.push('github_repos:');
  for (const repo of result.top_recommendations) {
    lines.push(`  - ${safeJson(repo.repo_url)}`);
  }
  lines.push('status: review_only');
  lines.push('---');
  lines.push('');
  lines.push('# GitHub trending discovery batch');
  lines.push('');
  lines.push('This file is review material only. It was generated by the HerWiki GitHub discovery workflow and must not be treated as auto-ingested wiki content.');
  lines.push('');
  for (const repo of result.top_recommendations) {
    lines.push(`## ${repo.full_name}`);
    lines.push('');
    lines.push(`- Repo: ${repo.repo_url}`);
    lines.push(`- Stars: ${repo.stars}`);
    lines.push(`- Forks: ${repo.forks}`);
    lines.push(`- Score: ${repo.score_total}`);
    lines.push(`- Relevance: ${repo.relevance_labels.join(', ') || 'n/a'}`);
    lines.push(`- Already in wiki: ${repo.novelty.already_known ? 'yes' : 'no'}`);
    lines.push(`- Description: ${repo.description || 'not captured'}`);
    lines.push('');
  }
  return lines.join('\n');
}

function writeOutputs(result, opts = {}) {
  const wikiRoot = path.resolve(opts.wikiRoot || DEFAULT_WIKI_ROOT);
  const maintenanceDir = path.resolve(opts.maintenanceDir || path.join(wikiRoot, 'wiki', 'maintenance'));
  const reportsDir = path.resolve(opts.reportsDir || path.join(wikiRoot, 'workspace', 'reports'));
  const rawInboxDir = path.resolve(opts.rawInboxDir || path.join(wikiRoot, 'raw', 'inbox'));

  ensureInside(wikiRoot, maintenanceDir);
  ensureInside(wikiRoot, reportsDir);
  ensureInside(wikiRoot, rawInboxDir);

  fs.mkdirSync(maintenanceDir, { recursive: true });
  fs.mkdirSync(reportsDir, { recursive: true });
  fs.mkdirSync(rawInboxDir, { recursive: true });

  const stamp = datePart(result.generated_at);
  const markdownPath = nextAvailablePath(maintenanceDir, `github-trending-report-${stamp}.md`);
  const jsonPath = nextAvailablePath(reportsDir, `github-trending-report-${stamp}.json`);
  fs.writeFileSync(markdownPath, buildMarkdownReport(result), 'utf-8');
  fs.writeFileSync(jsonPath, JSON.stringify(result, null, 2) + '\n', 'utf-8');

  let rawBatchPath = null;
  const reviewableRepos = result.top_recommendations.filter((repo) => !repo.novelty.already_known);
  if (reviewableRepos.length > 0) {
    rawBatchPath = nextAvailablePath(rawInboxDir, `${stamp}-github-trending-batch.md`);
    const batchResult = { ...result, top_recommendations: reviewableRepos };
    fs.writeFileSync(rawBatchPath, buildRawBatchMarkdown(batchResult), 'utf-8');
  }

  return {
    markdown_report_path: markdownPath,
    json_report_path: jsonPath,
    raw_batch_path: rawBatchPath,
  };
}

async function collectOptionalOssMomentum(opts = {}) {
  try {
    if (opts.ossMomentumFile) {
      const filePath = path.resolve(opts.ossMomentumFile);
      const payload = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
      return {
        hasOssInsight: true,
        momentumByRepo: payload && payload.momentumByRepo ? payload.momentumByRepo : {},
        warnings: [],
      };
    }
    if (opts.ossMomentumUrl) {
      const fetchJson = opts.fetchJson || requestJson;
      const response = await fetchJson(opts.ossMomentumUrl, {
        headers: opts.ossMomentumHeaders || {},
        timeoutMs: opts.timeoutMs || 30000,
      });
      if (response.statusCode !== 200) {
        throw new Error(`OSS Insight endpoint returned HTTP ${response.statusCode}`);
      }
      return {
        hasOssInsight: true,
        momentumByRepo: response.data && response.data.momentumByRepo ? response.data.momentumByRepo : {},
        warnings: [],
      };
    }
    if (!opts.ossMomentumFetcher) {
      return {
        hasOssInsight: false,
        momentumByRepo: {},
        warnings: ['OSS Insight provider not configured.'],
      };
    }
    const payload = await opts.ossMomentumFetcher(opts);
    return {
      hasOssInsight: true,
      momentumByRepo: payload && payload.momentumByRepo ? payload.momentumByRepo : {},
      warnings: [],
    };
  } catch (err) {
    return {
      hasOssInsight: false,
      momentumByRepo: {},
      warnings: [`OSS Insight unavailable: ${err.message}`],
    };
  }
}

function summarizeForStdout(result) {
  return {
    status: result.status,
    generated_at: result.generated_at,
    markdown_report_path: result.artifacts.markdown_report_path,
    json_report_path: result.artifacts.json_report_path,
    raw_batch_path: result.artifacts.raw_batch_path,
    candidate_count: result.summary.candidate_count,
    selected_count: result.summary.selected_count,
    top_recommendations: result.top_recommendations.map((repo) => ({
      full_name: repo.full_name,
      repo_url: repo.repo_url,
      score_total: repo.score_total,
      stars: repo.stars,
      forks: repo.forks,
      already_known: repo.novelty.already_known,
    })),
    warnings: result.warnings,
    errors: result.errors,
  };
}

async function generateGithubDiscoveryReport(opts = {}) {
  const wikiRoot = path.resolve(opts.wikiRoot || DEFAULT_WIKI_ROOT);
  const generatedAt = opts.generatedAt || nowIso();
  const errors = [];
  const warnings = [];

  const searchResult = await searchGithubRepositories({
    githubToken: opts.githubToken || process.env.GITHUB_TOKEN || '',
    topicSeeds: opts.topicSeeds,
    keywordQueries: opts.keywordQueries,
    perPage: opts.perPage || 20,
    timeoutMs: opts.timeoutMs || 30000,
    fetchJson: opts.fetchJson,
    githubApiBaseUrl: opts.githubApiBaseUrl,
  });
  warnings.push(...searchResult.warnings);

  const knownRepos = opts.knownRepos || collectKnownRepos(wikiRoot);
  const oss = await collectOptionalOssMomentum(opts);
  warnings.push(...oss.warnings);

  const ranked = computeRankedCandidates(searchResult.candidates, {
    now: new Date(generatedAt),
    knownRepos,
    ossMomentum: oss.momentumByRepo,
    hasOssInsight: oss.hasOssInsight,
  });
  warnings.push(...ranked.degradedWarnings);

  const topRecommendations = ranked.selected.slice(0, 5);
  const result = {
    tool: 'herwiki-github-discovery-report',
    status: warnings.length ? 'degraded' : 'completed',
    generated_at: generatedAt,
    operator_timezone: opts.operatorTimezone || 'Asia/Tokyo',
    topic_seeds: unique(opts.topicSeeds && opts.topicSeeds.length ? opts.topicSeeds : DEFAULT_TOPIC_SEEDS),
    keyword_queries: unique(opts.keywordQueries && opts.keywordQueries.length ? opts.keywordQueries : DEFAULT_KEYWORD_QUERIES),
    query_diagnostics: searchResult.queryDiagnostics,
    source_health: {
      github_api_authenticated: Boolean(opts.githubToken || process.env.GITHUB_TOKEN),
      oss_insight_available: oss.hasOssInsight,
    },
    summary: {
      candidate_count: searchResult.candidates.length,
      selected_count: ranked.selected.length,
      rejected_count: ranked.rejected.length,
    },
    top_recommendations: topRecommendations,
    notable_rejects: ranked.rejected.slice(0, 10),
    warnings,
    errors,
    artifacts: {
      markdown_report_path: null,
      json_report_path: null,
      raw_batch_path: null,
    },
  };

  result.artifacts = writeOutputs(result, {
    wikiRoot,
    maintenanceDir: opts.maintenanceDir,
    reportsDir: opts.reportsDir,
    rawInboxDir: opts.rawInboxDir,
  });
  return result;
}

module.exports = {
  DEFAULT_TOPIC_SEEDS,
  DEFAULT_KEYWORD_QUERIES,
  DEFAULT_REPORT_ROOTS,
  DOMAIN_RULES,
  applyHardFilters,
  buildMarkdownReport,
  buildRawBatchMarkdown,
  buildSearchQueries,
  classifyDomainRelevance,
  collectKnownRepos,
  collectOptionalOssMomentum,
  computeActivityScore,
  computeCommunityScore,
  computeNovelty,
  computeRankedCandidates,
  generateGithubDiscoveryReport,
  normalizeGithubRepo,
  searchGithubRepositories,
  summarizeForStdout,
  writeOutputs,
};
