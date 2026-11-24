// AI worker: in-browser speech recognition (Whisper) and translation (NLLB-200).
// Everything runs locally via Transformers.js — no API keys, the video never leaves the device.
import { pipeline, env, Tensor } from 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.8.1';

env.allowLocalModels = false;

// Browsers reject very large single Cache API entries (the translation model has
// ~450 MB files), and Transformers.js would silently re-download them every visit.
// This cache stores big files in 64 MB chunks and stitches them back together lazily.
const CACHE_NAME = 'matraboli-models-v2';
// Cache API ignores URL fragments, so parts are keyed with a query parameter.
const partKey = (key, i) => `${key}${String(key).includes('?') ? '&' : '?'}mb_part=${i}`;
const PART = 64 * 1024 * 1024;
const chunkedCache = {
  async match(key) {
    try {
      const cache = await caches.open(CACHE_NAME);
      const head = await cache.match(key);
      if (!head) return undefined;
      const parts = Number(head.headers.get('x-mb-parts') || 0);
      if (!parts) return head;
      const blobs = [];
      for (let i = 0; i < parts; i++) {
        const p = await cache.match(partKey(key, i));
        if (!p) return undefined; // incomplete — download again
        blobs.push(await p.blob());
      }
      const headers = new Headers(head.headers);
      headers.delete('x-mb-parts');
      const body = new Blob(blobs);
      headers.set('content-length', String(body.size));
      return new Response(body, { headers });
    } catch (e) {
      console.warn('Model cache read failed', e);
      return undefined;
    }
  },
  async put(key, response) {
    try {
      const cache = await caches.open(CACHE_NAME);
      const blob = await response.blob();
      if (blob.size <= PART) { await cache.put(key, new Response(blob, { headers: response.headers })); return; }
      const parts = Math.ceil(blob.size / PART);
      for (let i = 0; i < parts; i++) {
        await cache.put(partKey(key, i), new Response(blob.slice(i * PART, (i + 1) * PART)));
      }
      // Write the index entry last so a half-written file is never treated as complete.
      const headers = new Headers(response.headers);
      headers.set('x-mb-parts', String(parts));
      await cache.put(key, new Response('', { headers }));
    } catch (e) {
      console.warn('Model cache write failed (will download again next time)', e);
    }
  },
};
for (const old of ['transformers-cache', 'matraboli-models-v1']) caches.delete(old).catch(() => {});
env.useBrowserCache = false;
env.useCustomCache = true;
env.customCache = chunkedCache;

// Speech models. `word` = model exports cross-attentions, so Whisper word timestamps work.
// Models without it get word timing from our own audio aligner (align.js).
// `forceLang` = language token the model was fine-tuned with (Hinglish model emits Roman text with "en").
export const MODELS = {
  base: { id: 'onnx-community/whisper-base_timestamped', word: true,
    gpu: { encoder_model: 'fp32', decoder_model_merged: 'q4' }, cpu: 'q8' },
  // NB: 4-bit decoders on WebGPU loop endlessly ("दो दो दो…") for small — use fp16 (same size).
  small: { id: 'onnx-community/whisper-small_timestamped', word: true,
    gpu: { encoder_model: 'fp16', decoder_model_merged: 'fp16' }, cpu: 'q8' },
  turbo: { id: 'onnx-community/whisper-large-v3-turbo_timestamped', word: true,
    gpu: { encoder_model: 'fp16', decoder_model_merged: 'fp16' }, cpu: 'q8' },
  'turbo-lite': { id: 'onnx-community/whisper-large-v3-turbo_timestamped', word: true,
    gpu: { encoder_model: 'q4f16', decoder_model_merged: 'q4f16' }, cpu: 'q8' },
  hinglish: { id: 'onnx-community/Whisper-Hindi2Hinglish-Apex-ONNX', word: false, forceLang: 'en',
    gpu: { encoder_model: 'q4f16', decoder_model_merged: 'fp16' }, cpu: 'q8' },
  'hinglish-q4': { id: 'onnx-community/Whisper-Hindi2Hinglish-Apex-ONNX', word: false, forceLang: 'en',
    gpu: { encoder_model: 'q4f16', decoder_model_merged: 'q4f16' }, cpu: 'q8' },
  'hinglish-lite': { id: 'Hirecentive-D3l/Whisper-Hindi2Hinglish-Swift-ONNX', word: false, forceLang: 'en',
    gpu: null, cpu: 'q8' },
};
MODELS.fast = MODELS.base;       // legacy keys from saved settings
MODELS.accurate = MODELS.small;
const TRANSLATOR = 'Xenova/nllb-200-distilled-600M';

