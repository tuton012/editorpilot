/**
 * EditorPilot — Main application
 */

import {
  initAI,
  setStatusCallback,
  runCorrectionPipeline,
  runRewriteVariants,
  analyzeGrammarIssues,
  analyzeGrammarIssuesLocal,
  bumpRequestGeneration,
  getRequestGeneration,
  switchModel,
  getSelectedModelPref,
  setSelectedModelPref,
  setModelChangeCallback,
  getActiveModelId,
  isSmallTierModel,
  isMultilingualCapableModel,
  isAIReady,
  detectLanguageHeuristic,
  GEMMA_2B_MODEL_ID,
  GEMMA_MODEL_ID,
  APP_NAME,
  MIN_TEXT_LENGTH,
  MAX_CORRECTION_LENGTH,
  MAX_HIGHLIGHT_LENGTH,
  checkWebGPUSupport,
  checkEditorRequirements,
  MODEL_CATALOG,
  MODE_LABELS,
  LANGUAGE_MODES,
  STYLE_MODES,
  OUTPUT_LANGUAGES,
  SMALL_MODEL_LANGUAGES,
} from './ai.js';

import { computeWritingScores } from './scores.js';

import {
  initDatabase,
  saveDocument,
  getDocuments,
  getDocument,
  addCorrectionHistory,
  saveGrammarIssues,
  getGrammarIssues,
  ignoreIssue as dbIgnoreIssue,
  getIgnoredIssues,
  setPreference,
  getPreference,
  exportAllData,
  importAllData,
  deleteAllData,
  deleteDocument,
  generateId,
  getDocumentTitle,
} from './db.js';

// ---- Constants ----

const DEBOUNCE_MS = 800;
const HIGHLIGHT_DEBOUNCE_MS = 2500;
const AUTOSAVE_MS = 2000;
const MAX_UNDO = 40;
const VERSION_STORAGE_KEY = 'editorpilot_app_version';
const CORRECTION_BATCH_HINT = 3500;

const LEGAL_CONTENT = {
  shortcuts: {
    title: 'Keyboard shortcuts',
    html: `<table class="shortcuts-table">
      <tr><td><kbd>Ctrl</kbd> + <kbd>Z</kbd></td><td>Undo last change</td></tr>
      <tr><td><kbd>Ctrl</kbd> + <kbd>Shift</kbd> + <kbd>F</kbd></td><td>Toggle Focus mode</td></tr>
      <tr><td><kbd>Ctrl</kbd> + <kbd>Shift</kbd> + <kbd>C</kbd></td><td>Copy Updated Version panel</td></tr>
      <tr><td><kbd>Ctrl</kbd> + <kbd>Shift</kbd> + <kbd>R</kbd></td><td>Open Rewrite options</td></tr>
      <tr><td><kbd>Ctrl</kbd> + <kbd>Shift</kbd> + <kbd>D</kbd></td><td>Toggle Compare view</td></tr>
      <tr><td><kbd>Esc</kbd></td><td>Exit Focus · close modals</td></tr>
    </table>
    <p style="margin-top:12px;font-size:0.84rem;color:var(--text-muted)">On Mac, use <kbd>⌘</kbd> instead of <kbd>Ctrl</kbd>.</p>`,
  },
  privacy: {
    title: 'Privacy Policy',
    html: `<p>EditorPilot processes your writing locally in your browser. Drafts, preferences, and grammar notes are stored on this device only — not on our servers.</p>
      <h3>Data we do not collect</h3>
      <p>We do not receive, store, or sell your text, corrections, or personal information. There is no account system and no analytics tied to your content.</p>
      <h3>Local storage</h3>
      <p>Your drafts and settings are saved locally with SQLite WASM and the Origin Private File System (OPFS). You can export or delete this data anytime from the app.</p>
      <h3>Third-party models</h3>
      <p>Language models load from public CDNs on first use and are cached in your browser. No text is sent to a backend operated by EditorPilot.</p>`,
  },
  terms: {
    title: 'Terms of Use',
    html: `<p>EditorPilot is provided as-is for personal writing assistance. By using the app you agree to use it responsibly and in compliance with applicable laws.</p>
      <h3>No warranty</h3>
      <p>Suggestions and scores are automated estimates. Always review important documents before sending or publishing.</p>
      <h3>Your content</h3>
      <p>You retain full ownership of everything you write. EditorPilot does not claim rights over your text.</p>
      <h3>Donations</h3>
      <p>Voluntary donations support development but do not unlock exclusive features or create a service contract.</p>`,
  },
  gdpr: {
    title: 'GDPR Information',
    html: `<p>EditorPilot is designed with privacy by default and minimizes personal data processing.</p>
      <h3>Controller</h3>
      <p>For GDPR purposes, Carlos I is the project creator. Contact via the donation links if you have privacy questions.</p>
      <h3>Lawful basis</h3>
      <p>Processing happens locally on your device at your request. No personal data is transmitted to EditorPilot servers for core editing features.</p>
      <h3>Your rights</h3>
      <p>You can access, export, or erase your local data using Export, Import, and Delete All. Because data stays on your device, you control it directly.</p>
      <h3>Data retention</h3>
      <p>Data remains until you clear it or uninstall browser data for this site.</p>`,
  },
  credits: {
    title: 'Credits',
    html: `<p><strong>EditorPilot</strong> — created by <strong>Carlos I</strong>.</p>
      <h3>Built with</h3>
      <p>Thank you to the teams behind:</p>
      <ul style="margin:0;padding-left:1.2rem;line-height:1.6">
        <li><strong>WebLLM</strong> / MLC — local in-browser language models</li>
        <li><strong>SQLite WASM + OPFS</strong> — on-device persistence</li>
        <li><strong>WebGPU</strong> — fast local inference</li>
        <li>Qwen, Gemma, and other open model weights distributed via MLC</li>
      </ul>
      <p style="margin-top:12px">Grateful to everyone who builds open, privacy-respecting tools that make EditorPilot possible.</p>`,
  },
};

// ---- DOM references ----

const editor = document.getElementById('editor');
const plainTextSync = document.getElementById('plain-text-sync');
const correctedOutput = document.getElementById('corrected-output');
const modelSelect = document.getElementById('model-select');
const btnFocusMode = document.getElementById('btn-focus-mode');
const setupClose = document.getElementById('setup-close');
const scoreHuman = document.getElementById('score-human');
const scoreGrammar = document.getElementById('score-grammar');
const scoreClarity = document.getElementById('score-clarity');
const scoreReadability = document.getElementById('score-readability');
const scorePunctuation = document.getElementById('score-punctuation');
const scoreModel = document.getElementById('score-model');
const statWords = document.getElementById('stat-words');
const statChars = document.getElementById('stat-chars');
const statReadTime = document.getElementById('stat-read-time');
const btnCompare = document.getElementById('btn-compare');
const statusText = document.getElementById('status-text');
const statusDot = document.getElementById('status-dot');
const checkingIndicator = document.getElementById('checking-indicator');
const lengthWarning = document.getElementById('length-warning');
const appRoot = document.querySelector('.app');
const issuePopup = document.getElementById('issue-popup');
const popupOriginal = document.getElementById('popup-original');
const popupSuggestion = document.getElementById('popup-suggestion');
const popupExplanation = document.getElementById('popup-explanation');
const btnDarkToggle = document.getElementById('btn-dark-toggle');
const themeSelect = document.getElementById('theme-select');
const outputLanguageSelect = document.getElementById('output-language');
const panelFixing = document.getElementById('panel-fixing');
const panelFixingText = panelFixing?.querySelector('.panel-fixing-text');
const footerCopy = document.getElementById('footer-copy');
const toast = document.getElementById('toast');
const modalOverlay = document.getElementById('modal-overlay');
const modalTitle = document.getElementById('modal-title');
const modalMessage = document.getElementById('modal-message');
const modalCancel = document.getElementById('modal-cancel');
const modalConfirm = document.getElementById('modal-confirm');
const setupOverlay = document.getElementById('setup-overlay');
const setupTitle = document.getElementById('setup-title');
const setupMessage = document.getElementById('setup-message');
const setupBody = document.getElementById('setup-body');
const setupProgress = document.getElementById('setup-progress');
const setupBack = document.getElementById('setup-back');
const setupNext = document.getElementById('setup-next');
const fontFamilySelect = document.getElementById('font-family');
const fontSizeSelect = document.getElementById('font-size');
const btnBold = document.getElementById('btn-bold');
const btnItalic = document.getElementById('btn-italic');
const rewriteOverlay = document.getElementById('rewrite-overlay');
const rewriteOptions = document.getElementById('rewrite-options');
const rewriteStatus = document.getElementById('rewrite-status');
const rewriteCancel = document.getElementById('rewrite-cancel');
const legalOverlay = document.getElementById('legal-overlay');
const legalTitle = document.getElementById('legal-title');
const legalBody = document.getElementById('legal-body');
const legalClose = document.getElementById('legal-close');
const donationModal = document.getElementById('donation-modal');
const btnDonate = document.getElementById('btn-donate');
const closeDonationModal = document.getElementById('close-donation-modal');

