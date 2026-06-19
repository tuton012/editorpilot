/**
 * CalmWorkspace — Local WebGPU AI engine (WebLLM)
 */

import * as webllm from 'https://esm.run/@mlc-ai/web-llm';

export const GEMMA_MODEL_ID = 'gemma-2-9b-it-q4f16_1-MLC';
export const APP_NAME = 'EditorPilot';
export const MIN_TEXT_LENGTH = 3;
export const MAX_CORRECTION_LENGTH = 8000;
export const MAX_HIGHLIGHT_LENGTH = 2000;

export const AVAILABLE_MODELS = [
  { id: 'auto', label: 'Auto (recommended)' },
  { id: 'Qwen2.5-0.5B-Instruct-q4f32_1-MLC', label: 'Qwen 0.5B' },
  { id: 'Qwen2.5-1.5B-Instruct-q4f32_1-MLC', label: 'Qwen 1.5B' },
  { id: 'gemma-2-9b-it-q4f16_1-MLC', label: 'Gemma 2 9B' },
];

const MODEL_CANDIDATES = {
  weak: 'Qwen2.5-0.5B-Instruct-q4f32_1-MLC',
  normal: 'Qwen2.5-1.5B-Instruct-q4f32_1-MLC',
  fallback: 'Qwen2.5-0.5B-Instruct-q4f32_1-MLC',
};

let selectedModelPref = 'auto';

let engine = null;
let currentModelId = null;
let isReady = false;
let isLoading = false;
let sessionId = 0;
let onStatusChange = null;
let aiChain = Promise.resolve();

export function setStatusCallback(cb) {
  onStatusChange = cb;
}

function emitStatus(text, state, progress) {
  if (onStatusChange) {
    onStatusChange({ text, state, progress });
  }
}

function formatLoadingStatus(progress, statusText = '') {
  const fromCache =
    statusText &&
    /cache|cached|from local|already downloaded/i.test(statusText) &&
    !/download|fetch|network/i.test(statusText);

  if (fromCache) {
    if (progress === undefined || progress === null || Number.isNaN(progress)) {
      return 'Loading from cache…';
    }
    const pct = Math.min(100, Math.max(0, Math.round(progress * 100)));
    return `Loading from cache… ${pct}%`;
  }

  if (progress === undefined || progress === null || Number.isNaN(progress)) {
    return 'Loading…';
  }
  const pct = Math.min(100, Math.max(0, Math.round(progress * 100)));
  return `Loading… ${pct}%`;
}

export function getModelLabel(modelId) {
  const found = AVAILABLE_MODELS.find((m) => m.id === modelId);
  if (found) return found.label;
  if (!modelId) return 'Auto';
  if (modelId.includes('gemma')) return 'Gemma 2 9B';
  if (modelId.includes('0.5B')) return 'Qwen 0.5B';
  if (modelId.includes('1.5B')) return 'Qwen 1.5B';
  return 'Ready';
}

export function resolveModelId(pref) {
  if (!pref || pref === 'auto') return selectModelForDevice();
  return pref;
}

/** Prefer small fast models — never auto-load 3B. */
export function selectModelForDevice() {
  const memory = navigator.deviceMemory || 4;
  if (memory <= 4) {
    return MODEL_CANDIDATES.weak;
  }
  return MODEL_CANDIDATES.normal;
}

export async function checkWebGPUSupport() {
  if (!navigator.gpu) {
    return { supported: false, reason: 'WebGPU is not available in this browser.' };
  }
  try {
    const adapter = await navigator.gpu.requestAdapter();
    if (!adapter) {
      return { supported: false, reason: 'No WebGPU adapter found. Try updating your GPU drivers.' };
    }
    return { supported: true };
  } catch (err) {
    console.error('[ERROR]', err);
    return { supported: false, reason: err.message || 'WebGPU check failed.' };
  }
}