const cache = new Map();
let gpuF16 = null;
async function gpuInfo() {
  if (gpuF16 !== null) return gpuF16;
  try {
    const a = navigator.gpu && (await navigator.gpu.requestAdapter());
    gpuF16 = a ? (a.features.has('shader-f16') ? 'f16' : 'f32') : 'none';
  } catch { gpuF16 = 'none'; }
  return gpuF16;
}
// fp16 / q4f16 weights need shader-f16; fall back to fp32 / q4 on GPUs without it.
const noF16 = (dtype) => Object.fromEntries(Object.entries(dtype).map(([k, v]) => [k, v === 'fp16' ? 'fp32' : v === 'q4f16' ? 'q4' : v]));

function progress(stage) {
  const files = {};
  return (p) => {
    if (p.status === 'progress' && p.total) {
      files[p.file] = { loaded: p.loaded, total: p.total };
      const loaded = Object.values(files).reduce((a, f) => a + f.loaded, 0);
      const total = Object.values(files).reduce((a, f) => a + f.total, 0);
      self.postMessage({ type: 'progress', stage, loaded, total });
    }
  };
}

async function getASR(key) {
  const spec = typeof key === 'object' ? key : MODELS[key] || MODELS.base;
  const cacheKey = typeof key === 'object' ? JSON.stringify(key) : key in MODELS ? key : 'base';
  if (cache.has(cacheKey)) return cache.get(cacheKey);
  // free other speech models — two large models won't fit in GPU memory together
  for (const [k, v] of cache) if (k !== TRANSLATOR) { try { await v.asr.dispose?.(); } catch {} cache.delete(k); }
  const cb = progress('model');
  const gpu = await gpuInfo();
  let asr, device = 'wasm';
  if (spec.gpu && gpu !== 'none') {
    try {
      asr = await pipeline('automatic-speech-recognition', spec.id, {
        device: 'webgpu', dtype: gpu === 'f16' ? spec.gpu : noF16(spec.gpu), progress_callback: cb,
      });
      device = 'webgpu';
    } catch (e) {
      console.warn('WebGPU load failed, falling back to WASM', e);
    }
  }
  if (!asr) asr = await pipeline('automatic-speech-recognition', spec.id, { dtype: spec.cpu, progress_callback: cb });
  const entry = { asr, spec, device };
  cache.set(cacheKey, entry);
  return entry;
}

// Whisper's cross-attention word timestamps sometimes collapse on WebGPU (every word at the
// same instant, or past the end of the audio). Detect that and fall back to segment timing.
function invalidWordTimes(chunks, dur) {
  const ws = chunks.filter((c) => c.text.trim());
  if (!ws.length) return null;
  const starts = ws.map((c) => c.timestamp[0]);
  if (starts.some((s) => s == null || !Number.isFinite(s) || s > dur + 0.5)) return 'out-of-range';
  if (ws.length >= 4 && new Set(starts.map((s) => s.toFixed(2))).size / ws.length < 0.7) return 'collapsed';
  let back = 0;
  for (let i = 1; i < starts.length; i++) if (starts[i] < starts[i - 1] - 0.05) back++;
  if (back / ws.length > 0.1) return 'non-monotonic';
  // >6 words per second sustained over the whole clip is not human speech
  const span = starts[starts.length - 1] - starts[0];
  if (ws.length >= 6 && ws.length / Math.max(0.5, span) > 6) return 'too-fast';
  return null;
}

