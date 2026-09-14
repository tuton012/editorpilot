/**
 * CalmWorkspace ΓÇö Local WebGPU AI engine (WebLLM)
 */

import * as webllm from 'https://esm.run/@mlc-ai/web-llm';

export const LOCAL_QWEN_1_5B_MODEL_ID = 'Qwen2.5-1.5B-Instruct-q4f16_1-MLC-local';
export const LOCAL_QWEN_3B_MODEL_ID = 'Qwen2.5-3B-Instruct-q4f16_1-MLC-local';
export const LOCAL_QWEN_7B_MODEL_ID = 'Qwen2.5-7B-Instruct-q4f16_1-MLC-local';

export const MULTILINGUAL_MODEL_IDS = new Set([
  LOCAL_QWEN_1_5B_MODEL_ID,
  LOCAL_QWEN_3B_MODEL_ID,
  LOCAL_QWEN_7B_MODEL_ID,
]);
export const APP_NAME = 'EditorPilot';
export const MIN_TEXT_LENGTH = 3;
export const MAX_CORRECTION_LENGTH = 8000;
export const MAX_HIGHLIGHT_LENGTH = 2000;

export const AVAILABLE_MODELS = [
  { id: 'auto', label: 'Auto (recommended)' },
  { id: LOCAL_QWEN_1_5B_MODEL_ID, label: 'Qwen 1.5B (local)' },
  { id: LOCAL_QWEN_3B_MODEL_ID, label: 'Qwen 3B (local)' },
  { id: LOCAL_QWEN_7B_MODEL_ID, label: 'Qwen 7B (local)' },
];

/** User-facing model catalog for setup and model picker. */
export const MODEL_CATALOG = [
  {
    id: LOCAL_QWEN_1_5B_MODEL_ID,
    label: 'Qwen 1.5B (local)',
    size: '~1.0 GB',
    description: 'Local fallback for modest GPUs.',
    languages: 'Many languages',
    tier: 'standard',
    local: true,
  },
  {
    id: LOCAL_QWEN_3B_MODEL_ID,
    label: 'Qwen 3B (local)',
    size: '~2.5 GB',
    description: 'Recommended local grammar model with stronger correction quality.',
    languages: 'Many languages',
    tier: 'mid',
    local: true,
  },
  {
    id: LOCAL_QWEN_7B_MODEL_ID,
    label: 'Qwen 7B (local)',
    size: '~5.1 GB',
    description: 'Highest-quality local grammar and rewriting model.',
    languages: 'Many languages',
    tier: 'heavy',
    local: true,
  },
];

const LOCAL_MODEL_CONFIGS = [
  {
    model_id: LOCAL_QWEN_1_5B_MODEL_ID,
    model: new URL('../model/Qwen2.5-1.5B-Instruct-q4f16_1-MLC/', import.meta.url).href,
    model_lib: new URL('../model/runtime/Qwen2-1.5B-Instruct-q4f16_1_cs1k-webgpu.wasm', import.meta.url).href,
  },
  {
    model_id: LOCAL_QWEN_3B_MODEL_ID,
    model: new URL('../model/Qwen2.5-3B-Instruct-q4f16_1-MLC/', import.meta.url).href,
    model_lib: new URL('../model/runtime/Qwen2.5-3B-Instruct-q4f16_1_cs1k-webgpu.wasm', import.meta.url).href,
  },
  {
    model_id: LOCAL_QWEN_7B_MODEL_ID,
    model: new URL('../model/Qwen2.5-7B-Instruct-q4f16_1-MLC/', import.meta.url).href,
    model_lib: new URL('../model/runtime/Qwen2-7B-Instruct-q4f16_1_cs1k-webgpu.wasm', import.meta.url).href,
  },
];

const WEBLLM_APP_CONFIG = {
  cacheBackend: 'cache',
  model_list: LOCAL_MODEL_CONFIGS,
};

