// On-demand Google Fonts loading for the Font Library.
// Each family's CSS is requested once, with exactly the weights/italics Google says exist
// (a request for a missing weight makes the whole CSS request fail). Font files themselves
// only download for the scripts actually drawn, thanks to unicode-range subsets.
import { FONT_CATALOG } from './font-catalog.js';

export const FONT_INFO = new Map(FONT_CATALOG.map((f) => [f.family, f]));
const cssLoads = new Map();

export const CATEGORY_LABELS = {
  all: 'All', modern: 'Modern', bold: 'Bold', cinematic: 'Cinematic', handwriting: 'Handwriting',
  mono: 'Monospace', hindi: 'हिन्दी Hindi', indic: 'Indian scripts',
};

/** Weights we offer in the UI (300–900 where the family has them). */
export function usableWeights(family) {
  const f = FONT_INFO.get(family);
  if (!f) return [400, 700];
  const w = f.weights.filter((x) => x >= 300 && x <= 900);
  return w.length ? w : f.weights;
}
export function nearestWeight(family, want) {
  const ws = usableWeights(family);
  return ws.reduce((a, b) => (Math.abs(b - want) < Math.abs(a - want) ? b : a), ws[0]);
}
export const supportsHindi = (family) => !!FONT_INFO.get(family)?.scripts.includes('hi');

function cssUrl(f) {
  const name = f.family.replace(/ /g, '+');
  const w = usableWeights(f.family);
  const it = (f.italics || []).filter((x) => w.includes(x));
  let spec = '';
  if (it.length) spec = `:ital,wght@${[...w.map((x) => `0,${x}`), ...it.map((x) => `1,${x}`)].join(';')}`;
  else if (!(w.length === 1 && w[0] === 400)) spec = `:wght@${w.join(';')}`;
  return `https://fonts.googleapis.com/css2?family=${name}${spec}&display=swap`;
}

/** Inject the family's stylesheet once. Resolves when the CSS (not the font files) has loaded. */
export function ensureFamily(family) {
  if (!family) return Promise.resolve();
  if (cssLoads.has(family)) return cssLoads.get(family);
  const f = FONT_INFO.get(family);
  if (!f) { cssLoads.set(family, Promise.resolve()); return cssLoads.get(family); }
  const p = new Promise((resolve) => {
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = cssUrl(f);
    link.dataset.font = family;
    link.onload = () => resolve();
    link.onerror = () => { console.warn('Font CSS failed', family); resolve(); };
    document.head.appendChild(link);
  });
  cssLoads.set(family, p);
  return p;
}

/** Make sure a specific face is ready for canvas drawing (canvas never triggers font downloads itself). */
export async function ensureFace(family, weight = 400, italic = false, sample = 'Aa 123 हिन्दी') {
  if (!family) return;
  await ensureFamily(family);
  try { await document.fonts.load(`${italic ? 'italic ' : ''}${weight} 40px "${family}"`, sample); } catch {}
}

/** Load everything a caption design needs (base, accent, Hindi font). */
export function ensureDesignFonts(d) {
  return Promise.all([
    ensureFace(d.font, d.weight),
    d.accentFont && ensureFace(d.accentFont, d.accentWeight ?? 400, !!d.accentItalic),
    d.accentFallback && ensureFace(d.accentFallback, d.accentWeight ?? 400, !!d.accentItalic, 'हिन्दी'),
    d.hindiFont && ensureFace(d.hindiFont, nearestWeight(d.hindiFont, d.hindiWeight ?? d.weight), false, 'हिन्दी कमाल'),
  ]);
}
