#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const DEFAULT_WIKI_ROOT = '/workspace/sdtk-wiki/ai-agent-second-brain-main';

function nowIso() {
  return new Date().toISOString();
}

function datePart(iso) {
  const m = String(iso || '').match(/^(\d{4}-\d{2}-\d{2})/);
  return m ? m[1] : nowIso().slice(0, 10);
}

function asArray(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value;
  return [value];
}

function unique(values) {
  const seen = new Set();
  const out = [];
  for (const value of values) {
    const s = String(value || '').trim();
    if (!s || seen.has(s)) continue;
    seen.add(s);
    out.push(s);
  }
  return out;
}

function stripTrackingNoise(url) {
  let s = String(url || '').trim();
  s = s.replace(/[)>\],.;]+$/g, '');
  return s;
}

function extractUrls(text) {
  const s = String(text || '');
  const matches = s.match(/https?:\/\/[^\s<>'"`]+/g) || [];
  return matches.map(stripTrackingNoise);
}

function normalizeGithubRepoUrl(url) {
  const raw = stripTrackingNoise(url);
  let parsed;
  try {
    parsed = new URL(raw);
  } catch (_) {
    return null;
  }
  const host = parsed.hostname.toLowerCase();
  if (host !== 'github.com' && host !== 'www.github.com') return null;
  const parts = parsed.pathname.split('/').filter(Boolean);
  if (parts.length < 2) return null;
  const owner = parts[0];
  const repo = parts[1].replace(/\.git$/i, '');
  if (!owner || !repo) return null;
  return `https://github.com/${owner}/${repo}`;
}

function extractGithubRepos(input) {
  const candidates = [];
  candidates.push(...asArray(input.links));
  candidates.push(...asArray(input.extracted_links));
  candidates.push(...extractUrls(input.post_text || input.content || input.text || ''));
  candidates.push(...extractUrls(input.notes || ''));
  return unique(candidates.map(normalizeGithubRepoUrl).filter(Boolean));
}

function slugify(value, fallback = 'facebook-capture') {
  let s = String(value || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-{2,}/g, '-');
  if (!s) s = fallback;
  return s.slice(0, 80).replace(/-+$/g, '') || fallback;
}

function inferSlug(input, githubRepos) {
  if (input.slug) return slugify(input.slug);
  if (githubRepos.length) {
    const parts = new URL(githubRepos[0]).pathname.split('/').filter(Boolean);
    return slugify(`github-${parts[0]}-${parts[1]}`);
  }
  if (input.title) return slugify(input.title);
  if (input.heading) return slugify(input.heading);
  return 'facebook-capture';
}

function yamlQuote(value) {
  return JSON.stringify(String(value == null ? '' : value));
}

function yamlList(values, indent = '') {
  const arr = unique(asArray(values));
  if (!arr.length) return `${indent}[]`;
  return arr.map((v) => `${indent}- ${yamlQuote(v)}`).join('\n');
}

function section(title, body) {
  const content = String(body || '').trim();
  return `## ${title}\n\n${content || '_Not captured._'}\n`;
}

function buildMarkdown(input, opts = {}) {
  const capturedAt = input.captured_at || input.capturedAt || nowIso();
  const sourceUrl = input.source_url || input.url || '';
  const postText = input.post_text || input.content || input.text || '';
  const links = unique([
    ...asArray(input.links),
    ...asArray(input.extracted_links),
    ...extractUrls(postText),
  ]).map(stripTrackingNoise);
  const githubRepos = extractGithubRepos({ ...input, links });
  const browserArtifacts = unique([
    ...asArray(input.browser_artifacts),
    ...asArray(input.debug_artifacts),
    input.screenshot_path,
    input.html_path,
  ].filter(Boolean));

  const title = input.title || input.heading || 'Facebook post capture';
  const group = input.group || input.facebook_group || '';
  const author = input.author || '';

  const fm = [
    '---',
    'source_type: facebook_post',
    `captured_at: ${yamlQuote(capturedAt)}`,
    `source_url: ${yamlQuote(sourceUrl)}`,
    `group: ${yamlQuote(group)}`,
    `author: ${yamlQuote(author)}`,
    `title: ${yamlQuote(title)}`,
    'extracted_links:',
    yamlList(links, '  '),
    'github_repos:',
    yamlList(githubRepos, '  '),
    'status: captured',
    '---',
    '',
  ].join('\n');

  const sourceLines = [
    `- URL: ${sourceUrl || '_not captured_'}`,
    `- Group: ${group || '_not captured_'}`,
    `- Author: ${author || '_not captured_'}`,
    `- Captured at: ${capturedAt}`,
  ];
  if (input.title) sourceLines.push(`- Page title: ${input.title}`);
  if (input.heading) sourceLines.push(`- Main heading: ${input.heading}`);

  const linkLines = [];
  if (githubRepos.length) {
    linkLines.push('### GitHub repositories');
    for (const repo of githubRepos) linkLines.push(`- ${repo}`);
    linkLines.push('');
  }
  if (links.length) {
    linkLines.push('### All extracted links');
    for (const link of links) linkLines.push(`- ${link}`);
  }

  const ingestNotes = [
    input.main_topic ? `- Main topic: ${input.main_topic}` : null,
    input.candidate_entities ? `- Candidate entities: ${asArray(input.candidate_entities).join(', ')}` : null,
    input.candidate_concepts ? `- Candidate concepts: ${asArray(input.candidate_concepts).join(', ')}` : null,
    input.open_questions ? `- Open questions: ${asArray(input.open_questions).join('; ')}` : null,
    input.notes ? `- Notes: ${input.notes}` : null,
  ].filter(Boolean).join('\n');

  const artifacts = browserArtifacts.length
    ? browserArtifacts.map((a) => `- ${a}`).join('\n')
    : '';

  return {
    markdown: [
      fm,
      `# ${title}`,
      '',
      section('Source', sourceLines.join('\n')),
      section('Extracted post text', postText),
      section('Extracted links', linkLines.join('\n')),
      section('Browser artifacts', artifacts),
      section('Notes for ingest', ingestNotes),
    ].join('\n'),
    githubRepos,
    links,
    capturedAt,
  };
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

function writeFacebookCapture(input, opts = {}) {
  const wikiRoot = path.resolve(opts.wikiRoot || input.wiki_root || process.env.WIKI_ROOT || DEFAULT_WIKI_ROOT);
  const inboxDir = path.resolve(opts.inboxDir || path.join(wikiRoot, 'raw', 'inbox'));
  ensureInside(wikiRoot, inboxDir);
  if (!input.source_url && !input.url) {
    throw new Error('source_url is required');
  }

  const built = buildMarkdown(input, opts);
  const slug = inferSlug(input, built.githubRepos);
  const filename = `${datePart(built.capturedAt)}-facebook-${slug}.md`;
  fs.mkdirSync(inboxDir, { recursive: true });
  const outputPath = nextAvailablePath(inboxDir, filename);
  ensureInside(inboxDir, outputPath);
  fs.writeFileSync(outputPath, built.markdown, 'utf-8');

  return {
    status: 'completed',
    tool: 'facebook-capture-to-wiki-inbox',
    wiki_root: wikiRoot,
    raw_path: outputPath,
    source_url: input.source_url || input.url,
    github_repos: built.githubRepos,
    extracted_links_count: built.links.length,
    captured_at: built.capturedAt,
    next_step: `Ask HerWiki to ingest ${outputPath}`,
    warnings: built.githubRepos.length ? [] : ['No GitHub repository URL detected in provided capture.'],
    errors: [],
  };
}

module.exports = {
  DEFAULT_WIKI_ROOT,
  buildMarkdown,
  extractGithubRepos,
  extractUrls,
  normalizeGithubRepoUrl,
  slugify,
  writeFacebookCapture,
};
