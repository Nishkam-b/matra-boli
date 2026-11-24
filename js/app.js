import {
  DESIGNS, WORD_ANIMATIONS, ENTRANCES, EASING_LABELS, FONTS, SCRIPT_FALLBACKS, DEFAULT_MOTION, FONT_PAIRS, stripMarks,
  renderCaptions, buildPages, estimateWords, demoPages,
} from './engine.js';
import { LANGUAGES, LANG, detectScriptLang, romanize } from './languages.js';
import { buildCues } from './transcript.js';
import { FONT_CATALOG } from './font-catalog.js';
import { FONT_INFO, CATEGORY_LABELS, usableWeights, nearestWeight, supportsHindi, ensureFamily, ensureFace, ensureDesignFonts } from './fontloader.js';

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
const icons = () => window.lucide && window.lucide.createIcons();
const MAX_DURATION = 60.5;
const STORE_DRAFT = 'matraboli.draft.v1';
const STORE_PRESETS = 'matraboli.presets.v1';

/* ------------------------------------------------------------------ */
/* State                                                               */
/* ------------------------------------------------------------------ */
const state = {
  file: null, url: null, duration: 0, vw: 1080, vh: 1920,
  cues: [], original: [], wordLevel: false, translated: false,
  srcLang: 'auto', tgtLang: 'none', script: 'native',
  designId: 'modern', overrides: {}, motion: { ...DEFAULT_MOTION },
  sel: 0, pages: [], pagesDirty: true, thumb: null, busy: false,
};
const design = () => ({ ...DESIGNS[state.designId], ...state.overrides });
const transform = () => (state.script === 'roman' ? romanize : null);
const dirty = () => { state.pagesDirty = true; };
function pages() {
  if (state.pagesDirty) { state.pages = buildPages(state.cues, state.motion.maxWords); state.pagesDirty = false; }
  return state.pages;
}

const video = document.createElement('video');
video.playsInline = true;
video.preload = 'auto';
video.crossOrigin = 'anonymous';

/* ------------------------------------------------------------------ */
/* Utilities                                                           */
/* ------------------------------------------------------------------ */
function toast(msg, ms = 3200) {
  const t = $('#toast');
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toast._t);
  toast._t = setTimeout(() => (t.hidden = true), ms);
}
const fmt = (s) => { s = Math.max(0, s || 0); return `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`; };
const fmtPrecise = (s) => { s = Math.max(0, s || 0); return `${Math.floor(s / 60)}:${(s % 60).toFixed(1).padStart(4, '0')}`; };
function parseTime(str) {
  const m = String(str).trim().match(/^(?:(\d+):)?(\d+(?:\.\d+)?)$/);
  return m ? (Number(m[1] || 0) * 60 + Number(m[2])) : null;
}
function seekTo(t) {
  return new Promise((res) => {
    const done = () => { video.removeEventListener('seeked', done); res(); };
    video.addEventListener('seeked', done);
    video.currentTime = t;
  });
}
function readJSON(key, fallback) { try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; } }
function writeJSON(key, v) { try { localStorage.setItem(key, JSON.stringify(v)); return true; } catch { return false; } }
function download(blob, name) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 2000);
}
const baseName = () => (state.file?.name || 'matra-boli').replace(/\.[^.]+$/, '');

/* ------------------------------------------------------------------ */
/* Selects & chips                                                     */
/* ------------------------------------------------------------------ */
function fillLangSelect(sel, first) {
  sel.innerHTML = `<option value="${first[0]}">${first[1]}</option>` +
    LANGUAGES.map((l) => `<option value="${l.id}">${l.name}${l.native !== l.name ? ` (${l.native})` : ''}</option>`).join('');
}
fillLangSelect($('#homeSrc'), ['auto', 'Auto Detect']);
fillLangSelect($('#srcLang'), ['auto', 'Auto Detect']);
fillLangSelect($('#homeTgt'), ['none', 'Keep original language']);
fillLangSelect($('#tgtLang'), ['none', 'Keep original language']);
// Odia: Whisper has no Odia speech model, so it can't be a caption (source) language.
for (const s of [$('#homeSrc'), $('#srcLang')]) {
  const o = s.querySelector('option[value="or"]');
  o.disabled = true;
  o.textContent += ' — translation only';
}
$('#homeStyle').innerHTML = Object.entries(DESIGNS).map(([k, d]) => `<option value="${k}">${d.name}</option>`).join('');
$('#entrance').innerHTML = Object.entries(ENTRANCES).map(([k, e]) => `<option value="${k}">${e.name}</option>`).join('');
$('#easing').innerHTML = Object.entries(EASING_LABELS).map(([k, l]) => `<option value="${k}">${l}</option>`).join('');

const POPULAR = ['hi', 'en', 'hinglish', 'pa', 'bn', 'ta', 'te', 'mr', 'gu', 'kn', 'ml'];
let showAllChips = false;
function renderChips() {
  const list = showAllChips ? LANGUAGES : LANGUAGES.filter((l) => POPULAR.includes(l.id));
  $('#langChips').innerHTML = list.map((l) =>
    `<button class="chip${state.tgtLang === l.id ? ' on' : ''}" data-l="${l.id}"><b>${l.native}</b><small>${l.name}</small></button>`
  ).join('') + `<button class="chip" data-more><b>${showAllChips ? '− Less' : '+ More'}</b><small>${showAllChips ? 'Popular only' : 'Odia, Assamese, Urdu'}</small></button>`;
}
renderChips();
$('#langChips').addEventListener('click', (e) => {
  const c = e.target.closest('.chip');
  if (!c) return;
  if (c.hasAttribute('data-more')) { showAllChips = !showAllChips; renderChips(); return; }
  setTarget(c.dataset.l === state.tgtLang ? 'none' : c.dataset.l);
});
function setTarget(id) {
  state.tgtLang = id;
  $('#homeTgt').value = id;
  $('#tgtLang').value = id;
  renderChips();
}
function setSource(id) {
  state.srcLang = id;
  $('#homeSrc').value = id;
  $('#srcLang').value = id;
}
$('#homeSrc').addEventListener('change', (e) => setSource(e.target.value));
$('#homeTgt').addEventListener('change', (e) => setTarget(e.target.value));
$('#homeStyle').addEventListener('change', (e) => selectDesign(e.target.value));

/* ------------------------------------------------------------------ */
/* Home: upload                                                        */
/* ------------------------------------------------------------------ */
const dz = $('#dropzone');
$('#fileInput').addEventListener('change', (e) => e.target.files[0] && loadFile(e.target.files[0]));
['dragenter', 'dragover'].forEach((ev) => dz.addEventListener(ev, (e) => { e.preventDefault(); dz.classList.add('drag'); }));
['dragleave', 'drop'].forEach((ev) => dz.addEventListener(ev, (e) => { e.preventDefault(); dz.classList.remove('drag'); }));
dz.addEventListener('drop', (e) => { const f = e.dataTransfer.files[0]; if (f) loadFile(f); });

let loadToken = 0;
async function loadFile(file) {
  const token = ++loadToken; // if another file is picked while this one loads, the newest wins
  if (!file.type.startsWith('video/') && !/\.(mp4|mov|webm|m4v)$/i.test(file.name)) { toast('Please choose a video file (MP4, MOV or WebM).'); return; }
  const url = URL.createObjectURL(file);
  const ok = await new Promise((res) => {
    video.onloadedmetadata = () => res(true);
    video.onerror = () => res(false);
    video.src = url;
  });
  if (token !== loadToken) { URL.revokeObjectURL(url); return; }
  if (!ok) { URL.revokeObjectURL(url); toast("This browser can't read that video. Try MP4 (H.264) or WebM."); return; }
  if (video.duration > MAX_DURATION) {
    toast(`That video is ${fmt(video.duration)} long. Matra Boli supports up to 60 seconds — trim it and try again.`, 5000);
    URL.revokeObjectURL(url);
    video.removeAttribute('src');
    return;
  }
  if (state.url) URL.revokeObjectURL(state.url);
  Object.assign(state, { file, url, duration: video.duration, vw: video.videoWidth || 1080, vh: video.videoHeight || 1920, cues: [], original: [], translated: false });
  dirty();
  await makeThumb();
  if (token !== loadToken) return;
  $('#dzTitle').textContent = file.name;
  $('#dzMeta').textContent = `${fmt(state.duration)} · ${state.vw}×${state.vh} · ready`;
  $('.steps .step').classList.remove('active');
  $('.steps .step').classList.add('done');
  $$('.steps .step')[1].classList.add('active');
  $('#fileName').textContent = file.name;
  $('#fileMeta').textContent = `${fmt(state.duration)} • ${aspectLabel()}`;
  sizePreview();
  buildFilmstrip();
  if (document.body.dataset.view === 'editor') startPipeline();
  else toast('Video ready — pick your languages and hit Generate Captions.');
}
function aspectLabel() {
  const r = state.vw / state.vh;
  return r < 0.7 ? '9:16' : r < 0.9 ? '4:5' : r < 1.2 ? '1:1' : '16:9';
}
async function makeThumb() {
  await seekTo(Math.min(1, state.duration / 2));
  const tc = $('#thumb'), tx = tc.getContext('2d');
  const s = Math.max(tc.width / state.vw, tc.height / state.vh);
  tx.drawImage(video, (tc.width - state.vw * s) / 2, (tc.height - state.vh * s) / 2, state.vw * s, state.vh * s);
  try { state.thumb = await createImageBitmap(video); } catch { state.thumb = null; }
  await seekTo(0);
}

$('#generateBtn').addEventListener('click', () => {
  if (!state.file) { $('#fileInput').click(); return; }
  openEditor();
  const draft = readJSON(STORE_DRAFT, null);
  if (draft && draft.fileName === state.file.name && draft.fileSize === state.file.size && confirm('You have a saved draft for this video. Restore it?')) {
    restoreDraft(draft);
    return;
  }
  startPipeline();
});

/* ------------------------------------------------------------------ */
/* View switching                                                      */
/* ------------------------------------------------------------------ */
function openEditor() {
  document.body.dataset.view = 'editor';
  document.body.dataset.m = document.body.dataset.m || 'preview';
  window.scrollTo(0, 0);
  sizePreview();
  setTimeout(renderTimeline);
  setStep(2);
}
$('#backHome').addEventListener('click', (e) => { e.preventDefault(); video.pause(); document.body.dataset.view = 'home'; });
$('#replaceVideo').addEventListener('click', () => $('#fileInput').click());
$('#mobileTabs').addEventListener('click', (e) => {
  const b = e.target.closest('button');
  if (!b) return;
  document.body.dataset.m = b.dataset.m;
  $$('#mobileTabs button').forEach((x) => x.classList.toggle('on', x === b));
  if (b.dataset.m === 'captions') showView('transcript');
  if (b.dataset.m === 'style' && (galleryTab === 'transcript' || galleryTab === 'settings')) showView('styles');
  setTimeout(renderTimeline);
});

function setStep(n) {
  for (const li of [...$$('#stepper li'), ...$$('#sideSteps li')]) {
    const s = Number(li.dataset.s);
    li.classList.toggle('done', s < n);
    li.classList.toggle('current', s === n);
  }
}

