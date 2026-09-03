'use strict';

const path = require('path');
const fs = require('fs');
const { DatabaseSync } = require('node:sqlite');

const WORKFLOWS = new Set(['research_and_story', 'video_production', 'social_distribution']);
const EVENT_TYPES = new Set(['run_prepared', 'task_started', 'task_completed', 'task_failed', 'gate_waiting', 'gate_approved', 'run_cancelled', 'run_completed']);

function requireText(value, name) {
  const result = String(value || '').trim();
  if (!result) throw new Error(`${name} is required`);
  return result;
}

function reduceEvent(state, event) {
  const next = state ? structuredClone(state) : null;
  if (event.type === 'run_prepared') {
    if (next) throw new Error('run already initialized');
    return { run_id: event.run_id, workflow: event.payload.workflow, status: 'prepared', revision: event.sequence, tasks: {} };
  }
  if (!next) throw new Error('run is not initialized');
  if (event.type === 'task_started') {
    next.status = 'running';
    next.tasks[event.payload.task_id] = { status: 'running', attempt: event.payload.attempt };
  } else if (event.type === 'task_completed') {
    next.tasks[event.payload.task_id] = { status: 'completed', attempt: event.payload.attempt };
  } else if (event.type === 'task_failed') {
    next.status = 'blocked';
    next.tasks[event.payload.task_id] = { status: 'failed', attempt: event.payload.attempt, error_class: event.payload.error_class };
  } else if (event.type === 'gate_waiting') {
    next.status = 'waiting_for_approval';
    next.waiting_gate = event.payload.gate_id;
    next.packet_sha256 = event.payload.packet_sha256;
  } else if (event.type === 'gate_approved') {
    delete next.waiting_gate;
    delete next.packet_sha256;
    next.status = 'running';
  } else if (event.type === 'run_cancelled') {
    next.status = 'cancelled';
  } else if (event.type === 'run_completed') {
    next.status = 'completed';
  }
  next.revision = event.sequence;
  return next;
}

