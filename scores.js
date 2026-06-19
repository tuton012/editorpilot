/**
 * CalmWorkspace — local writing quality scores (no server)
 */

function clamp(n, min = 0, max = 100) {
  return Math.min(max, Math.max(min, Math.round(n)));
}

function countSentences(text) {
  const parts = text.split(/[.!?]+/).filter((s) => s.trim().length > 0);
  return Math.max(1, parts.length);
}

function countWords(text) {
  const w = text.trim().match(/\b[\w']+\b/g);
  return w ? w.length : 0;
}

function avgWordsPerSentence(text) {
  return countWords(text) / countSentences(text);
}

/** Grammar score from local issue highlights. */
function scoreGrammar(text, issues) {
  const words = Math.max(1, countWords(text));
  const penalty = issues.length * 4 + issues.filter((i) => i.type === 'spelling').length * 2;
  const density = (penalty / words) * 100;
  return clamp(100 - density * 8);
}

/** Human score — how polished the draft looks before fixing. */
function scoreHuman(text, issues) {
  if (!text || text.length < 3) return 0;
  let score = 88;
  score -= issues.length * 5;
  score -= (text.match(/ {2,}/g) || []).length * 3;
  score -= (text.match(/\b(\w+)\s+\1\b/gi) || []).length * 4;
  if (avgWordsPerSentence(text) > 28) score -= 8;
  if (text === text.toUpperCase() && text.length > 20) score -= 10;
  return clamp(score);
}

/** Model score — improvement vs original when a fix exists. */
function scoreAI(original, corrected) {
  if (!corrected || !original) return null;
  if (corrected.trim() === original.trim()) return clamp(92);

  const origIssues = (original.match(/\b(teh|recieve|definately|wierd)\b/gi) || []).length;
  const fixedIssues = (corrected.match(/\b(teh|recieve|definately|wierd)\b/gi) || []).length;
  let score = 78;
  score += Math.min(18, (origIssues - fixedIssues) * 6);
  score += Math.min(12, Math.abs(countWords(original) - countWords(corrected)) < 5 ? 8 : 4);
  if (corrected.length > original.length * 0.5) score += 4;
  return clamp(score);
}

/** Clarity — sentence length and structure. */
function scoreClarity(text) {
  if (!text || text.length < 3) return 0;
  const avg = avgWordsPerSentence(text);
  let score = 100;
  if (avg > 30) score -= (avg - 30) * 1.5;
  if (avg < 6) score -= (6 - avg) * 2;
  const longWords = (text.match(/\b\w{14,}\b/g) || []).length;
  score -= longWords * 2;
  return clamp(score);
}

/** Readability — simplified Flesch-style estimate. */
function scoreReadability(text) {
  if (!text || text.length < 3) return 0;
  const words = countWords(text);
  const sentences = countSentences(text);
  const syllables = text
    .toLowerCase()
    .split(/\s+/)
    .reduce((sum, word) => sum + Math.max(1, word.replace(/[^a-z]/g, '').length / 3), 0);

  const asl = words / sentences;
  const asw = syllables / Math.max(1, words);
  const flesch = 206.835 - 1.015 * asl - 84.6 * asw;
  return clamp(flesch);
}

/** Punctuation hygiene. */
function scorePunctuation(text) {
  if (!text) return 0;
  let score = 100;
  score -= (text.match(/[a-zA-Z]{2,}[.!?]{2,}/g) || []).length * 5;
  score -= (text.match(/\s+[,.]/g) || []).length * 4;
  score -= (text.match(/[,.](?!\s|$)/g) || []).length * 2;
  if (!/[.!?]$/.test(text.trim()) && text.trim().length > 40) score -= 5;
  return clamp(score);
}

export function computeWritingScores(original, aiFixed, newUpdate, issues) {
  return {
    human: scoreHuman(original, issues),
    grammar: scoreGrammar(original, issues),
    clarity: scoreClarity(original),
    readability: scoreReadability(original),
    punctuation: scorePunctuation(original),
    model: scoreAI(original, newUpdate || aiFixed),
  };
}