/* ------------------------------------------------------------------ */
/* AI pipeline (worker)                                                */
/* ------------------------------------------------------------------ */
let worker = null;
let pending = null;
function getWorker() {
  if (worker) return worker;
  worker = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });
  worker.onmessage = ({ data }) => {
    if (data.type === 'progress') {
      const pct = data.total ? Math.round((data.loaded / data.total) * 100) : 0;
      $('#busyBar').style.width = pct + '%';
      $('#busyTitle').textContent = data.stage === 'translator'
        ? `Loading translation model… ${pct}%`
        : `Loading speech model… ${pct}%`;
      $('#busySub').textContent = `${(data.loaded / 1e6).toFixed(0)} / ${(data.total / 1e6).toFixed(0)} MB · downloaded once, then loaded from this browser`;
    } else if (data.type === 'status') {
      $('#busyTitle').textContent = data.text;
      $('#busySub').textContent = 'Running on your device — nothing is uploaded';
      $('#busyBar').style.width = '100%';
    } else if (pending) {
      const p = pending; pending = null;
      data.type === 'error' ? p.reject(new Error(data.message)) : p.resolve(data);
    }
  };
  worker.onerror = (e) => { if (pending) { pending.reject(new Error(e.message || 'Worker failed to start')); pending = null; } };
  return worker;
}
function ask(msg, transfer) {
  return new Promise((resolve, reject) => {
    pending = { resolve, reject };
    getWorker().postMessage(msg, transfer || []);
  });
}
function setBusy(on, title, sub) {
  state.busy = on;
  $('#busy').hidden = !on;
  if (title) $('#busyTitle').textContent = title;
  if (sub !== undefined) $('#busySub').textContent = sub;
  $('#busyBar').style.width = '0%';
  ['#retranscribe', '#translateBtn', '#exportBtn'].forEach((s) => ($(s).disabled = on));
}

async function decodeAudio(file) {
  const buf = await file.arrayBuffer();
  const AC = window.AudioContext || window.webkitAudioContext;
  const ac = new AC({ sampleRate: 16000 });
  try {
    const ab = await ac.decodeAudioData(buf);
    if (ab.numberOfChannels === 1) return ab.getChannelData(0);
    const a = ab.getChannelData(0), b = ab.getChannelData(1);
    const mono = new Float32Array(a.length);
    for (let i = 0; i < a.length; i++) mono[i] = (a[i] + b[i]) / 2;
    return mono;
  } finally { ac.close(); }
}

let pipelineRunning = false, pipelineQueued = false;
async function startPipeline() {
  if (!state.file) return;
  // A new video arrived while we were still working: run again for it when this run ends.
  if (pipelineRunning) { pipelineQueued = true; toast('Finishing the current video first, then starting the new one…'); return; }
  pipelineRunning = true;
  const file = state.file;
  try {
    await transcribe();
    if (state.tgtLang !== 'none' && state.file === file) await translate();
    setStep(4);
  } catch (err) {
    console.error(err);
    setBusy(false);
    const friendly = {
      NO_AUDIO: "This video has no sound we can read (no audio track). You can still type captions with “Add caption”.",
      SILENT: "We couldn't hear any speech in this video. You can still type captions with “Add caption”.",
    }[err.message];
    toast(friendly || `Something went wrong: ${err.message}. You can still add captions manually.`, 7000);
    if (!state.cues.length) addCue();
  } finally {
    pipelineRunning = false;
    if (pipelineQueued) { pipelineQueued = false; startPipeline(); }
  }
}

// Which speech model to use. Chosen from the benchmark in bench/ (see README):
//  - Whisper large-v3-turbo: best text for Hindi, regional languages and English (native script)
//  - Hindi2Hinglish Apex: Hindi / Hinglish speech written in Roman script, the way creators type it
function chooseModel() {
  const pick = $('#asrModel').value;
  if (pick !== 'auto') return pick;
  const romanWanted = state.srcLang === 'hinglish' || (state.srcLang === 'hi' && state.tgtLang === 'hinglish');
  const translating = state.tgtLang !== 'none' && state.tgtLang !== 'hinglish';
  return romanWanted && !translating ? 'hinglish-q4' : 'turbo-lite';
}
const MODEL_LABEL = {
  'turbo-lite': 'Whisper large-v3 turbo', 'hinglish-q4': 'Hinglish model', base: 'Whisper base',
};

function updateModelHint() {
  const m = chooseModel();
  const auto = $('#asrModel').value === 'auto';
  let t = auto ? `Will use: ${MODEL_LABEL[m]}.` : '';
  if (m === 'base') t += ' Not recommended for Hindi or regional languages.';
  if (!navigator.gpu) t += ' Your browser has no WebGPU, so large models run slowly — use Chrome or Edge on a computer.';
  $('#modelHint').textContent = t.trim();
}
$('#asrModel').addEventListener('change', updateModelHint);
$('#modeSegAsr').addEventListener('click', (e) => {
  const b = e.target.closest('button');
  if (!b) return;
  $$('#modeSegAsr button').forEach((x) => x.classList.toggle('on', x === b));
  try { localStorage.setItem('matraboli.asrMode', b.dataset.v); } catch {}
});
try { const m = localStorage.getItem('matraboli.asrMode'); if (m) $$('#modeSegAsr button').forEach((x) => x.classList.toggle('on', x.dataset.v === m)); } catch {}
['#srcLang', '#tgtLang', '#homeSrc', '#homeTgt'].forEach((id) => $(id).addEventListener('change', () => setTimeout(updateModelHint)));
$('#langChips').addEventListener('click', () => setTimeout(updateModelHint));
setTimeout(updateModelHint);

async function transcribe() {
  setStep(2);
  setBusy(true, 'Reading audio…', 'Running on your device — nothing is uploaded');
  const forFile = state.file;
  let audio;
  try { audio = await decodeAudio(forFile); } catch { throw new Error('NO_AUDIO'); }
  let peak = 0;
  for (let i = 0; i < audio.length; i += 64) { const v = Math.abs(audio[i]); if (v > peak) peak = v; }
  if (!audio.length || peak < 0.003) throw new Error('SILENT');
  const model = chooseModel();
  setBusy(true, `Loading ${MODEL_LABEL[model] || 'speech model'}…`, 'Downloaded once, then loaded from this browser');
  const src = state.srcLang === 'auto' ? null : LANG[state.srcLang].whisper;
  const mode = $('#modeSegAsr .on')?.dataset.v || 'thorough';
  const res = await ask({ type: 'transcribe', audio: audio.slice(), language: src, model, mode });
  if (state.file !== forFile) { setBusy(false); return; } // user swapped videos meanwhile
  const cues = buildCues(res, audio, state.duration);
  state.wordLevel = res.wordLevel;
  state.timing = res.wordLevel ? 'model' : 'aligned';
  state.modelUsed = model;
  state.detectedLang = res.detected ? res.language : null;
  state.original = structuredClone(cues);
  state.cues = cues;
  state.translated = false;
  clearHistory();
  if (res.roman || state.srcLang === 'hinglish') setScript('roman');
  dirty();
  state.sel = 0;
  renderCues();
  setBusy(false);
  setStep(3);
  if (!cues.length) { toast('No speech detected. Add captions manually with “Add Caption”.', 5000); addCue(); return; }
  const det = res.detected && LANG[res.language]
    ? ` · detected ${LANG[res.language].name} (${Math.round((res.detected.probs[res.language] || 0) * 100)}%)` : '';
  // Some languages (notably Telugu) sometimes come back in Roman letters from the speech model.
  const want = state.srcLang !== 'auto' ? state.srcLang : res.language;
  const native = want && !['en', 'hinglish'].includes(want) && !res.roman;
  const all = cues.map((c) => c.text).join(' ');
  const latin = (all.match(/[A-Za-z]/g) || []).length, letters = (all.match(/\p{L}/gu) || []).length;
  if (native && letters > 20 && latin / letters > 0.6) {
    setScript('roman');
    toast(`The speech model wrote ${LANG[want]?.name || 'this language'} in English letters (a known limit for some languages). Captions are shown in Roman script — you can edit any line.`, 8000);
    return;
  }
  toast(`Transcribed ${cues.length} captions with ${MODEL_LABEL[model] || model}${det}.`, 4500);
}

async function translate() {
  const tgt = state.tgtLang;
  if (tgt === 'none') { restoreOriginal(); return; }
  if (!state.original.length) { toast('Transcribe or add captions first.'); return; }
  const srcId = state.srcLang !== 'auto' ? state.srcLang : state.detectedLang && LANG[state.detectedLang] ? state.detectedLang : detectScriptLang(state.original.map((c) => c.text).join(' '));
  const src = LANG[srcId], dst = LANG[tgt];
  setStep(3);
  if (src.nllb === dst.nllb) {
    state.cues = structuredClone(state.original);
    state.translated = false;
    setScript(dst.roman ? 'roman' : 'native');
    dirty(); renderCues(); return;
  }
  setBusy(true, 'Loading translation model…', 'Large one-time download (several hundred MB), cached afterwards');
  // Translate whole sentences (a sentence may span several caption lines), then
  // share the translated words back out over the original lines and their timings.
  const groups = sentenceGroups(state.original);
  const res = await ask({ type: 'translate', texts: groups.map((g) => g.map((c) => c.text).join(' ')), src: src.nllb, tgt: dst.nllb });
  state.cues = groups.flatMap((g, i) => {
    const translated = (res.texts[i] || g.map((c) => c.text).join(' ')).trim();
    return distributeWords(translated, g).map((text, k) => {
      const c = g[k];
      return { ...c, id: crypto.randomUUID(), text, words: estimateWords(text, c.start, c.end) };
    });
  }).filter((c) => c.text);
  state.translated = true;
  setScript(dst.roman ? 'roman' : 'native');
  dirty(); renderCues();
  setBusy(false);
  setStep(4);
  toast(`Translated into ${dst.name}. Machine translation can be wrong — check each line.`, 4500);
}
const SENTENCE_END = /[.?!।॥|۔؟]["')\]]*$/;
/** Group consecutive cues that belong to one sentence (max 4 lines, no long pauses). */
function sentenceGroups(cues) {
  const groups = [];
  let cur = [];
  for (const c of cues) {
    const prev = cur[cur.length - 1];
    if (prev && (SENTENCE_END.test(prev.text.trim()) || c.start - prev.end > 1 || cur.length >= 4)) {
      groups.push(cur); cur = [];
    }
    cur.push(c);
  }
  if (cur.length) groups.push(cur);
  return groups;
}
/** Split translated text over the group's lines in proportion to each source line's length. */
function distributeWords(text, group) {
  const words = text.split(/\s+/).filter(Boolean);
  const n = group.length;
  if (n === 1) return [words.join(' ')];
  const weights = group.map((c) => Math.max(1, c.text.length));
  const total = weights.reduce((a, b) => a + b, 0);
  const cuts = [0];
  let acc = 0;
  for (let k = 0; k < n - 1; k++) {
    acc += weights[k];
    let cut = Math.round((words.length * acc) / total);
    // snap to a nearby comma/danda so a phrase isn't split
    for (const d of [0, 1, -1]) {
      const w = words[cut - 1 + d];
      if (w && /[,،;:]$/.test(w)) { cut += d; break; }
    }
    // keep at least one word per line while words remain
    const minCut = cuts[k] + (words.length - cuts[k] > n - 1 - k ? 1 : 0);
    const maxCut = Math.max(minCut, words.length - (n - 1 - k));
    cuts.push(Math.max(minCut, Math.min(cut, maxCut)));
  }
  cuts.push(words.length);
  return group.map((_, k) => words.slice(cuts[k], cuts[k + 1]).join(' '));
}
function restoreOriginal() {
  state.cues = structuredClone(state.original);
  state.translated = false;
  dirty(); renderCues();
}

$('#srcLang').addEventListener('change', (e) => setSource(e.target.value));
$('#tgtLang').addEventListener('change', (e) => setTarget(e.target.value));
$('#retranscribe').addEventListener('click', () => startPipeline());
$('#translateBtn').addEventListener('click', () => translate().catch((err) => { setBusy(false); toast(`Translation failed: ${err.message}`, 6000); }));

function setScript(v) {
  state.script = v;
  $$('#scriptSeg button').forEach((b) => b.classList.toggle('on', b.dataset.v === v));
  renderCues();
}
$('#scriptSeg').addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) setScript(b.dataset.v); });

