// Matra Boli — Caption Animation Engine
// One canvas renderer drives the live preview, the gallery thumbnails and the final export.
// Design presets (how captions look) and motion presets (how they move) are kept separate
// so any design can be combined with any animation.

/* ------------------------------------------------------------------ */
/* Easing                                                              */
/* ------------------------------------------------------------------ */
export const EASINGS = {
  linear: (t) => t,
  easeOut: (t) => 1 - Math.pow(1 - t, 3),
  easeInOut: (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2),
  back: (t) => {
    const c1 = 1.70158, c3 = c1 + 1;
    return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
  },
  elastic: (t) =>
    t === 0 ? 0 : t === 1 ? 1 : Math.pow(2, -10 * t) * Math.sin((t * 10 - 0.75) * ((2 * Math.PI) / 3)) + 1,
  bounce: (t) => {
    const n1 = 7.5625, d1 = 2.75;
    if (t < 1 / d1) return n1 * t * t;
    if (t < 2 / d1) return n1 * (t -= 1.5 / d1) * t + 0.75;
    if (t < 2.5 / d1) return n1 * (t -= 2.25 / d1) * t + 0.9375;
    return n1 * (t -= 2.625 / d1) * t + 0.984375;
  },
};
export const EASING_LABELS = {
  auto: 'Auto (preset default)', linear: 'Linear', easeOut: 'Ease out', easeInOut: 'Ease in-out',
  back: 'Back (overshoot)', elastic: 'Elastic', bounce: 'Bounce',
};

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const lerp = (a, b, t) => a + (b - a) * t;
const hash = (n) => { const x = Math.sin(n * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); };

/* ------------------------------------------------------------------ */
/* Word animations                                                     */
/* hidden: word is invisible until its reveal time                     */
/* fn({p, raw, active, activeP, t, i}) -> partial word state           */
/* ------------------------------------------------------------------ */
export const WORD_ANIMATIONS = {
  none: {
    name: 'None', desc: 'Static captions', hidden: false, dur: 0.2, ease: 'linear',
    fn: () => ({}),
  },
  pop: {
    name: 'Word Pop', desc: 'Words pop in one by one', hidden: true, dur: 0.28, ease: 'back',
    fn: ({ p, raw }) => ({ scale: lerp(0.35, 1, p), alpha: clamp01(raw * 3) }),
  },
  bounce: {
    name: 'Bounce', desc: 'Words drop and bounce', hidden: true, dur: 0.5, ease: 'bounce',
    fn: ({ p, raw }) => ({ dy: lerp(-0.9, 0, p), alpha: clamp01(raw * 4) }),
  },
  karaoke: {
    name: 'Karaoke', desc: 'Active word fills with colour', hidden: false, dur: 0.2, ease: 'linear',
    fn: ({ revealed, active, activeP }) => ({ fill: active ? activeP : revealed ? 1 : 0, noActiveColor: true }),
  },
  zoom: {
    name: 'Zoom In', desc: 'Words zoom down into place', hidden: true, dur: 0.3, ease: 'easeOut',
    fn: ({ p }) => ({ scale: lerp(2.1, 1, p), alpha: p }),
  },
  elastic: {
    name: 'Elastic', desc: 'Springy stretch entrance', hidden: true, dur: 0.7, ease: 'elastic',
    fn: ({ p, raw }) => ({ scaleX: lerp(0.2, 1, p), scaleY: lerp(1.6, 1, p), alpha: clamp01(raw * 5) }),
  },
  shake: {
    name: 'Shake', desc: 'Spoken word shakes for emphasis', hidden: false, dur: 0.2, ease: 'linear',
    fn: ({ active, t, i }) => active
      ? { dx: Math.sin(t * 70 + i) * 0.06, dy: Math.cos(t * 55 + i) * 0.05, rot: Math.sin(t * 40) * 0.05, scale: 1.08 }
      : {},
  },
  fade: {
    name: 'Fade In', desc: 'Smooth cinematic fade', hidden: true, dur: 0.45, ease: 'easeInOut',
    fn: ({ p }) => ({ alpha: p }),
  },
  slide: {
    name: 'Slide Up', desc: 'Words rise into place', hidden: true, dur: 0.35, ease: 'easeOut',
    fn: ({ p }) => ({ dy: lerp(0.6, 0, p), alpha: p }),
  },
  typewriter: {
    name: 'Typewriter', desc: 'Letters type out progressively', hidden: true, dur: 0.35, ease: 'linear',
    fn: ({ p, active }) => ({ reveal: p, caret: active && p < 1 }),
  },
  wave: {
    name: 'Wave', desc: 'Words ripple in a wave', hidden: false, dur: 0.2, ease: 'linear',
    fn: ({ t, i, active }) => ({ dy: Math.sin(t * 6 - i * 0.8) * 0.12, scale: active ? 1.1 : 1 }),
  },
  glitch: {
    name: 'Glitch', desc: 'Digital glitch entrance', hidden: true, dur: 0.4, ease: 'linear',
    fn: ({ raw, t, i }) => {
      const g = raw < 1 ? 1 - raw : 0;
      const n = Math.floor(t * 30);
      return { glitch: g, dx: g ? (hash(n + i) - 0.5) * 0.5 * g : 0, alpha: raw < 1 ? (hash(n * 3 + i) > 0.25 ? 1 : 0.2) : 1 };
    },
  },
  sweep: {
    name: 'Highlight Sweep', desc: 'Marker sweeps behind the word', hidden: false, dur: 0.3, ease: 'easeOut',
    fn: ({ active, p }) => ({ sweep: active ? p : 0 }),
  },
};

