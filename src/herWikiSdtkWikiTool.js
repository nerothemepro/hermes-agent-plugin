'use strict';

const fs = require('fs');
const path = require('path');
const childProcess = require('child_process');

const DEFAULT_WIKI_ROOT = '/workspace/sdtk-wiki/ai-agent-second-brain-main';
const DEFAULT_RAW_INBOX = path.join(DEFAULT_WIKI_ROOT, 'raw', 'inbox');
const DEFAULT_REPORT_DIR = path.join(DEFAULT_WIKI_ROOT, '.sdtk', 'wiki', 'reports');

function ensureInside(parent, child) {
  const resolvedParent = path.resolve(parent);
  const resolvedChild = path.resolve(child);
  if (resolvedChild !== resolvedParent && !resolvedChild.startsWith(resolvedParent + path.sep)) {
    throw new Error(`Unsafe path outside ${resolvedParent}: ${resolvedChild}`);
  }
}

function listFilesRecursive(rootDir) {
  if (!fs.existsSync(rootDir)) {
    return [];
  }

  const stack = [rootDir];
  const files = [];
  while (stack.length) {
    const current = stack.pop();
    const entries = fs.readdirSync(current, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(fullPath);
        continue;
      }
      if (!entry.isFile()) {
        continue;
      }
      const stat = fs.statSync(fullPath);
      files.push({
        path: fullPath,
        name: entry.name,
        mtimeMs: stat.mtimeMs,
        sizeBytes: stat.size,
      });
    }
  }
  return files.sort((a, b) => {
    if (b.mtimeMs !== a.mtimeMs) return b.mtimeMs - a.mtimeMs;
    return a.path.localeCompare(b.path);
  });
}

function snapshotFiles(rootDir) {
  const snapshot = new Map();
  for (const file of listFilesRecursive(rootDir)) {
    snapshot.set(file.path, {
      mtimeMs: file.mtimeMs,
      sizeBytes: file.sizeBytes,
    });
  }
  return snapshot;
}

function collectChangedFiles(before, rootDir, startedAtMs) {
  return listFilesRecursive(rootDir)
    .filter((file) => {
      const previous = before.get(file.path);
      if (!previous) return true;
      return file.mtimeMs > previous.mtimeMs || file.sizeBytes !== previous.sizeBytes;
    })
    .filter((file) => file.mtimeMs + 5 >= startedAtMs)
    .map((file) => file.path);
}

function parseSearchOutput(stdout) {
  const trimmed = (stdout || '').trim();
  if (!trimmed) {
    return [];
  }
  try {
    return JSON.parse(trimmed);
  } catch (_error) {
    return null;
  }
}

function sanitizeReportPaths(paths) {
  return Array.from(new Set((paths || [])
    .filter((value) => typeof value === 'string')
    .map((value) => value.trim())
    .filter(Boolean)));
}

function truncateSnippet(value, limit = 220) {
  if (typeof value !== 'string') {
    return '';
  }
  const normalized = value.replace(/\s+/g, ' ').trim();
  if (normalized.length <= limit) {
    return normalized;
  }
  return normalized.slice(0, Math.max(0, limit - 1)).trimEnd() + '…';
}

function normalizeSearchResults(parsed, limit) {
  if (Array.isArray(parsed)) {
    const matches = parsed.slice(0, limit);
    return {
      searchResults: matches,
      resultCount: matches.length,
      totalMatches: matches.length,
      searchMeta: null,
    };
  }

  if (parsed && typeof parsed === 'object' && Array.isArray(parsed.matches)) {
    const matches = parsed.matches.slice(0, limit).map((match) => ({
      path: match.path || '',
      title: match.title || '',
      score: match.score ?? null,
      why: match.why || '',
      snippet: truncateSnippet(match.snippet || ''),
    }));

    return {
      searchResults: matches,
      resultCount: matches.length,
      totalMatches: Number.isFinite(parsed.totalMatches) ? parsed.totalMatches : matches.length,
      searchMeta: {
        scanned_files: Number.isFinite(parsed.scannedFiles) ? parsed.scannedFiles : null,
        search_mode: parsed.searchMode || null,
        premium_required: Boolean(parsed.premiumRequired),
        mutated: Boolean(parsed.mutated),
      },
    };
  }

  return {
    searchResults: parsed,
    resultCount: null,
    totalMatches: null,
    searchMeta: null,
  };
}

