/**
 * EditorPilot — In-app processing log and debug report helpers.
 */

const MAX_LOG_ENTRIES = 250;
const logEntries = [];
let lastError = null;

function formatTime(iso) {
  try {
    return new Date(iso).toLocaleTimeString(undefined, {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
  } catch {
    return iso;
  }
}

export function appendProcessingLog(level, message, details = null) {
  const entry = {
    ts: new Date().toISOString(),
    level,
    message: String(message || ''),
    details: details ?? null,
  };
  logEntries.push(entry);
  if (logEntries.length > MAX_LOG_ENTRIES) {
    logEntries.splice(0, logEntries.length - MAX_LOG_ENTRIES);
  }
  if (level === 'error') {
    lastError = entry;
  }
  return entry;
}

export function getProcessingLog() {
  return [...logEntries];
}

export function getLastError() {
  return lastError ? { ...lastError } : null;
}

export function clearProcessingLog() {
  logEntries.length = 0;
}

export function formatLogForDisplay(entries = logEntries) {
  if (!entries.length) {
    return 'No log entries yet. Processing activity will appear here.';
  }
  return entries
    .map((entry) => {
      const detail =
        entry.details == null
          ? ''
          : typeof entry.details === 'string'
            ? ` — ${entry.details}`
            : ` — ${JSON.stringify(entry.details)}`;
      return `[${formatTime(entry.ts)}] ${entry.level.toUpperCase()}: ${entry.message}${detail}`;
    })
    .join('\n');
}

export async function buildDebugReport(context = {}) {
  let webgpu = 'unknown';
  try {
    if (navigator.gpu) {
      const adapter = await navigator.gpu.requestAdapter();
      webgpu = adapter ? 'available' : 'unavailable';
    } else {
      webgpu = 'unsupported';
    }
  } catch (err) {
    webgpu = `error: ${err?.message || err}`;
  }

  return {
    generatedAt: new Date().toISOString(),
    appVersion: context.appVersion || 'unknown',
    reviewMode: context.reviewMode || 'unknown',
    outputLanguage: context.outputLanguage || 'unknown',
    correctionMode: context.correctionMode || 'unknown',
    modelId: context.modelId || 'unknown',
    browser: navigator.userAgent,
    platform: navigator.platform || 'unknown',
    language: navigator.language || 'unknown',
    deviceMemoryGB: navigator.deviceMemory ?? 'unknown',
    cpuCores: navigator.hardwareConcurrency ?? 'unknown',
    webgpu,
    screen: typeof screen !== 'undefined' ? `${screen.width}x${screen.height}` : 'unknown',
    pixelRatio: typeof devicePixelRatio !== 'undefined' ? devicePixelRatio : 'unknown',
    online: navigator.onLine,
    lastError: getLastError(),
    processingLog: getProcessingLog(),
  };
}

export function openBugReportEmail(reportText, appVersion = '') {
  const subject = encodeURIComponent(`EditorPilot Bug Report${appVersion ? ` v${appVersion}` : ''}`);
  const summary = reportText.length > 1200 ? `${reportText.slice(0, 1200)}\n\n… (truncated — full report copied to clipboard)` : reportText;
  const body = encodeURIComponent(
    `Describe what happened:\n\n\n\n--- Debug report ---\n${summary}\n\n(Paste the full report from your clipboard if it was truncated.)`
  );
  window.location.href = `mailto:bug@editorpilot.com?subject=${subject}&body=${body}`;
}