let undoInputTimer = null;

// ---- Application state ----

let currentMode = 'grammar';
let currentDocId = null;
let correctedText = '';
let grammarIssues = [];
let ignoredPatterns = new Set();
let activeIssueId = null;
let aiTaskRunning = false;
let focusMode = false;
let compareMode = false;

let debounceTimer = null;
let highlightTimer = null;
let autosaveTimer = null;
let currentRequestId = 0;
let darkMode = false;
let colorTheme = 'light-default';
let styleMode = 'grammar';
let outputLanguage = 'english';
let correctionRerunPending = false;
let undoStack = [];
let undoPaused = false;
let editorFormat = {
  fontFamily: 'Georgia, serif',
  fontSize: '16px',
  bold: false,
  italic: false,
};

// ---- Utility helpers ----

function escapeHtml(text) {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function showToast(message, duration = 2500) {
  toast.textContent = message;
  toast.hidden = false;
  setTimeout(() => {
    toast.hidden = true;
  }, duration);
}

function formatRelativeTime(iso) {
  if (!iso) return '';
  const date = new Date(iso);
  const now = new Date();
  const diff = now - date;

  if (diff < 60000) return 'Just now';
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function modeLabel(mode) {
  return MODE_LABELS[mode] || mode;
}

// ---- Appearance ----

function applyAppearance() {
  const theme = darkMode ? 'dark' : colorTheme;
  document.documentElement.dataset.theme = theme;
  btnDarkToggle.setAttribute('aria-pressed', String(darkMode));
  btnDarkToggle.title = darkMode ? 'Switch to light mode' : 'Switch to dark mode';
  themeSelect.disabled = darkMode;
  if (!darkMode) {
    themeSelect.value = colorTheme;
  }
}

// ---- Confirm modal ----

function showConfirmModal({ title, message, confirmText = 'Confirm', cancelText = 'Cancel', danger = false }) {
  return new Promise((resolve) => {
    modalTitle.textContent = title;
    modalMessage.textContent = message;
    modalCancel.textContent = cancelText;
    modalConfirm.textContent = confirmText;
    modalConfirm.className = danger ? 'btn btn-danger' : 'btn btn-primary';

    modalOverlay.hidden = false;

    const onCancel = () => {
      cleanup();
      resolve(false);
    };
    const onConfirm = () => {
      cleanup();
      resolve(true);
    };

    const onKey = (e) => {
      if (e.key === 'Escape') onCancel();
    };

    function cleanup() {
      modalOverlay.hidden = true;
      modalCancel.removeEventListener('click', onCancel);
      modalConfirm.removeEventListener('click', onConfirm);
      document.removeEventListener('keydown', onKey);
    }

    modalCancel.addEventListener('click', onCancel);
    modalConfirm.addEventListener('click', onConfirm);
    document.addEventListener('keydown', onKey);
    modalConfirm.focus();
  });
}

async function saveAppearancePrefs() {
  await setPreference('dark_mode', darkMode ? '1' : '0').catch((err) => console.error('[ERROR]', err));
  await setPreference('color_theme', colorTheme).catch((err) => console.error('[ERROR]', err));
}

function countWords(text) {
  const w = (text || '').trim().match(/\b[\w']+\b/g);
  return w ? w.length : 0;
}

function readingTimeLabel(text) {
  const words = countWords(text);
  if (words === 0) return '— read';
  const mins = Math.max(1, Math.ceil(words / 200));
  return mins === 1 ? '~1 min read' : `~${mins} min read`;
}

function updateDocStats(text) {
  const source = text ?? syncEditorPlainText();
  const chars = source.length;
  const words = countWords(source);
  statWords.textContent = `${words.toLocaleString()} word${words === 1 ? '' : 's'}`;
  statChars.textContent = `${chars.toLocaleString()} char${chars === 1 ? '' : 's'}`;
  statReadTime.textContent = readingTimeLabel(source);
}

function buildCompareHtml(original, updated) {
  if (!updated) return '';
  if (!original || original.trim() === updated.trim()) {
    return `<span class="diff-same">${escapeHtml(updated)}</span>`;
  }

  const o = original.trim().split(/\s+/).filter(Boolean);
  const u = updated.trim().split(/\s+/).filter(Boolean);
  const parts = u.map((word, i) => {
    if (i < o.length && o[i] === word) {
      return `<span class="diff-same">${escapeHtml(word)}</span>`;
    }
    if (i < o.length) {
      return `<span class="diff-changed">${escapeHtml(word)}</span>`;
    }
    return `<span class="diff-added">${escapeHtml(word)}</span>`;
  });
  return parts.join(' ');
}

function setCompareMode(on) {
  compareMode = on;
  btnCompare.setAttribute('aria-pressed', String(on));
  btnCompare.classList.toggle('active', on);
  refreshUpdatePanel();
}

function toggleCompareMode() {
  if (!correctedText) {
    showToast('No update to compare yet');
    return;
  }
  setCompareMode(!compareMode);
}

function refreshUpdatePanel() {
  if (!correctedText) {
    correctedOutput.textContent = 'Updated preview will display here once you start writing.';
    correctedOutput.classList.add('empty');
    setFixing(false);
    return;
  }

  correctedOutput.classList.remove('empty');
  if (compareMode) {
    const original = syncEditorPlainText();
    correctedOutput.innerHTML = buildCompareHtml(original, correctedText);
  } else {
    correctedOutput.textContent = correctedText;
  }
}

function isModKey(e) {
  return e.ctrlKey || e.metaKey;
}

function handleGlobalShortcuts(e) {
  const tag = document.activeElement?.tagName;
  const inField = tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA';

  if (isModKey(e) && e.shiftKey && e.key.toLowerCase() === 'f') {
    e.preventDefault();
    toggleFocusMode();
    return;
  }
  if (isModKey(e) && e.shiftKey && e.key.toLowerCase() === 'c') {
    e.preventDefault();
    copyPanelText(correctedText, 'update');
    return;
  }
  if (isModKey(e) && e.shiftKey && e.key.toLowerCase() === 'r') {
    e.preventDefault();
    openRewriteModal();
    return;
  }
  if (isModKey(e) && e.shiftKey && e.key.toLowerCase() === 'd') {
    e.preventDefault();
    toggleCompareMode();
    return;
  }
  if (isModKey(e) && e.key.toLowerCase() === 'z' && !e.shiftKey && !inField) {
    e.preventDefault();
    undoLastChange();
  }
}

// ---- Focus mode ----

function setFocusMode(on, persist = true) {
  focusMode = on;
  appRoot.classList.toggle('focus-mode', on);
  btnFocusMode.setAttribute('aria-pressed', String(on));
  btnFocusMode.textContent = on ? 'Exit focus' : 'Focus';

  if (on) {
    editor.focus();
  }

  if (persist) {
    setPreference('focus_mode', on ? '1' : '0').catch((err) => console.error('[ERROR]', err));
  }
}

function toggleFocusMode() {
  setFocusMode(!focusMode);
}

// ---- Text formatting (mirrored to Update panel) ----

function applyEditorFormat() {
  const weight = editorFormat.bold ? '700' : '400';
  const style = editorFormat.italic ? 'italic' : 'normal';

  for (const el of [editor, correctedOutput]) {
    el.style.fontFamily = editorFormat.fontFamily;
    el.style.fontSize = editorFormat.fontSize;
    el.style.fontWeight = weight;
    el.style.fontStyle = style;
  }

  btnBold.setAttribute('aria-pressed', String(editorFormat.bold));
  btnItalic.setAttribute('aria-pressed', String(editorFormat.italic));
  fontFamilySelect.value = editorFormat.fontFamily;
  fontSizeSelect.value = editorFormat.fontSize;
}

async function saveFormatPrefs() {
  await setPreference('editor_format', JSON.stringify(editorFormat)).catch((err) =>
    console.error('[ERROR]', err)
  );
}

async function loadFormatPrefs() {
  try {
    const raw = await getPreference('editor_format');
    if (raw) {
      const parsed = JSON.parse(raw);
      editorFormat = { ...editorFormat, ...parsed };
    }
  } catch (err) {
    console.error('[ERROR]', err);
  }
  applyEditorFormat();
}

// ---- Undo ----

function pushUndoSnapshot() {
  if (undoPaused) return;
  const text = syncEditorPlainText();
  if (undoStack.length && undoStack[undoStack.length - 1] === text) return;
  undoStack.push(text);
  if (undoStack.length > MAX_UNDO) undoStack.shift();
}

function undoLastChange() {
  if (undoStack.length < 2) {
    showToast('Nothing to undo');
    return;
  }
  undoStack.pop();
  const prev = undoStack[undoStack.length - 1];
  undoPaused = true;
  setEditorPlainText(prev);
  undoPaused = false;
  grammarIssues = filterIssues(analyzeGrammarIssuesLocal(prev), prev);
  renderHighlights(grammarIssues, true);
  scheduleDebouncedAI();
  scheduleAutosave();
  updateScores(prev);
  showToast('Undone');
}

// ---- Version manager ----

function compareVersions(a, b) {
  const pa = String(a).split('.').map((n) => parseInt(n, 10) || 0);
  const pb = String(b).split('.').map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const av = pa[i] || 0;
    const bv = pb[i] || 0;
    if (av < bv) return -1;
    if (av > bv) return 1;
  }
  return 0;
}

function formatFooterVersion(version) {
  const label = version.startsWith('V') ? version : `V${version}`;
  return `© EditorPilot · editorpilot.com · Carlos I - ${label}`;
}

function updateFooterVersion(version) {
  if (!footerCopy || !version) return;
  footerCopy.innerHTML =
    `${formatFooterVersion(version).replace('editorpilot.com', '<a href="https://editorpilot.com" class="footer-site-link" target="_blank" rel="noopener noreferrer">editorpilot.com</a>')}`;
}

async function clearAppCachesForUpdate() {
  if ('caches' in window) {
    const keys = await caches.keys();
    await Promise.all(keys.map((key) => caches.delete(key)));
  }
  if ('serviceWorker' in navigator) {
    const regs = await navigator.serviceWorker.getRegistrations();
    await Promise.all(regs.map((reg) => reg.unregister()));
  }
}

async function checkAppVersion() {
  try {
    const res = await fetch('./version.json', { cache: 'no-store' });
    if (!res.ok) return null;
    const data = await res.json();
    const version = data?.version;
    if (!version) return null;

    updateFooterVersion(version);

    const stored = localStorage.getItem(VERSION_STORAGE_KEY);
    if (stored && compareVersions(stored, version) < 0) {
      localStorage.setItem(VERSION_STORAGE_KEY, version);
      await clearAppCachesForUpdate();
      window.location.reload();
      return null;
    }

    localStorage.setItem(VERSION_STORAGE_KEY, version);
    return version;
  } catch (err) {
    console.warn('[VERSION] Could not check version.json', err);
    return null;
  }
}

// ---- Output language & model tier ----

function needsMultilingualModel(lang = outputLanguage) {
  if (!lang || SMALL_MODEL_LANGUAGES.has(lang)) {
    if (lang === 'auto') {
      const detected = detectLanguageHeuristic(syncEditorPlainText());
      return !SMALL_MODEL_LANGUAGES.has(detected) && detected !== 'english';
    }
    return false;
  }
  return true;
}

function syncOutputLanguageOptions() {
  if (!outputLanguageSelect) return;

  const small = isSmallTierModel(getActiveModelId());
  outputLanguageSelect.querySelectorAll('option').forEach((opt) => {
    if (opt.classList.contains('lang-tier-hint') || opt.value === '') return;
    const allowed = !small || SMALL_MODEL_LANGUAGES.has(opt.value);
    opt.disabled = !allowed;
    opt.hidden = false;
  });

  if (small && needsMultilingualModel(outputLanguageSelect.value)) {
    outputLanguage = 'english';
    outputLanguageSelect.value = 'english';
    setPreference('output_language', outputLanguage).catch((err) => console.error('[ERROR]', err));
  }
}

function setOutputLanguage(lang) {
  if (!lang || !OUTPUT_LANGUAGES.some((l) => l.id === lang)) {
    lang = 'english';
  }

  if (isSmallTierModel(getActiveModelId()) && !SMALL_MODEL_LANGUAGES.has(lang)) {
    showToast('That language needs Gemma 2 2B or Gemma 2 9B');
    outputLanguageSelect.value = outputLanguage;
    return;
  }

  outputLanguage = lang;
  outputLanguageSelect.value = lang;
  syncModelForLanguage();
  setPreference('output_language', lang).catch((err) => console.error('[ERROR]', err));
  scheduleDebouncedAI();
  scheduleAutosave();
}

function setFixing(show, message) {
  if (!panelFixing) return;

  if (show) {
    panelFixing.hidden = false;
    if (panelFixingText) {
      const dotsHtml = '<span class="panel-fixing-dots" aria-hidden="true"><span>.</span><span>.</span><span>.</span></span>';
      const label = message || 'Fixing';
      panelFixingText.innerHTML = `${escapeHtml(label)}${dotsHtml}`;
    }
    return;
  }

  panelFixing.hidden = true;
}

function onCorrectionProgress({ phase, batch, total }) {
  if (total <= 1) {
    setFixing(true, phase === 'translating' ? 'Translating' : 'Fixing');
    return;
  }
  const label = phase === 'translating' ? 'Translating' : 'Fixing';
  setFixing(true, `${label} (${batch}/${total})`);
}

function syncModelForLanguage() {
  syncOutputLanguageOptions();

  const needsMultilingual = needsMultilingualModel();

  modelSelect.querySelectorAll('option').forEach((opt) => {
    if (!opt.value || opt.value === 'auto') return;
    const isMultilingual = isMultilingualCapableModel(opt.value);
    if (needsMultilingual) {
      opt.hidden = !isMultilingual;
      opt.disabled = !isMultilingual;
    } else {
      opt.hidden = false;
      opt.disabled = false;
    }
  });

  if (needsMultilingual && !isMultilingualCapableModel(modelSelect.value)) {
    modelSelect.value = GEMMA_2B_MODEL_ID;
    setSelectedModelPref(GEMMA_2B_MODEL_ID);
    switchModel(GEMMA_2B_MODEL_ID).catch((err) => console.error('[ERROR]', err));
    setPreference('selected_model', GEMMA_2B_MODEL_ID).catch((err) => console.error('[ERROR]', err));
    showToast('This language uses Gemma 2 2B or Gemma 2 9B');
  }
}

// ---- Rewrite modal ----

function closeRewriteModal() {
  rewriteOverlay.hidden = true;
  rewriteOptions.innerHTML = '';
}

async function openRewriteModal() {
  const text = syncEditorPlainText();
  if (text.length < MIN_TEXT_LENGTH) {
    showToast('Type at least 3 characters');
    return;
  }

  rewriteOverlay.hidden = false;
  rewriteStatus.textContent = 'Generating options…';
  rewriteOptions.innerHTML = '';

  bumpRequestGeneration();
  const reqId = getRequestGeneration();

  try {
    const variants = await runRewriteVariants(text, reqId);
    if (reqId !== getRequestGeneration()) return;

    if (!variants.length) {
      rewriteStatus.textContent = 'No rewrites returned — try again.';
      return;
    }

    rewriteStatus.textContent = 'Copy a style — your draft stays unchanged.';
    rewriteOptions.innerHTML = variants
      .map(
        (v, i) => `
      <div class="rewrite-option" data-idx="${i}">
        <div class="rewrite-option-header">
          <span class="rewrite-option-label">${escapeHtml(v.label)}</span>
          <button type="button" class="btn btn-ghost btn-sm rewrite-option-copy">Copy</button>
        </div>
        <div class="rewrite-option-body">${escapeHtml(v.text)}</div>
      </div>`
      )
      .join('');

    rewriteOptions.querySelectorAll('.rewrite-option').forEach((card) => {
      const idx = Number(card.dataset.idx);
      card.querySelector('.rewrite-option-copy').addEventListener('click', (e) => {
        e.stopPropagation();
        copyPanelText(variants[idx].text, 'rewrite');
      });
    });
  } catch (err) {
    console.error('[ERROR]', err);
    rewriteStatus.textContent = 'Rewrite failed — try again.';
  }
}

function showLegalModal(key) {
  const doc = LEGAL_CONTENT[key];
  if (!doc) return;
  legalTitle.textContent = doc.title;
  legalBody.innerHTML = doc.html;
  legalOverlay.hidden = false;
}

// ---- Mode selection ----

function syncModeUI() {
  document.querySelectorAll('.mode-btn').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.mode === currentMode);
  });
}

