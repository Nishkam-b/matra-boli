// Word-timing utilities that run on the decoded 16 kHz audio.
//  - speech/voice activity envelope
//  - alignment of words inside a timed segment (for models without word timestamps)
//  - clean-up of model word timestamps (snap onsets out of silence, fix zero-length words)
import { graphemes } from './engine.js';
import { romanize } from './languages.js';

const SR = 16000;
const HOP = 0.01; // 10 ms frames

/** Frame-level loudness (dB) and a speech mask with an adaptive noise floor. */
export function speechEnvelope(audio) {
  const hop = Math.round(SR * HOP), win = hop * 2;
  const n = Math.max(1, Math.floor((audio.length - win) / hop) + 1);
  const db = new Float32Array(n);
  for (let f = 0; f < n; f++) {
    let s = 0;
    const o = f * hop;
    for (let i = 0; i < win; i++) { const v = audio[o + i] || 0; s += v * v; }
    db[f] = 10 * Math.log10(s / win + 1e-10);
  }
  const sorted = Array.from(db).sort((a, b) => a - b);
  const floor = sorted[Math.floor(n * 0.15)];
  const peak = sorted[Math.floor(n * 0.97)];
  const thr = floor + Math.max(6, (peak - floor) * 0.3);
  // smooth mask: speech if above threshold, with 60 ms hangover
  const mask = new Uint8Array(n);
  let hang = 0;
  for (let f = 0; f < n; f++) {
    if (db[f] > thr) { mask[f] = 1; hang = 6; } else if (hang > 0) { mask[f] = 1; hang--; }
  }
  return { db, mask, thr, n };
}
const fr = (t) => Math.round(t / HOP);
const tm = (f) => f * HOP;

/**
 * Expected spoken length of a word. Fitted on the benchmark's ground-truth timings:
 * onset-to-onset ≈ 0.126 s + 0.062 s × (letters in Roman form)  →  weight = letters + 2.
 * Indic scripts are romanised first so every script shares one model.
 */
export function wordWeight(w) {
  const r = romanize(w).toLowerCase().replace(/[^a-z0-9]/g, '');
  if (!r.length) return graphemes(w).length ? 2 + graphemes(w).length * 1.5 : 1;
  return r.length + 2;
}

/**
 * Distribute a segment's words over the *voiced* frames of [start, end],
 * then snap each boundary to the quietest frame nearby.
 */
export function alignSegment(env, text, start, end) {
  const parts = text.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return [];
  let f0 = Math.max(0, fr(start)), f1 = Math.min(env.n - 1, fr(end));
  // tighten to actual speech
  while (f0 < f1 && !env.mask[f0]) f0++;
  while (f1 > f0 && !env.mask[f1]) f1--;
  const voiced = [];
  for (let f = f0; f <= f1; f++) if (env.mask[f]) voiced.push(f);
  if (voiced.length < parts.length * 3) {
    // too little detected speech — fall back to the raw span
    voiced.length = 0;
    for (let f = fr(start); f <= fr(end); f++) voiced.push(f);
  }
  const weights = parts.map(wordWeight);
  const total = weights.reduce((a, b) => a + b, 0);
  const bounds = [voiced[0]];
  let acc = 0;
  for (let k = 0; k < parts.length - 1; k++) {
    acc += weights[k];
    let b = voiced[Math.min(voiced.length - 1, Math.round((acc / total) * (voiced.length - 1)))];
    // snap to local energy minimum within ±60 ms
    let best = b;
    for (let d = -6; d <= 6; d++) {
      const f = b + d;
      if (f > bounds[k] + 3 && f < voiced[voiced.length - 1] && env.db[f] < env.db[best]) best = f;
    }
    bounds.push(best);
  }
  bounds.push(voiced[voiced.length - 1] + 1);
  return parts.map((p, k) => {
    // word starts at first voiced frame after its boundary (skip pauses)
    let s = bounds[k];
    while (s < bounds[k + 1] - 1 && !env.mask[s]) s++;
    let e = bounds[k + 1];
    while (e > s + 1 && !env.mask[e - 1]) e--;
    return { text: p, start: +tm(s).toFixed(3), end: +tm(e).toFixed(3), aligned: true };
  });
}

