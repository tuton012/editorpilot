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

/** Words, punctuation, and whitespace as separate review tokens. */
function tokenizeForReview(text) {
  const tokens = [];
  const re = /\w+|[^\w\s]|\s+/g;
  let match;
  while ((match = re.exec(text)) !== null) {
    tokens.push({
      text: match[0],
      start: match.index,
      end: match.index + match[0].length,
    });
  }
  return tokens;
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

function diffTokens(origTokens, corrTokens) {
  const a = origTokens.map((t) => t.text);
  const b = corrTokens.map((t) => t.text);
  const dp = lcsMatrix(a, b);
  const ops = [];
  let i = origTokens.length;
  let j = corrTokens.length;

  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && a[i - 1] === b[j - 1]) {
      ops.unshift({ type: 'equal', oi: i - 1, cj: j - 1 });
      i--;
      j--;
    } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
      ops.unshift({ type: 'insert', cj: j - 1 });
      j--;
    } else {
      ops.unshift({ type: 'delete', oi: i - 1 });
      i--;
    }
  }

  return ops;
}

function insertPosition(origTokens, corrTokens, ops, opIndex) {
  let oi = 0;
  let cj = 0;

  for (let k = 0; k < opIndex; k++) {
    const op = ops[k];
    if (op.type === 'equal') {
      oi = op.oi + 1;
      cj = op.cj + 1;
    } else if (op.type === 'delete') {
      oi = op.oi + 1;
    } else if (op.type === 'insert') {
      cj = op.cj + 1;
    }
  }

  if (oi > 0) {
    return origTokens[oi - 1].end;
  }
  if (corrTokens.length && cj > 0) {
    return corrTokens[cj - 1].start;
  }
  return 0;
}

/** One pending item per word or punctuation change. */
function buildWordLevelChanges(original, corrected) {
  const origTokens = tokenizeForReview(original);
  const corrTokens = tokenizeForReview(corrected);
  const ops = diffTokens(origTokens, corrTokens);
  const changes = [];

  for (let i = 0; i < ops.length; i++) {
    const op = ops[i];
    if (op.type === 'equal') continue;

    if (op.type === 'delete' && ops[i + 1]?.type === 'insert') {
      const del = origTokens[op.oi];
      const ins = corrTokens[ops[i + 1].cj];
      changes.push({
        id: `chg_${changes.length}`,
        original: del.text,
        suggested: ins.text,
        startIndex: del.start,
        endIndex: del.end,
        status: 'pending',
        type: 'replace',
      });
      i++;
      continue;
    }

    if (op.type === 'delete') {
      const del = origTokens[op.oi];
      changes.push({
        id: `chg_${changes.length}`,
        original: del.text,
        suggested: '',
        startIndex: del.start,
        endIndex: del.end,
        status: 'pending',
        type: 'delete',
      });
      continue;
    }

    if (op.type === 'insert') {
      const ins = corrTokens[op.cj];
      changes.push({
        id: `chg_${changes.length}`,
        original: '',
        suggested: ins.text,
        startIndex: insertPosition(origTokens, corrTokens, ops, i),
        endIndex: insertPosition(origTokens, corrTokens, ops, i),
        status: 'pending',
        type: 'insert',
      });
    }
  }

  return changes;
}

/** Drop AI-appended content beyond the original text span. */
export function clipCorrectionTarget(original, corrected) {
  const o = String(original || '');
  const c = String(corrected || '');
  if (!o || !c) return c;
  if (c.length <= o.length + Math.max(12, Math.round(o.length * 0.08))) return c;

  const oTrim = o.trimEnd();
  return c.slice(0, oTrim.length);
}

function filterReviewChanges(changes, original) {
  const maxIndex = String(original || '').length;
  return changes.filter((change) => {
    if (change.startIndex >= maxIndex) return false;
    if (change.endIndex > maxIndex) return false;
    return true;
  });
}

export function shiftPendingChanges(changes, editEnd, delta) {
  if (!delta) return changes;
  return changes.map((change) => {
    if (change.status !== 'pending') return change;
    if (change.startIndex >= editEnd) {
      return {
        ...change,
        startIndex: change.startIndex + delta,
        endIndex: change.endIndex + delta,
      };
    }
    return change;
  });
}

/** Reject only obvious AI hallucinations ( huge unrelated rewrites / appends ). */
export function isReasonableCorrection(original, corrected) {
  const o = String(original || '').trim();
  const c = String(corrected || '').trim();
  if (!c) return false;
  if (o === c) return true;

  const clipped = clipCorrectionTarget(o, c);
  const lenRatio = clipped.length / Math.max(o.length, 1);

  if (lenRatio < 0.15) return false;

  if (lenRatio > 2.5) {
    const origWords = tokenizeForReview(o)
      .map((t) => t.text.toLowerCase())
      .filter((t) => /\w/.test(t));
    const corrWords = tokenizeForReview(clipped)
      .map((t) => t.text.toLowerCase())
      .filter((t) => /\w/.test(t));
    if (!corrWords.length) return false;
    const origSet = new Set(origWords);
    const overlap = corrWords.filter((w) => origSet.has(w)).length / corrWords.length;
    if (overlap < 0.2) return false;
  }

  return true;
}

/** Word and punctuation change sets for accept/reject review mode. */
export function computeChangeSets(original, corrected) {
  if (!corrected?.trim()) return [];
  if (!original?.trim()) {
    return [
      {
        id: 'chg_0',
        original: '',
        suggested: corrected.trim(),
        startIndex: 0,
        endIndex: 0,
        status: 'pending',
        type: 'insert',
      },
    ];
  }
  if (original.trim() === corrected.trim()) return [];

  const target = clipCorrectionTarget(original, corrected);
  return filterReviewChanges(buildWordLevelChanges(original, target), original);
}

export function hasPendingReviewChanges(changes) {
  return Array.isArray(changes) && changes.some((c) => c.status === 'pending');
}