function setMode(mode) {
  if (!STYLE_MODES.has(mode)) {
    mode = 'grammar';
  }
  currentMode = mode;
  styleMode = mode;
  syncModeUI();
  setPreference('last_mode', mode).catch((err) => console.error('[ERROR]', err));
  scheduleDebouncedAI();
  scheduleAutosave();
}

function setChecking(show) {
  checkingIndicator.hidden = !show;
}

function updateLengthWarning(text) {
  if (text.length > MAX_HIGHLIGHT_LENGTH) {
    lengthWarning.hidden = false;
    lengthWarning.textContent =
      `Grammar highlighting is limited above ${MAX_HIGHLIGHT_LENGTH.toLocaleString()} characters. Long documents are corrected in batches — updates may take longer.`;
  } else if (text.length > CORRECTION_BATCH_HINT) {
    lengthWarning.hidden = false;
    lengthWarning.textContent =
      'Long text is processed in batches. The Updated Version may take a little longer to refresh.';
  } else {
    lengthWarning.hidden = true;
  }
}

// ---- Caret helpers for contenteditable ----

function getCaretOffset(root) {
  const sel = window.getSelection();
  if (!sel || !sel.rangeCount) return 0;
  const range = sel.getRangeAt(0);
  const pre = range.cloneRange();
  pre.selectNodeContents(root);
  pre.setEnd(range.endContainer, range.endOffset);
  return pre.toString().length;
}

