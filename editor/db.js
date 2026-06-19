/**
 * EditorPilot — Database API (main thread proxy to OPFS worker).
 * SQLite WASM + OPFS only — no localStorage fallback.
 * Uses a dedicated Worker (OPFS sync APIs are not available in SharedWorkers).
 */

let worker = null;
let nextId = 0;
const pending = new Map();
let initPromise = null;

const WORKER_URL = new URL('./db-worker.js', import.meta.url);

function attachWorkerHandlers(w) {
  w.onmessage = (event) => {
    const { id, result, error } = event.data;
    const entry = pending.get(id);
    if (!entry) return;
    pending.delete(id);
    if (error) entry.reject(new Error(error));
    else entry.resolve(result);
  };
  w.onerror = (err) => {
    console.error('[DB]', err);
    rejectAllPending(err.message || 'Database worker error');
  };
}

function createWorker() {
  const w = new Worker(WORKER_URL, { type: 'module' });
  attachWorkerHandlers(w);
  console.log('[DB] Using dedicated Worker for OPFS');
  return w;
}

function rejectAllPending(message) {
  for (const [, entry] of pending) {
    entry.reject(new Error(message));
  }
  pending.clear();
}

function getWorker() {
  if (!worker) {
    worker = createWorker();
  }
  return worker;
}

function rpc(method, ...args) {
  return new Promise((resolve, reject) => {
    const id = ++nextId;
    pending.set(id, { resolve, reject });
    getWorker().postMessage({ id, method, args });
  });
}

/**
 * Initialize SQLite OPFS database in a dedicated worker.
 */
export async function initDatabase() {
  if (initPromise) return initPromise;

  const runInit = async () => {
    try {
      const result = await rpc('init');
      console.log('[DB] SQLite OPFS initialized via', result?.vfs || 'opfs');
      return result;
    } catch (err) {
      const msg = err?.message || String(err);
      if (msg.includes('Missing required OPFS APIs')) {
        throw new Error(
          'OPFS storage is not available in this browser. Use Chrome, Edge, or Firefox over HTTPS or localhost.'
        );
      }
      if (msg.includes('locked') || msg.includes('Access Handle')) {
        throw new Error(
          'EditorPilot storage is locked — close other EditorPilot tabs, wait a few seconds, then refresh.'
        );
      }
      throw err;
    }
  };

  initPromise = (async () => {
    if (typeof navigator !== 'undefined' && navigator.locks?.request) {
      return navigator.locks.request('editorpilot-db-init', runInit);
    }
    return runInit();
  })().catch((err) => {
    initPromise = null;
    throw err;
  });

  return initPromise;
}

export async function saveDocument(doc) {
  return rpc('saveDocument', doc);
}

export async function getDocuments(limit = 50) {
  return rpc('getDocuments', limit);
}

export async function getDocument(id) {
  return rpc('getDocument', id);
}

export async function deleteDocument(id) {
  return rpc('deleteDocument', id);
}

export async function addCorrectionHistory(entry) {
  return rpc('addCorrectionHistory', entry);
}

export async function saveGrammarIssues(documentId, issues) {
  return rpc('saveGrammarIssues', documentId, issues);
}

export async function getGrammarIssues(documentId) {
  return rpc('getGrammarIssues', documentId);
}

export async function ignoreIssue(issue) {
  return rpc('ignoreIssue', issue);
}

export async function getIgnoredIssues() {
  return rpc('getIgnoredIssues');
}

export async function setPreference(key, value) {
  return rpc('setPreference', key, value);
}

export async function getPreference(key) {
  return rpc('getPreference', key);
}

export async function setSetting(key, value) {
  return rpc('setSetting', key, value);
}

export async function getSetting(key) {
  return rpc('getSetting', key);
}

export async function exportAllData() {
  return rpc('exportAllData');
}

export async function importAllData(data) {
  return rpc('importAllData', data);
}

export async function deleteAllData() {
  return rpc('deleteAllData');
}

export function generateId(prefix = 'doc') {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

export function getDocumentTitle(text) {
  const line = (text || '').split('\n')[0].trim();
  if (!line) return 'Untitled draft';
  return line.length > 48 ? `${line.slice(0, 48)}…` : line;
}