/* ------------------------------------------------------------------ */
/* Caption list editor                                                 */
/* ------------------------------------------------------------------ */
function renderCues() {
  const list = $('#cueList');
  if (!state.cues.length) {
    list.innerHTML = '<div class="cue-empty">No captions yet.</div>';
  } else {
    const tf = transform();
    list.innerHTML = state.cues.map((c, i) => `
      <div class="cue${i === state.sel ? ' sel' : ''}" data-i="${i}">
        <button class="cue-play" data-act="play" title="Play this caption"><i data-lucide="play"></i></button>
        <div class="cue-time"><input data-f="start" value="${fmtPrecise(c.start)}" aria-label="Start time" /><span>–</span><input data-f="end" value="${fmtPrecise(c.end)}" aria-label="End time" /></div>
        <input class="cue-text" data-f="text" value="${escapeAttr(tf ? tf(c.text) : c.text)}" aria-label="Caption text" />
      </div>`).join('');
    icons();
  }
  renderTimeline();
  const note = [];
  note.push(state.translated ? 'Translated lines: word timing is spread over each original line.'
    : state.timing === 'model' ? 'Word timing from Whisper, checked against the audio.'
    : state.timing === 'aligned' ? 'Word timing aligned to the speech in your audio — about 4 in 5 words land within 0.2 s; edit any time that looks off.'
    : 'Word timing is estimated from each caption’s length.');
  if (state.translated) note.push(`Translated with NLLB-200 (in-browser). IndicTrans2 is planned once a browser build is verified.`);
  if (state.script === 'roman' && (state.modelUsed !== 'hinglish-q4' || state.translated)) note.push('Roman script uses automatic transliteration — edit any word that looks off.');
  $('#timingNote').textContent = note.join(' ');
}
const escapeAttr = (s) => String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');

$('#cueList').addEventListener('click', (e) => {
  const row = e.target.closest('.cue');
  if (!row) return;
  const i = Number(row.dataset.i);
  if (state.sel !== i) selectCue(i);
  if (e.target.closest('[data-act="play"]')) {
    const c = state.cues[i];
    seekTo(c.start + 0.001).then(() => { playUntil = c.end; video.play(); });
  }
});
$('#cueList').addEventListener('focusin', (e) => {
  const row = e.target.closest('.cue');
  if (!row) return;
  const i = Number(row.dataset.i);
  selectCue(i);
  textEditPushed = false;
  if (video.paused && e.target.dataset.f === 'text') video.currentTime = state.cues[i].start + 0.05;
});
$('#cueList').addEventListener('input', (e) => {
  const row = e.target.closest('.cue');
  if (!row || e.target.dataset.f !== 'text') return;
  const i = Number(row.dataset.i);
  if (!textEditPushed) { pushHistory(); textEditPushed = true; }
  const c = state.cues[i];
  setCueText(c, e.target.value);
  dirty();
  const block = $(`.tl-cue[data-i="${i}"] .tx`);
  if (block) block.textContent = e.target.value;
});
$('#cueList').addEventListener('change', (e) => {
  const row = e.target.closest('.cue');
  const f = e.target.dataset.f;
  if (!row || (f !== 'start' && f !== 'end')) return;
  const c = state.cues[Number(row.dataset.i)];
  const v = parseTime(e.target.value);
  if (v === null) { e.target.value = fmtPrecise(c[f]); return; }
  pushHistory();
  const oldS = c.start, oldE = c.end;
  c[f] = Math.min(Math.max(0, v), state.duration || v);
  if (c.end <= c.start) c.end = c.start + 0.3;
  rescaleWords(c, oldS, oldE);
  state.cues.sort((a, b) => a.start - b.start);
  syncOriginal();
  dirty(); renderCues();
});

function setCueText(c, text) {
  const parts = text.trim().split(/\s+/).filter(Boolean);
  if (c.words && c.words.length === parts.length && !c.words[0]?.estimated) {
    c.words = c.words.map((w, k) => ({ ...w, text: parts[k] }));
  } else {
    c.words = estimateWords(text, c.start, c.end);
  }
  c.text = text;
  syncOriginal();
}
function rescaleWords(c, oldS, oldE) {
  const span = oldE - oldS || 1;
  c.words = (c.words || []).map((w) => ({
    ...w,
    start: c.start + ((w.start - oldS) / span) * (c.end - c.start),
    end: c.start + ((w.end - oldS) / span) * (c.end - c.start),
  }));
  if (!c.words.length) c.words = estimateWords(c.text, c.start, c.end);
}
// Manual edits to an untranslated track become the new source for translation.
function syncOriginal() { if (!state.translated) state.original = structuredClone(state.cues); }

/** Free time ranges between captions (≥ minLen seconds), nearest to t first. */
function freeGaps(t, minLen = 0.5) {
  const dur = state.duration || Math.max(10, ...state.cues.map((c) => c.end));
  const sorted = [...state.cues].sort((a, b) => a.start - b.start);
  const gaps = [];
  let cur = 0;
  for (const c of sorted) { if (c.start - cur >= minLen) gaps.push([cur, c.start]); cur = Math.max(cur, c.end); }
  if (dur - cur >= minLen) gaps.push([cur, dur]);
  const dist = ([a, b]) => (t < a ? a - t : t > b ? t - b : 0);
  return gaps.sort((g1, g2) => dist(g1) - dist(g2));
}
function addCue() {
  // Add at the playhead if there is room, otherwise in the nearest free gap — never on top of a caption.
  const t = video.currentTime || 0;
  const gap = freeGaps(t, 0.8)[0]; // shorter than 0.8 s is too brief to read
  if (!gap) { toast('No free space on the timeline — trim or delete a caption first.'); return; }
  pushHistory();
  const start = Math.min(Math.max(t, gap[0] + (gap[0] > 0 ? 0.05 : 0)), gap[1] - 0.5);
  const end = Math.min(start + 2, gap[1] - (gap[1] < (state.duration || Infinity) ? 0.05 : 0));
  const text = LANG[state.tgtLang !== 'none' ? state.tgtLang : state.srcLang === 'auto' ? 'hi' : state.srcLang]?.sample || 'New caption';
  const cue = { id: crypto.randomUUID(), start, end, text, words: estimateWords(text, start, end) };
  state.cues.push(cue);
  state.cues.sort((a, b) => a.start - b.start);
  state.sel = state.cues.indexOf(cue);
  syncOriginal(); dirty(); renderCues();
  setTimeout(() => { const el = $(`.cue[data-i="${state.sel}"] .cue-text`); if (el) { el.focus({ preventScroll: true }); el.select(); listTouchedAt = 0; followCue(state.sel); } }, 0);
}
$('#addCue').addEventListener('click', () => { addCue(); showView('transcript'); });
$('#addCue2').addEventListener('click', addCue);
$('#deleteCue').addEventListener('click', deleteCue);
function deleteCue() {
  if (!state.cues.length) return;
  pushHistory();
  state.cues.splice(state.sel, 1);
  state.sel = Math.max(0, Math.min(state.sel, state.cues.length - 1));
  syncOriginal(); dirty(); renderCues();
}
$('#splitCue').addEventListener('click', () => {
  // Split the caption under the playhead (or the selected one) at the playhead's word.
  const t = video.currentTime;
  let idx = state.cues.findIndex((c) => t > c.start + 0.05 && t < c.end - 0.05);
  if (idx < 0) idx = state.sel;
  const c = state.cues[idx];
  if (!c) return;
  const words = c.words?.length ? c.words : estimateWords(c.text, c.start, c.end);
  if (words.length < 2) { toast('A caption needs at least two words to split.'); return; }
  let k = words.findIndex((w) => w.start >= t);
  if (!(t > c.start && t < c.end) || k <= 0) k = Math.ceil(words.length / 2);
  pushHistory();
  state.sel = idx;
  const a = words.slice(0, k), b = words.slice(k);
  const mid = b[0].start;
  const c1 = { ...c, end: mid, words: a, text: a.map((w) => w.text).join(' ') };
  const c2 = { ...c, id: crypto.randomUUID(), start: mid, words: b, text: b.map((w) => w.text).join(' ') };
  state.cues.splice(state.sel, 1, c1, c2);
  syncOriginal(); dirty(); renderCues();
});
$('#mergeCue').addEventListener('click', () => {
  const a = state.cues[state.sel], b = state.cues[state.sel + 1];
  if (!a || !b) { toast('Select a caption that has another one after it.'); return; }
  pushHistory();
  const m = { ...a, end: b.end, text: `${a.text} ${b.text}`, words: [...(a.words || []), ...(b.words || [])] };
  state.cues.splice(state.sel, 2, m);
  syncOriginal(); dirty(); renderCues();
});

/* ------------------------------------------------------------------ */
/* Preview player                                                      */
/* ------------------------------------------------------------------ */
const pc = $('#previewCanvas');
const px = pc.getContext('2d');
let playUntil = null;
function sizePreview() {
  const maxSide = 1280;
  const s = Math.min(1, maxSide / Math.max(state.vw, state.vh));
  pc.width = Math.round(state.vw * s);
  pc.height = Math.round(state.vh * s);
}
sizePreview();

function drawFrame(ctx, W, H, t) {
  ctx.clearRect(0, 0, W, H);
  if (video.readyState >= 2) ctx.drawImage(video, 0, 0, W, H);
  else { ctx.fillStyle = '#111'; ctx.fillRect(0, 0, W, H); }
  renderCaptions(ctx, W, H, pages(), t, design(), state.motion, { transform: transform() });
}

function setPlayIcon() {
  const ic = `<i data-lucide="${video.paused ? 'play' : 'pause'}"></i>`;
  $('#playBtn').innerHTML = ic;
  $('#tlPlay').innerHTML = ic;
  icons();
}
$('#tlPlay').addEventListener('click', () => { playUntil = null; video.paused ? video.play() : video.pause(); });
video.addEventListener('play', setPlayIcon);
video.addEventListener('pause', setPlayIcon);
$('#playBtn').addEventListener('click', () => { playUntil = null; video.paused ? video.play() : video.pause(); });
pc.addEventListener('click', () => { playUntil = null; video.paused ? video.play() : video.pause(); });
$('#seek').addEventListener('input', (e) => { video.currentTime = (Number(e.target.value) / 1000) * (state.duration || 0); });
$('#muteBtn').addEventListener('click', () => {
  video.muted = !video.muted;
  $('#muteBtn').innerHTML = `<i data-lucide="${video.muted ? 'volume-x' : 'volume-2'}"></i>`;
  icons();
});
/* Fullscreen: the whole player (video + controls) goes fullscreen.
 * - Standard Fullscreen API (Chrome, Edge, Firefox, Safari 16.4+), with webkit-prefixed fallbacks for older Safari.
 * - The preview is a <canvas> (that's where captions are drawn), so iPhone Safari's
 *   video.webkitEnterFullscreen() would show the bare video WITHOUT captions. Where element
 *   fullscreen isn't available (iPhone) or is blocked (e.g. an iframe without allow="fullscreen"),
 *   we fall back to an in-page fullscreen that fills the window and still shows captions. */