class WorkflowKernel {
  constructor(databaseFile) {
    const file = path.resolve(requireText(databaseFile, 'database file'));
    fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
    this.db = new DatabaseSync(file);
    this.db.exec('PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;');
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS commands (
        command_id TEXT PRIMARY KEY, run_id TEXT NOT NULL, workflow TEXT NOT NULL,
        payload_json TEXT NOT NULL, accepted_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS run_events (
        run_id TEXT NOT NULL, sequence INTEGER NOT NULL, event_type TEXT NOT NULL,
        payload_json TEXT NOT NULL, created_at TEXT NOT NULL,
        PRIMARY KEY (run_id, sequence)
      );
      CREATE TABLE IF NOT EXISTS outbox (
        id INTEGER PRIMARY KEY AUTOINCREMENT, run_id TEXT NOT NULL, sequence INTEGER NOT NULL,
        event_type TEXT NOT NULL, payload_json TEXT NOT NULL, delivered_at TEXT,
        UNIQUE (run_id, sequence, event_type)
      );
      CREATE TABLE IF NOT EXISTS task_leases (
        run_id TEXT NOT NULL, task_id TEXT NOT NULL, attempt INTEGER NOT NULL,
        worker_id TEXT NOT NULL, heartbeat_at TEXT NOT NULL, expires_at TEXT NOT NULL,
        PRIMARY KEY (run_id, task_id, attempt)
      );
    `);
  }

  close() { this.db.close(); }

  acceptCommand(input) {
    const commandId = requireText(input.commandId, 'command id');
    const workflow = requireText(input.workflow, 'workflow');
    const runId = requireText(input.runId, 'run id');
    if (!WORKFLOWS.has(workflow)) throw new Error('unsupported workflow');
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const existing = this.db.prepare('SELECT run_id FROM commands WHERE command_id = ?').get(commandId);
      if (existing) {
        this.db.exec('COMMIT');
        return { duplicate: true, run_id: existing.run_id };
      }
      const now = new Date().toISOString();
      this.db.prepare('INSERT INTO commands(command_id, run_id, workflow, payload_json, accepted_at) VALUES (?, ?, ?, ?, ?)')
        .run(commandId, runId, workflow, JSON.stringify(input.payload || {}), now);
      this._appendEvent(runId, 'run_prepared', { workflow }, now);
      this.db.exec('COMMIT');
      return { duplicate: false, run_id: runId };
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }

  _appendEvent(runId, type, payload, now = new Date().toISOString()) {
    if (!EVENT_TYPES.has(type)) throw new Error('unsupported event type');
    const row = this.db.prepare('SELECT COALESCE(MAX(sequence), 0) AS revision FROM run_events WHERE run_id = ?').get(runId);
    const sequence = Number(row.revision) + 1;
    const payloadJson = JSON.stringify(payload || {});
    this.db.prepare('INSERT INTO run_events(run_id, sequence, event_type, payload_json, created_at) VALUES (?, ?, ?, ?, ?)')
      .run(runId, sequence, type, payloadJson, now);
    this.db.prepare('INSERT INTO outbox(run_id, sequence, event_type, payload_json) VALUES (?, ?, ?, ?)')
      .run(runId, sequence, type, payloadJson);
    return sequence;
  }

  appendEvent(runIdValue, type, payload, options = {}) {
    const runId = requireText(runIdValue, 'run id');
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const row = this.db.prepare('SELECT COALESCE(MAX(sequence), 0) AS revision FROM run_events WHERE run_id = ?').get(runId);
      if (options.expectedRevision !== undefined && Number(options.expectedRevision) !== Number(row.revision)) {
        throw new Error(`revision conflict: expected ${options.expectedRevision}, actual ${row.revision}`);
      }
      const sequence = this._appendEvent(runId, type, payload);
      this.db.exec('COMMIT');
      return { run_id: runId, revision: sequence };
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }

  events(runIdValue) {
    const runId = requireText(runIdValue, 'run id');
    return this.db.prepare('SELECT run_id, sequence, event_type, payload_json, created_at FROM run_events WHERE run_id = ? ORDER BY sequence').all(runId)
      .map((row) => ({ run_id: row.run_id, sequence: Number(row.sequence), type: row.event_type, payload: JSON.parse(row.payload_json), created_at: row.created_at }));
  }

  currentState(runId) {
    const events = this.events(runId);
    if (!events.length) throw new Error('unknown run');
    return events.reduce(reduceEvent, null);
  }

  acquireLease(input) {
    const runId = requireText(input.runId, 'run id');
    const taskId = requireText(input.taskId, 'task id');
    const workerId = requireText(input.workerId, 'worker id');
    const attempt = Number(input.attempt);
    const now = new Date(input.now || Date.now());
    const expiresAt = new Date(now.getTime() + Number(input.ttlMs)).toISOString();
    if (!Number.isInteger(attempt) || attempt < 1 || !Number.isFinite(Number(input.ttlMs)) || Number(input.ttlMs) < 1000 || Number.isNaN(now.getTime())) throw new Error('invalid lease input');
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const current = this.db.prepare('SELECT worker_id, expires_at FROM task_leases WHERE run_id = ? AND task_id = ? AND attempt = ?').get(runId, taskId, attempt);
      if (current && current.expires_at > now.toISOString()) throw new Error('lease is active');
      this.db.prepare(`INSERT INTO task_leases(run_id, task_id, attempt, worker_id, heartbeat_at, expires_at)
        VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(run_id, task_id, attempt) DO UPDATE SET
        worker_id=excluded.worker_id, heartbeat_at=excluded.heartbeat_at, expires_at=excluded.expires_at`)
        .run(runId, taskId, attempt, workerId, now.toISOString(), expiresAt);
      this.db.exec('COMMIT');
      return { run_id: runId, task_id: taskId, attempt, worker_id: workerId, heartbeat_at: now.toISOString(), expires_at: expiresAt };
    } catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }

  heartbeat(input) {
    const now = new Date(input.now || Date.now());
    const expiresAt = new Date(now.getTime() + Number(input.ttlMs)).toISOString();
    const result = this.db.prepare(`UPDATE task_leases SET heartbeat_at = ?, expires_at = ?
      WHERE run_id = ? AND task_id = ? AND attempt = ? AND worker_id = ? AND expires_at >= ?`)
      .run(now.toISOString(), expiresAt, input.runId, input.taskId, Number(input.attempt), input.workerId, now.toISOString());
    if (Number(result.changes) !== 1) throw new Error('lease heartbeat rejected');
    return { run_id: input.runId, task_id: input.taskId, attempt: Number(input.attempt), worker_id: input.workerId, heartbeat_at: now.toISOString(), expires_at: expiresAt };
  }

  expiredLeases(nowValue = new Date().toISOString()) {
    const now = new Date(nowValue);
    if (Number.isNaN(now.getTime())) throw new Error('invalid lease time');
    return this.db.prepare('SELECT run_id, task_id, attempt, worker_id, heartbeat_at, expires_at FROM task_leases WHERE expires_at < ? ORDER BY expires_at').all(now.toISOString())
      .map((row) => Object.assign({}, row, { attempt: Number(row.attempt) }));
  }

  pendingOutbox() {
    return this.db.prepare('SELECT id, run_id, sequence, event_type, payload_json FROM outbox WHERE delivered_at IS NULL ORDER BY id').all()
      .map((row) => ({ id: Number(row.id), run_id: row.run_id, sequence: Number(row.sequence), event_type: row.event_type, payload: JSON.parse(row.payload_json) }));
  }
}

module.exports = { EVENT_TYPES, WORKFLOWS, WorkflowKernel, reduceEvent };