/* Caption (whole line) entrance animations */
export const ENTRANCES = {
  none: { name: 'None', fn: () => ({}) },
  fade: { name: 'Fade', fn: (e) => ({ alpha: e }) },
  slide: { name: 'Slide from Bottom', fn: (e) => ({ alpha: e, dy: (1 - e) * 0.08 }) },
  zoom: { name: 'Zoom', fn: (e) => ({ alpha: e, scale: lerp(0.6, 1, e) }) },
  pop: { name: 'Pop', fn: (e) => ({ alpha: clamp01(e * 3), scale: lerp(0.5, 1, EASINGS.back(e)) }) },
  blur: { name: 'Blur Reveal', fn: (e) => ({ alpha: e, blur: (1 - e) * 14 }) },
};

/* ------------------------------------------------------------------ */
/* Design presets                                                      */
/* ------------------------------------------------------------------ */
export const FONTS = [
  { id: 'Baloo 2', label: 'Baloo 2 (Indic)' },
  { id: 'Poppins', label: 'Poppins' },
  { id: 'Mukta', label: 'Mukta (Devanagari)' },
  { id: 'Anton', label: 'Anton (Display)' },
  { id: 'Montserrat', label: 'Montserrat' },
  { id: 'Yatra One', label: 'Yatra One (Devanagari)' },
  { id: 'Rozha One', label: 'Rozha One (Devanagari serif)' },
  { id: 'Tiro Devanagari Hindi', label: 'Tiro Devanagari (Cinematic)' },
  { id: 'Noto Sans', label: 'Noto Sans' },
  { id: 'Hind', label: 'Hind (Devanagari)' },
  { id: 'Khula', label: 'Khula (Devanagari)' },
  { id: 'Teko', label: 'Teko (Condensed)' },
  { id: 'Rozha One', label: 'Rozha One (Serif display)' },
  { id: 'Kalam', label: 'Kalam (Handwritten)' },
  { id: 'Modak', label: 'Modak (Bubbly)' },
  { id: 'Rajdhani', label: 'Rajdhani (Tech)' },
  { id: 'Sarpanch', label: 'Sarpanch (Tech display)' },
  { id: 'Eczar', label: 'Eczar (Serif)' },
  { id: 'Amita', label: 'Amita (Calligraphy)' },
  { id: 'Instrument Serif', label: 'Instrument Serif (English)' },
];

/*
 * Font pairings — a calm, readable BASE font for most words plus a contrasting ACCENT
 * font for the one word per screen that should pop (picked automatically, or marked
 * with *stars* in the transcript). Rules followed:
 *  1. Contrast of structure, not of everything: sans base + serif / script / condensed / rounded accent.
 *  2. Similar x-height & stroke weight so the line still reads as one sentence.
 *  3. Accent is used sparingly (one word per screen) and ~1.2–1.4× larger.
 *  4. Every "Devanagari" pair has Hindi glyphs in BOTH fonts (checked on Google Fonts),
 *     so Hindi captions keep the pairing. Other Indian scripts fall back to Baloo.
 */