const playerEl = $('.player');
const fsElement = () => document.fullscreenElement || document.webkitFullscreenElement || null;
const isFullscreen = () => fsElement() === playerEl || playerEl.classList.contains('pseudo-fs');
async function enterFullscreen() {
  const req = playerEl.requestFullscreen || playerEl.webkitRequestFullscreen;
  const enabled = document.fullscreenEnabled ?? document.webkitFullscreenEnabled ?? !!req;
  if (req && enabled) {
    try {
      // Some embedded browsers never settle this promise, so don't wait on it forever.
      await Promise.race([
        Promise.resolve(req.call(playerEl, { navigationUI: 'hide' })),
        new Promise((r) => setTimeout(r, 600)),
      ]);
    } catch (e) {
      console.warn('Fullscreen request refused, using in-page fullscreen', e);
    }
    // Some hosts (embedded browsers, old Safari) accept the request but never go fullscreen.
    // Verify, and fall back instead of silently doing nothing.
    await new Promise((r) => setTimeout(r, 350));
    if (fsElement() === playerEl) return; // fullscreenchange already updated the UI
  }
  playerEl.classList.add('pseudo-fs');
  document.body.classList.add('fs-lock');
  onFullscreenChange();
}
function exitFullscreen() {
  if (fsElement()) {
    const exit = document.exitFullscreen || document.webkitExitFullscreen;
    exit?.call(document);
  } else {
    playerEl.classList.remove('pseudo-fs');
    document.body.classList.remove('fs-lock');
    onFullscreenChange();
  }
}
function onFullscreenChange() {
  const on = isFullscreen();
  playerEl.classList.toggle('is-fs', on);
  const btn = $('#fsBtn');
  btn.title = on ? 'Exit fullscreen (Esc)' : 'Fullscreen';
  btn.setAttribute('aria-label', btn.title);
  btn.setAttribute('aria-pressed', String(on));
  btn.innerHTML = `<i data-lucide="${on ? 'minimize' : 'maximize'}"></i>`;
  icons();
}
document.addEventListener('fullscreenchange', onFullscreenChange);
document.addEventListener('webkitfullscreenchange', onFullscreenChange);
document.addEventListener('webkitfullscreenerror', () => { if (!fsElement()) { playerEl.classList.add('pseudo-fs'); document.body.classList.add('fs-lock'); onFullscreenChange(); } });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && playerEl.classList.contains('pseudo-fs')) exitFullscreen(); });
$('#fsBtn').addEventListener('click', () => (isFullscreen() ? exitFullscreen() : enterFullscreen()));
document.addEventListener('keydown', (e) => {
  if (document.body.dataset.view !== 'editor') return;
  const typing = e.target.closest('input[type=text], input:not([type]), select, textarea');
  const mod = e.ctrlKey || e.metaKey;
  if (mod && !typing && e.key.toLowerCase() === 'z') { e.preventDefault(); e.shiftKey ? redo() : undo(); return; }
  if (mod && !typing && e.key.toLowerCase() === 'y') { e.preventDefault(); redo(); return; }
  if (typing || e.target.closest('button, input')) return;
  if (e.code === 'Space') { e.preventDefault(); video.paused ? video.play() : video.pause(); }
  if ((e.key === 'Delete' || e.key === 'Backspace') && $('.tl-cue.sel')) { e.preventDefault(); deleteCue(); }
});

let lastPlaying = -1;
// Keep the playing caption visible by scrolling ONLY the caption list — never the page
// (scrollIntoView scrolled the whole page while the video played).
let listTouchedAt = 0;
['wheel', 'touchmove', 'pointerdown'].forEach((ev) => $('#cueList').addEventListener(ev, () => (listTouchedAt = performance.now()), { passive: true }));
function followCue(idx) {
  const list = $('#cueList');
  const row = list.querySelector(`.cue[data-i="${idx}"]`);
  if (!row || list.scrollHeight <= list.clientHeight) return;
  if (performance.now() - listTouchedAt < 4000) return; // the user is browsing the list
  const a = document.activeElement;
  if (a && list.contains(a) && a.tagName === 'INPUT') return; // the user is typing
  const top = row.offsetTop, bottom = top + row.offsetHeight;
  if (top < list.scrollTop + 4 || bottom > list.scrollTop + list.clientHeight - 4) {
    list.scrollTo({ top: Math.max(0, top - 8), behavior: 'smooth' });
  }
}
function tickPreview() {
  const t = video.currentTime;
  if (playUntil !== null && t >= playUntil) { video.pause(); playUntil = null; }
  drawFrame(px, pc.width, pc.height, t);
  if (state.safe) drawSafeZones(px, pc.width, pc.height);
  $('#timeLabel').textContent = `${fmt(t)} / ${fmt(state.duration)}`;
  $('#tlTime').textContent = `${clock(t)} / ${clock(state.duration)}`;
  updatePlayhead(t);
  if (document.activeElement !== $('#seek')) $('#seek').value = state.duration ? Math.round((t / state.duration) * 1000) : 0;
  const idx = state.cues.findIndex((c) => t >= c.start && t < c.end);
  if (idx !== lastPlaying) {
    lastPlaying = idx;
    $$('.cue, .tl-cue').forEach((r) => r.classList.toggle('playing', Number(r.dataset.i) === idx));
    if (idx >= 0 && !video.paused) followCue(idx);
  }
}

/* ------------------------------------------------------------------ */
/* Undo / redo                                                         */
/* ------------------------------------------------------------------ */
const hist = { past: [], future: [] };
let textEditPushed = false;
const snap = () => ({ cues: structuredClone(state.cues), original: structuredClone(state.original), sel: state.sel });
function pushHistory() {
  hist.past.push(snap());
  if (hist.past.length > 100) hist.past.shift();
  hist.future = [];
  updateUndoButtons();
}
function clearHistory() { hist.past = []; hist.future = []; updateUndoButtons(); }
function restoreSnap(x) { state.cues = x.cues; state.original = x.original; state.sel = x.sel; dirty(); renderCues(); }
function undo() { if (!hist.past.length) return; hist.future.push(snap()); restoreSnap(hist.past.pop()); updateUndoButtons(); }
function redo() { if (!hist.future.length) return; hist.past.push(snap()); restoreSnap(hist.future.pop()); updateUndoButtons(); }
function updateUndoButtons() { $('#undoBtn').disabled = !hist.past.length; $('#redoBtn').disabled = !hist.future.length; }
$('#undoBtn').addEventListener('click', undo);
$('#redoBtn').addEventListener('click', redo);

function selectCue(i) {
  state.sel = i;
  $$('.cue, .tl-cue').forEach((r) => r.classList.toggle('sel', Number(r.dataset.i) === i));
}

