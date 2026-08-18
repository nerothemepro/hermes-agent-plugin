'use strict';

const TERMINAL_RUN_STATUSES = new Set(['blocked', 'cancelled', 'completed', 'failed']);

function isTerminalRunStatus(status) {
  return TERMINAL_RUN_STATUSES.has(String(status || '').trim());
}

module.exports = { TERMINAL_RUN_STATUSES, isTerminalRunStatus };