function setCaretOffset(root, offset) {
  const sel = window.getSelection();
  if (!sel) return;
  const range = document.createRange();
  let remaining = offset;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let node = walker.nextNode();

  while (node) {
    const len = node.textContent.length;
    if (remaining <= len) {
      range.setStart(node, remaining);
      range.collapse(true);
      sel.removeAllRanges();
      sel.addRange(range);
      return;
    }
    remaining -= len;
    node = walker.nextNode();
  }

  range.selectNodeContents(root);
  range.collapse(false);
  sel.removeAllRanges();
  sel.addRange(range);
}

// ---- Plain text sync ----

/**
 * Extract plain text from the contenteditable editor and sync hidden field.
 */
export function syncEditorPlainText() {
  const text = editor.innerText.replace(/\r\n/g, '\n');
  plainTextSync.value = text;
  return text;
}

/**
 * Set editor content from plain text (no highlights).
 */
function setEditorPlainText(text) {
  editor.textContent = text;
  plainTextSync.value = text;
}

// ---- Grammar highlighting ----

/**
 * Filter out ignored issues and overlapping duplicates.
 */
function filterIssues(issues, text) {
  return issues
    .filter((issue) => {
      const key = `${issue.originalText}::${issue.suggestion}`;
      if (ignoredPatterns.has(key)) return false;
      const slice = text.slice(issue.startIndex, issue.endIndex);
      return slice === issue.originalText;
    })
    .sort((a, b) => a.startIndex - b.startIndex);
}

/**
 * Render grammar issue highlights inside the contenteditable editor.
 * Skips DOM updates while typing (focused) to keep the caret stable.
 */
export function renderHighlights(issues, force = false) {
  const text = plainTextSync.value || syncEditorPlainText();
  const filtered = filterIssues(issues, text);
  grammarIssues = filtered;

  if (!force && document.activeElement === editor) {
    return;
  }

  if (!text) {
    editor.innerHTML = '';
    return;
  }

  const caret = document.activeElement === editor ? getCaretOffset(editor) : null;

  let html = '';
  let cursor = 0;

  for (const issue of filtered) {
    if (issue.startIndex < cursor) continue;
    html += escapeHtml(text.slice(cursor, issue.startIndex));
    html += `<span class="grammar-issue" data-issue-id="${escapeHtml(issue.id)}" title="${escapeHtml(issue.suggestion)}">${escapeHtml(text.slice(issue.startIndex, issue.endIndex))}</span>`;
    cursor = issue.endIndex;
  }

  html += escapeHtml(text.slice(cursor));
  editor.innerHTML = html;

  if (caret !== null) {
    setCaretOffset(editor, Math.min(caret, text.length));
  }
}

/**
 * Clear all highlight spans from the editor.
 */
export function clearHighlights() {
  grammarIssues = [];
  const text = syncEditorPlainText();
  setEditorPlainText(text);
}

/**
 * Apply a single grammar suggestion by issue id.
 */
export function acceptSuggestion(issueId) {
  const text = syncEditorPlainText();
  const issue = grammarIssues.find((i) => i.id === issueId);
  if (!issue) return text;

  const before = text.slice(0, issue.startIndex);
  const after = text.slice(issue.endIndex);
  const newText = before + issue.suggestion + after;
  pushUndoSnapshot();
  const delta = issue.suggestion.length - (issue.endIndex - issue.startIndex);

  grammarIssues = grammarIssues
    .filter((i) => i.id !== issueId)
    .map((i) => {
      if (i.startIndex >= issue.endIndex) {
        return {
          ...i,
          startIndex: i.startIndex + delta,
          endIndex: i.endIndex + delta,
        };
      }
      return i;
    });

  setEditorPlainText(newText);
  renderHighlights(grammarIssues, true);
  hideIssuePopup();
  scheduleDebouncedAI();
  scheduleAutosave();
  updateScores(newText);
  return newText;
}

/**
 * Ignore a grammar suggestion.
 */
export function ignoreSuggestion(issueId) {
  const issue = grammarIssues.find((i) => i.id === issueId);
  if (!issue) return;

  const key = `${issue.originalText}::${issue.suggestion}`;
  ignoredPatterns.add(key);

  dbIgnoreIssue({
    id: issueId,
    originalText: issue.originalText,
    suggestion: issue.suggestion,
    type: issue.type,
  }).catch((err) => console.error('[ERROR]', err));

  grammarIssues = grammarIssues.filter((i) => i.id !== issueId);
  renderHighlights(grammarIssues, true);
  hideIssuePopup();
}

/**
 * Accept all current grammar suggestions (end to start to preserve indexes).
 */
export function acceptAllSuggestions() {
  let text = syncEditorPlainText();
  const sorted = [...grammarIssues].sort((a, b) => b.startIndex - a.startIndex);

  for (const issue of sorted) {
    text =
      text.slice(0, issue.startIndex) + issue.suggestion + text.slice(issue.endIndex);
  }

  grammarIssues = [];
  setEditorPlainText(text);
  hideIssuePopup();
  scheduleDebouncedAI();
  showToast('All suggestions applied');
}

// ---- Issue popup ----

function showIssuePopup(issue, x, y) {
  activeIssueId = issue.id;
  popupOriginal.textContent = issue.originalText;
  popupSuggestion.textContent = `→ ${issue.suggestion}`;
  popupExplanation.textContent = issue.explanation || issue.type;

  issuePopup.hidden = false;
  issuePopup.style.left = `${Math.min(x, window.innerWidth - 320)}px`;
  issuePopup.style.top = `${Math.min(y + 8, window.innerHeight - 180)}px`;

  editor.querySelectorAll('.grammar-issue').forEach((el) => {
    el.classList.toggle('active', el.dataset.issueId === issue.id);
  });
}

function hideIssuePopup() {
  issuePopup.hidden = true;
  activeIssueId = null;
  editor.querySelectorAll('.grammar-issue.active').forEach((el) => {
    el.classList.remove('active');
  });
}

// ---- Correction processing ----

function updateOutputPanel(el, text, emptyMessage) {
  if (!text) {
    el.textContent = emptyMessage;
    el.classList.add('empty');
  } else {
    el.textContent = text;
    el.classList.remove('empty');
  }
}

function updateNewUpdatePanel(text) {
  correctedText = text ?? '';
  refreshUpdatePanel();
}

function scoreValueClass(val) {
  if (val === null || val === undefined) return '';
  if (val >= 75) return 'score-good';
  if (val >= 50) return 'score-mid';
  return 'score-low';
}

function setScoreEl(el, val) {
  if (val === null || val === undefined) {
    el.textContent = '—';
    el.className = 'score-value';
    return;
  }
  el.textContent = String(val);
  el.className = `score-value ${scoreValueClass(val)}`;
}

function updateScores(text) {
  const source = text ?? syncEditorPlainText();
  if (!source || source.length < MIN_TEXT_LENGTH) {
    [scoreHuman, scoreGrammar, scoreClarity, scoreReadability, scorePunctuation, scoreModel].forEach((el) => {
      el.textContent = '—';
      el.className = 'score-value';
    });
    return;
  }

  const scores = computeWritingScores(source, null, correctedText, grammarIssues);
  setScoreEl(scoreHuman, scores.human);
  setScoreEl(scoreGrammar, scores.grammar);
  setScoreEl(scoreClarity, scores.clarity);
  setScoreEl(scoreReadability, scores.readability);
  setScoreEl(scorePunctuation, scores.punctuation);
  setScoreEl(scoreModel, scores.model);
}

async function copyPanelText(text, label) {
  if (!text) {
    showToast(`No ${label} to copy`);
    return;
  }
  try {
    await navigator.clipboard.writeText(text);
    showToast('Copied to clipboard');
  } catch (err) {
    console.error('[ERROR]', err);
    showToast('Copy failed');
  }
}

/** Live path: style correction + optional translation (batched, no length cap). */
async function runCorrectionOnly(text, requestId) {
  if (!text || text.length < MIN_TEXT_LENGTH) {
    correctedText = '';
    updateNewUpdatePanel('');
    updateScores(text);
    setFixing(false);
    return;
  }

  if (requestId !== getRequestGeneration()) {
    return;
  }

  if (aiTaskRunning) {
    correctionRerunPending = true;
    return;
  }

  aiTaskRunning = true;
  setChecking(true);
  setFixing(true);

  try {
    if (!isAIReady()) {
      try {
        await initAI(getSelectedModelPref());
      } catch (err) {
        console.error('[ERROR]', err);
        showToast('Model still loading — try again in a moment');
        return;
      }
    }

    if (requestId !== getRequestGeneration()) {
      return;
    }

    const modeFixed = await runCorrectionPipeline(
      currentMode,
      text,
      outputLanguage,
      requestId,
      onCorrectionProgress
    );

    if (requestId !== getRequestGeneration()) {
      return;
    }

    if (modeFixed !== null) {
      correctedText = modeFixed;
      updateNewUpdatePanel(correctedText);
    }

    updateScores(text);
  } catch (err) {
    console.error('[ERROR]', err);
    const msg = String(err?.message || err || '').toLowerCase();
    if (msg.includes('device was lost') || msg.includes('disposed') || msg.includes('modelnotloaded')) {
      showToast('GPU ran out of memory — switch to Qwen 0.5B in the header');
    } else {
      showToast('Could not update — try again');
    }
  } finally {
    aiTaskRunning = false;
    setChecking(false);
    setFixing(false);

    if (correctionRerunPending) {
      correctionRerunPending = false;
      const latest = syncEditorPlainText();
      const reqId = getRequestGeneration();
      if (latest.length >= MIN_TEXT_LENGTH) {
        queueMicrotask(() => runCorrectionOnly(latest, reqId));
      }
    }
  }
}

