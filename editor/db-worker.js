/**
 * EditorPilot — SQLite WASM worker with OPFS persistence.
 * Requires cross-origin isolation (COOP/COEP).
 */

import sqlite3InitModule from './vendor/sqlite-wasm/index.mjs';

const WASM_BASE = new URL('./vendor/sqlite-wasm/', import.meta.url).href;
const DB_FILE = '/calmworkspace.db';

let db = null;

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

async function openOpfsDatabase(sqlite3) {
  const hasStandardOpfs =
    sqlite3.oo1?.OpfsDb && sqlite3.capi?.sqlite3_vfs_find?.('opfs');

  if (hasStandardOpfs) {
    db = new sqlite3.oo1.OpfsDb(DB_FILE, 'c');
    createTables();
    console.log('[DB] OPFS ready (opfs VFS) at', db.filename);
    return { opfs: true, vfs: 'opfs', file: db.filename };
  }

  if (typeof sqlite3.installOpfsSAHPoolVfs !== 'function') {
    throw new Error(
      'OPFS is not available in this browser. Use Chrome, Edge, Firefox 111+, or Safari 16.4+ over localhost or HTTPS.'
    );
  }

  const poolUtil = await sqlite3.installOpfsSAHPoolVfs({
    name: 'editorpilot-opfs',
    directory: '/.editorpilot-opfs',
    initialCapacity: 8,
    forceReinitIfPreviouslyFailed: true,
  });

  if (!poolUtil?.OpfsSAHPoolDb) {
    throw new Error('OPFS pool failed to initialize.');
  }

  db = new poolUtil.OpfsSAHPoolDb(DB_FILE, 'c');
  createTables();
  console.log('[DB] OPFS ready (opfs-sahpool) at', DB_FILE);
  return { opfs: true, vfs: 'opfs-sahpool', file: DB_FILE };
}

async function initDb() {
  const sqlite3 = await sqlite3InitModule({
    print: () => {},
    printErr: (msg) => console.error('[DB worker]', msg),
    locateFile: (file) => WASM_BASE + file,
  });

  try {
    return await openOpfsDatabase(sqlite3);
  } catch (err) {
    console.error('[DB worker] OPFS init failed:', {
      crossOriginIsolated: self.crossOriginIsolated,
      sharedArrayBuffer: typeof SharedArrayBuffer !== 'undefined',
      opfsDb: !!sqlite3.oo1?.OpfsDb,
      sahpool: typeof sqlite3.installOpfsSAHPoolVfs === 'function',
      error: err?.message || err,
    });
    throw err;
  }
}

const handlers = {
  init: () => initDb(),

  saveDocument(doc) {
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

    return { updated_at: now };
  },

  getDocuments(limit = 50) {
    return queryAll(
      `SELECT id, title, original_text, corrected_text, mode, created_at, updated_at
       FROM documents ORDER BY updated_at DESC LIMIT ?`,
      [limit]
    );
  },

  getDocument(id) {
    return queryOne('SELECT * FROM documents WHERE id = ?', [id]);
  },

  deleteDocument(id) {
    exec('DELETE FROM grammar_issues WHERE document_id = ?', [id]);
    exec('DELETE FROM correction_history WHERE document_id = ?', [id]);
    exec('DELETE FROM documents WHERE id = ?', [id]);
  },

  addCorrectionHistory(entry) {
    exec(
      `INSERT INTO correction_history (id, document_id, original_text, corrected_text, mode, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [entry.id, entry.document_id, entry.original_text, entry.corrected_text, entry.mode, entry.created_at]
    );
  },

  saveGrammarIssues(documentId, issues) {
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
  },

  getGrammarIssues(documentId) {
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
  },

  ignoreIssue(issue) {
    const now = new Date().toISOString();
    const id = issue.id || `ignored_${Date.now()}`;

    exec(
      `INSERT OR IGNORE INTO ignored_issues (id, original_text, suggestion, type, created_at) VALUES (?, ?, ?, ?, ?)`,
      [id, issue.originalText, issue.suggestion, issue.type || 'grammar', now]
    );
    exec(`UPDATE grammar_issues SET status = 'ignored', updated_at = ? WHERE id = ?`, [now, issue.id]);
  },

  getIgnoredIssues() {
    return queryAll('SELECT original_text, suggestion, type FROM ignored_issues');
  },

  setPreference(key, value) {
    const now = new Date().toISOString();
    exec(
      `INSERT INTO user_preferences (id, key, value, updated_at) VALUES (?, ?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
      [`pref_${key}`, key, value, now]
    );
  },

  getPreference(key) {
    const row = queryOne('SELECT value FROM user_preferences WHERE key = ?', [key]);
    return row ? row.value : null;
  },

  setSetting(key, value) {
    const now = new Date().toISOString();
    exec(
      `INSERT INTO app_settings (id, key, value, updated_at) VALUES (?, ?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
      [`setting_${key}`, key, value, now]
    );
  },

  getSetting(key) {
    const row = queryOne('SELECT value FROM app_settings WHERE key = ?', [key]);
    return row ? row.value : null;
  },

  exportAllData() {
    return exportAllDataInternal();
  },

  importAllData(data) {
    importAllDataInternal(data);
  },

  deleteAllData() {
    exec('DELETE FROM grammar_issues');
    exec('DELETE FROM correction_history');
    exec('DELETE FROM documents');
    exec('DELETE FROM ignored_issues');
    exec('DELETE FROM user_preferences');
    exec('DELETE FROM app_settings');
  },
};

self.onmessage = async (event) => {
  const { id, method, args = [] } = event.data;

  try {
    const handler = handlers[method];
    if (!handler) {
      throw new Error(`Unknown DB method: ${method}`);
    }
    if (method !== 'init' && !db) {
      throw new Error('Database not initialized');
    }
    const result = await handler(...args);
    self.postMessage({ id, result });
  } catch (err) {
    console.error('[DB worker]', err);
    self.postMessage({ id, error: err?.message || String(err) });
  }
};