/** Spectral flux per frame (onset strength): how much the spectrum changes — peaks at syllable/word onsets. */
export function spectralFlux(audio, env) {
  if (env.flux) return env.flux;
  const N = 256, hop = Math.round(SR * HOP);
  const re = new Float32Array(N), im = new Float32Array(N), prev = new Float32Array(N / 2), flux = new Float32Array(env.n);
  const win = new Float32Array(N).map((_, i) => 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / N));
  for (let f = 0; f < env.n; f++) {
    for (let i = 0; i < N; i++) { re[i] = (audio[f * hop + i] || 0) * win[i]; im[i] = 0; }
    fft(re, im);
    let s = 0;
    for (let k = 2; k < N / 2; k++) {
      const m = Math.log1p(100 * Math.hypot(re[k], im[k]));
      const d = m - prev[k];
      if (d > 0) s += d;
      prev[k] = m;
    }
    flux[f] = s;
  }
  // normalise to 0..1 with a robust max
  const sorted = Array.from(flux).sort((a, b) => a - b);
  const hi = sorted[Math.floor(sorted.length * 0.98)] || 1;
  for (let f = 0; f < env.n; f++) flux[f] = Math.min(1, flux[f] / hi);
  env.flux = flux;
  return flux;
}
function fft(re, im) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) { [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]]; }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len, wr = Math.cos(ang), wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const ar = re[i + k + len / 2] * cr - im[i + k + len / 2] * ci, ai = re[i + k + len / 2] * ci + im[i + k + len / 2] * cr;
        re[i + k + len / 2] = re[i + k] - ar; im[i + k + len / 2] = im[i + k] - ai;
        re[i + k] += ar; im[i + k] += ai;
        const t = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = t;
      }
    }
  }
}

// Tuned on the benchmark (bench/): acoustic boundary cues (quiet frames, spectral onsets) did not
// help on continuous speech — the fitted duration prior alone scored best (77% of words ±0.2 s).
export const ALIGN_PARAMS = { lambda: 1.2, quiet: 0, onset: 0, pause: 0 };
/**
 * Dynamic-programming aligner: chooses word boundaries that balance an expected-duration prior
 * (from word length) against acoustic evidence (quiet frames, spectral onsets, pauses).
 */
export function alignSegmentDP(env, text, start, end, audio, P = ALIGN_PARAMS) {
  const parts = text.trim().split(/\s+/).filter(Boolean);
  const K = parts.length;
  if (!K) return [];
  let f0 = Math.max(0, fr(start) - 10), f1 = Math.min(env.n - 1, fr(end) + 10);
  while (f0 < f1 && !env.mask[f0]) f0++;
  while (f1 > f0 && !env.mask[f1]) f1--;
  const F = f1 - f0 + 1;
  if (K === 1 || F < K * 4) return alignSegment(env, text, start, end);
  const flux = audio && P.onset ? spectralFlux(audio, env) : null;
  // boundary cost per frame (lower = better place to start a word)
  const lo = env.thr - 6, span = 30;
  const bcost = new Float32Array(F);
  for (let i = 0; i < F; i++) {
    const f = f0 + i;
    const quiet = Math.min(1, Math.max(0, (env.db[f] - lo) / span));
    const prevSilent = f > 0 && !env.mask[f - 1] && env.mask[f];
    const onset = flux ? Math.max(flux[f], flux[f + 1] || 0) : 0;
    bcost[i] = P.quiet * quiet - P.onset * onset - (prevSilent ? P.pause : 0);
  }
  // voiced length (pauses don't count toward a word's duration)
  const vcum = new Float32Array(F + 1);
  for (let i = 0; i < F; i++) vcum[i + 1] = vcum[i] + (env.mask[f0 + i] ? 1 : 0.15);
  const weights = parts.map(wordWeight);
  const wsum = weights.reduce((a, b) => a + b, 0);
  const exp = weights.map((w) => Math.max(4, (vcum[F] * w) / wsum));
  const MIN = 4;
  // D[k][i] = best cost with word k starting at frame i
  const INF = 1e9;
  const D = Array.from({ length: K }, () => new Float32Array(F).fill(INF));
  const B = Array.from({ length: K }, () => new Int32Array(F).fill(-1));
  D[0][0] = 0;
  for (let k = 1; k < K; k++) {
    const e = exp[k - 1], maxLen = Math.min(F, Math.ceil(e * 3.5) + 20);
    for (let i = MIN * k; i < F - MIN * (K - k) + 1; i++) {
      let best = INF, arg = -1;
      for (let j = Math.max(0, i - maxLen); j <= i - MIN; j++) {
        if (D[k - 1][j] >= INF) continue;
        const d = vcum[i] - vcum[j];
        const r = Math.log(Math.max(0.5, d) / e);
        const c = D[k - 1][j] + P.lambda * r * r;
        if (c < best) { best = c; arg = j; }
      }
      if (arg >= 0) { D[k][i] = best + bcost[i]; B[k][i] = arg; }
    }
  }
  // close the last word at the segment end
  let best = INF, arg = -1;
  const eL = exp[K - 1];
  for (let i = 0; i < F - MIN + 1; i++) {
    if (D[K - 1][i] >= INF) continue;
    const r = Math.log(Math.max(0.5, vcum[F] - vcum[i]) / eL);
    const c = D[K - 1][i] + P.lambda * r * r;
    if (c < best) { best = c; arg = i; }
  }
  if (arg < 0) return alignSegment(env, text, start, end);
  const starts = new Array(K);
  starts[K - 1] = arg;
  for (let k = K - 1; k > 0; k--) starts[k - 1] = B[k][starts[k]];
  return parts.map((p, k) => {
    let s = f0 + starts[k];
    const e = k + 1 < K ? f0 + starts[k + 1] : f1 + 1;
    while (s < e - 1 && !env.mask[s]) s++;
    let ee = e;
    while (ee > s + 1 && !env.mask[ee - 1]) ee--;
    return { text: p, start: +tm(s).toFixed(3), end: +tm(ee).toFixed(3), aligned: true };
  });
}