const MODEL_CANDIDATES = {
  ultra: LOCAL_QWEN_1_5B_MODEL_ID,
  weak: LOCAL_QWEN_1_5B_MODEL_ID,
  normal: LOCAL_QWEN_3B_MODEL_ID,
  fallback: LOCAL_QWEN_1_5B_MODEL_ID,
};

let selectedModelPref = 'auto';

let engine = null;
let currentModelId = null;
let isReady = false;
let isLoading = false;
let initPromise = null;
let sessionId = 0;
let onStatusChange = null;
let onModelChange = null;
let aiChain = Promise.resolve();

export function setStatusCallback(cb) {
  onStatusChange = cb;
}

export function setModelChangeCallback(cb) {
  onModelChange = cb;
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

  let pct = null;
  if (progress !== undefined && progress !== null && !Number.isNaN(Number(progress))) {
    pct = Math.min(100, Math.max(0, Math.round(Number(progress) * 100)));
  } else {
    const match = String(statusText || '').match(/(\d{1,3})\s*%/);
    if (match) pct = Number(match[1]);
  }

  if (pct !== null) {
    return fromCache ? `Loading from cacheΓÇª ${pct}%` : `DownloadingΓÇª ${pct}%`;
  }

  return fromCache ? 'Loading from cacheΓÇª 0%' : 'DownloadingΓÇª 0%';
}

export function getCatalogModel(modelId) {
  return MODEL_CATALOG.find((m) => m.id === modelId) || null;
}

export async function isModelCached(modelId) {
  if (!modelId || modelId === 'auto') return false;
  try {
    return await webllm.hasModelInCache(modelId, WEBLLM_APP_CONFIG);
  } catch (err) {
    console.warn('[AI] cache check failed:', err);
    return false;
  }
}

export async function refreshModelsCacheStatus(
  modelIds = MODEL_CATALOG.map((m) => m.id)
) {
  const status = {};
  await Promise.all(
    modelIds.map(async (id) => {
      status[id] = await isModelCached(id);
    })
  );
  return status;
}

export function getModelLabel(modelId) {
  const found = AVAILABLE_MODELS.find((m) => m.id === modelId);
  if (found) return found.label;
  if (!modelId) return 'Auto';
  if (modelId.includes('SmolLM')) return 'SmolLM2 360M';
  if (modelId.includes('Llama-3.2-1B')) return 'Llama 3.2 1B';
  if (modelId.includes('gemma-2-2b')) return 'Gemma 2 2B';
  if (modelId.includes('gemma')) return 'Gemma 2 9B';
  if (modelId.includes('0.5B')) return 'Qwen 0.5B';
  if (modelId.includes('1.5B')) return 'Qwen 1.5B';
  return 'Ready';
}

export function isMultilingualCapableModel(modelId = getActiveModelId()) {
  if (!modelId) return false;
  return MULTILINGUAL_MODEL_IDS.has(modelId);
}

export function resolveModelId(pref) {
  if (!pref || pref === 'auto') return selectModelForDevice();
  return pref;
}

/** Prefer small fast models ΓÇö conservative for integrated GPUs. */
export function selectModelForDevice() {
  const memory = navigator.deviceMemory || 4;
  if (memory >= 16) {
    return MODEL_CANDIDATES.normal;
  }
  if (memory >= 8) {
    return MODEL_CANDIDATES.normal;
  }
  return MODEL_CANDIDATES.fallback;
}

export async function requestWebGPUAdapter() {
  if (!navigator.gpu) return null;

  const optionsList = [
    { powerPreference: 'high-performance' },
    {},
    { powerPreference: 'low-power' },
    { forceFallbackAdapter: true },
  ];

  for (const options of optionsList) {
    try {
      const adapter = await navigator.gpu.requestAdapter(options);
      if (adapter) return adapter;
    } catch (err) {
      console.warn('[WebGPU] Adapter request failed:', options, err);
    }
  }

  return null;
}