function buildArgs(action, opts) {
  const wikiRoot = path.resolve(opts.wikiRoot || DEFAULT_WIKI_ROOT);
  const rawInbox = path.resolve(opts.sourceRoot || path.join(wikiRoot, 'raw', 'inbox'));
  const limit = Number.isFinite(opts.limit) ? opts.limit : 10;
  const query = typeof opts.query === 'string' ? opts.query.trim() : '';

  ensureInside(wikiRoot, rawInbox);

  const common = ['--project-path', wikiRoot];
  switch (action) {
    case 'ingest':
      return {
        wikiRoot,
        rawInbox,
        argv: ['ingest', rawInbox, ...common],
      };
    case 'compile':
      return {
        wikiRoot,
        rawInbox,
        argv: ['compile', '--mode', 'safe', ...common],
      };
    case 'lint':
      return {
        wikiRoot,
        rawInbox,
        argv: ['lint', ...common],
      };
    case 'maintain':
      return {
        wikiRoot,
        rawInbox,
        argv: ['maintain', '--mode', 'safe', ...common],
      };
    case 'discover':
      return {
        wikiRoot,
        rawInbox,
        argv: ['discover', '--plan', ...common],
      };
    case 'search':
      if (!query) {
        throw new Error('Search query is required for action "search".');
      }
      return {
        wikiRoot,
        rawInbox,
        argv: ['search', '--project-path', wikiRoot, '--json', '--limit', String(limit), query],
        query,
        limit,
      };
    default:
      throw new Error(`Unsupported action: ${action}`);
  }
}

function runSdtkWikiAction(action, opts = {}) {
  const timeoutMs = Number.isFinite(opts.timeoutMs) ? opts.timeoutMs : 120000;
  const reportDir = path.resolve(opts.reportDir || DEFAULT_REPORT_DIR);
  const startedAtMs = Date.now();
  const beforeReports = snapshotFiles(reportDir);
  const command = buildArgs(action, opts);

  const result = childProcess.spawnSync('sdtk-wiki', command.argv, {
    encoding: 'utf-8',
    timeout: timeoutMs,
  });

  const stdout = (result.stdout || '').trim();
  const stderr = (result.stderr || '').trim();
  const reportPaths = sanitizeReportPaths(collectChangedFiles(beforeReports, reportDir, startedAtMs));
  const payload = {
    status: result.status === 0 ? 'completed' : 'error',
    action,
    wiki_root: command.wikiRoot,
    report_dir: reportDir,
    command: ['sdtk-wiki', ...command.argv],
    exit_code: result.status,
    signal: result.signal || null,
    report_paths: reportPaths,
    warnings: [],
    errors: [],
  };

  if (action === 'ingest') {
    payload.source_root = command.rawInbox;
  }
  if (action === 'search') {
    payload.query = command.query;
    payload.limit = command.limit;
    const parsed = parseSearchOutput(stdout);
    if (parsed !== null) {
      const normalized = normalizeSearchResults(parsed, command.limit);
      payload.search_results = normalized.searchResults;
      payload.result_count = normalized.resultCount;
      payload.total_matches = normalized.totalMatches;
      if (normalized.searchMeta) {
        payload.search_meta = normalized.searchMeta;
      }
    } else {
      payload.stdout = stdout;
      payload.warnings.push('search output was not valid JSON');
    }
  } else {
    if (stdout) payload.stdout = stdout;
  }
  if (stderr) {
    payload.stderr = stderr;
  }

  if (result.error) {
    payload.status = 'error';
    payload.errors.push(result.error.message);
  } else if (result.status !== 0) {
    payload.errors.push(stderr || stdout || `sdtk-wiki exited with code ${result.status}`);
  }

  if (!reportPaths.length && action !== 'search') {
    payload.warnings.push('no changed report files were detected');
  }

  return payload;
}

module.exports = {
  DEFAULT_RAW_INBOX,
  DEFAULT_REPORT_DIR,
  DEFAULT_WIKI_ROOT,
  buildArgs,
  collectChangedFiles,
  normalizeSearchResults,
  parseSearchOutput,
  runSdtkWikiAction,
  sanitizeReportPaths,
  snapshotFiles,
  truncateSnippet,
};