export async function initAI(preferredModel, { force = false } = {}) {
  if (isLoading) return engine;

  const pref = preferredModel || selectedModelPref;
  const modelId = resolveModelId(pref);

  if (!force && isReady && engine && currentModelId === modelId) {
    emitStatus('Ready', 'ready');
    return engine;
  }

  const gpuCheck = await checkWebGPUSupport();
  if (!gpuCheck.supported) {
    emitStatus(gpuCheck.reason, 'error');
    throw new Error(gpuCheck.reason);
  }

  isLoading = true;
  selectedModelPref = pref;
  currentModelId = modelId;

  emitStatus('Loading…', 'loading', 0);

  const modelsToTry = [modelId];
  if (!modelsToTry.includes(MODEL_CANDIDATES.fallback)) {
    modelsToTry.push(MODEL_CANDIDATES.fallback);
  }

  let lastError = null;

  for (const tryModel of modelsToTry) {
    try {
      engine = await webllm.CreateMLCEngine(tryModel, {
        initProgressCallback: (report) => {
          emitStatus(
            formatLoadingStatus(report.progress, report.text),
            'loading',
            report.progress
          );
        },
      });

      currentModelId = tryModel;
      isReady = true;
      isLoading = false;
      emitStatus('Ready', 'ready');
      console.log('[AI] Model ready:', tryModel, '(weights cached in browser after first load)');
      return engine;
    } catch (err) {
      lastError = err;
      console.error('[ERROR]', err);
      engine = null;
      isReady = false;
    }
  }

  isLoading = false;
  const msg = lastError?.message || 'Failed to load model.';
  emitStatus(msg, 'error');
  throw new Error(msg);
}

export async function switchModel(modelPref) {
  const pref = modelPref || 'auto';
  const modelId = resolveModelId(pref);
  selectedModelPref = pref;

  if (isReady && engine && currentModelId === modelId) {
    emitStatus('Ready', 'ready');
    return engine;
  }

  isReady = false;
  engine = null;
  isLoading = false;
  await initAI(pref, { force: true });
}

export function getSelectedModelPref() {
  return selectedModelPref;
}

export function setSelectedModelPref(pref) {
  selectedModelPref = pref || 'auto';
}

export function isAIReady() {
  return isReady && !!engine;
}

export function getCorrectionPrompt(mode, text) {
  return getCorrectionMessages(mode, text).user;
}

/** System + user messages for chat API (stops instruction leak in output). */
export function getCorrectionMessages(mode, text) {
  const instructions = {
    grammar: 'Fix spelling, punctuation, and grammar only. Keep the same meaning and tone.',
    professional: 'Rewrite in a professional, workplace-friendly tone. Keep the same meaning. Do not add facts.',
    simple: 'Rewrite to be simple and clear. Keep the same meaning. Do not add facts.',
    shorter: 'Make shorter while keeping meaning, names, dates, numbers, and links.',
    friendlier: 'Rewrite in a warmer, friendlier tone. Keep the same meaning.',
    email: 'Turn into a clean email or message. Keep the same facts and details.',
    creative: 'Rewrite with more vivid, expressive language while keeping the same meaning.',
    formal: 'Rewrite in a formal, polished register. Keep the same meaning.',
    casual: 'Rewrite in a relaxed, conversational tone. Keep the same meaning.',
    spanish: 'Corrige gramática, ortografía y puntuación en español. Mantén el mismo significado.',
    french: 'Corrigez la grammaire et l\'orthographe en français. Gardez le même sens.',
    german: 'Korrigiere Grammatik und Rechtschreibung auf Deutsch. Gleiche Bedeutung beibehalten.',
    portuguese: 'Corrija gramática e ortografia em português. Mantenha o mesmo significado.',
    italian: 'Correggi grammatica e ortografia in italiano. Mantieni lo stesso significato.',
    dutch: 'Corrigeer grammatica en spelling in het Nederlands. Behoud dezelfde betekenis.',
    chinese: '修正中文的语法、标点和用词，保持原意。',
    japanese: '日本語の文法・表記・句読点を修正し、意味はそのままに。',
    korean: '한국어 맞춤법·문법·띄어쓰기를 교정하고 의미는 동일하게 유지하세요.',
    arabic: 'صحح القواعد والإملاء بالعربية مع الحفاظ على المعنى.',
    hindi: 'हिंदी व्याकरण और वर्तनी सुधारें, अर्थ वही रखें।',
    russian: 'Исправьте грамматику и орфографию на русском, сохраните смысл.',
    polish: 'Popraw gramatykę i ortografię po polsku, zachowaj znaczenie.',
  };

  const task = instructions[mode] || instructions.grammar;

  return {
    system:
      'You are a writing editor. Output ONLY the edited text the user should use. ' +
      'Never repeat the task, instructions, labels, or explanations. No markdown fences.',
    user: `${task}\n\nText to edit:\n${text}`,
  };
}

