'use strict';

const fs = require('fs');
const path = require('path');

const DEFAULT_WIKI_ROOT = '/workspace/sdtk-wiki/ai-agent-second-brain-main';

function ensureInside(parent, child) {
  const resolvedParent = path.resolve(parent);
  const resolvedChild = path.resolve(child);
  if (resolvedChild !== resolvedParent && !resolvedChild.startsWith(resolvedParent + path.sep)) {
    throw new Error(`Unsafe path outside ${resolvedParent}: ${resolvedChild}`);
  }
}

function listInboxMarkdownFiles(inboxDir) {
  return fs.readdirSync(inboxDir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith('.md'))
    .map((entry) => {
      const fullPath = path.join(inboxDir, entry.name);
      const stat = fs.statSync(fullPath);
      return {
        name: entry.name,
        path: fullPath,
        mtimeMs: stat.mtimeMs,
        sizeBytes: stat.size,
      };
    })
    .sort((a, b) => {
      if (b.mtimeMs !== a.mtimeMs) return b.mtimeMs - a.mtimeMs;
      return a.name.localeCompare(b.name);
    });
}

function isProblematicCapture(filePath) {
  const text = fs.readFileSync(filePath, 'utf-8').slice(0, 12000).toLowerCase();
  return [
    'facebook login required',
    'main heading: facebook login',
    'unknown (login required)',
    'requires a facebook login',
    'redirected to the login screen',
  ].some((needle) => text.includes(needle));
}

function buildHerWikiPrompt(rawPath) {
  return [
    'Ingest file raw này vào wiki theo đúng contract trong /workspace/sdtk-wiki/ai-agent-second-brain-main/CLAUDE.md:',
    rawPath,
    '',
    'Yêu cầu:',
    '- giữ raw source immutable',
    '- tạo/update source page',
    '- tạo/update entity nếu có repo GitHub',
    '- append wiki/log.md',
    '- report các file đã thay đổi',
  ].join('\n');
}

function resolveLatestRawInbox(opts = {}) {
  const wikiRoot = path.resolve(opts.wikiRoot || DEFAULT_WIKI_ROOT);
  const inboxDir = path.resolve(opts.inboxDir || path.join(wikiRoot, 'raw', 'inbox'));
  ensureInside(wikiRoot, inboxDir);

  if (!fs.existsSync(inboxDir)) {
    throw new Error(`Inbox directory does not exist: ${inboxDir}`);
  }

  const allFiles = listInboxMarkdownFiles(inboxDir);
  const files = opts.includeProblematic
    ? allFiles
    : allFiles.filter((file) => !isProblematicCapture(file.path));
  if (!files.length) {
    throw new Error("No ingestable markdown files found in inbox: " + inboxDir);
  }

  const latest = files[0];
  const prompt = buildHerWikiPrompt(latest.path);

  return {
    status: 'completed',
    wiki_root: wikiRoot,
    inbox_dir: inboxDir,
    latest_raw_path: latest.path,
    latest_raw_name: latest.name,
    latest_raw_mtime_ms: latest.mtimeMs,
    source_count: allFiles.length,
    ingestable_source_count: files.length,
    skipped_problematic_count: allFiles.length - files.length,
    prompt_for_herwiki: prompt,
  };
}

module.exports = {
  DEFAULT_WIKI_ROOT,
  resolveLatestRawInbox,
  buildHerWikiPrompt,
  listInboxMarkdownFiles,
  isProblematicCapture,
};