/* ------------------------------------------------------------------ */
/* Timeline: ruler, filmstrip, draggable caption blocks, playhead      */
/* ------------------------------------------------------------------ */
const tl = { pps: 40, film: [], token: 0, drag: null, scrub: false };
const tlScroll = $('#tlScroll'), tlInner = $('#tlInner'), tlTrack = $('#tlTrack'), tlRuler = $('#tlRuler'), tlFilm = $('#tlFilm'), tlHead = $('#tlPlayhead');
const FILM_H = 56;
const clock = (t) => { t = Math.max(0, t || 0); return `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(Math.floor(t % 60)).padStart(2, '0')}`; };
function fitPps() { return Math.max(6, (tlScroll.clientWidth - 38) / Math.max(1, state.duration || 10)); }
function zoomPps() {
  const z = Number($('#tlZoom').value) / 100, min = fitPps(), max = Math.max(min * 1.5, 320);
  return min * Math.pow(max / min, z);
}
function renderTimeline() {
  if (!tlScroll.clientWidth) return; // hidden (e.g. mobile tab)
  const dur = state.duration || 10;
  tl.pps = zoomPps();
  const W = Math.ceil(dur * tl.pps) + 2;
  tlInner.style.width = `${W}px`;
  const step = [0.5, 1, 2, 5, 10, 15, 30].find((x) => x * tl.pps >= 64) || 30;
  let ruler = '';
  for (let t = 0; t <= dur + 1e-6; t += step / 4) {
    const major = Math.abs(t / step - Math.round(t / step)) < 1e-6;
    ruler += major ? `<span class="maj" style="left:${t * tl.pps}px">${clock(t)}${step < 1 ? '.' + Math.round((t % 1) * 10) : ''}</span>` : `<i style="left:${t * tl.pps}px"></i>`;
  }
  tlRuler.innerHTML = ruler;
  const tf = transform();
  tlTrack.innerHTML = state.cues.map((c, i) => `<div class="tl-cue${i === state.sel ? ' sel' : ''}${i === lastPlaying ? ' playing' : ''}" data-i="${i}" style="left:${c.start * tl.pps}px;width:${Math.max(8, (c.end - c.start) * tl.pps)}px" title="Drag to move · drag edges to trim · double-click to edit"><span class="h l"></span><span class="tx">${escapeAttr(tf ? tf(c.text) : c.text)}</span><span class="h r"></span></div>`).join('');
  drawFilm(W);
  updatePlayhead(video.currentTime, true);
}
function drawFilm(W = tlInner.offsetWidth) {
  const dpr = window.devicePixelRatio || 1;
  tlFilm.width = Math.round(W * dpr); tlFilm.height = Math.round(FILM_H * dpr);
  tlFilm.style.width = `${W}px`;
  const ctx = tlFilm.getContext('2d');
  ctx.fillStyle = '#1c1c1c'; ctx.fillRect(0, 0, tlFilm.width, tlFilm.height);
  if (!tl.film.length || !state.duration) return;
  const tileW = Math.max(24, FILM_H * (state.vw / state.vh));
  const usable = state.duration * tl.pps;
  for (let x = 0; x < usable; x += tileW) {
    const t = Math.min(state.duration - 0.01, (x + tileW / 2) / tl.pps);
    const fr = tl.film[Math.min(tl.film.length - 1, Math.floor((t / state.duration) * tl.film.length))];
    if (fr) ctx.drawImage(fr, x * dpr, 0, Math.min(tileW, usable - x) * dpr, FILM_H * dpr);
  }
}
// Thumbnails come from a second, hidden video so the preview isn't disturbed.
async function buildFilmstrip() {
  const token = ++tl.token;
  tl.film = [];
  const fv = document.createElement('video');
  fv.muted = true; fv.preload = 'auto'; fv.src = state.url;
  const ok = await new Promise((r) => { fv.onloadeddata = () => r(true); fv.onerror = () => r(false); });
  if (!ok) return;
  const N = Math.min(60, Math.max(8, Math.ceil(state.duration)));
  const h = FILM_H * 2, w = Math.max(24, Math.round(h * (state.vw / state.vh)));
  for (let i = 0; i < N; i++) {
    if (token !== tl.token) return;
    await new Promise((r) => { fv.onseeked = r; fv.currentTime = ((i + 0.5) * state.duration) / N; });
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    c.getContext('2d').drawImage(fv, 0, 0, w, h);
    tl.film[i] = c;
    if (i % 8 === 7) drawFilm();
  }
  drawFilm();
  fv.removeAttribute('src'); fv.load();
}
function updatePlayhead(t, force) {
  const x = t * tl.pps;
  tlHead.style.transform = `translateX(${x}px)`;
  // follow the playhead inside the timeline only (never scrolls the page)
  if ((!video.paused || force) && !tl.drag && !tl.scrub) {
    const vis0 = tlScroll.scrollLeft, vis1 = vis0 + tlScroll.clientWidth;
    if (x < vis0 + 10 || x > vis1 - 40) tlScroll.scrollLeft = Math.max(0, x - 60);
  }
}
const tlX = (e) => e.clientX - tlInner.getBoundingClientRect().left;
tlInner.addEventListener('pointerdown', (e) => {
  const block = e.target.closest('.tl-cue');
  if (block) {
    const i = Number(block.dataset.i), c = state.cues[i];
    selectCue(i);
    tl.drag = {
      i, el: block, x0: e.clientX, moved: false,
      mode: e.target.classList.contains('l') ? 'l' : e.target.classList.contains('r') ? 'r' : 'move',
      o: { start: c.start, end: c.end, words: structuredClone(c.words || []) },
    };
    try { block.setPointerCapture(e.pointerId); } catch {}
    return;
  }
  tl.scrub = true;
  try { tlInner.setPointerCapture(e.pointerId); } catch {}
  playUntil = null;
  video.currentTime = Math.min(state.duration, Math.max(0, tlX(e) / tl.pps));
});
tlInner.addEventListener('pointermove', (e) => {
  if (tl.scrub) { video.currentTime = Math.min(state.duration, Math.max(0, tlX(e) / tl.pps)); return; }
  const d = tl.drag;
  if (!d) return;
  const dx = e.clientX - d.x0;
  if (!d.moved && Math.abs(dx) < 3) return;
  if (!d.moved) { pushHistory(); d.moved = true; }
  const c = state.cues[d.i], prev = state.cues[d.i - 1], next = state.cues[d.i + 1];
  const lo = prev ? prev.end : 0, hi = next ? next.start : state.duration;
  const dt = dx / tl.pps, o = d.o;
  if (d.mode === 'move') {
    const sh = Math.min(Math.max(dt, lo - o.start), hi - o.end);
    c.start = o.start + sh; c.end = o.end + sh;
  } else if (d.mode === 'l') {
    c.start = Math.min(Math.max(o.start + dt, lo), o.end - 0.2); c.end = o.end;
  } else {
    c.end = Math.max(Math.min(o.end + dt, hi), o.start + 0.2); c.start = o.start;
  }
  c.words = structuredClone(o.words);
  rescaleWords(c, o.start, o.end);
  d.el.style.left = `${c.start * tl.pps}px`;
  d.el.style.width = `${Math.max(8, (c.end - c.start) * tl.pps)}px`;
  dirty();
  if (video.paused) video.currentTime = d.mode === 'r' ? Math.max(c.start, c.end - 0.05) : c.start + 0.01;
});
const endPointer = () => {
  if (tl.scrub) { tl.scrub = false; return; }
  const d = tl.drag;
  tl.drag = null;
  if (!d) return;
  if (d.moved) { syncOriginal(); renderCues(); }
  else { playUntil = null; video.currentTime = state.cues[d.i].start + 0.01; }
};
tlInner.addEventListener('pointerup', endPointer);
tlInner.addEventListener('pointercancel', endPointer);
tlInner.addEventListener('dblclick', (e) => {
  const block = e.target.closest('.tl-cue');
  if (!block) return;
  const i = Number(block.dataset.i);
  showView('transcript');
  if (window.matchMedia('(max-width: 900px)').matches) $('#mobileTabs [data-m="captions"]').click();
  setTimeout(() => { const el = $(`.cue[data-i="${i}"] .cue-text`); if (el) { el.focus({ preventScroll: true }); listTouchedAt = 0; followCue(i); } });
});
function setZoom(v) {
  const t = video.currentTime;
  $('#tlZoom').value = Math.max(0, Math.min(100, v));
  renderTimeline();
  tlScroll.scrollLeft = Math.max(0, t * tl.pps - tlScroll.clientWidth / 2);
}
$('#tlZoom').addEventListener('input', (e) => setZoom(Number(e.target.value)));
$('#zoomIn').addEventListener('click', () => setZoom(Number($('#tlZoom').value) + 12));
$('#zoomOut').addEventListener('click', () => setZoom(Number($('#tlZoom').value) - 12));
let resizeT;
window.addEventListener('resize', () => { clearTimeout(resizeT); resizeT = setTimeout(renderTimeline, 120); });

// Reels / Shorts safe zones (preview only — never drawn into exports)
function drawSafeZones(ctx, W, H) {
  ctx.save();
  ctx.fillStyle = 'rgba(239,68,68,0.18)';
  ctx.strokeStyle = 'rgba(255,255,255,0.55)';
  ctx.setLineDash([8, 6]);
  ctx.lineWidth = Math.max(1, W / 360);
  const zones = [[0, 0, W, H * 0.11], [0, H * 0.79, W, H * 0.21], [W * 0.86, H * 0.42, W * 0.14, H * 0.37]];
  for (const [x, y, w, h] of zones) { ctx.fillRect(x, y, w, h); ctx.strokeRect(x, y, w, h); }
  ctx.setLineDash([]);
  ctx.fillStyle = 'rgba(255,255,255,0.85)';
  ctx.font = `600 ${Math.round(W / 34)}px Inter, sans-serif`;
  ctx.fillText('App UI — keep captions out', W * 0.04, H * 0.79 + W / 22);
  ctx.restore();
}

/* ------------------------------------------------------------------ */
/* Galleries: styles, animations, presets (looping live previews)      */
/* ------------------------------------------------------------------ */
const PERIOD = 3.2;
let galleryTab = 'styles';
let styleFilter = 'all';
function cardHTML(kind, id, name, sub, extra = '') {
  return `<div class="scard" data-kind="${kind}" data-id="${id}" role="button" tabindex="0"><canvas width="320" height="200"></canvas><span>${name}</span>${sub ? `<small>${sub}</small>` : ''}${extra}</div>`;
}
function renderStyleCards() {
  const saved = styleFilter === 'saved';
  $('#styleCards').hidden = saved;
  $('#savedWrap').hidden = !saved;
  if (saved) { renderPresetCards(); return; }
  $('#styleCards').innerHTML = Object.entries(DESIGNS)
    .filter(([, d]) => styleFilter === 'all' || d.tags.includes(styleFilter))
    .map(([k, d]) => cardHTML('design', k, d.name)).join('');
  markSelected();
}
function renderAnimCards() {
  $('#animCards').innerHTML = Object.entries(WORD_ANIMATIONS).filter(([k]) => k !== 'none')
    .map(([k, a]) => cardHTML('anim', k, a.name, a.desc)).join('') + cardHTML('anim', 'none', 'None', 'Static captions');
  markSelected();
}
function renderPresetCards() {
  const presets = readJSON(STORE_PRESETS, []);
  $('#presetCards').innerHTML = presets.map((p) =>
    cardHTML('preset', p.id, escapeAttr(p.name), `${DESIGNS[p.designId]?.name || ''} · ${WORD_ANIMATIONS[p.motion.anim]?.name || ''}`,
      `<button class="del" data-del="${p.id}" title="Delete preset"><i data-lucide="trash-2"></i></button>`)).join('');
  $('#presetEmpty').hidden = presets.length > 0;
  icons();
}
function renderPairCards() {
  $('#pairCards').innerHTML = FONT_PAIRS.map((p) =>
    cardHTML('pair', p.id, p.name, `${p.vibe} · ${p.font} + ${p.accentFont}`, `<em class="pair-tag${p.scripts.startsWith('English') ? ' en' : ''}">${p.scripts}</em>`)).join('');
  markSelected();
}
const PAIR_KEYS = ['font', 'weight', 'hindiFont', 'hindiWeight', 'accentFont', 'accentFallback', 'accentWeight', 'accentScale', 'accentItalic', 'accentUpper', 'accentColor'];
function pairOverrides(p) {
  return { font: p.font, weight: p.weight, hindiFont: p.hindiFont || null, hindiWeight: p.hindiWeight || null, accentFont: p.accentFont, accentFallback: p.accentFallback || null, accentWeight: p.accentWeight, accentScale: p.accentScale,
    accentItalic: !!p.accentItalic, accentUpper: !!p.accentUpper, accentColor: p.accentColor || null };
}
function currentPairId() {
  const d = design();
  return FONT_PAIRS.find((p) => p.font === d.font && p.accentFont === d.accentFont)?.id || null;
}
function markSelected() {
  const pid = currentPairId();
  $$('#pairCards .scard').forEach((c) => c.classList.toggle('on', c.dataset.id === pid));
  $$('#styleCards .scard').forEach((c) => c.classList.toggle('on', c.dataset.id === state.designId));
  $$('#animCards .scard').forEach((c) => c.classList.toggle('on', c.dataset.id === state.motion.anim));
}
renderStyleCards(); renderAnimCards(); renderPresetCards(); renderPairCards();

// One panel, several views: the top tabs and the left menu both switch it.
function showView(v) {
  galleryTab = v;
  $$('#galleryTabs button').forEach((x) => x.classList.toggle('on', x.dataset.tab === v));
  $$('#sideNav button').forEach((x) => x.classList.toggle('on', x.dataset.view === v));
  $$('.tab-body').forEach((x) => (x.hidden = x.dataset.body !== v));
  if (v === 'transcript') { listTouchedAt = 0; if (lastPlaying >= 0) followCue(lastPlaying); }
  if (v === 'text' && !showView.pairsLoaded) { showView.pairsLoaded = true; FONT_PAIRS.forEach((p) => ensureDesignFonts({ ...p, ...pairOverrides(p) })); }
}
$('#galleryTabs').addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) showView(b.dataset.tab); });
$('#sideNav').addEventListener('click', (e) => {
  const b = e.target.closest('button');
  if (!b) return;
  showView(b.dataset.view);
  if (window.matchMedia('(max-width: 900px)').matches) {
    const m = b.dataset.view === 'transcript' ? 'captions' : 'style';
    $(`#mobileTabs [data-m="${m}"]`).click();
  }
});
$('#styleFilters').addEventListener('click', (e) => {
  const b = e.target.closest('button');
  if (!b) return;
  styleFilter = b.dataset.f;
  $$('#styleFilters button').forEach((x) => x.classList.toggle('on', x === b));
  renderStyleCards();
});
function onCardActivate(e) {
  if (e.type === 'keydown' && e.key !== 'Enter' && e.key !== ' ') return;
  const del = e.target.closest('[data-del]');
  if (del) {
    writeJSON(STORE_PRESETS, readJSON(STORE_PRESETS, []).filter((p) => p.id !== del.dataset.del));
    renderPresetCards();
    return;
  }
  const card = e.target.closest('.scard');
  if (!card) return;
  e.preventDefault();
  if (card.dataset.kind === 'design') selectDesign(card.dataset.id);
  else if (card.dataset.kind === 'anim') setMotion({ anim: card.dataset.id });
  else if (card.dataset.kind === 'pair') {
    const p = FONT_PAIRS.find((x) => x.id === card.dataset.id);
    if (p) { override({ ...pairOverrides(p), accentMode: design().accentMode === 'off' ? 'key' : design().accentMode }); markSelected(); }
  }
  else if (card.dataset.kind === 'preset') {
    const p = readJSON(STORE_PRESETS, []).find((x) => x.id === card.dataset.id);
    if (p) { selectDesign(p.designId, p.overrides); setMotion(p.motion); toast(`Applied “${p.name}”.`); }
  }
}
for (const id of ['#styleCards', '#animCards', '#presetCards', '#pairCards']) {
  $(id).addEventListener('click', onCardActivate);
  $(id).addEventListener('keydown', onCardActivate);
}
$('#savePreset').addEventListener('click', () => {
  const name = prompt('Name this preset', `${DESIGNS[state.designId].name} + ${WORD_ANIMATIONS[state.motion.anim].name}`);
  if (!name) return;
  const presets = readJSON(STORE_PRESETS, []);
  presets.unshift({ id: crypto.randomUUID(), name: name.slice(0, 40), designId: state.designId, overrides: { ...state.overrides }, motion: { ...state.motion } });
  if (!writeJSON(STORE_PRESETS, presets)) { toast("Couldn't save — browser storage is unavailable."); return; }
  renderPresetCards();
  toast('Preset saved.');
});