/** Instruction strings for stripping leaked prompts from model output. */
const INSTRUCTION_SNIPPETS = [
  'Fix spelling', 'Return only', 'Same meaning', 'Corrige gramática', 'ortografía y puntuación',
  'Mismo significado', 'Solo el texto', 'Rewrite', 'Do not add', 'Keep the same',
  'Text to edit', 'Turn into', 'professional', 'workplace-friendly',
];

function cleanCorrectionOutput(raw, originalText, mode) {
  let text = cleanAIOutput(raw);
  if (!text) return '';

  // Drop "Text to edit:" preamble if model echoed structure
  const editMarker = text.toLowerCase().indexOf('text to edit');
  if (editMarker !== -1 && editMarker < 80) {
    text = text.slice(editMarker).replace(/^text to edit:?\s*/i, '').trim();
  }

  // If response has blank line after instruction paragraph, keep body only
  const blocks = text.split(/\n\s*\n/);
  if (blocks.length >= 2) {
    const first = blocks[0].trim();
    const looksLikeInstruction =
      INSTRUCTION_SNIPPETS.some((s) => first.toLowerCase().includes(s.toLowerCase())) &&
      first.length < originalText.length * 1.5;
    if (looksLikeInstruction) {
      text = blocks.slice(1).join('\n\n').trim();
    }
  }

  // Remove known instruction lines at the start
  const lines = text.split('\n');
  while (lines.length > 1) {
    const line = lines[0].trim();
    const isInstruction =
      !line ||
      INSTRUCTION_SNIPPETS.some((s) => line.toLowerCase().includes(s.toLowerCase())) ||
      /^[\-\*•]/.test(line);
    if (!isInstruction || line.length > 200) break;
    lines.shift();
  }
  text = lines.join('\n').trim();

  // Strip wrapping quotes
  text = cleanAIOutput(text);

  // If model returned only instructions, fall back to original
  if (!text || text.length < 2) return originalText;

  const instrHits = INSTRUCTION_SNIPPETS.filter((s) =>
    text.toLowerCase().includes(s.toLowerCase())
  ).length;
  if (instrHits >= 3 && text.length < originalText.length * 0.5) {
    return originalText;
  }

  return text;
}

/** All mode ids and human labels (for UI). */
export const MODE_LABELS = {
  grammar: 'Grammar',
  professional: 'Professional',
  simple: 'Simple',
  shorter: 'Shorter',
  friendlier: 'Friendlier',
  email: 'Email',
  creative: 'Creative',
  formal: 'Formal',
  casual: 'Casual',
  spanish: 'Spanish',
  french: 'French',
  german: 'German',
  portuguese: 'Portuguese',
  italian: 'Italian',
  dutch: 'Dutch',
  chinese: 'Chinese',
  japanese: 'Japanese',
  korean: 'Korean',
  arabic: 'Arabic',
  hindi: 'Hindi',
  russian: 'Russian',
  polish: 'Polish',
};

export const LANGUAGE_MODES = new Set([
  'spanish', 'french', 'german', 'portuguese', 'italian', 'dutch',
  'chinese', 'japanese', 'korean', 'arabic', 'hindi', 'russian', 'polish',
]);

export const STYLE_MODES = new Set([
  'grammar', 'professional', 'simple', 'shorter', 'friendlier', 'email',
  'creative', 'formal', 'casual',
]);

/** Distinct styles for the Rewrite picker (one pass each). */
export const REWRITE_VARIANT_STYLES = [
  { mode: 'professional', label: 'Professional' },
  { mode: 'simple', label: 'Simple & clear' },
  { mode: 'friendlier', label: 'Warm & friendly' },
  { mode: 'shorter', label: 'Concise' },
  { mode: 'formal', label: 'Formal' },
  { mode: 'creative', label: 'Creative' },
];