export const FONT_PAIRS = [
  { id: 'creator-pop', name: 'Creator Pop', vibe: 'Punchy reels & tips', scripts: 'Hindi + English',
    font: 'Poppins', weight: 700, accentFont: 'Teko', accentWeight: 600, accentScale: 1.45, accentUpper: true, accentColor: '#FFE14D' },
  { id: 'editorial', name: 'Editorial', vibe: 'Premium storytelling', scripts: 'Hindi + English',
    font: 'Mukta', weight: 700, accentFont: 'Rozha One', accentWeight: 400, accentScale: 1.3, accentColor: '#F5C451' },
  { id: 'diary', name: 'Dear Diary', vibe: 'Personal vlogs', scripts: 'Hindi + English',
    font: 'Hind', weight: 600, accentFont: 'Kalam', accentWeight: 700, accentScale: 1.35, accentColor: '#F9A8D4' },
  { id: 'bollywood', name: 'Bollywood', vibe: 'Fun, festive, desi', scripts: 'Hindi + English',
    font: 'Baloo 2', weight: 800, accentFont: 'Modak', accentWeight: 400, accentScale: 1.25, accentColor: '#FF9933' },
  { id: 'royal', name: 'Royal Shaadi', vibe: 'Weddings, food, culture', scripts: 'Hindi + English',
    font: 'Eczar', weight: 600, accentFont: 'Amita', accentWeight: 700, accentScale: 1.3, accentColor: '#FACC15' },
  { id: 'cinema', name: 'Cinema', vibe: 'Documentary & mood', scripts: 'Hindi + English',
    font: 'Khula', weight: 600, accentFont: 'Tiro Devanagari Hindi', accentWeight: 400, accentScale: 1.3, accentItalic: true, accentColor: '#F5E6C8' },
  { id: 'tech', name: 'Tech Explainer', vibe: 'Gadgets, AI, gaming', scripts: 'Hindi + English',
    font: 'Rajdhani', weight: 700, accentFont: 'Sarpanch', accentWeight: 800, accentScale: 1.15, accentUpper: true, accentColor: '#22D3EE' },
  { id: 'modern-serif', name: 'Modern Serif', vibe: 'Aesthetic English reels', scripts: 'English & Hinglish',
    font: 'Montserrat', weight: 800, accentFont: 'Instrument Serif', accentFallback: 'Tiro Devanagari Hindi', accentWeight: 400, accentScale: 1.45, accentItalic: true, accentColor: '#FFFFFF' },
  { id: 'modern-creator', name: 'Modern Creator', vibe: 'Talking-head creators', scripts: 'Hindi via Hind',
    font: 'Inter', weight: 700, hindiFont: 'Hind', accentFont: 'Anton', accentFallback: 'Teko', accentWeight: 400, accentScale: 1.35, accentUpper: true, accentColor: '#FFE14D' },
  { id: 'viral', name: 'Viral Reels', vibe: 'Hooks & reactions', scripts: 'Hindi + English',
    font: 'Poppins', weight: 700, accentFont: 'Archivo Black', accentFallback: 'Khand', accentWeight: 400, accentScale: 1.25, accentUpper: true, accentColor: '#FF4D6D' },
  { id: 'luxury', name: 'Luxury', vibe: 'Fashion, jewellery, premium', scripts: 'Hindi via Mukta',
    font: 'Manrope', weight: 600, hindiFont: 'Mukta', accentFont: 'Playfair Display', accentFallback: 'Tiro Devanagari Hindi', accentWeight: 600, accentScale: 1.35, accentItalic: true, accentColor: '#F5E6C8' },
  { id: 'tech-creator', name: 'Tech Creator', vibe: 'Coding & AI tutorials', scripts: 'Hindi via Rajdhani',
    font: 'Space Grotesk', weight: 600, hindiFont: 'Rajdhani', accentFont: 'JetBrains Mono', accentFallback: 'Rajdhani', accentWeight: 700, accentScale: 1.1, accentColor: '#22D3EE' },
  { id: 'podcast', name: 'Podcast', vibe: 'Interviews & clips', scripts: 'Hindi via Mukta',
    font: 'Manrope', weight: 700, hindiFont: 'Mukta', accentFont: 'Oswald', accentFallback: 'Teko', accentWeight: 600, accentScale: 1.3, accentUpper: true, accentColor: '#FDE047' },
  { id: 'travel', name: 'Travel Vlog', vibe: 'Trips & day-in-life', scripts: 'Hindi via Hind',
    font: 'Outfit', weight: 600, hindiFont: 'Hind', accentFont: 'Caveat', accentFallback: 'Kalam', accentWeight: 700, accentScale: 1.5, accentColor: '#7DD3FC' },
  { id: 'aesthetic', name: 'Aesthetic', vibe: 'Soft, dreamy, lifestyle', scripts: 'Hindi via Khula',
    font: 'Urbanist', weight: 600, hindiFont: 'Khula', accentFont: 'Cormorant Garamond', accentFallback: 'Tiro Devanagari Hindi', accentWeight: 600, accentScale: 1.45, accentItalic: true, accentColor: '#FFFFFF' },
  { id: 'gaming', name: 'Gaming', vibe: 'Streams & highlights', scripts: 'Hindi + English',
    font: 'Rajdhani', weight: 700, accentFont: 'Russo One', accentFallback: 'Sarpanch', accentWeight: 400, accentScale: 1.2, accentUpper: true, accentColor: '#A3E635' },
  { id: 'documentary', name: 'Documentary', vibe: 'Explainers & history', scripts: 'Hindi via Martel',
    font: 'Lora', weight: 600, hindiFont: 'Martel', accentFont: 'Oswald', accentFallback: 'Teko', accentWeight: 600, accentScale: 1.25, accentUpper: true, accentColor: '#FACC15' },
  { id: 'fashion', name: 'Fashion', vibe: 'OOTD & beauty', scripts: 'Hindi via Mukta',
    font: 'Montserrat', weight: 600, hindiFont: 'Mukta', accentFont: 'Bodoni Moda', accentFallback: 'Tiro Devanagari Hindi', accentWeight: 700, accentScale: 1.4, accentItalic: true, accentColor: '#FFFFFF' },
  { id: 'retro', name: 'Retro', vibe: 'Food, nostalgia, fun', scripts: 'Hindi via Khand',
    font: 'Archivo Black', weight: 400, hindiFont: 'Khand', hindiWeight: 700, accentFont: 'Lobster', accentFallback: 'Yatra One', accentWeight: 400, accentScale: 1.35, accentColor: '#FB923C' },
  { id: 'news', name: 'Breaking News', vibe: 'Updates & facts', scripts: 'Hindi via Khand',
    font: 'Roboto Condensed', weight: 700, hindiFont: 'Khand', accentFont: 'Anton', accentFallback: 'Teko', accentWeight: 400, accentScale: 1.3, accentUpper: true, accentColor: '#EF4444' },
  { id: 'hindi-creator', name: 'Hindi Creator', vibe: 'Pure Hindi content', scripts: 'Hindi + English',
    font: 'Hind', weight: 600, accentFont: 'Khand', accentWeight: 700, accentScale: 1.35, accentColor: '#FFE14D' },
  { id: 'friendly', name: 'Friendly', vibe: 'Kids, family, wholesome', scripts: 'Hindi via Baloo 2',
    font: 'Nunito', weight: 800, hindiFont: 'Baloo 2', accentFont: 'Baloo 2', accentWeight: 800, accentScale: 1.25, accentColor: '#34D399' },
  { id: 'hustle', name: 'Hustle', vibe: 'Business & motivation', scripts: 'English & Hinglish',
    font: 'Poppins', weight: 800, accentFont: 'Anton', accentFallback: 'Teko', accentWeight: 400, accentScale: 1.35, accentUpper: true, accentColor: '#22C55E' },
];

