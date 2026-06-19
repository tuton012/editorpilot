/**
 * CalmWorkspace — Database API
 * Main-thread SQLite WASM (works on localhost / Live Server).
 * Persists to localStorage; uses OPFS when cross-origin isolated.
 */

import sqlite3InitModule from 'https://cdn.jsdelivr.net/npm/@sqlite.org/sqlite-wasm@3.51.2-build8/dist/index.mjs';

const WASM_VERSION = '3.51.2-build8';
const WASM_BASE = `https://cdn.jsdelivr.net/npm/@sqlite.org/sqlite-wasm@${WASM_VERSION}/dist/`;
const DB_FILE = '/calmworkspace.db';
const STORAGE_KEY = 'calmworkspace_db_v1';

let db = null;
let usingOpfs = false;
let initPromise = null;

// ---- Low-level SQL helpers ----

function exec(sql, bind = []) {
  db.exec({ sql, bind });
}

function queryAll(sql, bind = []) {
  const rows = [];
  db.exec({
    sql,
    bind,
    rowMode: 'object',
    callback: (row) => rows.push(row),
  });
  return rows;
}

function queryOne(sql, bind = []) {
  const rows = queryAll(sql, bind);
  return rows[0] || null;
}

function createTables() {
  exec(`
    CREATE TABLE IF NOT EXISTS documents (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL DEFAULT '',
      original_text TEXT NOT NULL DEFAULT '',
      corrected_text TEXT NOT NULL DEFAULT '',
      mode TEXT NOT NULL DEFAULT 'grammar',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS correction_history (
      id TEXT PRIMARY KEY,
      document_id TEXT NOT NULL,
      original_text TEXT NOT NULL,
      corrected_text TEXT NOT NULL,
      mode TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS grammar_issues (
      id TEXT PRIMARY KEY,
      document_id TEXT NOT NULL,
      original_text TEXT NOT NULL,
      suggestion TEXT NOT NULL,
      explanation TEXT NOT NULL DEFAULT '',
      type TEXT NOT NULL DEFAULT 'grammar',
      start_index INTEGER NOT NULL,
      end_index INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'active',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS ignored_issues (
      id TEXT PRIMARY KEY,
      original_text TEXT NOT NULL,
      suggestion TEXT NOT NULL,
      type TEXT NOT NULL DEFAULT 'grammar',
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS user_preferences (
      id TEXT PRIMARY KEY,
      key TEXT NOT NULL UNIQUE,
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS app_settings (
      id TEXT PRIMARY KEY,
      key TEXT NOT NULL UNIQUE,
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);
}

function exportAllDataInternal() {
  return {
    documents: queryAll('SELECT * FROM documents'),
    correction_history: queryAll('SELECT * FROM correction_history'),
    grammar_issues: queryAll('SELECT * FROM grammar_issues'),
    ignored_issues: queryAll('SELECT * FROM ignored_issues'),
    user_preferences: queryAll('SELECT * FROM user_preferences'),
    app_settings: queryAll('SELECT * FROM app_settings'),
    exported_at: new Date().toISOString(),
    app: 'EditorPilot',
    version: 1,
  };
}

function importAllDataInternal(data) {
  exec('DELETE FROM grammar_issues');
  exec('DELETE FROM correction_history');
  exec('DELETE FROM documents');
  exec('DELETE FROM ignored_issues');
  exec('DELETE FROM user_preferences');
  exec('DELETE FROM app_settings');

  for (const table of [
    'documents',
    'correction_history',
    'grammar_issues',
    'ignored_issues',
    'user_preferences',
    'app_settings',
  ]) {
    for (const row of data[table] || []) {
      const cols = Object.keys(row);
      exec(
        `INSERT INTO ${table} (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`,
        cols.map((c) => row[c])
      );
    }
  }
}

/** Snapshot DB to localStorage when OPFS is not in use. */
function persistSnapshot() {
  if (usingOpfs || !db) return;
  try {
    const data = exportAllDataInternal();
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  } catch (err) {
    console.error('[ERROR]', err);
  }
}

function restoreSnapshot() {
  if (usingOpfs) return;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    const data = JSON.parse(raw);
    if (data?.app === 'EditorPilot' || data?.app === 'CalmWorkspace') {
      importAllDataInternal(data);
      console.log('[DB] Restored from local storage');
    }
  } catch (err) {
    console.error('[ERROR]', err);
  }
}

function touchPersist() {
  persistSnapshot();
}

// ---- Initialize ----

/**
 * Initialize SQLite and open calmworkspace.db.
 * OPFS when isolated; otherwise in-memory + localStorage snapshot.
 */
export async function initDatabase() {
  if (initPromise) return initPromise;

  initPromise = (async () => {
    const sqlite3 = await sqlite3InitModule({
      print: () => {},
      printErr: (msg) => {
        if (typeof msg === 'string' && msg.includes('OPFS sqlite3_vfs')) return;
        console.error(msg);
      },
      locateFile: (file) => WASM_BASE + file,
    });

    // OPFS only works in a dedicated worker — main thread uses memory + localStorage.
    db = new sqlite3.oo1.DB(':memory:', 'c');
    usingOpfs = false;
    console.log('[DB] Using in-memory SQLite (localStorage persistence)');

    createTables();

    if (!usingOpfs) {
      restoreSnapshot();
    }

    console.log('[DB] SQLite initialized');
    return { opfs: usingOpfs };
  })().catch((err) => {
    initPromise = null;
    console.error('[ERROR]', err);
    throw err;
  });

  return initPromise;
}

// ---- Public API ----

export async function saveDocument(doc) {
  const now = new Date().toISOString();
  const existing = queryOne('SELECT id FROM documents WHERE id = ?', [doc.id]);

  if (existing) {
    exec(
      `UPDATE documents SET title = ?, original_text = ?, corrected_text = ?, mode = ?, updated_at = ? WHERE id = ?`,
      [doc.title, doc.original_text, doc.corrected_text, doc.mode, now, doc.id]
    );
  } else {
    exec(
      `INSERT INTO documents (id, title, original_text, corrected_text, mode, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [doc.id, doc.title, doc.original_text, doc.corrected_text, doc.mode, now, now]
    );
  }

  touchPersist();
  return { updated_at: now };
}

export async function getDocuments(limit = 50) {
  return queryAll(
    `SELECT id, title, original_text, corrected_text, mode, created_at, updated_at
     FROM documents ORDER BY updated_at DESC LIMIT ?`,
    [limit]
  );
}

export async function getDocument(id) {
  return queryOne('SELECT * FROM documents WHERE id = ?', [id]);
}

export async function deleteDocument(id) {
  exec('DELETE FROM grammar_issues WHERE document_id = ?', [id]);
  exec('DELETE FROM correction_history WHERE document_id = ?', [id]);
  exec('DELETE FROM documents WHERE id = ?', [id]);
  touchPersist();
}

export async function addCorrectionHistory(entry) {
  exec(
    `INSERT INTO correction_history (id, document_id, original_text, corrected_text, mode, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [entry.id, entry.document_id, entry.original_text, entry.corrected_text, entry.mode, entry.created_at]
  );
  touchPersist();
}

export async function saveGrammarIssues(documentId, issues) {
  const now = new Date().toISOString();
  exec('DELETE FROM grammar_issues WHERE document_id = ? AND status = ?', [documentId, 'active']);

  for (const issue of issues) {
    exec(
      `INSERT INTO grammar_issues (id, document_id, original_text, suggestion, explanation, type, start_index, end_index, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?)`,
      [
        issue.id,
        documentId,
        issue.originalText,
        issue.suggestion,
        issue.explanation || '',
        issue.type || 'grammar',
        issue.startIndex,
        issue.endIndex,
        now,
        now,
      ]
    );
  }

  touchPersist();
}

export async function getGrammarIssues(documentId) {
  return queryAll(
    `SELECT id, original_text, suggestion, explanation, type, start_index, end_index, status
     FROM grammar_issues WHERE document_id = ? AND status = 'active'`,
    [documentId]
  ).map((row) => ({
    id: row.id,
    originalText: row.original_text,
    suggestion: row.suggestion,
    explanation: row.explanation,
    type: row.type,
    startIndex: row.start_index,
    endIndex: row.end_index,
  }));
}

export async function ignoreIssue(issue) {
  const now = new Date().toISOString();
  const id = issue.id || `ignored_${Date.now()}`;

  exec(
    `INSERT OR IGNORE INTO ignored_issues (id, original_text, suggestion, type, created_at) VALUES (?, ?, ?, ?, ?)`,
    [id, issue.originalText, issue.suggestion, issue.type || 'grammar', now]
  );
  exec(`UPDATE grammar_issues SET status = 'ignored', updated_at = ? WHERE id = ?`, [now, issue.id]);
  touchPersist();
}

export async function getIgnoredIssues() {
  return queryAll('SELECT original_text, suggestion, type FROM ignored_issues');
}

export async function setPreference(key, value) {
  const now = new Date().toISOString();
  exec(
    `INSERT INTO user_preferences (id, key, value, updated_at) VALUES (?, ?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
    [`pref_${key}`, key, value, now]
  );
  touchPersist();
}

export async function getPreference(key) {
  const row = queryOne('SELECT value FROM user_preferences WHERE key = ?', [key]);
  return row ? row.value : null;
}

export async function setSetting(key, value) {
  const now = new Date().toISOString();
  exec(
    `INSERT INTO app_settings (id, key, value, updated_at) VALUES (?, ?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
    [`setting_${key}`, key, value, now]
  );
  touchPersist();
}

export async function getSetting(key) {
  const row = queryOne('SELECT value FROM app_settings WHERE key = ?', [key]);
  return row ? row.value : null;
}

export async function exportAllData() {
  return exportAllDataInternal();
}

export async function importAllData(data) {
  importAllDataInternal(data);
  touchPersist();
}

export async function deleteAllData() {
  exec('DELETE FROM grammar_issues');
  exec('DELETE FROM correction_history');
  exec('DELETE FROM documents');
  exec('DELETE FROM ignored_issues');
  exec('DELETE FROM user_preferences');
  exec('DELETE FROM app_settings');
  localStorage.removeItem(STORAGE_KEY);
}

export function generateId(prefix = 'doc') {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

export function getDocumentTitle(text) {
  const line = (text || '').split('\n')[0].trim();
  if (!line) return 'Untitled draft';
  return line.length > 48 ? `${line.slice(0, 48)}…` : line;
}