function demoText() {
  const c = state.cues.find((x) => x.text.trim());
  let text = c ? c.text : (LANG[state.tgtLang]?.sample || LANG[state.srcLang]?.sample || LANG.hi.sample);
  if (!c && state.tgtLang === 'none' && state.srcLang === 'auto') text = LANG.hi.sample;
  const words = text.split(/\s+/).slice(0, 5).join(' ');
  return state.script === 'roman' ? romanize(words) : words;
}
let demoCache = { text: '', pages: null };
function getDemoPages() {
  const text = demoText();
  if (demoCache.text !== text) demoCache = { text, pages: demoPages(text, PERIOD) };
  return demoCache.pages;
}
function drawBackdrop(ctx, W, H) {
  if (state.thumb) {
    const s = Math.max(W / state.thumb.width, H / state.thumb.height);
    ctx.drawImage(state.thumb, (W - state.thumb.width * s) / 2, (H - state.thumb.height * s) / 2, state.thumb.width * s, state.thumb.height * s);
    ctx.fillStyle = 'rgba(0,0,0,0.25)';
    ctx.fillRect(0, 0, W, H);
  } else {
    const g = ctx.createLinearGradient(0, 0, W, H);
    g.addColorStop(0, '#4a3f35'); g.addColorStop(1, '#1d1a18');
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  }
}
function tickGallery(now) {
  const t = (now / 1000) % PERIOD;
  const container = galleryTab === 'styles' ? (styleFilter === 'saved' ? '#presetCards' : '#styleCards') : galleryTab === 'motion' ? '#animCards' : galleryTab === 'text' ? '#pairCards' : null;
  if (!container) return;
  const pg = getDemoPages();
  const presets = container === '#presetCards' ? readPresetsCached() : null;
  for (const card of $$(`${container} .scard`)) {
    const cv = card.firstElementChild, ctx = cv.getContext('2d');
    let d, m;
    if (card.dataset.kind === 'design') { d = { ...DESIGNS[card.dataset.id], y: 0.55 }; m = { ...state.motion }; }
    else if (card.dataset.kind === 'pair') {
      const p = FONT_PAIRS.find((x) => x.id === card.dataset.id);
      d = { ...design(), ...pairOverrides(p), accentMode: design().accentMode === 'off' ? 'key' : design().accentMode, y: 0.55 };
      m = { ...state.motion };
    }
    else if (card.dataset.kind === 'anim') { d = { ...design(), y: 0.55 }; m = { ...state.motion, anim: card.dataset.id }; }
    else {
      const p = presets.find((x) => x.id === card.dataset.id);
      if (!p) continue;
      d = { ...DESIGNS[p.designId], ...p.overrides, y: 0.55 }; m = p.motion;
    }
    drawBackdrop(ctx, cv.width, cv.height);
    renderCaptions(ctx, cv.width, cv.height, pg, t, d, { ...m, maxWords: 0 }, { ref: 300, fit: 0.72 });
  }
}
let presetCache = { at: 0, list: [] };
function readPresetsCached() {
  if (performance.now() - presetCache.at > 1000) presetCache = { at: performance.now(), list: readJSON(STORE_PRESETS, []) };
  return presetCache.list;
}

/* ------------------------------------------------------------------ */
/* Customize panel                                                     */
/* ------------------------------------------------------------------ */
const TEXT_COLORS = ['#FFFFFF', '#111111', '#FFE14D', '#F472B6', '#A855F7', '#3B82F6', '#22C55E'];
const BG_COLORS = ['#FFD60A', '#111111', '#FFFFFF', '#F9A8D4', '#C4B5FD', 'gradient:#8B5CF6,#EC4899'];
function swatchHTML(colors, allowNone) {
  return (allowNone ? '<button class="sw none" data-c="" title="None"></button>' : '') +
    colors.map((c) => `<button class="sw" data-c="${c}" style="background:${c.startsWith('gradient:') ? `linear-gradient(135deg,${c.slice(9)})` : c}" title="${c.startsWith('gradient:') ? 'Gradient' : c}"></button>`).join('') +
    '<label class="sw custom" title="Custom colour"><input type="color" /></label>';
}
$('#colorSw').innerHTML = swatchHTML(TEXT_COLORS, false);
$('#activeColorSw').innerHTML = swatchHTML(TEXT_COLORS, true);
$('#activeBgSw').innerHTML = swatchHTML(BG_COLORS, true);
$('#outlineColorSw').innerHTML = swatchHTML(['#000000', '#111111', '#FFFFFF', '#14532D', '#1E3A8A', '#7C2D12', '#581C87'], false);
$('#shadowColorSw').innerHTML = swatchHTML(['rgba(0,0,0,0.65)', '#000000', '#22D3EE', '#F472B6', '#FFE14D', '#A855F7', '#22C55E'], false);
$('#accentColorSw').innerHTML = swatchHTML(['#FFE14D', '#F5C451', '#FF9933', '#F9A8D4', '#22D3EE', '#22C55E', '#FFFFFF'], true);
$('#boxColorSw').innerHTML = swatchHTML(['#000000', '#FFFFFF', '#16A34A', '#FFD60A', '#A855F7', '#F472B6', '#1E3A8A'], false);
function bindSwatches(sel, key) {
  const el = $(sel);
  el.addEventListener('click', (e) => {
    const b = e.target.closest('button.sw');
    if (b) override({ [key]: b.dataset.c || null });
  });
  el.addEventListener('input', (e) => { if (e.target.type === 'color') override({ [key]: e.target.value }); });
}
bindSwatches('#colorSw', 'color');
bindSwatches('#activeColorSw', 'activeColor');
bindSwatches('#activeBgSw', 'activeBg');
bindSwatches('#outlineColorSw', 'outlineColor');
bindSwatches('#shadowColorSw', 'shadowColor');
bindSwatches('#boxColorSw', 'boxColor');
bindSwatches('#accentColorSw', 'accentColor');

function override(o) { Object.assign(state.overrides, o); ensureDesignFonts(design()); syncControls(); }
function selectDesign(id, overrides = null) {
  if (!DESIGNS[id]) return;
  // Styles own colours & shapes; a chosen font pairing carries over to the new style.
  const keep = {};
  if (!overrides && state.overrides.accentFont) {
    for (const k of [...PAIR_KEYS, 'accentMode']) if (k in state.overrides) keep[k] = state.overrides[k];
  }
  state.designId = id;
  state.overrides = { ...keep, ...(overrides || {}) };
  ensureDesignFonts(design()); // drafts & presets may use library fonts
  $('#homeStyle').value = id;
  syncControls();
  markSelected();
}
function setMotion(m) {
  Object.assign(state.motion, m);
  if ('maxWords' in m) dirty();
  syncControls();
  markSelected();
}

function syncControls() {
  const d = design(), m = state.motion;
  setFontBtn('#fontBtnName', d.font, d.weight);
  renderWeights(d);
  $('#letterSpacing').value = d.letterSpacing || 0; $('#lsOut').textContent = `${Number(d.letterSpacing || 0).toFixed(2)} em`;
  setFontBtn('#hindiFontName', d.hindiFont, 600, 'Auto (from base font)');
  $('#size').value = d.size; $('#sizeOut').textContent = `${d.size} px`;
  const markSw = (sel, val) => $$(`${sel} .sw`).forEach((s) => s.classList.toggle('on', s.dataset.c !== undefined && (s.dataset.c || null) === (val || null) && !(s.classList.contains('custom'))));
  markSw('#colorSw', d.color); markSw('#activeColorSw', d.activeColor); markSw('#activeBgSw', d.activeBg);
  markSw('#outlineColorSw', d.outlineColor); markSw('#shadowColorSw', d.shadowColor); markSw('#boxColorSw', d.boxColor);
  markSw('#accentColorSw', d.accentColor);
  setFontBtn('#accentFontName', d.accentFont, d.accentWeight ?? 400, 'None — single font', d.accentItalic);
  $('#accentScale').value = d.accentScale; $('#accentScaleOut').textContent = `${Number(d.accentScale).toFixed(2)}×`;
  $('#accentItalic').checked = !!d.accentItalic;
  $('#accentUpper').checked = !!d.accentUpper;
  $$('#accentModeSeg button').forEach((b) => b.classList.toggle('on', b.dataset.v === (d.accentFont ? d.accentMode : 'off')));
  ['#accentScale', '#accentItalic', '#accentUpper'].forEach((id) => ($(id).disabled = !d.accentFont));
  if (typeof markSelected === 'function' && $('#pairCards').children.length) $$('#pairCards .scard').forEach((c) => c.classList.toggle('on', c.dataset.id === currentPairId()));
  $('#boxOpacity').value = d.boxOpacity; $('#boxOpOut').textContent = `${Math.round(d.boxOpacity * 100)}%`;
  $('#lineHeight').value = d.lineHeight; $('#lhOut').textContent = Number(d.lineHeight).toFixed(2);
  $$('#posPresets button').forEach((b) => b.classList.toggle('on', Math.abs(Number(b.dataset.y) - d.y) < 0.02));
  $('#outlineOn').checked = d.outline > 0;
  $('#outline').value = d.outline > 0 ? d.outline : ($('#outline').value || 6);
  $('#outlineOut').textContent = `${$('#outline').value} px`;
  $('#outline').disabled = !(d.outline > 0);
  $('#shadowOn').checked = d.shadow > 0;
  $('#shadow').value = d.shadow > 0 ? d.shadow : ($('#shadow').value || 18);
  $('#shadowOut').textContent = `${$('#shadow').value} px`;
  $('#shadow').disabled = !(d.shadow > 0);
  $('#boxOn').checked = !!d.box;
  $('#upperOn').checked = !!d.uppercase;
  $('#posY').value = Math.round(d.y * 100); $('#posOut').textContent = `${Math.round(d.y * 100)}%`;
  $$('#modeSeg button').forEach((b) => b.classList.toggle('on', b.dataset.v === m.mode));
  $('#entrance').value = m.entrance;
  $('#easing').value = m.easing;
  $('#speed').value = m.speed; $('#speedOut').textContent = `${Number(m.speed).toFixed(1)}×`;
  $('#delay').value = m.delay; $('#delayOut').textContent = `${Number(m.delay).toFixed(2)} s`;
  $('#maxWords').value = m.maxWords; $('#maxWordsOut').textContent = m.maxWords ? m.maxWords : 'Full line';
}
$('#size').addEventListener('input', (e) => override({ size: Number(e.target.value) }));
$('#weightSeg').addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) override({ weight: Number(b.dataset.v) }); });
$('#letterSpacing').addEventListener('input', (e) => override({ letterSpacing: Number(e.target.value) }));
$('#accentClear').addEventListener('click', () => override({ accentFont: null, accentFallback: null, accentMode: 'off' }));
$('#hindiClear').addEventListener('click', () => override({ hindiFont: null, hindiWeight: null }));
$('#outlineOn').addEventListener('change', (e) => override({ outline: e.target.checked ? Number($('#outline').value) || 6 : 0 }));
$('#outline').addEventListener('input', (e) => override({ outline: Number(e.target.value) }));
$('#shadowOn').addEventListener('change', (e) => override({ shadow: e.target.checked ? Number($('#shadow').value) || 18 : 0 }));
$('#shadow').addEventListener('input', (e) => override({ shadow: Number(e.target.value) }));
$('#boxOn').addEventListener('change', (e) => override({ box: e.target.checked }));
$('#upperOn').addEventListener('change', (e) => override({ uppercase: e.target.checked }));
$('#posY').addEventListener('input', (e) => override({ y: Number(e.target.value) / 100 }));
$('#posPresets').addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) override({ y: Number(b.dataset.y) }); });
$('#boxOpacity').addEventListener('input', (e) => override({ boxOpacity: Number(e.target.value) }));
$('#lineHeight').addEventListener('input', (e) => override({ lineHeight: Number(e.target.value) }));
$('#safeOn').addEventListener('change', (e) => { state.safe = e.target.checked; });
$('#accentScale').addEventListener('input', (e) => override({ accentScale: Number(e.target.value) }));
$('#accentItalic').addEventListener('change', (e) => override({ accentItalic: e.target.checked }));
$('#accentUpper').addEventListener('change', (e) => override({ accentUpper: e.target.checked }));
$('#accentModeSeg').addEventListener('click', (e) => {
  const b = e.target.closest('button');
  if (!b) return;
  if (b.dataset.v !== 'off' && !design().accentFont) override(pairOverrides(FONT_PAIRS[0])); // pick a sensible pair first
  override({ accentMode: b.dataset.v });
});
$('#modeSeg').addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) setMotion({ mode: b.dataset.v }); });
$('#entrance').addEventListener('change', (e) => setMotion({ entrance: e.target.value }));
$('#easing').addEventListener('change', (e) => setMotion({ easing: e.target.value }));
$('#speed').addEventListener('input', (e) => setMotion({ speed: Number(e.target.value) }));
$('#delay').addEventListener('input', (e) => setMotion({ delay: Number(e.target.value) }));
$('#maxWords').addEventListener('input', (e) => setMotion({ maxWords: Number(e.target.value) }));
syncControls();