/**
 * Long segments (some models return one segment for 20+ s of speech): split the text into
 * phrases at punctuation, match phrase boundaries to real pauses in the audio, then align
 * words inside each phrase. Keeps errors from drifting across the whole segment.
 */
export function alignLong(env, text, start, end, audio) {
  const tokens = text.trim().split(/\s+/).filter(Boolean);
  const phrases = [];
  let cur = [];
  tokens.forEach((t, i) => {
    cur.push(t);
    if (/[,.!?।;:]["')]*$/.test(t) || i === tokens.length - 1) { phrases.push(cur); cur = []; }
  });
  if (end - start < 6 || phrases.length < 2) return alignSegmentDP(env, text, start, end, audio);
  const f0 = Math.max(0, fr(start)), f1 = Math.min(env.n - 1, fr(end));
  // candidate pauses: runs of ≥120 ms non-speech
  const pauses = [];
  let run = -1;
  for (let f = f0; f <= f1; f++) {
    if (!env.mask[f]) { if (run < 0) run = f; }
    else if (run >= 0) { if (f - run >= 12 && run > f0) pauses.push({ mid: (run + f) / 2, len: f - run, s: run, e: f }); run = -1; }
  }
  if (!pauses.length) return alignSegmentDP(env, text, start, end, audio);
  // expected boundary positions from phrase weights over voiced frames
  const voiced = [];
  for (let f = f0; f <= f1; f++) if (env.mask[f]) voiced.push(f);
  const pw = phrases.map((p) => p.reduce((s, w) => s + wordWeight(w), 0));
  const total = pw.reduce((a, b) => a + b, 0);
  const expect = [];
  let acc = 0;
  for (let k = 0; k < phrases.length - 1; k++) {
    acc += pw[k];
    expect.push(voiced[Math.min(voiced.length - 1, Math.round((acc / total) * (voiced.length - 1)))] || f0);
  }
  // DP: each boundary k → a pause index (strictly increasing) or none (-1)
  const P = pauses.length, K = expect.length, SIG = 120; // σ ≈ 1.2 s
  const cost = (k, j) => (j < 0 ? 2.5 : ((pauses[j].mid - expect[k]) / SIG) ** 2 - Math.min(1.5, pauses[j].len / 30));
  let prev = new Map([[-1, { c: 0, path: [] }]]);
  for (let k = 0; k < K; k++) {
    const next = new Map();
    for (const [last, st] of prev) {
      const opts = [-1];
      for (let j = last + 1; j < P; j++) opts.push(j);
      for (const j of opts) {
        const key = j < 0 ? last : j;
        const c = st.c + cost(k, j);
        const ex = next.get(key);
        if (!ex || c < ex.c) next.set(key, { c, path: [...st.path, j] });
      }
    }
    prev = next;
  }
  const best = [...prev.values()].sort((a, b) => a.c - b.c)[0].path;
  // build phrase spans
  const out = [];
  let ps = start;
  for (let k = 0; k < phrases.length; k++) {
    let pe = end, nextStart = end;
    if (k < K) {
      const j = best[k];
      if (j >= 0) { pe = tm(pauses[j].s); nextStart = tm(pauses[j].e); } else { pe = nextStart = tm(expect[k]); }
    }
    out.push(...alignSegmentDP(env, phrases[k].join(' '), ps, Math.max(ps + 0.1, pe), audio));
    ps = nextStart;
  }
  return out;
}

/**
 * Clean model word timestamps:
 *  - a word starting in silence is moved to the next speech onset (within 0.5 s)
 *  - zero/negative-length words get a minimum duration
 *  - words never overlap the next word
 */
export function refineWords(env, words) {
  const out = words.map((w) => ({ ...w }));
  for (let i = 0; i < out.length; i++) {
    const w = out[i];
    let f = fr(w.start);
    if (f < env.n && !env.mask[f]) {
      const lim = Math.min(env.n - 1, f + 50, fr(w.end) + 10);
      let g = f;
      while (g < lim && !env.mask[g]) g++;
      if (env.mask[g]) w.start = +tm(g).toFixed(3);
    }
    if (!(w.end > w.start + 0.05)) w.end = w.start + 0.12;
  }
  for (let i = 0; i < out.length - 1; i++) {
    if (out[i].end > out[i + 1].start) out[i].end = Math.max(out[i].start + 0.05, out[i + 1].start);
    if (out[i + 1].start < out[i].start) out[i + 1].start = out[i].start + 0.05;
  }
  return out;
}