let PIECE_MAX = 15, PIECE_MIN = 5;
/** Split audio into short pieces (≤PIECE_MAX s), cutting in the longest pause between 14 s and 28 s. */
function splitAtPauses(audio, maxS = PIECE_MAX, minS = PIECE_MIN) {
  const SR = 16000, n = audio.length;
  if (n <= maxS * SR) return [[0, n]];
  const hop = 160; // 10 ms
  const frames = Math.floor(n / hop);
  const db = new Float32Array(frames);
  for (let f = 0; f < frames; f++) {
    let e = 0;
    for (let i = 0; i < hop; i++) { const v = audio[f * hop + i]; e += v * v; }
    db[f] = 10 * Math.log10(e / hop + 1e-10);
  }
  const sorted = Array.from(db).sort((x, y) => x - y);
  const thr = sorted[Math.floor(frames * 0.15)] + 6;
  const ranges = [];
  let start = 0;
  while ((n - start) / SR > maxS) {
    const lo = Math.floor((start + minS * SR) / hop), hi = Math.floor((start + maxS * SR) / hop);
    // find longest run of quiet frames in [lo, hi]; tie-break by lowest energy
    let bestMid = -1, bestLen = 0, runStart = -1;
    for (let f = lo; f <= hi; f++) {
      if (db[f] < thr) { if (runStart < 0) runStart = f; }
      if ((db[f] >= thr || f === hi) && runStart >= 0) {
        const len = f - runStart;
        if (len > bestLen) { bestLen = len; bestMid = Math.floor((runStart + f) / 2); }
        runStart = -1;
      }
    }
    if (bestMid < 0) { // no pause: cut at the quietest frame
      let m = lo;
      for (let f = lo; f <= hi; f++) if (db[f] < db[m]) m = f;
      bestMid = m;
    }
    const cut = bestMid * hop;
    ranges.push([start, cut]);
    start = cut;
  }
  ranges.push([start, n]);
  return ranges;
}

// Transformers.js has no Whisper language detection (it silently assumes English),
// so we read the language-token probabilities from the first decoder step ourselves.
const DETECT_LANGS = ['hi', 'en', 'pa', 'bn', 'ta', 'te', 'mr', 'gu', 'kn', 'ml', 'as', 'ur'];
async function detectLanguage(asr, audio) {
  const gc = asr.model.generation_config;
  if (!gc?.lang_to_id) return null;
  const inputs = await asr.processor(audio.subarray(0, 16000 * 30));
  const sot = gc.decoder_start_token_id ?? 50258;
  const decoder_input_ids = new Tensor('int64', BigInt64Array.from([BigInt(sot)]), [1, 1]);
  const out = await asr.model({ ...inputs, decoder_input_ids });
  const { data, dims } = out.logits;
  const vocab = dims[dims.length - 1];
  const off = (dims[1] - 1) * vocab;
  // Whisper's own "no speech" signal: probability of the <|nospeech|> token at the first step.
  let noSpeech = null;
  const nsId = noSpeechId(asr);
  if (nsId !== undefined) {
    let m = -Infinity;
    for (let i = 0; i < vocab; i++) if (data[off + i] > m) m = data[off + i];
    let z = 0;
    for (let i = 0; i < vocab; i++) z += Math.exp(data[off + i] - m);
    noSpeech = Math.exp(Number(data[off + nsId]) - m) / z;
  }
  const scores = DETECT_LANGS
    .map((l) => [l, gc.lang_to_id[`<|${l}|>`]])
    .filter(([, id]) => id !== undefined)
    .map(([l, id]) => [l, Number(data[off + id])]);
  const max = Math.max(...scores.map((s) => s[1]));
  const z = scores.reduce((a, s) => a + Math.exp(s[1] - max), 0);
  const probs = Object.fromEntries(scores.map(([l, s]) => [l, Math.exp(s - max) / z]).sort((a, b) => b[1] - a[1]));
  let best = Object.keys(probs)[0];
  // Spoken Hindi and Urdu are near-identical; Indian creators almost always want Devanagari.
  if (best === 'ur' && (probs.hi || 0) > 0.05) best = 'hi';
  return { language: best, probs, noSpeech };
}