function getHighlightPrompt(text) {
  return `Return only JSON array of issues with id,startIndex,endIndex,originalText,suggestion,explanation,type. Indexes must match text exactly. [] if none.

${text}`;
}

function cleanAIOutput(raw) {
  if (!raw) return '';
  let text = raw.trim();
  text = text.replace(/^```(?:json|text)?\s*/i, '').replace(/\s*```$/i, '').trim();
  if (
    (text.startsWith('"') && text.endsWith('"')) ||
    (text.startsWith("'") && text.endsWith("'"))
  ) {
    text = text.slice(1, -1);
  }
  return text;
}

function tokenBudget(text, cap = 768) {
  return Math.min(cap, Math.max(96, Math.ceil(text.length * 1.25)));
}

function isStale(requestId) {
  return requestId !== sessionId;
}

async function generateCorrection(mode, text, requestId, options = {}) {
  if (!engine || !isReady) {
    await initAI();
  }
  if (isStale(requestId)) return null;

  const { maxTokens = 512, temperature = 0.1 } = options;
  const { system, user } = getCorrectionMessages(mode, text);

  const reply = await engine.chat.completions.create({
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ],
    temperature,
    max_tokens: maxTokens,
  });

  if (isStale(requestId)) return null;

  const raw = reply?.choices?.[0]?.message?.content || '';
  return cleanCorrectionOutput(raw, text, mode);
}

async function generate(prompt, requestId, options = {}) {
  if (!engine || !isReady) {
    await initAI();
  }
  if (isStale(requestId)) return null;

  const { maxTokens = 512, temperature = 0.1 } = options;

  const reply = await engine.chat.completions.create({
    messages: [{ role: 'user', content: prompt }],
    temperature,
    max_tokens: maxTokens,
  });

  if (isStale(requestId)) return null;

  return cleanAIOutput(reply?.choices?.[0]?.message?.content || '');
}

export function bumpRequestGeneration() {
  sessionId++;
}

export function getRequestGeneration() {
  return sessionId;
}

/** Serialize AI calls; stale sessions exit immediately. */
function runExclusive(requestId, job) {
  if (isStale(requestId)) return Promise.resolve(null);

  const task = async () => {
    if (isStale(requestId)) return null;
    return job();
  };

  const result = aiChain.then(task, task);
  aiChain = result.catch(() => {});
  return result;
}

export async function runRewriteVariants(text, requestId) {
  if (!text || text.length < MIN_TEXT_LENGTH) return [];
  if (text.length > MAX_CORRECTION_LENGTH) return [];
  if (isStale(requestId)) return [];

  return runExclusive(requestId, async () => {
    emitStatus('Checking…', 'loading');
    const variants = [];
    const seen = new Set();

    try {
      for (const spec of REWRITE_VARIANT_STYLES) {
        if (isStale(requestId)) break;
        if (variants.length >= 3) break;

        const result = await generateCorrection(spec.mode, text, requestId, {
          maxTokens: tokenBudget(text, 1024),
          temperature: 0.45,
        });

        if (isStale(requestId)) break;
        if (!result) continue;

        const normalized = result.trim();
        const key = normalized.toLowerCase();
        if (
          normalized.length < MIN_TEXT_LENGTH ||
          key === text.trim().toLowerCase() ||
          seen.has(key)
        ) {
          continue;
        }

        seen.add(key);
        variants.push({ label: spec.label, mode: spec.mode, text: normalized });
      }

      emitStatus('Ready', 'ready');
      return variants;
    } catch (err) {
      console.error('[ERROR]', err);
      emitStatus('Ready', 'ready');
      throw err;
    }
  });
}

export async function runCorrection(mode, text, requestId) {
  if (!text || text.length < MIN_TEXT_LENGTH) return '';
  if (text.length > MAX_CORRECTION_LENGTH) return null;
  if (isStale(requestId)) return null;

  return runExclusive(requestId, async () => {
    console.log('[AI] Correction started');
    emitStatus('Checking…', 'loading');

    try {
      const result = await generateCorrection(mode, text, requestId, {
        maxTokens: tokenBudget(text, 1024),
        temperature: 0.1,
      });

      if (isStale(requestId)) return null;

      console.log('[AI] Correction complete');
      emitStatus('Ready', 'ready');
      return result || '';
    } catch (err) {
      console.error('[ERROR]', err);
    emitStatus('Ready', 'ready');
    throw err;
    }
  });
}