// Words that should never be the emphasised word (Hindi, Hinglish, English).
const STOPWORDS = new Set(`
है हैं था थी थे हो होता होती होते का की के को में से पर ने और या तो भी ही यह ये वह वो इस उस एक कि जो
कर करें करो करना कुछ सब बस मैं हम तुम आप उन इन अपने अपना अपनी लिए साथ नहीं ना जी
hai hain tha thi the ho hota hoti hote ka ki ke ko mein me se par ne aur ya to bhi hi yeh ye yah vah wo woh
is us ek kar karo karen karna kuch sab bas main hum tum aap apne apna apni liye lie saath nahi nahin na ji
the a an and or of to in on at for with is are was were be been it this that you your i we they my our
so but just very really can will do does did have has had not no
guys friends hello hi hey namaste doston dosto bhai yaar okay ok koi kya kyun kaise aapko aapke aapki tumhe mujhe mera meri mere hamare humne usne aaj ab abhi phir नमस्ते दोस्तों दोस्तो भाई यार कोई क्या क्यों कैसे आपको आपके आपकी तुम्हें मुझे मेरा मेरी मेरे हमारे आज अब अभी फिर
`.trim().split(/\s+/));
const clean = (w) => w.replace(/[*.,!?।॥"'“”‘’()\[\]:;-]/g, '').toLowerCase();
/** Remove *emphasis* marks from caption text (for exports). */
export const stripMarks = (t) => String(t).replace(/\*/g, '');
/** Pick the word that carries the meaning: long, non-stopword, numbers / English loanwords favoured. */
export function pickKeyWord(words) {
  let best = -1, bestScore = -1;
  words.forEach((w, i) => {
    const c = clean(w.text);
    if (!c || STOPWORDS.has(c)) return;
    let score = Math.min(8, graphemes(c).length); // cap so very long words don't always win
    if (/\d/.test(c)) score += 9; // numbers ("60 seconds", "₹999") are almost always the hook
    if (/[!?]$/.test(w.text)) score += 2;
    if (/^[a-z]+$/.test(c) && words.some((x) => /[\u0900-\u0D7F]/.test(x.text))) score += 3; // "free", "tool" inside Hindi
    if (score > bestScore) { bestScore = score; best = i; }
  });
  return best;
}
// Fallback chain so every Indian script renders with a matching family.
export const SCRIPT_FALLBACKS = [
  'Baloo 2', 'Baloo Paaji 2', 'Baloo Da 2', 'Baloo Thambi 2', 'Baloo Tammudu 2', 'Baloo Bhai 2',
  'Baloo Tamma 2', 'Baloo Chettan 2', 'Baloo Bhaina 2', 'Noto Nastaliq Urdu', 'Noto Sans', 'sans-serif',
];

const base = {
  font: 'Baloo 2', size: 72, weight: 800, color: '#FFFFFF', activeColor: null, activeBg: null,
  activeShape: 'pill', outline: 0, outlineColor: '#000000', shadow: 18, shadowColor: 'rgba(0,0,0,0.65)',
  box: false, boxColor: '#000000', boxOpacity: 0.55, uppercase: false, y: 0.74, lineHeight: 1.3,
  activeScale: 1,
  letterSpacing: 0, hindiFont: null, hindiWeight: null, accentFallback: null,
  accentFont: null, accentWeight: 400, accentScale: 1.3, accentItalic: false, accentUpper: false, accentColor: null, accentMode: 'key',
};
export const DESIGNS = {
  modern: { name: 'Creator Bold', tags: ['popular', 'bold', 'creator'], ...base, activeColor: '#FFE14D', outline: 6 },
  creator: { name: 'Creator', tags: ['popular', 'creator'], ...base, font: 'Poppins', size: 64, weight: 700, activeShape: 'underline', activeBg: '#8B5CF6', outline: 4 },
  hormozi: { name: 'Hormozi', tags: ['popular', 'bold'], ...base, font: 'Anton', size: 86, weight: 400, hindiFont: 'Teko', hindiWeight: 600, uppercase: true, activeBg: '#FFD60A', activeColor: '#111111', activeShape: 'tilt', outline: 7, activeScale: 1.06 },
  minimal: { name: 'Minimal', tags: ['minimal'], ...base, font: 'Mukta', size: 58, weight: 600, shadow: 10, y: 0.82 },
  highlight: { name: 'Highlight', tags: ['popular', 'creator'], ...base, activeBg: '#A855F7', activeShape: 'pill', outline: 5 },
  boxed: { name: 'Boxed', tags: ['minimal'], ...base, font: 'Mukta', size: 56, weight: 700, box: true, boxOpacity: 0.6, shadow: 0 },
  brush: { name: 'Brush', tags: ['bold', 'creator'], ...base, activeBg: '#C026D3', activeShape: 'brush', outline: 4 },
  cinematic: { name: 'Cinematic', tags: ['minimal', 'cinematic'], ...base, font: 'Tiro Devanagari Hindi', size: 56, weight: 400, color: '#F5F0E6', shadow: 24, y: 0.86 },
  podcast: { name: 'Podcast', tags: ['minimal'], ...base, font: 'Poppins', size: 54, weight: 600, box: true, boxColor: '#16A34A', boxOpacity: 0.92, shadow: 0, activeColor: '#FDE047' },
  viral: { name: 'Viral', tags: ['popular', 'bold'], ...base, size: 92, weight: 800, activeColor: '#22C55E', outline: 9, activeScale: 1.12, y: 0.62 },
  neon: { name: 'Neon', tags: ['bold', 'cinematic'], ...base, font: 'Montserrat', size: 66, weight: 800, hindiFont: 'Mukta', color: '#E0F2FE', shadowColor: '#22D3EE', shadow: 30, activeColor: '#F472B6' },
  gradient: { name: 'Gradient', tags: ['popular', 'creator'], ...base, font: 'Poppins', size: 70, weight: 800, activeBg: 'gradient:#8B5CF6,#EC4899', activeShape: 'pill', outline: 5 },
  desi: { name: 'Desi Pop', tags: ['popular', 'bold'], ...base, font: 'Yatra One', size: 78, weight: 400, color: '#FFFFFF', activeColor: '#FF9933', outline: 7, outlineColor: '#14532D' },
};

export const DEFAULT_MOTION = {
  anim: 'pop', entrance: 'fade', mode: 'word', speed: 1, delay: 0, easing: 'auto', maxWords: 4,
};

/* ------------------------------------------------------------------ */
/* Timing helpers                                                      */
/* ------------------------------------------------------------------ */
const segmenter = typeof Intl !== 'undefined' && Intl.Segmenter ? new Intl.Segmenter(undefined, { granularity: 'grapheme' }) : null;
export function graphemes(s) {
  return segmenter ? Array.from(segmenter.segment(s), (x) => x.segment) : Array.from(s);
}

/** Split a cue's text into words with proportional (estimated) timings. */
export function estimateWords(text, start, end) {
  const parts = text.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return [];
  const weights = parts.map((w) => Math.max(1, graphemes(w).length) + 1.5);
  const total = weights.reduce((a, b) => a + b, 0);
  let acc = start;
  return parts.map((w, i) => {
    const d = ((end - start) * weights[i]) / total;
    const word = { text: w, start: acc, end: acc + d, estimated: true };
    acc += d;
    return word;
  });
}

/** Divide cues into on-screen "pages" of at most maxWords words. */
export function buildPages(cues, maxWords) {
  const pages = [];
  for (const cue of cues) {
    const words = cue.words && cue.words.length ? cue.words : estimateWords(cue.text, cue.start, cue.end);
    if (!words.length) continue;
    const n = maxWords > 0 ? maxWords : words.length;
    for (let k = 0; k < words.length; k += n) {
      const ws = words.slice(k, k + n);
      const last = k + n >= words.length;
      pages.push({
        words: ws,
        start: k === 0 ? Math.min(cue.start, ws[0].start) : ws[0].start,
        end: last ? Math.max(cue.end, ws[ws.length - 1].end) : words[k + n].start,
        lastInCue: last,
      });
    }
  }
  return pages;
}

/* ------------------------------------------------------------------ */
/* Renderer                                                            */
/* ------------------------------------------------------------------ */
export function fontString(d, px) {
  const fam = [d.font, ...(d.fallback ? [d.fallback] : []), ...SCRIPT_FALLBACKS.filter((f) => f !== d.font && f !== d.fallback)].map((f) => (f === 'sans-serif' ? f : `"${f}"`)).join(', ');
  return `${d.italic ? 'italic ' : ''}${d.weight} ${px}px ${fam}`;
}

function roundRect(ctx, x, y, w, h, r) {
  r = Math.min(r, h / 2, w / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function drawActiveShape(ctx, shape, color, w, h, S, frac = 1) {
  const padX = h * 0.14, padY = h * 0.06;
  const fullW = w + padX * 2;
  const bw = fullW * frac;
  if (typeof color === 'string' && color.startsWith('gradient:')) {
    const [c1, c2] = color.slice(9).split(',');
    const g = ctx.createLinearGradient(-fullW / 2, 0, fullW / 2, 0);
    g.addColorStop(0, c1); g.addColorStop(1, c2 || c1);
    color = g;
  }
  ctx.fillStyle = color;
  if (shape === 'underline') {
    ctx.strokeStyle = color;
    ctx.lineCap = 'round';
    ctx.lineWidth = Math.max(2, h * 0.1);
    ctx.beginPath();
    const y = h * 0.52;
    ctx.moveTo(-w / 2, y);
    ctx.quadraticCurveTo(-w / 2 + (w * frac) / 2, y + h * 0.16, -w / 2 + w * frac, y - h * 0.02);
    ctx.stroke();
    return;
  }
  if (shape === 'brush') {
    const x = -fullW / 2, y = -h / 2 - padY, hh = h + padY * 2;
    ctx.beginPath();
    ctx.moveTo(x + 6 * S, y + hh * 0.12);
    ctx.quadraticCurveTo(x + bw * 0.5, y - hh * 0.06, x + bw, y + hh * 0.08);
    ctx.lineTo(x + bw - 4 * S, y + hh * 0.5);
    ctx.lineTo(x + bw + 2 * S, y + hh * 0.92);
    ctx.quadraticCurveTo(x + bw * 0.5, y + hh * 1.04, x, y + hh * 0.9);
    ctx.lineTo(x + 5 * S, y + hh * 0.5);
    ctx.closePath();
    ctx.fill();
    return;
  }
  ctx.save();
  if (shape === 'tilt') ctx.rotate(-0.045);
  roundRect(ctx, -fullW / 2, -h / 2 - padY, bw, h + padY * 2, shape === 'rect' ? h * 0.12 : h * 0.28);
  ctx.fill();
  ctx.restore();
}

/**
 * Render captions for time t.
 * @param ctx 2D context
 * @param W,H canvas size in pixels
 * @param pages output of buildPages
 * @param design design preset (merged with overrides)
 * @param motion motion settings
 * @param opts { ref: reference size (default 1080), transform: text transform fn }
 */
export function renderCaptions(ctx, W, H, pages, t, design, motion, opts = {}) {
  const page = pages.find((p) => t >= p.start && t < p.end);
  if (!page) return;
  const d = design;
  const S = Math.min(W, H) / (opts.ref || 900);
  const anim = WORD_ANIMATIONS[motion.anim] || WORD_ANIMATIONS.none;
  const ease = EASINGS[motion.easing === 'auto' || !motion.easing ? anim.ease : motion.easing] || EASINGS.linear;
  const dur = anim.dur / (motion.speed || 1);
  const delay = motion.delay || 0;
  const sentence = motion.mode === 'sentence';

  ctx.save();
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'left';

  // Two-font pairing: which words use the accent font?
  const pair = d.accentFont && d.accentMode !== 'off' ? d : null;
  const marked = page.words.map((w) => w.text.includes('*'));
  const anyMarked = marked.some(Boolean);
  const keyIdx = pair && d.accentMode !== 'active' && !anyMarked ? pickKeyWord(page.words) : -1;
  const isAccent = (i) => !!pair && d.accentMode !== 'active' && (anyMarked ? marked[i] : i === keyIdx);
  const accentFontStr = (px) => fontString({ font: d.accentFont, fallback: d.accentFallback, weight: d.accentWeight ?? 400, italic: d.accentItalic }, px * (d.accentScale || 1.3));

  // Layout (shrinks the font if the caption would overflow the frame)
  const layout = (px) => {
    const baseF = fontString(d, px), accF = pair ? accentFontStr(px) : null;
    const prep = (text, acc) => {
      text = stripMarks(text);
      if (d.uppercase || (acc && d.accentUpper)) text = text.toUpperCase();
      if (opts.transform) text = opts.transform(text);
      return text;
    };
    const LS = d.letterSpacing || 0; // in em
    const setLS = (size) => { if ('letterSpacing' in ctx) ctx.letterSpacing = `${(LS * size).toFixed(2)}px`; };
    const measure = (text, f, size) => { ctx.font = f; setLS(size); return ctx.measureText(text).width; };
    // Hinglish: Hindi words can use their own font (e.g. Inter for English + Hind for Hindi)
    const hindiF = d.hindiFont ? fontString({ font: d.hindiFont, weight: d.hindiWeight ?? d.weight }, px) : null;
    const words = page.words.map((w, i) => {
      const acc = isAccent(i);
      const text = prep(w.text, acc);
      const base = hindiF && /[\u0900-\u097F]/.test(text) ? hindiF : baseF;
      const size = acc ? px * (d.accentScale || 1.3) : px;
      const out = { ...w, text, i, accent: acc, font: acc ? accF : base, size, ls: LS * size, baseLs: LS * px };
      out.w = measure(text, out.font, size);
      if (pair && d.accentMode === 'active') {
        // the spoken word switches font: reserve room for both so the line never jumps
        out.accentText = prep(w.text, true);
        out.accentFontStr = accF;
        out.w = Math.max(out.w, measure(out.accentText, accF, px * (d.accentScale || 1.3)));
        out.accentLs = LS * px * (d.accentScale || 1.3);
        out.size = px * Math.max(1, d.accentScale || 1.3);
      }
      return out;
    });
    ctx.font = baseF;
    setLS(0);
    const space = ctx.measureText(' ').width * 1.05 + LS * px;
    const maxW = W * 0.86;
    const lines = [];
    let line = [], lw = 0;
    for (const w of words) {
      const add = (line.length ? space : 0) + w.w;
      if (line.length && lw + add > maxW) { lines.push({ words: line, w: lw }); line = []; lw = 0; }
      lw += (line.length ? space : 0) + w.w;
      line.push(w);
    }
    if (line.length) lines.push({ words: line, w: lw });
    for (const l of lines) l.h = Math.max(...l.words.map((w) => (d.accentMode === 'active' ? px : w.size))) * d.lineHeight;
    const blockH = lines.reduce((a, l) => a + l.h, 0);
    return { px, space, lines, lh: px * d.lineHeight, blockH, blockW: Math.max(...lines.map((l) => l.w)) };
  };
  const maxBlock = H * (opts.fit || 0.6);
  let L = layout(d.size * S);
  for (let k = 0; k < 4 && (L.blockH > maxBlock || L.blockW > W * 0.92); k++) {
    L = layout(L.px * Math.min(0.9, maxBlock / L.blockH, (W * 0.9) / L.blockW));
  }
  const { px, space, lines, lh, blockH, blockW } = L;
  const cy = Math.min(Math.max(H * d.y, blockH / 2 + 16 * S), H - blockH / 2 - 16 * S);
  const cx = W / 2;

  // Entrance (whole caption)
  const entDur = 0.3 / (motion.speed || 1);
  const e = EASINGS.easeOut(clamp01((t - page.start) / entDur));
  const ent = (ENTRANCES[motion.entrance] || ENTRANCES.none).fn(e);
  let alpha = ent.alpha ?? 1;
  if (page.lastInCue) alpha *= clamp01((page.end - t) / 0.12);
  ctx.globalAlpha = alpha;
  ctx.translate(cx, cy + (ent.dy || 0) * H);
  if (ent.scale) ctx.scale(ent.scale, ent.scale);
  if (ent.blur > 0.3) ctx.filter = `blur(${ent.blur * S}px)`;

  if (d.box) {
    ctx.save();
    ctx.globalAlpha = alpha * d.boxOpacity;
    ctx.fillStyle = d.boxColor;
    const pad = px * 0.35;
    roundRect(ctx, -blockW / 2 - pad, -blockH / 2 - pad * 0.5, blockW + pad * 2, blockH + pad, px * 0.3);
    ctx.fill();
    ctx.restore();
  }

  let yAcc = -blockH / 2;
  lines.forEach((ln) => {
    let x = -ln.w / 2;
    const y = yAcc + ln.h / 2;
    yAcc += ln.h;
    for (const w of ln.words) {
      const wx = x + w.w / 2;
      x += w.w + space;
      const next = page.words[w.i + 1];
      const activeEnd = next ? next.start : page.end;
      const revealAt = (sentence ? page.start : w.start) + delay;
      const raw = dur > 0 ? clamp01((t - revealAt) / dur) : 1;
      const revealed = t >= revealAt;
      const active = !sentence && t >= w.start && t < activeEnd;
      const activeP = active ? clamp01((t - w.start) / Math.max(0.05, activeEnd - w.start)) : 0;
      if (anim.hidden && !revealed) continue;
      const st = anim.fn({ p: ease(raw), raw, active, activeP, revealed, t, i: w.i });
      drawWord(ctx, w, wx, y, w.accent ? w.size : px, S, d, st, active);
    }
  });
  ctx.restore();
}

function drawWord(ctx, w, x, y, px, S, d, st, active) {
  ctx.save();
  ctx.translate(x + (st.dx || 0) * px, y + (st.dy || 0) * px);
  if (st.rot) ctx.rotate(st.rot);
  const as = active && d.activeScale ? d.activeScale : 1;
  const sx = (st.scaleX ?? st.scale ?? 1) * as, sy = (st.scaleY ?? st.scale ?? 1) * as;
  if (sx !== 1 || sy !== 1) ctx.scale(sx, sy);
  if (st.alpha !== undefined) ctx.globalAlpha *= clamp01(st.alpha);

  // accent font for this word right now?
  const accentNow = w.accent || (active && !!w.accentFontStr);
  let text = accentNow && w.accentText ? w.accentText : w.text;
  ctx.font = accentNow && w.accentFontStr ? w.accentFontStr : w.font;
  const h = accentNow && w.accentFontStr ? px * (d.accentScale || 1.3) : px;
  if ('letterSpacing' in ctx) ctx.letterSpacing = `${((accentNow && w.accentFontStr ? w.accentLs : w.ls) || 0).toFixed(2)}px`;
  const tw = ctx.measureText(text).width;
  // background shapes
  if (st.sweep > 0) {
    drawActiveShape(ctx, d.activeShape === 'underline' ? 'pill' : d.activeShape || 'pill', d.activeBg || '#FACC15', tw, h, S, st.sweep);
  } else if (active && d.activeBg && st.sweep === undefined) {
    drawActiveShape(ctx, d.activeShape, d.activeBg, tw, h, S);
  }

  if (st.reveal !== undefined && st.reveal < 1) {
    const g = graphemes(text);
    text = g.slice(0, Math.ceil(g.length * st.reveal)).join('');
  }
  let color = active && d.activeColor && !st.noActiveColor ? d.activeColor : d.color;
  if (accentNow && d.accentColor && !(active && d.activeBg && d.activeColor)) color = d.accentColor;
  const x0 = -tw / 2;

  if (st.glitch > 0) {
    ctx.save();
    ctx.globalAlpha *= 0.85;
    ctx.fillStyle = '#FF1E56';
    ctx.fillText(text, x0 - 7 * S * st.glitch, -2 * S * st.glitch);
    ctx.fillStyle = '#00E5FF';
    ctx.fillText(text, x0 + 7 * S * st.glitch, 2 * S * st.glitch);
    ctx.restore();
  }

  // A word sitting on a highlight box reads best without outline/shadow.
  const onBox = (active && d.activeBg && d.activeShape !== 'underline' && st.sweep === undefined) || st.sweep > 0.5;
  paintText(ctx, text, x0, onBox ? { ...d, outline: 0, shadow: 0 } : d, S, color);

  if (st.fill !== undefined && st.fill > 0) {
    ctx.save();
    ctx.beginPath();
    ctx.rect(x0 - 2, -h, tw * st.fill + 2, h * 2);
    ctx.clip();
    paintText(ctx, text, x0, d, S, d.activeColor || '#FFE14D', true);
    ctx.restore();
  }
  if (st.caret) {
    const cw = ctx.measureText(text).width;
    ctx.fillStyle = color;
    ctx.fillRect(x0 + cw + 3 * S, -h * 0.4, Math.max(2, 5 * S), h * 0.8);
  }
  ctx.restore();
}

function paintText(ctx, text, x, d, S, color, noShadow) {
  if (d.outline > 0) {
    ctx.save();
    ctx.lineJoin = 'round';
    ctx.miterLimit = 2;
    ctx.lineWidth = d.outline * 2 * S;
    ctx.strokeStyle = d.outlineColor;
    if (d.shadow > 0 && !noShadow) {
      ctx.shadowColor = d.shadowColor;
      ctx.shadowBlur = d.shadow * S;
      ctx.shadowOffsetY = d.shadow * S * 0.25;
    }
    ctx.strokeText(text, x, 0);
    ctx.restore();
  }
  ctx.save();
  if (d.shadow > 0 && !noShadow && !(d.outline > 0)) {
    ctx.shadowColor = d.shadowColor;
    ctx.shadowBlur = d.shadow * S;
    ctx.shadowOffsetY = d.shadow * S * 0.25;
  }
  ctx.fillStyle = color;
  ctx.fillText(text, x, 0);
  ctx.restore();
}

/** Build demo pages for gallery thumbnails (loops over `period` seconds). */
export function demoPages(text, period = 3.2) {
  const words = estimateWords(text, 0.25, period - 0.5);
  return buildPages([{ text, start: 0.25, end: period - 0.35, words }], 0);
}
