// Turns raw speech-model output into timed caption cues (shared by the app and the benchmark).
import { speechEnvelope, alignLong, refineWords } from './align.js';

const uid = () => (crypto.randomUUID ? crypto.randomUUID() : String(Math.random()).slice(2));
const SENTENCE_END = /[.?!।॥|۔؟]["')\]]*$/;

/**
 * @param res      worker result { chunks, wordLevel }
 * @param audio    Float32Array 16 kHz mono (for alignment / refinement)
 * @param duration media duration in seconds
 * @param opts     { refine: true, align: true }
 */
export function buildCues(res, audio, duration, opts = {}) {
  const refine = opts.refine !== false, align = opts.align !== false;
  const env = audio && (refine || align) ? speechEnvelope(audio) : null;
  const pieces = res.pieces || [{ wordLevel: res.wordLevel, chunks: res.chunks, end: duration }];
  const words = pieces.flatMap((p) => piecesWords(p, env, audio, duration, refine, align));
  return groupWords(words);
}

function piecesWords(res, env, audio, duration, refine, align) {
  duration = res.end ?? duration;
  let words;
  if (res.wordLevel) {
    words = res.chunks
      .map((c) => ({ text: c.text.trim(), start: c.timestamp[0], end: c.timestamp[1] }))
      .filter((w) => w.text && w.start != null);
    words.forEach((w, i) => {
      if (w.end == null || w.end <= w.start) w.end = words[i + 1]?.start ?? Math.min(duration, w.start + 0.4);
    });
    if (env && refine) words = refineWords(env, words);
  } else {
    words = [];
    res.chunks.forEach((c, i) => {
      const text = c.text.trim();
      if (!text) return;
      const start = c.timestamp[0] ?? res.offset ?? 0;
      const end = c.timestamp[1] ?? res.chunks[i + 1]?.timestamp[0] ?? duration;
      const ws = env && align ? alignLong(env, text, start, Math.min(end, duration), audio) : evenWords(text, start, end);
      words.push(...ws);
    });
  }
  return words;
}

function evenWords(text, start, end) {
  const parts = text.split(/\s+/).filter(Boolean);
  const d = (end - start) / Math.max(1, parts.length);
  return parts.map((p, i) => ({ text: p, start: start + i * d, end: start + (i + 1) * d }));
}

/** Group words into caption lines: break at sentence ends, pauses, or ~8 words / 4 s. */
export function groupWords(words) {
  const cues = [];
  let cur = [];
  const flush = () => {
    if (!cur.length) return;
    cues.push({ id: uid(), start: cur[0].start, end: cur[cur.length - 1].end, text: cur.map((w) => w.text).join(' '), words: cur });
    cur = [];
  };
  for (const w of words) {
    const prev = cur[cur.length - 1];
    if (prev && (w.start - prev.end > 0.7 || cur.length >= 8 || w.start - cur[0].start > 4 || SENTENCE_END.test(prev.text))) flush();
    cur.push(w);
  }
  flush();
  return cues;
}