function parseBrowserName(userAgent = '') {
  if (/Edg\//.test(userAgent)) return 'Microsoft Edge';
  if (/OPR\//.test(userAgent) || /Opera/.test(userAgent)) return 'Opera';
  if (/Chrome\//.test(userAgent)) return 'Google Chrome';
  if (/Firefox\//.test(userAgent)) return 'Firefox';
  if (/Safari\//.test(userAgent)) return 'Safari';
  return 'Browser';
}

export async function getUserDeviceSpecs(gpuResult = null) {
  const gpu = gpuResult || (await checkWebGPUSupport());
  let gpuName = 'Not detected';
  let gpuVendor = 'ΓÇö';

  if (gpu.adapter) {
    try {
      const info = gpu.adapter.info;
      gpuName = info?.description || info?.device || 'GPU detected';
      gpuVendor = info?.vendor || 'ΓÇö';
    } catch {
      gpuName = 'GPU detected';
    }
  } else if (gpu.warning) {
    gpuName = 'API available (adapter not confirmed in check)';
  } else if (!navigator.gpu) {
    gpuName = 'WebGPU not supported in this browser';
  }

  const userAgent = navigator.userAgent || '';
  const platform =
    navigator.userAgentData?.platform ||
    navigator.platform ||
    'Unknown';

  return {
    browser: parseBrowserName(userAgent),
    platform,
    cpuCores: navigator.hardwareConcurrency || 'Unknown',
    deviceMemoryGB: navigator.deviceMemory
      ? `${navigator.deviceMemory} GB (browser-reported)`
      : 'Unknown (browser did not report)',
    gpu: gpuName,
    gpuVendor,
    webgpuStatus: gpu.confirmed
      ? 'Confirmed'
      : gpu.warning
        ? 'API available ΓÇö will verify when loading model'
        : 'Not available',
    screen: `${window.screen.width} ├ù ${window.screen.height}`,
    pixelRatio: window.devicePixelRatio || 1,
    userAgent,
  };
}

export async function checkWebGPUSupport() {
  if (!navigator.gpu) {
    return { supported: false, reason: 'WebGPU is not available in this browser.' };
  }

  try {
    const adapter = await requestWebGPUAdapter();
    if (adapter) {
      return { supported: true, adapter, confirmed: true };
    }

    // WebGPU API exists but adapter probe failed ΓÇö allow continue; WebLLM may still load.
    return {
      supported: true,
      adapter: null,
      confirmed: false,
      warning:
        'WebGPU API is available but this quick check could not confirm a GPU adapter. You can continue ΓÇö EditorPilot will verify when loading your model.',
    };
  } catch (err) {
    console.error('[ERROR]', err);
    return { supported: false, reason: err.message || 'WebGPU check failed.' };
  }
}

export function checkOPFSSupport() {
  if (!window.isSecureContext) {
    return {
      supported: false,
      reason: 'A secure connection is required (HTTPS or localhost).',
    };
  }
  if (!navigator.storage?.getDirectory) {
    return {
      supported: false,
      reason: 'Local storage is not available. Use Chrome, Edge, Firefox 111+, or Safari 16.4+.',
    };
  }
  return { supported: true };
}

function isIntegratedGPU(description = '') {
  const text = description.toLowerCase();
  if (!text) return true;
  if (/nvidia|geforce|rtx|gtx|quadro|radeon rx|radeon pro [w\d]/i.test(description)) {
    return false;
  }
  return /radeon|intel|iris|uhd|vega|integrated|apple|adreno|mali/i.test(text);
}

export async function checkDeviceCapabilities(gpuResult = null) {
  const gpu = gpuResult || (await checkWebGPUSupport());
  if (!gpu.supported) {
    return {
      supported: false,
      reason: gpu.reason,
      recommendedModelId: MODEL_CANDIDATES.fallback,
      isIntegratedGPU: true,
    };
  }

  let description = '';
  if (gpu.adapter) {
    try {
      const info = gpu.adapter.info;
      description = info?.description || info?.device || '';
    } catch {
      /* adapter.info may be unavailable */
    }
  } else if (gpu.warning) {
    description = 'GPU adapter not confirmed in quick check';
  }

  const integrated = isIntegratedGPU(description);
  const memory = navigator.deviceMemory || 4;
  let recommendedModelId = MODEL_CANDIDATES.normal;

  if (integrated || memory <= 4) {
    recommendedModelId = MODEL_CANDIDATES.fallback;
  } else if (memory >= 16 && !integrated) {
    recommendedModelId = MODEL_CANDIDATES.normal;
  } else if (memory >= 8) {
    recommendedModelId = MODEL_CANDIDATES.normal;
  }

  return {
    supported: true,
    description: description || 'GPU detected',
    isIntegratedGPU: integrated,
    deviceMemoryGB: memory,
    recommendedModelId,
  };
}

export async function checkEditorRequirements() {
  const gpu = await checkWebGPUSupport();
  const specs = await getUserDeviceSpecs(gpu);

  const secure = {
    id: 'secure',
    label: 'Secure connection',
    ok: window.isSecureContext,
    detail: window.isSecureContext
      ? 'Running on HTTPS or localhost'
      : 'Open EditorPilot over HTTPS or localhost.',
  };

  const webgpu = {
    id: 'webgpu',
    label: 'WebGPU',
    ok: gpu.supported,
    warn: !!gpu.warning,
    detail: gpu.warning || (gpu.confirmed ? 'GPU acceleration is available' : gpu.reason),
  };

  const opfsCheck = checkOPFSSupport();
  const opfs = {
    id: 'opfs',
    label: 'Local storage',
    ok: opfsCheck.supported,
    detail: opfsCheck.supported
      ? 'Drafts and settings can be saved on this device'
      : opfsCheck.reason,
  };

  const capabilities = gpu.supported ? await checkDeviceCapabilities(gpu) : null;

  return {
    passed: secure.ok && webgpu.ok && opfs.ok,
    results: [secure, webgpu, opfs],
    capabilities,
    specs,
  };
}

function isGPURecoverableError(err) {
  const msg = String(err?.message || err || '').toLowerCase();
  return (
    msg.includes('device was lost') ||
    msg.includes('already been disposed') ||
    msg.includes('modelnotloaded') ||
    msg.includes('out of memory') ||
    msg.includes('insufficient memory') ||
    msg.includes('gpu')
  );
}

export async function resetAI() {
  sessionId++;
  if (engine) {
    try {
      if (typeof engine.unload === 'function') {
        await engine.unload();
      }
    } catch (err) {
      console.error('[AI] unload failed:', err);
    }
  }
  engine = null;
  currentModelId = null;
  isReady = false;
  isLoading = false;
  initPromise = null;
  aiChain = Promise.resolve();
}

async function recoverFromGPUError() {
  console.warn('[AI] Recovering from GPU error ΓÇö switching to lighter model');
  const previousPref = selectedModelPref;
  await resetAI();
  selectedModelPref = MODEL_CANDIDATES.fallback;
  try {
    await initAI(MODEL_CANDIDATES.fallback, { force: true });
    return previousPref !== MODEL_CANDIDATES.fallback;
  } catch (err) {
    console.error('[AI] Recovery failed:', err);
    throw err;
  }
}

async function safeChatCompletion(createFn, requestId) {
  try {
    return await createFn();
  } catch (err) {
    if (isStale(requestId) || !isGPURecoverableError(err)) {
      throw err;
    }
    console.error('[AI] GPU/runtime error during inference:', err);
    const downgraded = await recoverFromGPUError();
    if (downgraded) {
      emitStatus('Using lighter model after GPU error', 'ready');
      onModelChange?.(MODEL_CANDIDATES.fallback);
    }
    if (isStale(requestId) || !engine || !isReady) {
      return null;
    }
    return createFn();
  }
}

export async function initAI(preferredModel, { force = false } = {}) {
  const pref = preferredModel || selectedModelPref;
  const modelId = resolveModelId(pref);

  if (!force && isReady && engine && currentModelId === modelId) {
    emitStatus('Ready', 'ready');
    return engine;
  }

  if (!force && initPromise) {
    return initPromise;
  }

  initPromise = loadEngine(pref, modelId);

  try {
    return await initPromise;
  } catch (err) {
    initPromise = null;
    throw err;
  }
}

async function loadEngine(pref, modelId) {
  const gpuCheck = await checkWebGPUSupport();
  if (!gpuCheck.supported) {
    emitStatus(gpuCheck.reason, 'error');
    throw new Error(gpuCheck.reason);
  }

  if (engine) {
    await resetAI();
  }

  isLoading = true;
  selectedModelPref = pref;
  currentModelId = modelId;

  emitStatus('LoadingΓÇª', 'loading', 0);

  const modelsToTry = [modelId];
  if (!modelsToTry.includes(MODEL_CANDIDATES.fallback)) {
    modelsToTry.push(MODEL_CANDIDATES.fallback);
  }

  let lastError = null;

  for (const tryModel of modelsToTry) {
    try {
      engine = await webllm.CreateMLCEngine(tryModel, {
        appConfig: WEBLLM_APP_CONFIG,
        initProgressCallback: (report) => {
          emitStatus(
            formatLoadingStatus(report.progress, report.text),
            'loading',
            report.progress
          );
        },
      });

      currentModelId = tryModel;
      selectedModelPref = tryModel === modelId ? pref : MODEL_CANDIDATES.fallback;
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
      if (isGPURecoverableError(err)) {
        await resetAI();
      }
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

  await resetAI();
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

let activeWritingContext = '';

export function setWritingContext(contextBlock = '') {
  activeWritingContext = contextBlock || '';
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
    spanish: 'Corrige gram├ítica, ortograf├¡a y puntuaci├│n en espa├▒ol. Mant├⌐n el mismo significado.',
    french: 'Corrigez la grammaire et l\'orthographe en fran├ºais. Gardez le m├¬me sens.',
    german: 'Korrigiere Grammatik und Rechtschreibung auf Deutsch. Gleiche Bedeutung beibehalten.',
    portuguese: 'Corrija gram├ítica e ortografia em portugu├¬s. Mantenha o mesmo significado.',
    italian: 'Correggi grammatica e ortografia in italiano. Mantieni lo stesso significato.',
    dutch: 'Corrigeer grammatica en spelling in het Nederlands. Behoud dezelfde betekenis.',
    chinese: 'Σ┐«µ¡úΣ╕¡µûçτÜäΦ»¡µ│òπÇüµáçτé╣σÆîτö¿Φ»ì∩╝îΣ┐¥µîüσÄƒµäÅπÇé',
    japanese: 'µùÑµ£¼Φ¬₧πü«µûçµ│òπâ╗Φí¿Φ¿ÿπâ╗σÅÑΦ¬¡τé╣πéÆΣ┐«µ¡úπüùπÇüµäÅσæ│πü»πü¥πü«πü╛πü╛πü½πÇé',
    korean: 'φò£Ω╡¡∞û┤ δº₧∞╢ñδ▓ò┬╖δ¼╕δ▓ò┬╖δ¥ä∞û┤∞ô░Ω╕░δÑ╝ Ω╡É∞áòφòÿΩ│á ∞¥ÿδ»╕δèö δÅÖ∞¥╝φòÿΩ▓î ∞£á∞ºÇφòÿ∞ä╕∞Üö.',
    arabic: '╪╡╪¡╪¡ ╪º┘ä┘é┘ê╪º╪╣╪» ┘ê╪º┘ä╪Ñ┘à┘ä╪º╪í ╪¿╪º┘ä╪╣╪▒╪¿┘è╪⌐ ┘à╪╣ ╪º┘ä╪¡┘ü╪º╪╕ ╪╣┘ä┘ë ╪º┘ä┘à╪╣┘å┘ë.',
    hindi: 'αñ╣αñ┐αñéαñªαÑÇ αñ╡αÑìαñ»αñ╛αñòαñ░αñú αñöαñ░ αñ╡αñ░αÑìαññαñ¿αÑÇ αñ╕αÑüαñºαñ╛αñ░αÑçαñé, αñàαñ░αÑìαñÑ αñ╡αñ╣αÑÇ αñ░αñûαÑçαñéαÑñ',
    russian: '╨ÿ╤ü╨┐╤Ç╨░╨▓╤î╤é╨╡ ╨│╤Ç╨░╨╝╨╝╨░╤é╨╕╨║╤â ╨╕ ╨╛╤Ç╤ä╨╛╨│╤Ç╨░╤ä╨╕╤Ä ╨╜╨░ ╤Ç╤â╤ü╤ü╨║╨╛╨╝, ╤ü╨╛╤à╤Ç╨░╨╜╨╕╤é╨╡ ╤ü╨╝╤ï╤ü╨╗.',
    polish: 'Popraw gramatyk─Ö i ortografi─Ö po polsku, zachowaj znaczenie.',
  };

  const task = instructions[mode] || instructions.grammar;

  return {
    system:
      'You are a writing editor. Output ONLY the edited text the user should use. ' +
      'Never repeat the task, instructions, labels, or explanations. No markdown fences.',
    user: `${task}${activeWritingContext}\n\nText to edit:\n${text}`,
  };
}

/** Instruction strings for stripping leaked prompts from model output. */
const INSTRUCTION_SNIPPETS = [
  'Fix spelling', 'Return only', 'Same meaning', 'Corrige gram├ítica', 'ortograf├¡a y puntuaci├│n',
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
      /^[\-\*ΓÇó]/.test(line);
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
  try {
    await initAI();
  } catch (err) {
    console.error('[ERROR]', err);
    return null;
  }
  if (isStale(requestId) || !engine || !isReady) return null;

  const { maxTokens = 512, temperature = 0.1 } = options;
  const { system, user } = getCorrectionMessages(mode, text);

  const reply = await safeChatCompletion(
    () =>
      engine.chat.completions.create({
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
        temperature,
        max_tokens: maxTokens,
      }),
    requestId
  );

  if (isStale(requestId)) return null;
  if (!reply) return null;

  const raw = reply?.choices?.[0]?.message?.content || '';
  return cleanCorrectionOutput(raw, text, mode);
}

async function generate(prompt, requestId, options = {}) {
  try {
    await initAI();
  } catch (err) {
    console.error('[ERROR]', err);
    return null;
  }
  if (isStale(requestId) || !engine || !isReady) return null;

  const { maxTokens = 512, temperature = 0.1 } = options;

  const reply = await safeChatCompletion(
    () =>
      engine.chat.completions.create({
        messages: [{ role: 'user', content: prompt }],
        temperature,
        max_tokens: maxTokens,
      }),
    requestId
  );

  if (isStale(requestId)) return null;
  if (!reply) return null;

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
    emitStatus('CheckingΓÇª', 'loading');
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
    emitStatus('CheckingΓÇª', 'loading');

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

/** Fast local checks ΓÇö no AI, instant underline hints. */
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

export function getActiveModelId() {
  return currentModelId || resolveModelId(selectedModelPref);
}

export function isSmallTierModel(modelId = getActiveModelId()) {
  if (!modelId) return true;
  if (isMultilingualCapableModel(modelId)) return false;
  return (
    modelId.includes('SmolLM') ||
    modelId.includes('0.5B') ||
    modelId.includes('1.5B') ||
    modelId.includes('Llama-3.2-1B')
  );
}

/** Output / translation targets for the Updated Version panel. */
export const OUTPUT_LANGUAGES = [
  { id: 'english', label: 'English' },
  { id: 'auto', label: 'Auto-detect' },
  { id: 'spanish', label: 'Spanish' },
  { id: 'french', label: 'French' },
  { id: 'german', label: 'German' },
  { id: 'portuguese', label: 'Portuguese' },
  { id: 'italian', label: 'Italian' },
  { id: 'dutch', label: 'Dutch' },
  { id: 'chinese', label: 'Chinese' },
  { id: 'japanese', label: 'Japanese' },
  { id: 'korean', label: 'Korean' },
  { id: 'arabic', label: 'Arabic' },
  { id: 'hindi', label: 'Hindi' },
  { id: 'russian', label: 'Russian' },
  { id: 'polish', label: 'Polish' },
];

export const SMALL_MODEL_LANGUAGES = new Set(['english', 'auto', 'spanish']);

const TRANSLATION_LABELS = Object.fromEntries(
  OUTPUT_LANGUAGES.filter((l) => l.id !== 'auto').map((l) => [l.id, l.label])
);

const CORRECTION_BATCH_SIZE = 3500;

const LANGUAGE_HINTS = [
  { id: 'spanish', re: /[┬┐┬í├▒├í├⌐├¡├│├║├╝]/i, words: /\b(el|la|los|las|que|de|en|un|una|por|con|para|es|est├í|como|pero|m├ís|muy|tambi├⌐n|qu├⌐|hola|gracias)\b/i },
  { id: 'french', re: /[├á├ó├º├⌐├¿├¬├½├«├»├┤├╣├╗├╝]/i, words: /\b(le|la|les|de|des|un|une|et|est|dans|pour|que|qui|avec|pas|plus|tr├¿s|bonjour|merci)\b/i },
  { id: 'german', re: /[├ñ├╢├╝├ƒ]/i, words: /\b(der|die|das|und|ist|in|den|von|zu|mit|sich|auf|f├╝r|nicht|auch|ein|eine|ich|wir)\b/i },
  { id: 'portuguese', re: /[├ú├╡├í├⌐├¡├│├║├º]/i, words: /\b(o|a|os|as|de|que|em|um|uma|para|com|n├úo|por|mais|como|muito|obrigado|ol├í)\b/i },
  { id: 'italian', re: /[├á├¿├⌐├¼├¡├«├▓├│├╣├║]/i, words: /\b(il|lo|la|i|gli|le|di|che|e|un|una|per|con|non|pi├╣|come|molto|ciao|grazie)\b/i },
  { id: 'dutch', re: /[├½├»]/i, words: /\b(de|het|een|en|van|in|is|dat|op|te|voor|met|niet|zijn|ook|als|maar)\b/i },
  { id: 'chinese', re: /[\u4e00-\u9fff]/ },
  { id: 'japanese', re: /[\u3040-\u30ff\u4e00-\u9fff]/ },
  { id: 'korean', re: /[\uac00-\ud7af]/ },
  { id: 'arabic', re: /[\u0600-\u06ff]/ },
  { id: 'hindi', re: /[\u0900-\u097f]/ },
  { id: 'russian', re: /[\u0400-\u04ff]/ },
  { id: 'polish', re: /[─à─ç─Ö┼é┼ä├│┼¢┼║┼╝]/i, words: /\b(i|w|na|z|do|nie|to|jest|si─Ö|┼╝e|od|jak|ale|czy|te┼╝|dla)\b/i },
];

/** Lightweight language guess for auto-detect and translation routing. */
export function detectLanguageHeuristic(text) {
  if (!text || text.length < MIN_TEXT_LENGTH) return 'english';

  const sample = text.slice(0, 4000);
  let best = 'english';
  let bestScore = 0;

  for (const hint of LANGUAGE_HINTS) {
    let score = 0;
    if (hint.re?.test(sample)) score += 3;
    if (hint.words) {
      const hits = sample.match(new RegExp(hint.words.source, 'gi'));
      score += Math.min(6, hits?.length || 0);
    }
    if (score > bestScore) {
      bestScore = score;
      best = hint.id;
    }
  }

  return bestScore >= 2 ? best : 'english';
}

export function splitTextIntoBatches(text, maxChunk = CORRECTION_BATCH_SIZE) {
  if (!text) return [];
  if (text.length <= maxChunk) return [text];

  const batches = [];
  const parts = text.split(/(\n\n+)/);
  let current = '';

  for (const part of parts) {
    if (!part) continue;

    if ((current + part).length <= maxChunk) {
      current += part;
      continue;
    }

    if (current.trim()) {
      batches.push(current);
      current = '';
    }

    if (part.length <= maxChunk) {
      current = part;
      continue;
    }

    for (let i = 0; i < part.length; i += maxChunk) {
      batches.push(part.slice(i, i + maxChunk));
    }
  }

  if (current.trim()) batches.push(current);
  return batches.length ? batches : [text];
}

export function resolveCorrectionMode(styleMode, text, outputLang) {
  const detected = detectLanguageHeuristic(text);
  const mode = STYLE_MODES.has(styleMode) ? styleMode : 'grammar';

  if (outputLang === 'auto') {
    if (mode === 'grammar' && LANGUAGE_MODES.has(detected)) return detected;
    return mode;
  }

  if (mode === 'grammar' && LANGUAGE_MODES.has(detected)) {
    return detected;
  }

  return mode;
}

export function resolveTranslationTarget(outputLang, text) {
  if (!outputLang || outputLang === 'auto') return null;

  const detected = detectLanguageHeuristic(text);
  if (outputLang === detected) return null;

  if (outputLang === 'english' && detected === 'english') return null;

  return outputLang;
}

function getTranslationMessages(targetLang, text) {
  const label = TRANSLATION_LABELS[targetLang] || 'English';
  return {
    system:
      'You are a professional translator. Output ONLY the translated text. ' +
      'Never repeat instructions, labels, or explanations. No markdown fences.',
    user: `Translate the following text into ${label}. Preserve meaning, names, numbers, and links.\n\n${text}`,
  };
}

async function generateTranslation(targetLang, text, requestId, options = {}) {
  if (!text || isStale(requestId)) return null;

  const { maxTokens = tokenBudget(text, 1024), temperature = 0.15 } = options;
  const { system, user } = getTranslationMessages(targetLang, text);

  const reply = await safeChatCompletion(
    () =>
      engine.chat.completions.create({
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
        temperature,
        max_tokens: maxTokens,
      }),
    requestId
  );

  if (isStale(requestId)) return null;
  if (!reply) return null;

  return cleanAIOutput(reply?.choices?.[0]?.message?.content || '') || text;
}

/**
 * Correct (and optionally translate) text in batches ΓÇö no length cap.
 * onProgress({ phase: 'fixing'|'translating', batch, total })
 */
export async function runCorrectionPipeline(styleMode, text, outputLang, requestId, onProgress) {
  if (!text || text.length < MIN_TEXT_LENGTH) return '';

  return runExclusive(requestId, async () => {
    try {
      await initAI();
    } catch (err) {
      console.error('[ERROR]', err);
      return null;
    }
    if (isStale(requestId) || !engine || !isReady) return null;

    const correctionMode = resolveCorrectionMode(styleMode, text, outputLang);
    const batches = splitTextIntoBatches(text);
    const correctedParts = [];

    console.log('[AI] Correction started', { batches: batches.length, mode: correctionMode });

    for (let i = 0; i < batches.length; i++) {
      if (isStale(requestId)) return null;
      onProgress?.({ phase: 'fixing', batch: i + 1, total: batches.length });

      const chunk = batches[i];
      const result = await generateCorrection(correctionMode, chunk, requestId, {
        maxTokens: tokenBudget(chunk, 1536),
        temperature: 0.1,
      });

      if (isStale(requestId)) return null;
      correctedParts.push(result || chunk);
    }

    let merged = correctedParts.join('');

    const translateTarget = resolveTranslationTarget(outputLang, text);
    if (translateTarget) {
      const translateBatches = splitTextIntoBatches(merged);
      const translatedParts = [];

      for (let i = 0; i < translateBatches.length; i++) {
        if (isStale(requestId)) return null;
        onProgress?.({ phase: 'translating', batch: i + 1, total: translateBatches.length });

        const chunk = translateBatches[i];
        const translated = await generateTranslation(translateTarget, chunk, requestId, {
          maxTokens: tokenBudget(chunk, 1536),
          temperature: 0.15,
        });

        if (isStale(requestId)) return null;
        translatedParts.push(translated || chunk);
      }

      merged = translatedParts.join('');
    }

    console.log('[AI] Correction complete');
    emitStatus('Ready', 'ready');
    return merged;
  });
}