function scheduleDebouncedAI() {
  clearTimeout(debounceTimer);

  const text = syncEditorPlainText();
  updateLengthWarning(text);

  grammarIssues = filterIssues(analyzeGrammarIssuesLocal(text), text);
  updateScores(text);
  updateDocStats(text);

  if (text.length < MIN_TEXT_LENGTH) {
    bumpRequestGeneration();
    currentRequestId = getRequestGeneration();
    correctedText = '';
    updateNewUpdatePanel('');
    setFixing(false);
    setChecking(false);
    return;
  }

  bumpRequestGeneration();
  currentRequestId = getRequestGeneration();
  const reqId = currentRequestId;

  debounceTimer = setTimeout(() => {
    if (getRequestGeneration() !== reqId) return;
    runCorrectionOnly(syncEditorPlainText(), reqId);
  }, DEBOUNCE_MS);
}

function scheduleLocalHighlights() {
  clearTimeout(highlightTimer);
  highlightTimer = setTimeout(() => {
    if (document.activeElement === editor) return;
    const text = syncEditorPlainText();
    if (text.length >= MIN_TEXT_LENGTH) {
      renderHighlights(analyzeGrammarIssuesLocal(text), true);
      updateScores(text);
    }
  }, HIGHLIGHT_DEBOUNCE_MS);
}

// ---- Autosave ----

function scheduleAutosave() {
  clearTimeout(autosaveTimer);
  autosaveTimer = setTimeout(performAutosave, AUTOSAVE_MS);
}

async function performAutosave() {
  const text = syncEditorPlainText();

  if (!currentDocId) {
    currentDocId = generateId('doc');
  }

  const doc = {
    id: currentDocId,
    title: getDocumentTitle(text),
    original_text: text,
    corrected_text: correctedText,
    mode: currentMode,
  };

  try {
    await saveDocument(doc);

    if (grammarIssues.length) {
      await saveGrammarIssues(currentDocId, grammarIssues);
    }

    console.log('[AUTOSAVE] Saved document');
    await refreshDraftsList();
  } catch (err) {
    console.error('[ERROR]', err);
  }
}

// ---- Drafts ----

async function refreshDraftsList() {
  /* Recent drafts UI removed — autosave still persists locally. */
}

async function deleteDraft(id) {
  const doc = await getDocument(id);
  const title = doc?.title || 'Untitled draft';

  const ok = await showConfirmModal({
    title: 'Delete draft?',
    message: `"${title}" will be permanently removed from this device.`,
    confirmText: 'Delete draft',
    danger: true,
  });
  if (!ok) return;

  try {
    await deleteDocument(id);
    if (currentDocId === id) {
      currentDocId = generateId('doc');
      setEditorPlainText('');
      correctedText = '';
      updateNewUpdatePanel('');
      updateScores('');
      grammarIssues = [];
      clearHighlights();
    }
    await refreshDraftsList();
    showToast('Draft deleted');
  } catch (err) {
    console.error('[ERROR]', err);
    showToast('Could not delete draft');
  }
}

async function loadDraft(id, { silent = false } = {}) {
  try {
    const doc = await getDocument(id);
    if (!doc) return;

    currentDocId = doc.id;
    let savedMode = doc.mode || 'grammar';
    if (LANGUAGE_MODES.has(savedMode)) {
      outputLanguage = savedMode;
      outputLanguageSelect.value = savedMode;
      savedMode = 'grammar';
    }
    currentMode = STYLE_MODES.has(savedMode) ? savedMode : 'grammar';
    styleMode = currentMode;
    correctedText = doc.corrected_text || '';

    setEditorPlainText(doc.original_text || '');
    updateNewUpdatePanel(correctedText);
    setActiveModeButton(currentMode);

    const issues = await getGrammarIssues(id);
    grammarIssues = issues;
    renderHighlights(issues);
    updateScores(doc.original_text || '');
    updateDocStats(doc.original_text || '');
    undoStack = [doc.original_text || ''];
    scheduleDebouncedAI();

    await refreshDraftsList();
    if (!silent) showToast('Draft loaded');
  } catch (err) {
    console.error('[ERROR]', err);
  }
}

function setActiveModeButton(mode) {
  if (LANGUAGE_MODES.has(mode)) {
    outputLanguage = mode;
    outputLanguageSelect.value = mode;
    mode = 'grammar';
  }
  currentMode = STYLE_MODES.has(mode) ? mode : 'grammar';
  styleMode = currentMode;
  syncModeUI();
  syncModelForLanguage();
}

// ---- Backup / import ----

async function exportWorkspace() {
  try {
    const data = await exportAllData();
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'calmworkspace-backup.json';
    a.click();
    URL.revokeObjectURL(url);
    showToast('Workspace exported');
  } catch (err) {
    console.error('[ERROR]', err);
    showToast('Export failed');
  }
}

async function importWorkspace(file) {
  try {
    const text = await file.text();
    const data = JSON.parse(text);

    if (data.app && data.app !== APP_NAME && data.app !== 'CalmWorkspace') {
      const ok = await showConfirmModal({
        title: 'Unknown backup file?',
        message: 'This file may not be an EditorPilot backup. Import anyway?',
        confirmText: 'Import anyway',
      });
      if (!ok) return;
    }

    const confirmed = await showConfirmModal({
      title: 'Import workspace?',
      message: 'This will replace all local drafts, settings, and history on this device.',
      confirmText: 'Import',
      danger: true,
    });
    if (!confirmed) return;

    await importAllData(data);
    currentDocId = null;
    setEditorPlainText('');
    correctedText = '';
    grammarIssues = [];
    updateNewUpdatePanel('');
    updateScores('');
    clearHighlights();

    const docs = await getDocuments(1);
    if (docs.length) {
      await loadDraft(docs[0].id);
    }

    await refreshDraftsList();
    showToast('Workspace imported');
  } catch (err) {
    console.error('[ERROR]', err);
    showToast('Import failed — check the file format');
  }
}

async function deleteAllLocalData() {
  const confirmed = await showConfirmModal({
    title: 'Delete all local data?',
    message:
      'Every draft, correction history, grammar note, and setting will be erased from this device. Export a backup first if you want to keep anything.',
    confirmText: 'Delete everything',
    cancelText: 'Keep my data',
    danger: true,
  });
  if (!confirmed) return;

  try {
    await deleteAllData();
    currentDocId = null;
    setEditorPlainText('');
    correctedText = '';
    grammarIssues = [];
    ignoredPatterns.clear();
    updateNewUpdatePanel('');
    updateScores('');
    clearHighlights();
    await refreshDraftsList();
    showToast('All local data deleted');
  } catch (err) {
    console.error('[ERROR]', err);
  }
}

// ---- Model status UI ----

function handleModelStatus({ text, state, progress }) {
  let label = text;

  if (state === 'loading') {
    if (text.startsWith('Checking')) {
      label = 'Checking…';
    } else if (progress !== undefined && progress !== null) {
      const pct = Math.min(100, Math.max(0, Math.round(progress * 100)));
      label = `Loading… ${pct}%`;
    } else {
      label = 'Loading…';
    }
  } else if (state === 'ready') {
    label = 'Ready';
  } else if (state === 'error') {
    label = 'Error';
  }

  statusText.textContent = label;
  statusText.title = text;
  statusDot.className = 'status-dot';
  if (state === 'ready') statusDot.classList.add('ready');
  else if (state === 'loading') statusDot.classList.add('loading');
  else if (state === 'error') statusDot.classList.add('error');
}

setStatusCallback(handleModelStatus);

setModelChangeCallback((modelId) => {
  modelSelect.value = modelId;
  setPreference('selected_model', modelId).catch((err) => console.error('[ERROR]', err));
  showToast('Switched to Qwen 0.5B — lighter on GPU memory');
});

// ---- Setup wizard ----

let setupStep = 0;
const SETUP_STEPS = 6;
let setupMandatory = false;
let setupRequirementsPassed = false;
let setupModelLoading = false;
let setupRecommendedModelId = MODEL_CATALOG[0].id;
let setupDraft = {
  mode: 'grammar',
  outputLanguage: 'english',
  colorTheme: 'light-default',
  darkMode: false,
  modelId: MODEL_CATALOG[0].id,
};
let setupAppearanceSnapshot = null;

