/**
 * EditorPilot — Database API (main thread proxy to OPFS worker).
 * SQLite WASM + OPFS only — no localStorage fallback.
 */

let worker = null;
let nextId = 0;
const pending = new Map();
let initPromise = null;

function getWorker() {
  if (!worker) {
    worker = new Worker(new URL('./db-worker.js', import.meta.url), { type: 'module' });
    worker.onmessage = (event) => {
      const { id, result, error } = event.data;
      const entry = pending.get(id);
      if (!entry) return;
      pending.delete(id);
      if (error) entry.reject(new Error(error));
      else entry.resolve(result);
    };
    worker.onerror = (err) => {
      console.error('[DB]', err);
      for (const [, entry] of pending) {
        entry.reject(new Error(err.message || 'Database worker error'));
      }
      pending.clear();
    };
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
 * Throws if cross-origin isolation or OPFS is unavailable.
 */
export async function initDatabase() {
  if (initPromise) return initPromise;

  if (!window.crossOriginIsolated) {
    const err = new Error(
      'Cross-origin isolation is required for local storage. Reload the page so the service worker can enable it (localhost or HTTPS).'
    );
    console.error('[DB]', err.message);
    throw err;
  }

  initPromise = rpc('init')
    .then((result) => {
      console.log('[DB] SQLite OPFS initialized');
      return result;
    })
    .catch((err) => {
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
