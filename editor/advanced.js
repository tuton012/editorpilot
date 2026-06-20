/**
 * EditorPilot — Advanced settings, templates, and review-mode helpers.
 */

export const REVIEW_MODES = {
  INCREMENTAL: 'incremental',
  WHOLE: 'whole',
};

export const BUILTIN_TEMPLATES = [
  {
    id: 'tpl_email',
    name: 'Professional email',
    body: 'Subject: \n\nHi [Name],\n\nI hope you are well.\n\n[Your message here]\n\nBest regards,\n[Your name]',
  },
  {
    id: 'tpl_followup',
    name: 'Meeting follow-up',
    body: 'Hi [Name],\n\nThank you for meeting today. Here is a quick summary of what we discussed:\n\n• \n• \n\nNext steps:\n\nBest,\n[Your name]',
  },
  {
    id: 'tpl_apology',
    name: 'Apology message',
    body: 'Hi [Name],\n\nI am sorry for [issue]. I understand how frustrating this must be.\n\nHere is what I am doing to fix it:\n\n\nThank you for your patience.\n\nBest,\n[Your name]',
  },
  {
    id: 'tpl_cover',
    name: 'Cover letter',
    body: 'Dear Hiring Manager,\n\nI am writing to apply for [role] at [company].\n\n[Why you are a strong fit — 2–3 sentences]\n\nI would welcome the chance to discuss how I can contribute to your team.\n\nSincerely,\n[Your name]',
  },
  {
    id: 'tpl_social',
    name: 'Social post',
    body: 'Hook line that grabs attention.\n\nMain point in 1–2 short sentences.\n\nCall to action or question for readers.',
  },
];

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
    customTemplates: [],
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
      settings.customTemplates = Array.isArray(parsed.customTemplates) ? parsed.customTemplates : [];
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

function splitSegments(text) {
  if (!text?.trim()) return [];
  return text.split(/(?<=[.!?])\s+|\n\n+/).filter((s) => s.trim());
}

/** Sentence-level change sets for accept/reject review mode. */
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

  const origSegs = splitSegments(original);
  const corrSegs = splitSegments(corrected);
  const changes = [];
  const maxLen = Math.max(origSegs.length, corrSegs.length);

  for (let i = 0; i < maxLen; i++) {
    const o = origSegs[i]?.trim() ?? '';
    const s = corrSegs[i]?.trim() ?? '';
    if (o === s) continue;

    if (o && s) {
      changes.push({ id: `chg_${i}`, original: o, suggested: s, status: 'pending', type: 'replace' });
    } else if (o && !s) {
      changes.push({ id: `chg_${i}`, original: o, suggested: '', status: 'pending', type: 'delete' });
    } else if (!o && s) {
      changes.push({ id: `chg_${i}`, original: '', suggested: s, status: 'pending', type: 'insert' });
    }
  }

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

export function allTemplates(settings) {
  return [...BUILTIN_TEMPLATES, ...(settings.customTemplates || [])];
}