/* ------------------------------------------------------------------ */
/* Font Library                                                        */
/* ------------------------------------------------------------------ */
function setFontBtn(sel, family, weight = 600, empty = '', italic = false) {
  const el = $(sel);
  el.textContent = family || empty;
  el.style.fontFamily = family ? `"${family}", "Baloo 2", sans-serif` : '';
  el.style.fontWeight = family ? weight : '';
  el.style.fontStyle = italic ? 'italic' : '';
  if (family) ensureFamily(family);
}
function renderWeights(d) {
  const ws = usableWeights(d.font);
  const key = d.font + ws.join(',');
  const box = $('#weightSeg');
  if (box.dataset.key !== key) {
    box.dataset.key = key;
    box.style.gridTemplateColumns = `repeat(${Math.min(ws.length, 4)}, 1fr)`;
    box.innerHTML = ws.map((w) => `<button data-v="${w}" type="button" title="${w}" style="font-family:'${d.font}', 'Baloo 2', sans-serif;font-weight:${w}">Aa<small>${w}</small></button>`).join('');
  }
  const cur = nearestWeight(d.font, d.weight);
  $$('#weightSeg button').forEach((b) => b.classList.toggle('on', Number(b.dataset.v) === cur));
}

const fl = { target: 'font', cat: 'all', q: '', hover: null, observer: null };
const catOf = (f) => {
  const c = new Set(f.cats);
  if (f.scripts.includes('hi')) c.add('hindi');
  if (f.scripts.some((s) => s !== 'hi')) c.add('indic');
  return c;
};
function openFontLibrary(target) {
  fl.target = target; fl.q = ''; $('#flSearch').value = '';
  fl.cat = target === 'hindiFont' ? 'hindi' : 'all';
  const sample = state.cues.find((c) => /[A-Za-z]/.test(c.text))?.text;
  if (sample && !$('#flPrevText').dataset.touched) $('#flPrevText').value = stripMarks(sample).split(/\s+/).slice(0, 6).join(' ');
  renderFontLibrary();
  $('#fontDialog').showModal();
  setTimeout(() => $('#flSearch').focus(), 50);
}
function renderFontLibrary() {
  $$('#flTarget button').forEach((b) => b.classList.toggle('on', b.dataset.t === fl.target));
  const cats = fl.target === 'hindiFont' ? ['hindi'] : Object.keys(CATEGORY_LABELS);
  $('#flCats').innerHTML = cats.map((c) => `<button data-c="${c}" class="${c === fl.cat ? 'on' : ''}" type="button">${CATEGORY_LABELS[c]}</button>`).join('');
  const q = fl.q.trim().toLowerCase();
  const list = FONT_CATALOG.filter((f) => {
    const c = catOf(f);
    if (fl.target === 'hindiFont' && !f.scripts.includes('hi')) return false;
    if (fl.cat !== 'all' && !c.has(fl.cat)) return false;
    return !q || f.family.toLowerCase().includes(q) || [...c].some((x) => CATEGORY_LABELS[x]?.toLowerCase().includes(q));
  });
  const current = design()[fl.target];
  $('#flGrid').innerHTML = list.map((f) => {
    const hi = f.scripts.includes('hi');
    const cat = CATEGORY_LABELS[f.cats[0]] || '';
    const w = nearestWeight(f.family, 700);
    return `<button class="fl-card${f.family === current ? ' on' : ''}" data-f="${f.family}" type="button">
      <span class="fl-aa" style="font-family:'${f.family}', sans-serif;font-weight:${w}">Aa 123</span>
      ${hi ? `<span class="fl-hi" style="font-family:'${f.family}', sans-serif;font-weight:${w}">हिन्दी</span>` : ''}
      <span class="fl-name">${f.family}</span>
      <span class="fl-cat">${cat}${hi ? ' · हिन्दी' : ''} · ${usableWeights(f.family).length} weight${usableWeights(f.family).length > 1 ? 's' : ''}</span>
    </button>`;
  }).join('') || '<p class="muted empty">No fonts match.</p>';
  $('#flCount').textContent = `${list.length} of ${FONT_CATALOG.length} Google Fonts · loads only what you use`;
  $('#flNote').textContent = fl.target === 'hindiFont'
    ? 'Hindi words use this font; English words keep your base font.'
    : fl.target === 'accentFont' ? 'Used for the key word on each screen.' : 'Used for most caption words.';
  // load each family's CSS only when its card scrolls into view
  fl.observer?.disconnect();
  fl.observer = new IntersectionObserver((entries) => {
    for (const e of entries) if (e.isIntersecting) { ensureFamily(e.target.dataset.f); fl.observer.unobserve(e.target); }
  }, { root: $('#flGrid'), rootMargin: '200px' });
  $$('#flGrid .fl-card').forEach((c) => fl.observer.observe(c));
  showFontPreview(fl.hover || current || 'Poppins');
}
function showFontPreview(family) {
  if (!family) return;
  ensureFamily(family);
  const f = FONT_INFO.get(family);
  const w = nearestWeight(family, fl.target === 'font' ? design().weight : 700);
  const fam = `"${family}", "Baloo 2", sans-serif`;
  for (const id of ['#flPrevEn', '#flPrevHi']) { $(id).style.fontFamily = fam; $(id).style.fontWeight = w; }
  $('#flPrevEn').textContent = $('#flPrevText').value || 'Make every word count.';
  $('#flPrevLabel').textContent = `LIVE PREVIEW · ${family}`;
  $('#flPrevHi').classList.toggle('fallback', !supportsHindi(family));
  $('#flPrevMeta').textContent = f
    ? (supportsHindi(family) ? 'Has Hindi (Devanagari) letters' : 'No Hindi letters — Hindi words use your Hindi font') + ` · weights ${usableWeights(family).join(', ')}`
    : '';
}
function chooseFont(family) {
  const d = design();
  if (fl.target === 'font') override({ font: family, weight: nearestWeight(family, d.weight) });
  else if (fl.target === 'accentFont') override({ accentFont: family, accentFallback: null, accentWeight: nearestWeight(family, d.accentWeight || 400), accentItalic: d.accentItalic && !!FONT_INFO.get(family)?.italic, accentMode: d.accentMode === 'off' || !d.accentFont ? 'key' : d.accentMode });
  else override({ hindiFont: family, hindiWeight: null });
  markSelected();
  $$('#flGrid .fl-card').forEach((c) => c.classList.toggle('on', c.dataset.f === family));
}
$('#fontBtn').addEventListener('click', () => openFontLibrary('font'));
$('#accentFontBtn').addEventListener('click', () => openFontLibrary('accentFont'));
$('#hindiFontBtn').addEventListener('click', () => openFontLibrary('hindiFont'));
$('#flTarget').addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) { fl.target = b.dataset.t; if (fl.target === 'hindiFont') fl.cat = 'hindi'; renderFontLibrary(); } });
$('#flCats').addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) { fl.cat = b.dataset.c; renderFontLibrary(); } });
$('#flSearch').addEventListener('input', (e) => { fl.q = e.target.value; renderFontLibrary(); });
$('#flPrevText').addEventListener('input', (e) => { e.target.dataset.touched = '1'; $('#flPrevEn').textContent = e.target.value; });
$('#flGrid').addEventListener('click', (e) => { const c = e.target.closest('.fl-card'); if (c) chooseFont(c.dataset.f); });
$('#flGrid').addEventListener('mouseover', (e) => { const c = e.target.closest('.fl-card'); if (c && c.dataset.f !== fl.hover) { fl.hover = c.dataset.f; showFontPreview(fl.hover); } });
$('#flGrid').addEventListener('mouseleave', () => { fl.hover = null; showFontPreview(design()[fl.target] || 'Poppins'); });
$('#flClose').addEventListener('click', () => $('#fontDialog').close());
$('#flDone').addEventListener('click', () => $('#fontDialog').close());
$('#fontDialog').addEventListener('click', (e) => { if (e.target.id === 'fontDialog') $('#fontDialog').close(); });

/* ------------------------------------------------------------------ */
/* Drafts                                                              */
/* ------------------------------------------------------------------ */
$('#saveDraft').addEventListener('click', () => {
  if (!state.file) return;
  const ok = writeJSON(STORE_DRAFT, {
    fileName: state.file.name, fileSize: state.file.size, savedAt: Date.now(),
    cues: state.cues, original: state.original, wordLevel: state.wordLevel, translated: state.translated,
    srcLang: state.srcLang, tgtLang: state.tgtLang, script: state.script,
    designId: state.designId, overrides: state.overrides, motion: state.motion,
  });
  toast(ok ? 'Draft saved in this browser. Re-open the same video to restore it.' : "Couldn't save — browser storage is unavailable.");
});
function restoreDraft(d) {
  Object.assign(state, { cues: d.cues, original: d.original, wordLevel: d.wordLevel, translated: d.translated, sel: 0 });
  setSource(d.srcLang); setTarget(d.tgtLang); setScript(d.script);
  selectDesign(d.designId, d.overrides);
  setMotion(d.motion);
  dirty(); renderCues(); setStep(4);
  toast('Draft restored.');
}