export function parseGrammarIssues(rawJson, sourceText) {
  let parsed;

  try {
    parsed = JSON.parse(rawJson);
  } catch (err) {
    console.error('[HIGHLIGHT ERROR]', err);
    return [];
  }

  if (!Array.isArray(parsed)) {
    if (parsed && Array.isArray(parsed.issues)) {
      parsed = parsed.issues;
    } else {
      return [];
    }
  }

  const valid = [];

  for (let i = 0; i < parsed.length; i++) {
    const issue = parsed[i];
    if (
      typeof issue.startIndex !== 'number' ||
      typeof issue.endIndex !== 'number' ||
      !issue.suggestion
    ) {
      continue;
    }

    const slice = sourceText.slice(issue.startIndex, issue.endIndex);
    if (issue.originalText && slice !== issue.originalText) {
      continue;
    }

    valid.push({
      id: issue.id || `issue_${i + 1}`,
      startIndex: issue.startIndex,
      endIndex: issue.endIndex,
      originalText: slice || issue.originalText || '',
      suggestion: issue.suggestion,
      explanation: issue.explanation || '',
      type: issue.type || 'grammar',
    });
  }

  return valid;
}

/** Fast local checks — no AI, instant underline hints. */
export function analyzeGrammarIssuesLocal(text) {
  if (!text || text.length < MIN_TEXT_LENGTH) return [];

  const issues = [];
  let id = 0;

  const repeated = /\b(\w+)\s+\1\b/gi;
  let m;
  while ((m = repeated.exec(text)) !== null) {
    issues.push({
      id: `local_${++id}`,
      startIndex: m.index,
      endIndex: m.index + m[0].length,
      originalText: m[0],
      suggestion: m[1],
      explanation: 'Repeated word',
      type: 'grammar',
    });
  }

  const doubleSpace = / {2,}/g;
  while ((m = doubleSpace.exec(text)) !== null) {
    issues.push({
      id: `local_${++id}`,
      startIndex: m.index,
      endIndex: m.index + m[0].length,
      originalText: m[0],
      suggestion: ' ',
      explanation: 'Extra space',
      type: 'punctuation',
    });
  }

  const common = [
    [/\bteh\b/gi, 'the'],
    [/\brecieve\b/gi, 'receive'],
    [/\boccured\b/gi, 'occurred'],
    [/\bdefinately\b/gi, 'definitely'],
    [/\bwierd\b/gi, 'weird'],
    [/\bthier\b/gi, 'their'],
    [/\byour\s+welcome\b/gi, "you're welcome"],
  ];

  for (const [pattern, fix] of common) {
    const regex = new RegExp(pattern.source, pattern.flags);
    while ((m = regex.exec(text)) !== null) {
      issues.push({
        id: `local_${++id}`,
        startIndex: m.index,
        endIndex: m.index + m[0].length,
        originalText: m[0],
        suggestion: fix,
        explanation: 'Common spelling mistake',
        type: 'spelling',
      });
    }
  }

  return issues;
}

export async function analyzeGrammarIssues(text, requestId) {
  if (!text || text.length < MIN_TEXT_LENGTH) return [];
  if (text.length > MAX_HIGHLIGHT_LENGTH) return [];
  if (isStale(requestId)) return [];

  return runExclusive(requestId, async () => {
    try {
      const prompt = getHighlightPrompt(text);
      const raw = await generate(prompt, requestId, {
        maxTokens: tokenBudget(text, 512),
        temperature: 0.05,
      });

      if (isStale(requestId) || !raw) return [];

      const issues = parseGrammarIssues(raw, text);
      console.log('[HIGHLIGHT] Issues found:', issues.length);
      return issues;
    } catch (err) {
      console.error('[HIGHLIGHT ERROR]', err);
      return [];
    }
  });
}

export function getCurrentModelId() {
  return currentModelId;
}