function updateSetupActions() {
  const onRequirementsStep = setupStep === 1;
  const onModelStep = setupStep === 2;

  setupClose.hidden = setupMandatory;
  setupBack.hidden = setupStep === 0 || setupModelLoading;

  if (setupModelLoading) {
    setupNext.disabled = true;
    setupNext.textContent = 'Downloading…';
    return;
  }

  setupNext.disabled = onRequirementsStep && !setupRequirementsPassed;
  setupNext.textContent = setupStep === SETUP_STEPS - 1 ? 'Get started' : 'Continue';
}

function renderDeviceSpecs(specs) {
  if (!specs) return '';

  const rows = [
    ['Browser', specs.browser],
    ['OS / platform', specs.platform],
    ['CPU cores', String(specs.cpuCores)],
    ['Device memory', specs.deviceMemoryGB],
    ['GPU', specs.gpu],
    ['GPU vendor', specs.gpuVendor],
    ['WebGPU status', specs.webgpuStatus],
    ['Screen', specs.screen],
    ['Pixel ratio', String(specs.pixelRatio)],
  ];

  return `
    <div class="setup-specs">
      <h3 class="setup-specs-title">Your device</h3>
      <table class="setup-specs-table">
        <tbody>
          ${rows
            .map(
              ([label, value]) => `
            <tr>
              <th scope="row">${escapeHtml(label)}</th>
              <td>${escapeHtml(value)}</td>
            </tr>`
            )
            .join('')}
        </tbody>
      </table>
      <p class="setup-specs-note">Memory and GPU details are what your browser reports — they may not match Task Manager exactly.</p>
    </div>`;
}

function renderRequirementChecks(report) {
  const { results, capabilities, specs } = report;

  const rows = results
    .map((item) => {
      const state = item.warn ? 'warn' : item.ok ? 'ok' : 'fail';
      const icon = item.warn ? '!' : item.ok ? '✓' : '✕';
      return `
      <li class="setup-check-item ${state}">
        <span class="setup-check-icon" aria-hidden="true">${icon}</span>
        <div>
          <strong>${escapeHtml(item.label)}</strong>
          <span>${escapeHtml(item.detail)}</span>
        </div>
      </li>`;
    })
    .join('');

  let gpuHint = '';
  if (capabilities?.supported) {
    const rec = MODEL_CATALOG.find((m) => m.id === capabilities.recommendedModelId);
    gpuHint = `
      <p class="setup-hint">
        ${capabilities.description ? `Detected: ${escapeHtml(capabilities.description)}.` : 'GPU check complete.'}
        ${capabilities.isIntegratedGPU ? ' Integrated graphics detected —' : ''}
        Recommended: <strong>${escapeHtml(rec?.label || 'Qwen 0.5B')}</strong>.
      </p>`;
    setupRecommendedModelId = capabilities.recommendedModelId;
    setupDraft.modelId = capabilities.recommendedModelId;
  }

  setupBody.innerHTML = `
    ${renderDeviceSpecs(specs)}
    <h3 class="setup-specs-title">Requirements</h3>
    <ul class="setup-check-list">${rows}</ul>
    ${gpuHint}
    ${
      !setupRequirementsPassed
        ? '<p class="setup-error">EditorPilot cannot run until all requirements pass. Try a supported browser or update your GPU drivers.</p>'
        : ''
    }`;
}

async function runSetupRequirementsCheck() {
  setupRequirementsPassed = false;
  updateSetupActions();
  setupBody.innerHTML = '<p class="setup-checking">Checking your browser and device…</p>';

  try {
    const report = await checkEditorRequirements();
    setupRequirementsPassed = report.passed;
    renderRequirementChecks(report);
  } catch (err) {
    console.error('[ERROR]', err);
    setupBody.innerHTML =
      '<p class="setup-error">Could not complete the requirements check. Refresh and try again.</p>';
  }

  updateSetupActions();
}

function renderSetupModelOptions() {
  const cards = MODEL_CATALOG.map((model) => {
    const selected = setupDraft.modelId === model.id;
    const recommended =
      model.id === setupRecommendedModelId ? ' <span class="setup-badge">Recommended</span>' : '';
    return `
      <button type="button" class="setup-option setup-model-option ${selected ? 'selected' : ''}" data-model-id="${model.id}">
        <div>
          <strong>${escapeHtml(model.label)}${recommended}</strong>
          <span class="setup-model-meta">${escapeHtml(model.size)} · ${escapeHtml(model.languages)}</span>
          <span>${escapeHtml(model.description)}</span>
        </div>
      </button>`;
  }).join('');

  setupBody.innerHTML = `
    <p class="setup-hint">Choose a model that fits your device. You can change it later in the header. Smaller models use less GPU memory.</p>
    <div class="setup-options">${cards}</div>
    <div id="setup-model-progress" class="setup-model-progress" hidden>
      <span class="panel-fixing-spinner" aria-hidden="true"></span>
      <span id="setup-model-progress-text">Preparing model…</span>
    </div>`;

  setupBody.querySelectorAll('.setup-model-option').forEach((btn) => {
    btn.addEventListener('click', () => {
      setupDraft.modelId = btn.dataset.modelId;
      setupBody.querySelectorAll('.setup-model-option').forEach((el) => {
        el.classList.toggle('selected', el.dataset.modelId === setupDraft.modelId);
      });
    });
  });
}

async function downloadSetupModel() {
  const modelId = setupDraft.modelId;
  setSelectedModelPref(modelId);
  modelSelect.value = modelId;

  if (isAIReady() && getActiveModelId() === modelId) {
    return true;
  }

  setupModelLoading = true;
  updateSetupActions();

  const progressEl = document.getElementById('setup-model-progress');
  const progressText = document.getElementById('setup-model-progress-text');
  progressEl?.removeAttribute('hidden');

  const statusHandler = ({ text, state, progress }) => {
    if (!progressText) return;
    if (state === 'loading' && progress != null) {
      const pct = Math.min(100, Math.max(0, Math.round(progress * 100)));
      progressText.textContent = `${text} ${pct}%`;
    } else {
      progressText.textContent = text;
    }
  };

  setStatusCallback((payload) => {
    statusHandler(payload);
    handleModelStatus(payload);
  });

  try {
    await initAI(modelId, { force: true });
    await setPreference('selected_model', modelId);
    return true;
  } catch (err) {
    console.error('[ERROR]', err);
    showToast('Could not load that model — try Qwen 0.5B');
    if (progressText) {
      progressText.textContent = 'Download failed. Pick a smaller model and try again.';
    }
    return false;
  } finally {
    setStatusCallback(handleModelStatus);
    setupModelLoading = false;
    updateSetupActions();
  }
}

function applySetupPreview() {
  const theme = setupDraft.darkMode ? 'dark' : setupDraft.colorTheme;
  document.documentElement.dataset.theme = theme;
}

function captureSetupAppearanceSnapshot() {
  setupAppearanceSnapshot = { darkMode, colorTheme };
}

function restoreSetupAppearanceSnapshot() {
  if (!setupAppearanceSnapshot) return;
  darkMode = setupAppearanceSnapshot.darkMode;
  colorTheme = setupAppearanceSnapshot.colorTheme;
  applyAppearance();
}

