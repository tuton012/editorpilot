/**
 * EditorPilot — Advanced settings and review-mode helpers.
 */

export const REVIEW_MODES = {
  INCREMENTAL: 'incremental',
  WHOLE: 'whole',
};

export function parseLines(text) {
  return String(text || '')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);
}

export function defaultAdvancedSettings() {
  return {
    customRules: [],
    personalDictionary: [],
    blockedPhrases: [],
  };
}

export async function loadAdvancedSettings(getPreference) {
  const settings = defaultAdvancedSettings();
  try {
    const raw = await getPreference('advanced_settings');
    if (raw) {
      const parsed = JSON.parse(raw);
      settings.customRules = Array.isArray(parsed.customRules) ? parsed.customRules : [];
      settings.personalDictionary = Array.isArray(parsed.personalDictionary)
        ? parsed.personalDictionary
        : [];
      settings.blockedPhrases = Array.isArray(parsed.blockedPhrases) ? parsed.blockedPhrases : [];
    }
  } catch (err) {
    console.warn('[ADVANCED] Could not load settings', err);
  }
  return settings;
}

export async function saveAdvancedSettings(setPreference, settings) {
  await setPreference('advanced_settings', JSON.stringify(settings));
}

export function buildWritingContextBlock(settings = defaultAdvancedSettings()) {
  const parts = [];
  if (settings.personalDictionary?.length) {
    parts.push(
      `Never change, remove, or "correct" these words or names: ${settings.personalDictionary.join(', ')}.`
    );
  }
  if (settings.blockedPhrases?.length) {
    parts.push(
      `Do not use these words or phrases in the output: ${settings.blockedPhrases.join(', ')}.`
    );
  }
  if (settings.customRules?.length) {
    parts.push(`Follow these writing rules:\n${settings.customRules.map((r) => `- ${r}`).join('\n')}`);
  }
  return parts.length ? `\n\n${parts.join('\n')}` : '';
}

function tokenizeWords(text) {
  return String(text || '').match(/\S+/g) || [];
}

function lcsMatrix(a, b) {
  const m = a.length;
  const n = b.length;
  const dp = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (a[i - 1] === b[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1] + 1;
      } else {
        dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
      }
    }
  }
  return dp;
}

function wordDiffOps(original, corrected) {
  const a = tokenizeWords(original);
  const b = tokenizeWords(corrected);
  const dp = lcsMatrix(a, b);
  const ops = [];
  let i = a.length;
  let j = b.length;

  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && a[i - 1] === b[j - 1]) {
      ops.unshift({ type: 'equal', word: a[i - 1] });
      i--;
      j--;
    } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
      ops.unshift({ type: 'insert', word: b[j - 1] });
      j--;
    } else {
      ops.unshift({ type: 'delete', word: a[i - 1] });
      i--;
    }
  }

  return ops;
}

function groupWordDiffOps(ops) {
  const changes = [];
  let chunk = null;

  const flush = () => {
    if (!chunk) return;
    const original = chunk.origWords.join(' ');
    const suggested = chunk.suggWords.join(' ');
    if (original || suggested) {
      changes.push({
        id: `chg_${changes.length}`,
        original,
        suggested,
        status: 'pending',
        type: !original ? 'insert' : !suggested ? 'delete' : 'replace',
      });
    }
    chunk = null;
  };

  for (const op of ops) {
    if (op.type === 'equal') {
      flush();
      continue;
    }
    if (!chunk) {
      chunk = { origWords: [], suggWords: [] };
    }
    if (op.type === 'delete') chunk.origWords.push(op.word);
    if (op.type === 'insert') chunk.suggWords.push(op.word);
  }

  flush();
  return changes;
}

/** Reject AI output that rewrites the text instead of correcting it. */
export function isReasonableCorrection(original, corrected) {
  const o = String(original || '').trim();
  const c = String(corrected || '').trim();
  if (!c) return false;
  if (o === c) return true;

  const lenRatio = c.length / Math.max(o.length, 1);
  if (lenRatio > 1.75 || lenRatio < 0.35) return false;

  const origWords = tokenizeWords(o.toLowerCase());
  const corrWords = tokenizeWords(c.toLowerCase());
  if (!corrWords.length) return false;

  const origSet = new Set(origWords);
  const overlap = corrWords.filter((w) => origSet.has(w)).length / corrWords.length;
  return overlap >= 0.45;
}

/** Word-level change sets for accept/reject review mode. */
export function computeChangeSets(original, corrected) {
  if (!corrected?.trim()) return [];
  if (!original?.trim()) {
    return [
      {
        id: 'chg_0',
        original: '',
        suggested: corrected.trim(),
        status: 'pending',
        type: 'insert',
      },
    ];
  }
  if (original.trim() === corrected.trim()) return [];
  if (!isReasonableCorrection(original, corrected)) return [];

  const changes = groupWordDiffOps(wordDiffOps(original, corrected));
  if (!changes.length && original.trim() !== corrected.trim()) {
    changes.push({
      id: 'chg_full',
      original: original.trim(),
      suggested: corrected.trim(),
      status: 'pending',
      type: 'replace',
    });
  }

  return changes;
}

export function hasPendingReviewChanges(changes) {
  return Array.isArray(changes) && changes.some((c) => c.status === 'pending');
}