const nsIds = new WeakMap(); // token ids differ between Whisper versions
function noSpeechId(asr) {
  if (nsIds.has(asr)) return nsIds.get(asr);
  let nsCache = null;
  for (const t of ['<|nospeech|>', '<|nocaptions|>']) {
    try {
      const ids = asr.tokenizer.encode(t, { add_special_tokens: false });
      if (ids.length === 1) { nsCache = ids[0]; break; }
    } catch {}
    const m = asr.tokenizer?.model?.tokens_to_ids;
    if (m?.get?.(t) !== undefined) { nsCache = m.get(t); break; }
  }
  nsIds.set(asr, nsCache);
  return nsCache;
}
/** Share of 10 ms frames clearly louder than digital silence / the noise floor. */
function voicedFraction(audio) {
  const hop = 160, n = Math.floor(audio.length / hop);
  if (!n) return 0;
  const db = new Float32Array(n);
  for (let f = 0; f < n; f++) {
    let e = 0;
    for (let i = 0; i < hop; i++) { const v = audio[f * hop + i]; e += v * v; }
    db[f] = 10 * Math.log10(e / hop + 1e-12);
  }
  const floor = Array.from(db).sort((x, y) => x - y)[Math.floor(n * 0.1)];
  const thr = Math.max(-50, floor + 10);
  let v = 0;
  for (let f = 0; f < n; f++) if (db[f] > thr) v++;
  return v / n;
}
/** Detects decoding loops like "रिए रिए रिए…" or a repeated phrase. */
function hasLoop(text) {
  const w = text.trim().split(/\s+/).filter(Boolean);
  for (let n = 1; n <= 4; n++) {
    let run = 1;
    for (let i = n; i + n <= w.length; i += n) {
      if (w.slice(i, i + n).join(' ') === w.slice(i - n, i).join(' ')) { if (++run >= 4) return true; } else run = 1;
    }
  }
  return w.length > 24 && new Set(w).size / w.length < 0.3;
}
/** Last-resort clean-up: keep at most two consecutive repeats of a word. */
function collapseRepeats(chunks) {
  const out = [];
  for (const c of chunks) {
    const t = c.text.trim();
    const n = out.length;
    if (n >= 2 && out[n - 1].text.trim() === t && out[n - 2].text.trim() === t) continue;
    out.push({ ...c, text: c.text.replace(/(\S+)(\s+\1){2,}/g, '$1 $1') });
  }
  return out;
}
// Words Whisper tends to invent over silence/music when there is no speech.
const HALLUCINATIONS = /^(thank you( for watching)?|thanks for watching|subscribe|please subscribe|you|bye|music|♪+|\.+|धन्यवाद|सब्सक्राइब( करें)?|शुक्रिया)[.!।\s]*$/i;

async function getTranslator() {
  if (cache.has(TRANSLATOR)) return cache.get(TRANSLATOR);
  const tr = await pipeline('translation', TRANSLATOR, { dtype: 'q8', progress_callback: progress('translator') });
  cache.set(TRANSLATOR, tr);
  return tr;
}