/* ------------------------------------------------------------------ */
/* Export                                                              */
/* ------------------------------------------------------------------ */
const dlg = $('#exportDialog');
const MIME_CANDIDATES = [
  ['video/mp4;codecs=avc1.42E01F,mp4a.40.2', 'mp4'], ['video/mp4;codecs=avc1,opus', 'mp4'], ['video/mp4', 'mp4'],
  ['video/webm;codecs=vp9,opus', 'webm'], ['video/webm;codecs=vp8,opus', 'webm'], ['video/webm', 'webm'],
];
const recFormat = () => (window.MediaRecorder ? MIME_CANDIDATES.find(([m]) => MediaRecorder.isTypeSupported(m)) : null);
$('#exportBtn').addEventListener('click', () => {
  if (!state.file) return;
  const f = recFormat();
  $('#expFormat').textContent = f ? `${f[1].toUpperCase()} · ${state.vw}×${state.vh} · burned-in animated captions` : 'Not supported in this browser — use Chrome or Edge';
  $('#expVideo').disabled = !f;
  $('#expProgress').hidden = true;
  setStep(5);
  dlg.showModal();
});
function srtTime(s, sep) {
  const ms = Math.round(s * 1000);
  const h = Math.floor(ms / 3600000), m = Math.floor((ms % 3600000) / 60000), sec = Math.floor((ms % 60000) / 1000), r = ms % 1000;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}${sep}${String(r).padStart(3, '0')}`;
}
const outText = (c) => { const tf = transform(); const t = stripMarks(c.text); return tf ? tf(t) : t; };
$('#expSrt').addEventListener('click', () => {
  const body = state.cues.map((c, i) => `${i + 1}\n${srtTime(c.start, ',')} --> ${srtTime(c.end, ',')}\n${outText(c)}\n`).join('\n');
  download(new Blob([body], { type: 'application/x-subrip' }), `${baseName()}.srt`);
});
$('#expVtt').addEventListener('click', () => {
  const body = 'WEBVTT\n\n' + state.cues.map((c) => `${srtTime(c.start, '.')} --> ${srtTime(c.end, '.')}\n${outText(c)}\n`).join('\n');
  download(new Blob([body], { type: 'text/vtt' }), `${baseName()}.vtt`);
});
$('#expTxt').addEventListener('click', () => {
  download(new Blob([state.cues.map(outText).join('\n')], { type: 'text/plain' }), `${baseName()}-transcript.txt`);
});

let audioGraph = null;
function getAudioGraph() {
  if (audioGraph) return audioGraph;
  const AC = window.AudioContext || window.webkitAudioContext;
  const ctx = new AC();
  const src = ctx.createMediaElementSource(video);
  const dest = ctx.createMediaStreamDestination();
  src.connect(ctx.destination);
  src.connect(dest);
  audioGraph = { ctx, src, dest };
  return audioGraph;
}

let exporting = false;
$('#expVideo').addEventListener('click', async () => {
  const f = recFormat();
  if (!f || exporting) return;
  exporting = true;
  $$('.export-opt').forEach((b) => (b.disabled = true));
  $('#expProgress').hidden = false;
  $('#expTitle').textContent = 'Rendering video…';
  $('#expBar').style.width = '0%';
  try {
    $('#expTitle').textContent = 'Loading fonts…';
    await ensureDesignFonts(design());
    $('#expTitle').textContent = 'Rendering video…';
    const blob = await renderVideo(f[0], (p) => { $('#expBar').style.width = `${Math.round(p * 100)}%`; });
    download(blob, `${baseName()}-matra-boli.${f[1]}`);
    $('#expTitle').textContent = 'Done — your video is downloading.';
    setTimeout(() => dlg.close(), 1600);
  } catch (err) {
    console.error(err);
    $('#expTitle').textContent = `Export failed: ${err.message}`;
  } finally {
    exporting = false;
    $$('.export-opt').forEach((b) => (b.disabled = false));
  }
});
dlg.addEventListener('cancel', (e) => { if (exporting) e.preventDefault(); });

async function renderVideo(mimeType, onProgress) {
  const scale = Math.min(1, 1920 / Math.max(state.vw, state.vh));
  const W = Math.round((state.vw * scale) / 2) * 2, H = Math.round((state.vh * scale) / 2) * 2;
  const canvas = document.createElement('canvas');
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext('2d');
  const stream = canvas.captureStream(30);
  const g = getAudioGraph();
  await g.ctx.resume();
  try { g.src.disconnect(g.ctx.destination); } catch {}
  const at = g.dest.stream.getAudioTracks()[0];
  if (at) stream.addTrack(at);

  const wasMuted = video.muted;
  video.muted = false;
  video.pause();
  playUntil = null;
  await seekTo(0);
  drawFrame(ctx, W, H, 0);

  const chunks = [];
  const rec = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: 10_000_000, audioBitsPerSecond: 160_000 });
  rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
  const stopped = new Promise((res) => (rec.onstop = res));
  rec.start(250);

  await new Promise((resolve, reject) => {
    let raf;
    const step = () => {
      drawFrame(ctx, W, H, video.currentTime);
      onProgress(Math.min(1, video.currentTime / state.duration));
      if (video.ended || video.currentTime >= state.duration - 0.02) { resolve(); return; }
      raf = requestAnimationFrame(step);
    };
    video.onended = () => { cancelAnimationFrame(raf); drawFrame(ctx, W, H, state.duration); resolve(); };
    video.play().then(() => (raf = requestAnimationFrame(step))).catch(reject);
  });
  video.onended = null;
  await new Promise((r) => setTimeout(r, 150));
  rec.stop();
  await stopped;
  stream.getVideoTracks().forEach((t) => t.stop());
  g.src.connect(g.ctx.destination);
  video.muted = wasMuted;
  onProgress(1);
  return new Blob(chunks, { type: mimeType.split(';')[0] });
}

/* ------------------------------------------------------------------ */
/* Home hero demo — cycles languages with the live engine              */
/* ------------------------------------------------------------------ */
const hero = $('#heroDemo'), hx = hero.getContext('2d');
const HERO_LANGS = ['hi', 'ta', 'bn', 'hinglish', 'pa', 'te', 'gu', 'ml', 'mr', 'kn', 'ur', 'en'];
const HERO_STYLES = ['modern', 'hormozi', 'highlight', 'desi', 'brush', 'viral'];
const HERO_ANIMS = ['pop', 'karaoke', 'bounce', 'sweep', 'slide', 'zoom'];
const heroPagesCache = {};
function tickHero(now) {
  const W = hero.width, H = hero.height;
  const cycle = Math.floor(now / 1000 / PERIOD);
  const t = (now / 1000) % PERIOD;
  const lang = LANG[HERO_LANGS[cycle % HERO_LANGS.length]];
  $('#heroLang').textContent = lang.native === lang.name ? lang.name : `${lang.native} · ${lang.name}`;
  // warm, abstract backdrop
  const g = hx.createLinearGradient(0, 0, W, H);
  g.addColorStop(0, '#5b4636'); g.addColorStop(0.55, '#2f2620'); g.addColorStop(1, '#151210');
  hx.fillStyle = g; hx.fillRect(0, 0, W, H);
  const r = hx.createRadialGradient(W * 0.72, H * 0.25, 10, W * 0.72, H * 0.25, W * 0.6);
  r.addColorStop(0, 'rgba(255,170,90,0.45)'); r.addColorStop(1, 'rgba(255,170,90,0)');
  hx.fillStyle = r; hx.fillRect(0, 0, W, H);
  hx.fillStyle = 'rgba(255,255,255,0.06)';
  for (let i = 0; i < 5; i++) { hx.beginPath(); hx.arc(W * (0.15 + i * 0.18), H * (0.2 + (i % 2) * 0.12), 26 + i * 6, 0, Math.PI * 2); hx.fill(); }
  heroPagesCache[lang.id] ||= demoPages(lang.sample, PERIOD);
  const d = { ...DESIGNS[HERO_STYLES[cycle % HERO_STYLES.length]], y: 0.62 };
  renderCaptions(hx, W, H, heroPagesCache[lang.id], t, d, { ...DEFAULT_MOTION, anim: HERO_ANIMS[cycle % HERO_ANIMS.length], maxWords: 0 }, { ref: 640 });
  // progress line
  hx.fillStyle = 'rgba(255,255,255,0.25)'; hx.fillRect(24, H - 26, W - 48, 4);
  hx.fillStyle = '#fff'; hx.fillRect(24, H - 26, (W - 48) * (t / PERIOD), 4);
}

/* ------------------------------------------------------------------ */
/* Main loop                                                           */
/* ------------------------------------------------------------------ */
function loop(now) {
  if (!document.hidden) {
    if (document.body.dataset.view === 'editor') {
      tickPreview();
      tickGallery(now);
    } else {
      tickHero(now);
    }
  }
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);

// Make sure every Indic font is ready before canvases draw with it.
const FONT_PROBES = [
  ['Baloo 2', 'हिन्दी Aa'], ['Baloo Paaji 2', 'ਪੰਜਾਬੀ'], ['Baloo Da 2', 'বাংলা অসমীয়া'], ['Baloo Thambi 2', 'தமிழ்'],
  ['Baloo Tammudu 2', 'తెలుగు'], ['Baloo Bhai 2', 'ગુજરાતી'], ['Baloo Tamma 2', 'ಕನ್ನಡ'], ['Baloo Chettan 2', 'മലയാളം'],
  ['Baloo Bhaina 2', 'ଓଡ଼ିଆ'], ['Noto Nastaliq Urdu', 'اردو'],
];
for (const [fam, sample] of FONT_PROBES) {
  for (const w of [700, 800]) document.fonts.load(`${w} 40px "${fam}"`, sample).catch(() => {});
}
ensureDesignFonts(design());
for (const p of FONT_PAIRS) {
  document.fonts.load(`${p.weight} 40px "${p.font}"`, 'Aaकमाल').catch(() => {});
  document.fonts.load(`${p.accentItalic ? 'italic ' : ''}${p.accentWeight} 40px "${p.accentFont}"`, 'Aaकमाल').catch(() => {});
}
void SCRIPT_FALLBACKS;

// Intro banner (dismissal remembered in this browser only)
try { if (localStorage.getItem('matraboli.banner.hidden') === '1') $('#introBanner').hidden = true; } catch {}
$('#closeBanner').addEventListener('click', () => {
  $('#introBanner').hidden = true;
  try { localStorage.setItem('matraboli.banner.hidden', '1'); } catch {}
});

// Accessibility: icon-only buttons get their tooltip as an accessible name.
function labelIconButtons(root = document) {
  root.querySelectorAll('button[title]:not([aria-label])').forEach((b) => {
    if (!b.textContent.trim()) b.setAttribute('aria-label', b.title);
  });
}
new MutationObserver(() => labelIconButtons()).observe(document.body, { childList: true, subtree: true });
labelIconButtons();

renderCues();
icons();
