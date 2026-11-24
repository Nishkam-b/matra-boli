// Language catalogue. `whisper` = speech-recognition code (null = Whisper can't transcribe it).
// `nllb` = translation code used by the current in-browser translation engine.
export const LANGUAGES = [
  { id: 'hi', name: 'Hindi', native: 'हिन्दी', whisper: 'hi', nllb: 'hin_Deva', sample: 'यह एक कमाल का टूल है!' },
  { id: 'en', name: 'English', native: 'English', whisper: 'en', nllb: 'eng_Latn', sample: 'This is an amazing tool!' },
  { id: 'hinglish', name: 'Hinglish', native: 'Hinglish', whisper: 'hi', nllb: 'hin_Deva', roman: true, sample: 'Yeh ek kamaal ka tool hai!' },
  { id: 'pa', name: 'Punjabi', native: 'ਪੰਜਾਬੀ', whisper: 'pa', nllb: 'pan_Guru', sample: 'ਇਹ ਇੱਕ ਕਮਾਲ ਦਾ ਟੂਲ ਹੈ!' },
  { id: 'bn', name: 'Bengali', native: 'বাংলা', whisper: 'bn', nllb: 'ben_Beng', sample: 'এটা একটা দারুণ টুল!' },
  { id: 'ta', name: 'Tamil', native: 'தமிழ்', whisper: 'ta', nllb: 'tam_Taml', sample: 'இது ஒரு அருமையான கருவி!' },
  { id: 'te', name: 'Telugu', native: 'తెలుగు', whisper: 'te', nllb: 'tel_Telu', sample: 'ఇది ఒక అద్భుతమైన టూల్!' },
  { id: 'mr', name: 'Marathi', native: 'मराठी', whisper: 'mr', nllb: 'mar_Deva', sample: 'हे एक भारी टूल आहे!' },
  { id: 'gu', name: 'Gujarati', native: 'ગુજરાતી', whisper: 'gu', nllb: 'guj_Gujr', sample: 'આ એક કમાલનું ટૂલ છે!' },
  { id: 'kn', name: 'Kannada', native: 'ಕನ್ನಡ', whisper: 'kn', nllb: 'kan_Knda', sample: 'ಇದು ಒಂದು ಅದ್ಭುತ ಟೂಲ್!' },
  { id: 'ml', name: 'Malayalam', native: 'മലയാളം', whisper: 'ml', nllb: 'mal_Mlym', sample: 'ഇതൊരു അടിപൊളി ടൂൾ ആണ്!' },
  { id: 'or', name: 'Odia', native: 'ଓଡ଼ିଆ', whisper: null, nllb: 'ory_Orya', sample: 'ଏହା ଏକ ଚମତ୍କାର ଟୁଲ୍!' },
  { id: 'as', name: 'Assamese', native: 'অসমীয়া', whisper: 'as', nllb: 'asm_Beng', sample: 'এইটো এটা চমৎকাৰ টুল!' },
  { id: 'ur', name: 'Urdu', native: 'اردو', whisper: 'ur', nllb: 'urd_Arab', sample: 'یہ ایک کمال کا ٹول ہے!' },
];
export const LANG = Object.fromEntries(LANGUAGES.map((l) => [l.id, l]));

// Detect source language from the script of transcribed text (for auto-detect).
const RANGES = [
  [0x0900, 'hi'], [0x0980, 'bn'], [0x0a00, 'pa'], [0x0a80, 'gu'], [0x0b00, 'or'],
  [0x0b80, 'ta'], [0x0c00, 'te'], [0x0c80, 'kn'], [0x0d00, 'ml'],
];
export function detectScriptLang(text) {
  const counts = {};
  for (const ch of text) {
    const c = ch.codePointAt(0);
    let id = null;
    if (c >= 0x0600 && c <= 0x06ff) id = 'ur';
    else if (c >= 0x0900 && c < 0x0d80) id = RANGES.find(([s]) => c >= s && c < s + 0x80)?.[1];
    else if (/[A-Za-z]/.test(ch)) id = 'en';
    if (id) counts[id] = (counts[id] || 0) + 1;
  }
  const best = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
  return best ? best[0] : 'en';
}