function renderSetupStep() {
  setupProgress.textContent = `Step ${setupStep + 1} of ${SETUP_STEPS}`;
  updateSetupActions();

  if (setupStep === 0) {
    setupTitle.textContent = 'Welcome to EditorPilot';
    setupMessage.textContent =
      'EditorPilot is an AI writing assistant that lives entirely in your browser. No data leaves your device. No accounts. No tracking. Just better writing.';
    setupBody.innerHTML = '';
    return;
  }

  if (setupStep === 1) {
    setupTitle.textContent = 'Check requirements';
    setupMessage.textContent =
      'EditorPilot needs WebGPU and local storage. We will verify your browser before continuing.';
    void runSetupRequirementsCheck();
    return;
  }

  if (setupStep === 2) {
    setupTitle.textContent = 'Choose your AI model';
    setupMessage.textContent =
      'Models download once and are cached in your browser. Pick a size that matches your GPU memory.';
    renderSetupModelOptions();
    return;
  }

  if (setupStep === 3) {
    setupTitle.textContent = 'How should AI fix your writing?';
    setupMessage.textContent = 'Pick a default style and output language for the Updated Version panel.';
    setupBody.innerHTML = `
      <div class="setup-field">
        <label for="setup-mode">Correction style</label>
        <select id="setup-mode" class="mode-select">
          <option value="grammar">Grammar — fix spelling & grammar</option>
          <option value="professional">Professional — workplace tone</option>
          <option value="simple">Simple — easy to read</option>
          <option value="shorter">Shorter — same meaning, fewer words</option>
          <option value="friendlier">Friendlier — warmer tone</option>
          <option value="email">Email — clean message format</option>
          <option value="creative">Creative — vivid expression</option>
          <option value="formal">Formal — polished register</option>
          <option value="casual">Casual — conversational</option>
        </select>
      </div>
      <div class="setup-field">
        <label for="setup-language">Output language</label>
        <select id="setup-language" class="mode-select">
          <option value="english">English</option>
          <option value="auto">Auto-detect</option>
          <option value="spanish">Spanish</option>
          <option value="french">French</option>
          <option value="german">German</option>
          <option value="portuguese">Portuguese</option>
          <option value="italian">Italian</option>
          <option value="dutch">Dutch</option>
          <option value="chinese">Chinese</option>
          <option value="japanese">Japanese</option>
          <option value="korean">Korean</option>
          <option value="arabic">Arabic</option>
          <option value="hindi">Hindi</option>
          <option value="russian">Russian</option>
          <option value="polish">Polish</option>
        </select>
      </div>`;
    document.getElementById('setup-mode').value = STYLE_MODES.has(setupDraft.mode)
      ? setupDraft.mode
      : 'grammar';
    document.getElementById('setup-language').value = setupDraft.outputLanguage || 'english';
    return;
  }

  if (setupStep === 4) {
    setupTitle.textContent = 'Choose your look';
    setupMessage.textContent = 'Pick colors that are easy on your eyes. You can change these anytime.';
    setupBody.innerHTML = `
      <div class="setup-field">
        <label for="setup-theme">Color theme</label>
        <select id="setup-theme" class="theme-select">
          <option value="light-default">Calm Blue</option>
          <option value="light-soft">Soft Gray</option>
          <option value="light-warm">Warm Cream</option>
          <option value="light-sepia">Sepia Read</option>
          <option value="light-ocean">Ocean Teal</option>
          <option value="light-forest">Forest Green</option>
          <option value="light-rose">Rose Blush</option>
          <option value="light-lavender">Lavender</option>
          <option value="light-slate">Slate</option>
        </select>
      </div>
      <div class="setup-field">
        <span class="setup-field-label">Appearance</span>
        <div class="setup-options setup-options-split">
          <button type="button" class="setup-option ${setupDraft.darkMode ? 'selected' : ''}" id="setup-dark-opt" data-value="dark">
            <div><strong>Dark mode</strong><span>Easier on eyes at night</span></div>
          </button>
          <button type="button" class="setup-option ${!setupDraft.darkMode ? 'selected' : ''}" id="setup-light-opt" data-value="light">
            <div><strong>Light mode</strong><span>Uses the color theme above</span></div>
          </button>
        </div>
      </div>`;
    document.getElementById('setup-theme').value = setupDraft.colorTheme;
    document.getElementById('setup-theme').addEventListener('change', (e) => {
      setupDraft.colorTheme = e.target.value;
      applySetupPreview();
    });
    document.getElementById('setup-dark-opt').addEventListener('click', () => {
      setupDraft.darkMode = true;
      document.getElementById('setup-dark-opt').classList.add('selected');
      document.getElementById('setup-light-opt').classList.remove('selected');
      applySetupPreview();
    });
    document.getElementById('setup-light-opt').addEventListener('click', () => {
      setupDraft.darkMode = false;
      document.getElementById('setup-light-opt').classList.add('selected');
      document.getElementById('setup-dark-opt').classList.remove('selected');
      applySetupPreview();
    });
    applySetupPreview();
    return;
  }

  if (setupStep === 5) {
    setupTitle.textContent = 'Quick guide';
    setupMessage.textContent = 'A few things to know about your workspace.';
    setupBody.innerHTML = `
      <ul class="setup-guide-list">
        <li><strong>Focus</strong> — Dim everything and write full width (button on Write Here)</li>
        <li><strong>Offline use</strong> — Install the app from your browser first; wait for the model to finish downloading before going offline</li>
        <li><strong>Export</strong> — Download all drafts & settings as a backup file</li>
        <li><strong>Import</strong> — Restore from a backup (replaces local data)</li>
        <li><strong>Delete All</strong> — Erase everything on this device</li>
        <li><strong>Change model</strong> — Pick a local model in the header (cached after first load)</li>
      </ul>`;
  }

  if (setupStep >= 4) {
    applySetupPreview();
  }
}

function collectSetupStep() {
  if (setupStep === 2) {
    const selected = setupBody.querySelector('.setup-model-option.selected');
    if (selected?.dataset.modelId) {
      setupDraft.modelId = selected.dataset.modelId;
    }
  }
  if (setupStep === 3) {
    const lang = document.getElementById('setup-language')?.value || 'english';
    const mode = document.getElementById('setup-mode')?.value || 'grammar';
    setupDraft.outputLanguage = lang;
    setupDraft.mode = mode;
  }
  if (setupStep === 4) {
    setupDraft.colorTheme = document.getElementById('setup-theme')?.value || 'light-default';
  }
}

async function finishSetup() {
  collectSetupStep();

  colorTheme = setupDraft.colorTheme;
  darkMode = setupDraft.darkMode;
  applyAppearance();
  await saveAppearancePrefs();

  setMode(setupDraft.mode);
  setOutputLanguage(setupDraft.outputLanguage || 'english');

  setSelectedModelPref(setupDraft.modelId);
  modelSelect.value = setupDraft.modelId;
  await setPreference('selected_model', setupDraft.modelId);

  await setPreference('setup_complete', '1');
  setupMandatory = false;
  setupAppearanceSnapshot = null;
  setupOverlay.hidden = true;
  updateSetupActions();
  showToast('Welcome to EditorPilot');
}

function openSetupWizard(resetStep = false, mandatory = false) {
  setupMandatory = mandatory;
  if (resetStep) {
    setupStep = 0;
    setupRequirementsPassed = false;
    setupModelLoading = false;
    setupDraft = {
      mode: currentMode,
      outputLanguage,
      colorTheme,
      darkMode,
      modelId: getSelectedModelPref() !== 'auto' ? getSelectedModelPref() : MODEL_CATALOG[0].id,
    };
    captureSetupAppearanceSnapshot();
  }
  renderSetupStep();
  setupOverlay.hidden = false;
}

async function closeSetupWizard() {
  if (setupMandatory) return;
  if (setupStep > 0) {
    collectSetupStep();
  }
  restoreSetupAppearanceSnapshot();
  setupAppearanceSnapshot = null;
  setupOverlay.hidden = true;
}

function bindSetupWizard() {
  setupNext.addEventListener('click', async () => {
    collectSetupStep();

    if (setupStep === 2) {
      const loaded = await downloadSetupModel();
      if (!loaded) return;
    }

    if (setupStep < SETUP_STEPS - 1) {
      setupStep++;
      renderSetupStep();
    } else {
      await finishSetup();
    }
  });

  setupBack.addEventListener('click', () => {
    if (setupModelLoading) return;
    if (setupStep > 0) {
      collectSetupStep();
      if (setupStep === 4) {
        restoreSetupAppearanceSnapshot();
      }
      setupStep--;
      renderSetupStep();
    }
  });

  setupClose.addEventListener('click', () => {
    void closeSetupWizard();
  });
}

// ---- PWA install ----

let deferredInstallPrompt = null;

function isAppInstalled() {
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    window.matchMedia('(display-mode: window-controls-overlay)').matches ||
    window.navigator.standalone === true
  );
}

async function promptAppInstall() {
  if (!deferredInstallPrompt) return false;
  deferredInstallPrompt.prompt();
  const { outcome } = await deferredInstallPrompt.userChoice;
  deferredInstallPrompt = null;
  document.getElementById('btn-install')?.setAttribute('hidden', '');
  document.getElementById('offline-hint-install')?.setAttribute('hidden', '');
  hideOfflineHint();
  if (outcome === 'accepted') {
    showToast('EditorPilot installed — open from your desktop or home screen');
  }
  return outcome === 'accepted';
}

function hideOfflineHint() {
  const hint = document.getElementById('offline-hint');
  if (hint) hint.hidden = true;
}

function showOfflineInstallButton() {
  document.getElementById('btn-install')?.removeAttribute('hidden');
  document.getElementById('offline-hint-install')?.removeAttribute('hidden');
}

async function initOfflineHint() {
  const hint = document.getElementById('offline-hint');
  if (!hint || isAppInstalled()) return;

  try {
    const dismissed = await getPreference('offline_hint_dismissed');
    if (dismissed === '1') return;
  } catch {
    /* show hint even if prefs unavailable */
  }

  hint.hidden = false;

  document.getElementById('offline-hint-close')?.addEventListener('click', async () => {
    hideOfflineHint();
    try {
      await setPreference('offline_hint_dismissed', '1');
    } catch {
      /* ignore */
    }
  });

  document.getElementById('offline-hint-install')?.addEventListener('click', () => {
    void promptAppInstall();
  });
}

function bindPwaInstall() {
  const btnInstall = document.getElementById('btn-install');
  if (!btnInstall) return;

  if (isAppInstalled()) {
    btnInstall.hidden = true;
    hideOfflineHint();
    return;
  }

  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredInstallPrompt = e;
    showOfflineInstallButton();
  });

  btnInstall.addEventListener('click', () => {
    void promptAppInstall();
  });

  window.addEventListener('appinstalled', () => {
    deferredInstallPrompt = null;
    btnInstall.hidden = true;
    hideOfflineHint();
  });
}