async function handle(data) {
  try {
    if (data.type === 'transcribe') {
      const t0 = performance.now();
      const { asr, spec, device } = await getASR(data.model);
      const loadMs = performance.now() - t0;
      // We split long audio ourselves (at pauses) instead of using the pipeline's 30 s chunking,
      // which dropped whole sentences at chunk boundaries in testing.
      const base = { task: 'transcribe', ...(data.options || {}) };
      let detected = null;
      // Thorough (default): short pieces + a language check per piece — handles English sentences inside
      // Hindi videos (60 s mixed clip: 4% WER). Fast: long pieces, language checked once (~3× quicker).
      const fast = data.mode === 'fast';
      PIECE_MAX = data.pieceMax || (fast ? 28 : 15);
      PIECE_MIN = data.pieceMin || (fast ? 14 : 5);
      // language is detected per piece below (piece 0 doubles as the whole-video detection)
      const lang = spec.forceLang || data.language || detected?.language || 'hi';
      base.language = lang;
      const t1 = performance.now();
      const ranges = splitAtPauses(data.audio);
      const pieces = [];
      const fallbacks = [];
      let wordFails = 0; // word timestamps collapsed on consecutive pieces → stop paying for the attempt
      for (let p = 0; p < ranges.length; p++) {
        const [s0, s1] = ranges[p];
        self.postMessage({ type: 'status', text: ranges.length > 1 ? `Listening to your video… (${p + 1}/${ranges.length})` : 'Listening to your video…' });
        const clip = data.audio.subarray(s0, s1);
        const offset = s0 / 16000;
        // 1) what is in this piece? (language + is there speech at all)
        let info = null;
        // Language check per piece costs one extra model pass, so only run it when it can change the outcome.
        const needLang = !spec.forceLang && data.language !== 'en' && (!fast || (p === 0 && !data.language));
        if (needLang) { try { info = await detectLanguage(asr, clip); } catch (e) { console.warn('piece analysis failed', e); } }
        if (p === 0 && !detected && !data.language && !spec.forceLang) detected = info;
        // A clearly-English sentence inside a Hindi/regional video is transcribed as English
        // (forcing Hindi on English speech garbles it and can trigger decoding loops).
        let pieceLang = lang;
        if (!spec.forceLang) {
          if (!data.language && info?.language) pieceLang = info.language;
          else if (data.language && data.language !== 'en' && (info?.probs?.en || 0) > 0.75) pieceLang = 'en';
        }
        const runPiece = async (extra = {}) => {
          const opts = { ...base, language: pieceLang, ...extra };
          let out = null, wordLevel = spec.word;
          if (spec.word && data.wordTimestamps !== false && wordFails < 2) {
            try {
              out = await asr(clip, { ...opts, return_timestamps: 'word' });
              const why = invalidWordTimes(out.chunks || [], clip.length / 16000);
              if (why) { fallbacks.push(why); out = null; wordFails++; } else wordFails = 0;
            } catch (e) {
              console.warn('Word timestamps failed, using sentence timestamps', e);
              fallbacks.push('error');
            }
          }
          if (!out) { wordLevel = false; out = await asr(clip, { ...opts, return_timestamps: true }); }
          return { out, wordLevel };
        };
        // 2) transcribe; if the decoder loops, retry with repetition penalties
        let { out, wordLevel } = await runPiece();
        if (hasLoop(out.text || '')) {
          fallbacks.push('loop');
          const retry = await runPiece({ repetition_penalty: 1.15, no_repeat_ngram_size: 4 });
          if (!hasLoop(retry.out.text || '') || (retry.out.text || '').length < (out.text || '').length) ({ out, wordLevel } = retry);
          if (hasLoop(out.text || '')) out = { ...out, chunks: collapseRepeats(out.chunks || []) };
        }
        // 3) no-speech gate: drop invented text over silence / music.
        //    (large-v3-turbo's own no-speech probability is ~0 for everything, so we measure the audio.)
        const noSpeech = info?.noSpeech ?? 0;
        const voiced = voicedFraction(clip);
        const txt = (out.text || '').trim();
        const hasLetters = /[\p{L}\p{N}]/u.test(txt);
        if (!hasLetters || (HALLUCINATIONS.test(txt) && voiced < 0.15) || voiced < 0.02) {
          if (txt) fallbacks.push('no-speech');
          out = { ...out, chunks: [], text: '' };
        } else {
          // punctuation-only fragments never become captions
          out = { ...out, chunks: (out.chunks || []).filter((c) => /[\p{L}\p{N}]/u.test(c.text)) };
        }
        const chunks = (out.chunks || []).map((c) => ({
          text: c.text,
          timestamp: c.timestamp.map((t) => (t == null ? t : t + offset)),
        }));
        // segment end missing on the last segment → end of this piece
        if (!wordLevel && chunks.length && chunks[chunks.length - 1].timestamp[1] == null) chunks[chunks.length - 1].timestamp[1] = s1 / 16000;
        pieces.push({ offset, end: s1 / 16000, wordLevel, chunks, language: pieceLang, noSpeech });
      }
      const allWord = pieces.every((p) => p.wordLevel);
      self.postMessage({
        id: data.id, type: 'transcript', text: pieces.flatMap((p) => p.chunks.map((c) => c.text)).join(''),
        pieces, wordLevel: allWord, mixedTiming: !allWord && pieces.some((p) => p.wordLevel),
        roman: spec.forceLang === 'en', device, loadMs, runMs: performance.now() - t1,
        language: lang, detected, fallback: fallbacks.join(',') || null,
      });
    } else if (data.type === 'translate') {
      const tr = await getTranslator();
      const results = [];
      for (let i = 0; i < data.texts.length; i++) {
        const text = data.texts[i];
        if (!text.trim()) { results.push(''); continue; }
        const r = await tr(text, { src_lang: data.src, tgt_lang: data.tgt });
        results.push(r[0]?.translation_text || '');
        self.postMessage({ type: 'status', text: `Translating ${i + 1} / ${data.texts.length}…` });
      }
      self.postMessage({ id: data.id, type: 'translation', texts: results });
    }
  } catch (err) {
    self.postMessage({ id: data.id, type: 'error', message: err?.message || String(err) });
  }
}


// Jobs run one at a time, in order; every reply carries the request id so the app
// can never mix up results (two overlapping requests used to lose one of them).
let queue = Promise.resolve();
self.onmessage = ({ data }) => { queue = queue.then(() => handle(data)).catch((e) => console.warn(e)); };