/* ------------------------------------------------------------------ */
/* Romanisation (Indic script -> Hinglish-style Roman)                  */
/* Brahmic Unicode blocks share the ISCII layout, so we map every       */
/* script onto Devanagari offsets and romanise from there.              */
/* ------------------------------------------------------------------ */
const CONS = {
  0x15: 'k', 0x16: 'kh', 0x17: 'g', 0x18: 'gh', 0x19: 'n', 0x1a: 'ch', 0x1b: 'chh', 0x1c: 'j', 0x1d: 'jh', 0x1e: 'n',
  0x1f: 't', 0x20: 'th', 0x21: 'd', 0x22: 'dh', 0x23: 'n', 0x24: 't', 0x25: 'th', 0x26: 'd', 0x27: 'dh', 0x28: 'n',
  0x29: 'n', 0x2a: 'p', 0x2b: 'ph', 0x2c: 'b', 0x2d: 'bh', 0x2e: 'm', 0x2f: 'y', 0x30: 'r', 0x31: 'r', 0x32: 'l',
  0x33: 'l', 0x34: 'zh', 0x35: 'v', 0x36: 'sh', 0x37: 'sh', 0x38: 's', 0x39: 'h',
  0x58: 'q', 0x59: 'kh', 0x5a: 'gh', 0x5b: 'z', 0x5c: 'd', 0x5d: 'rh', 0x5e: 'f', 0x5f: 'y',
};
const VOWELS = {
  0x05: 'a', 0x06: 'aa', 0x07: 'i', 0x08: 'i', 0x09: 'u', 0x0a: 'u', 0x0b: 'ri', 0x0f: 'e', 0x10: 'ai',
  0x13: 'o', 0x14: 'au', 0x0e: 'e', 0x12: 'o',
};
const MATRAS = {
  0x3e: 'aa', 0x3f: 'i', 0x40: 'i', 0x41: 'u', 0x42: 'u', 0x43: 'ri', 0x47: 'e', 0x48: 'ai', 0x4b: 'o', 0x4c: 'au',
  0x46: 'e', 0x4a: 'o',
};
const NUKTA_MAP = { 'k': 'q', 'kh': 'kh', 'g': 'gh', 'j': 'z', 'ph': 'f', 'd': 'r', 'dh': 'rh' };

function romanWord(word) {
  const cps = Array.from(word).map((ch) => {
    const c = ch.codePointAt(0);
    if (c >= 0x0900 && c < 0x0d80) return { off: (c - 0x0900) % 0x80, ch };
    return { off: -1, ch };
  });
  // 1. Parse into syllable units: { c: consonant, v: vowel, inh: inherent schwa, post: n/m/h }
  const units = [];
  for (let i = 0; i < cps.length; i++) {
    const { off, ch } = cps[i];
    if (off < 0) { units.push({ raw: ch }); continue; }
    if (CONS[off] !== undefined) {
      let c = CONS[off];
      let j = i + 1;
      if (cps[j] && cps[j].off === 0x3c) { c = NUKTA_MAP[c] || c; j++; }
      const nx = cps[j];
      if (nx && nx.off === 0x4d) { units.push({ c, v: '' }); i = j; continue; }
      if (nx && MATRAS[nx.off] !== undefined) { units.push({ c, v: MATRAS[nx.off] }); i = j; continue; }
      units.push({ c, v: 'a', inh: true });
      i = j - 1;
      continue;
    }
    if (VOWELS[off] !== undefined) { units.push({ c: '', v: VOWELS[off] }); continue; }
    const prev = units[units.length - 1];
    if (off === 0x71) continue; // Gurmukhi addak (gemination)
    if (off === 0x02 || off === 0x01 || off === 0x03 || off === 0x70) {
      const nx = cps[i + 1];
      const s = off === 0x03 ? 'h' : nx && [0x2a, 0x2b, 0x2c, 0x2d, 0x2e].includes(nx.off) ? 'm' : 'n';
      if (prev && prev.raw === undefined) prev.post = (prev.post || '') + s; else units.push({ raw: s });
      continue;
    }
    if (off === 0x64 || off === 0x65) { units.push({ raw: '.' }); continue; }
    if (off >= 0x66 && off <= 0x6f) { units.push({ raw: String(off - 0x66) }); continue; }
    if (off === 0x3c || off === 0x4d) continue;
    units.push({ raw: ch });
  }
  // 2. Schwa deletion: word-final, then medial V C(a) C V  ->  V C C V  (aapako -> aapko)
  const letters = units.filter((u) => u.raw === undefined);
  const last = letters[letters.length - 1];
  if (last && last.inh && !last.post && letters.length > 1) last.v = '';
  for (let k = 1; k < letters.length - 1; k++) {
    const u = letters[k], p = letters[k - 1], n = letters[k + 1];
    if (u.inh && !u.post && u.v && p.v && n.c && n.v) u.v = '';
  }
  let out = units.map((u) => (u.raw !== undefined ? u.raw : u.c + u.v + (u.post || ''))).join('');
  // Hinglish-friendly endings: final "aa" reads better as "a" (hona, kya)
  out = out.replace(/aa(?=[^a-z]*$)/i, 'a');
  return out;
}

export function romanize(text) {
  if (!/[ऀ-ൿ]/.test(text)) return text;
  return text.split(/(\s+)/).map((w) => (/\s/.test(w) ? w : romanWord(w))).join('')
    .replace(/(^|[.!?।]\s*)([a-z])/g, (m, a, b) => a + b.toUpperCase());
}