// ---- Event bindings ----

function bindEvents() {
  editor.addEventListener('focus', () => {
    if (!editor.querySelector('.grammar-issue')) return;
    const offset = getCaretOffset(editor);
    const text = syncEditorPlainText();
    editor.textContent = text;
    setCaretOffset(editor, Math.min(offset, text.length));
  });

  editor.addEventListener('input', () => {
    syncEditorPlainText();
    updateDocStats(syncEditorPlainText());
    if (compareMode && correctedText) refreshUpdatePanel();
    clearTimeout(undoInputTimer);
    undoInputTimer = setTimeout(() => pushUndoSnapshot(), 500);
    scheduleDebouncedAI();
    scheduleAutosave();
  });

  editor.addEventListener('blur', () => {
    const text = syncEditorPlainText();
    if (text.length >= MIN_TEXT_LENGTH) {
      renderHighlights(analyzeGrammarIssuesLocal(text), true);
    }
  });

  editor.addEventListener('click', (e) => {
    const span = e.target.closest('.grammar-issue');
    if (!span) {
      hideIssuePopup();
      return;
    }

    const issueId = span.dataset.issueId;
    const issue = grammarIssues.find((i) => i.id === issueId);
    if (issue) {
      showIssuePopup(issue, e.clientX, e.clientY);
    }
  });

  document.addEventListener('click', (e) => {
    if (!issuePopup.contains(e.target) && !e.target.closest('.grammar-issue')) {
      hideIssuePopup();
    }
  });

  document.getElementById('popup-accept').addEventListener('click', () => {
    if (activeIssueId) acceptSuggestion(activeIssueId);
  });

  document.getElementById('popup-ignore').addEventListener('click', () => {
    if (activeIssueId) ignoreSuggestion(activeIssueId);
  });

  document.querySelectorAll('.mode-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      setMode(btn.dataset.mode);
    });
  });

  outputLanguageSelect.addEventListener('change', () => {
    setOutputLanguage(outputLanguageSelect.value);
  });

  btnFocusMode.addEventListener('click', () => {
    toggleFocusMode();
  });

  document.addEventListener('keydown', (e) => {
    handleGlobalShortcuts(e);
    if (e.key === 'Escape') {
      if (focusMode) setFocusMode(false);
      if (!rewriteOverlay.hidden) closeRewriteModal();
      if (!donationModal.hidden) donationModal.hidden = true;
      if (!legalOverlay.hidden) legalOverlay.hidden = true;
      if (setupMandatory && !setupOverlay.hidden) return;
    }
  });

  btnCompare.addEventListener('click', toggleCompareMode);

  btnDarkToggle.addEventListener('click', () => {
    darkMode = !darkMode;
    applyAppearance();
    saveAppearancePrefs();
  });

  themeSelect.addEventListener('change', () => {
    colorTheme = themeSelect.value;
    applyAppearance();
    saveAppearancePrefs();
  });

  document.getElementById('btn-copy-update').addEventListener('click', () => {
    copyPanelText(correctedText, 'update');
  });

  document.getElementById('btn-undo').addEventListener('click', undoLastChange);

  document.getElementById('btn-rewrite').addEventListener('click', openRewriteModal);

  rewriteCancel.addEventListener('click', closeRewriteModal);

  fontFamilySelect.addEventListener('change', () => {
    editorFormat.fontFamily = fontFamilySelect.value;
    applyEditorFormat();
    saveFormatPrefs();
  });

  fontSizeSelect.addEventListener('change', () => {
    editorFormat.fontSize = fontSizeSelect.value;
    applyEditorFormat();
    saveFormatPrefs();
  });

  btnBold.addEventListener('click', () => {
    editorFormat.bold = !editorFormat.bold;
    applyEditorFormat();
    saveFormatPrefs();
  });

  btnItalic.addEventListener('click', () => {
    editorFormat.italic = !editorFormat.italic;
    applyEditorFormat();
    saveFormatPrefs();
  });

  document.querySelectorAll('.footer-link').forEach((btn) => {
    btn.addEventListener('click', () => showLegalModal(btn.dataset.legal));
  });

  legalClose.addEventListener('click', () => {
    legalOverlay.hidden = true;
  });

  btnDonate?.addEventListener('click', () => {
    donationModal.hidden = false;
  });

  closeDonationModal.addEventListener('click', () => {
    donationModal.hidden = true;
  });

  document.getElementById('btn-clear').addEventListener('click', async () => {
    const confirmed = await showConfirmModal({
      title: 'Clear writing?',
      message: 'This clears the writing area and the update panel.',
      confirmText: 'Clear',
      danger: true,
    });
    if (!confirmed) return;

    bumpRequestGeneration();
    undoStack = [];
    setEditorPlainText('');
    correctedText = '';
    grammarIssues = [];
    updateNewUpdatePanel('');
    updateScores('');
    clearHighlights();
    lengthWarning.hidden = true;
    scheduleAutosave();
  });

  modelSelect.addEventListener('change', async () => {
    syncOutputLanguageOptions();
    if (needsMultilingualModel() && !isMultilingualCapableModel(modelSelect.value)) {
      modelSelect.value = GEMMA_2B_MODEL_ID;
      showToast('This language uses Gemma 2 2B or Gemma 2 9B');
      return;
    }
    const pref = modelSelect.value;
    setSelectedModelPref(pref);
    await setPreference('selected_model', pref).catch((err) => console.error('[ERROR]', err));
    modelSelect.disabled = true;
    try {
      await switchModel(pref);
      syncOutputLanguageOptions();
      scheduleDebouncedAI();
      showToast('Model changed');
    } catch (err) {
      console.error('[ERROR]', err);
      showToast('Could not load that model');
    } finally {
      modelSelect.disabled = false;
    }
  });

  document.getElementById('btn-export').addEventListener('click', exportWorkspace);

  document.getElementById('btn-import').addEventListener('click', () => {
    document.getElementById('import-file').click();
  });

  document.getElementById('import-file').addEventListener('change', (e) => {
    const file = e.target.files?.[0];
    if (file) importWorkspace(file);
    e.target.value = '';
  });

  document.getElementById('btn-delete-all').addEventListener('click', deleteAllLocalData);

  document.getElementById('btn-setup').addEventListener('click', () => openSetupWizard(true, false));

  window.addEventListener('pagehide', () => {
    clearTimeout(autosaveTimer);
    void performAutosave();
  });

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') {
      clearTimeout(autosaveTimer);
      void performAutosave();
    }
  });
}

// ---- Bootstrap ----

async function bootstrap() {
  await checkAppVersion();

  bindEvents();
  bindPwaInstall();
  bindSetupWizard();
  setFixing(false);
  updateNewUpdatePanel('');
  updateDocStats('');

  try {
    await initDatabase();
    await initOfflineHint();

    const ignored = await getIgnoredIssues();
    ignored.forEach((row) => {
      ignoredPatterns.add(`${row.original_text}::${row.suggestion}`);
    });

    const savedOutputLang = await getPreference('output_language');
    if (savedOutputLang && OUTPUT_LANGUAGES.some((l) => l.id === savedOutputLang)) {
      outputLanguage = savedOutputLang;
      outputLanguageSelect.value = savedOutputLang;
    }

    const savedMode = await getPreference('last_mode');
    if (savedMode) {
      setActiveModeButton(savedMode);
    }
    syncModelForLanguage();

    await loadFormatPrefs();

    const savedDark = await getPreference('dark_mode');
    darkMode = savedDark === '1';
    const savedTheme = await getPreference('color_theme');
    if (savedTheme) {
      colorTheme = savedTheme;
    }
    applyAppearance();

    const savedFocus = await getPreference('focus_mode');
    setFocusMode(savedFocus === '1', false);

    const savedModel = await getPreference('selected_model');
    if (savedModel) {
      setSelectedModelPref(savedModel);
      modelSelect.value = savedModel;
    } else {
      modelSelect.value = getSelectedModelPref();
    }

    const setupDone = await getPreference('setup_complete');
    if (setupDone !== '1') {
      openSetupWizard(true, true);
    } else {
      statusText.textContent = 'Starting…';
      try {
        await initAI(getSelectedModelPref());
      } catch (err) {
        console.error('[ERROR]', err);
        showToast('Model failed to load — try a smaller model in the header');
      }
    }

    const docs = await getDocuments(1);
    if (docs.length) {
      await loadDraft(docs[0].id, { silent: true });
    } else {
      currentDocId = generateId('doc');
      undoStack = [''];
      await refreshDraftsList();
    }
  } catch (err) {
    console.error('[ERROR]', err);
    const msg = err?.message || 'Database init failed';
    showToast(msg.includes('locked') ? msg : `Storage error — ${msg}`);
  }
}

bootstrap();

// Expose grammar API on window for debugging
window.EditorPilot = {
  analyzeGrammarIssues,
  renderHighlights,
  acceptSuggestion,
  ignoreSuggestion,
  acceptAllSuggestions,
  clearHighlights,
  syncEditorPlainText,
};
