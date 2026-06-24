#!/usr/bin/env node
'use strict';

const { writeFacebookCapture, DEFAULT_WIKI_ROOT } = require('./facebookCaptureToWikiInbox');

const CAPTURED_STATUSES = new Set(['captured', 'completed', 'success', 'ok']);
const BLOCKED_STATUSES = new Set([
  'blocked',
  'login_required',
  'not_accessible',
  'not_found',
  'browser_error',
  'error',
  'skipped',
]);

function asArray(value) {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}

function normalizeStatus(value) {
  return String(value || '').trim().toLowerCase();
}

function sourceUrlOf(item) {
  return item.source_url || item.url || item.facebook_url || '';
}

function detectLoginWall(item) {
  const haystack = [
    item.status,
    item.reason,
    item.error,
    item.title,
    item.heading,
    item.post_text,
    item.content,
    item.text,
    ...asArray(item.errors),
    ...asArray(item.warnings),
  ].join('\n').toLowerCase();

  return [
    'facebook login',
    'login required',
    'login wall',
    'log in to facebook',
    'you must log in',
    'đăng nhập',
    'dang nhap',
  ].some((needle) => haystack.includes(needle));
}

function hasRealCaptureContent(item) {
  const text = String(item.post_text || item.content || item.text || '').trim();
  const links = asArray(item.links).concat(asArray(item.extracted_links));
  return text.length >= 40 || links.length > 0;
}

function classifyItem(item) {
  const status = normalizeStatus(item.status);

  if (detectLoginWall(item)) {
    return {
      action: 'failed',
      reason: 'login_required',
      detail: item.reason || item.error || 'Facebook login wall detected.',
    };
  }

  if (CAPTURED_STATUSES.has(status)) {
    if (!hasRealCaptureContent(item)) {
      return {
        action: 'failed',
        reason: 'empty_capture',
        detail: 'Capture status was completed, but no usable post text or links were provided.',
      };
    }
    return { action: 'capture' };
  }

  if (BLOCKED_STATUSES.has(status)) {
    return {
      action: 'failed',
      reason: status || 'blocked',
      detail: item.reason || item.error || asArray(item.errors).join('; ') || 'Marked as blocked by caller.',
    };
  }

  if (hasRealCaptureContent(item)) {
    return { action: 'capture' };
  }

  return {
    action: 'failed',
    reason: status || 'unknown_status',
    detail: item.reason || item.error || 'No explicit captured status and no usable content.',
  };
}

function normalizeInput(input) {
  if (Array.isArray(input)) return { items: input };
  if (Array.isArray(input.items)) return input;
  if (Array.isArray(input.captures)) return { ...input, items: input.captures };
  if (Array.isArray(input.links)) {
    return {
      ...input,
      items: input.links.map((url) => ({
        source_url: url,
        status: 'blocked',
        reason: 'not_processed',
      })),
    };
  }
  throw new Error('Input must be an array or an object with items/captures array');
}

function processBatch(input, opts = {}) {
  const normalized = normalizeInput(input);
  const wikiRoot = opts.wikiRoot || normalized.wiki_root || normalized.wikiRoot || DEFAULT_WIKI_ROOT;
  const items = normalized.items;
  const completed = [];
  const failed = [];
  const warnings = [];

  if (!items.length) {
    throw new Error('items must contain at least one capture result');
  }

  items.forEach((item, index) => {
    const sourceUrl = sourceUrlOf(item);
    if (!sourceUrl) {
      failed.push({
        index,
        url: '',
        reason: 'missing_source_url',
        detail: 'source_url/url is required for each batch item',
      });
      return;
    }

    const classification = classifyItem(item);
    if (classification.action !== 'capture') {
      failed.push({
        index,
        url: sourceUrl,
        reason: classification.reason,
        detail: classification.detail,
      });
      return;
    }

    try {
      const result = writeFacebookCapture({ ...item, source_url: sourceUrl }, { wikiRoot });
      completed.push({
        index,
        url: sourceUrl,
        raw_path: result.raw_path,
        github_repos: result.github_repos,
        extracted_links_count: result.extracted_links_count,
        warnings: result.warnings,
      });
    } catch (err) {
      failed.push({
        index,
        url: sourceUrl,
        reason: 'write_failed',
        detail: err.message,
      });
    }
  });

  if (failed.length) {
    warnings.push(`${failed.length} link(s) were not captured. See failed[].`);
  }

  return {
    status: completed.length ? 'completed' : 'blocked',
    tool: 'facebook-batch-capture-to-wiki-inbox',
    wiki_root: wikiRoot,
    total_count: items.length,
    completed_count: completed.length,
    failed_count: failed.length,
    completed,
    failed,
    warnings,
    errors: completed.length ? [] : ['No Facebook link was captured into raw/inbox.'],
  };
}

module.exports = {
  classifyItem,
  detectLoginWall,
  processBatch,
};
