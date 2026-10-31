// Compare clips (inside Clips): pick saved clips or local files, re-analyse them
// with the current engines, show changes against the earliest.

import { listRecordings } from '../store/db.js';
import { settings, activeBands } from '../settings.js';
import { decodeWav } from '../audio/wav.js';
import { analyzeSamples, profile, compareProfiles, matchTokens, CHANGE } from '../compare.js';
import { ELVIN_F_OVER_M, HILLENBRAND_F_OVER_M } from '../norms.js';
import { fmtDuration } from '../summary.js';

const $ = (id) => document.getElementById(id);
const MAX_PICK = 4;
const imported = [];          // files added this visit: in memory only
const picked = new Set();     // item ids
const traces = new Map();     // `${id}|${engines}` -> { trace, reanalysed }
let items = [], busy = false;

function el(tag, props = {}, ...kids) {
  const e = Object.assign(document.createElement(tag), props);
  e.append(...kids.filter((k) => k != null));
  return e;
}

const fmtDate = (ms, opts) => {
  try { return new Date(ms).toLocaleString(undefined, opts); }
  catch { return new Date(ms).toISOString().slice(0, 16).replace('T', ' '); }
};
const shortDate = (ms) => fmtDate(ms, { day: 'numeric', month: 'short', ...(new Date(ms).getFullYear() !== new Date().getFullYear() && { year: 'numeric' }) });
const clock = (ms) => fmtDate(ms, { hour: 'numeric', minute: '2-digit' });
const engines = () => Object.values(settings.analyzer).join(', ');

async function decode(buf) {
  try { return decodeWav(buf); } catch { /* not 16-bit PCM: let the browser decode it */ }
  const ac = new OfflineAudioContext(1, 1, 48000);
  const audio = await ac.decodeAudioData(buf.slice(0));
  return { samples: audio.getChannelData(0), sampleRate: audio.sampleRate };
}

/** Pull rows in ~30 ms slices so the page stays responsive on a phone. */
async function drain(rows, onProgress) {
  const out = [];
  for (let next = rows.next(); !next.done;) {
    const until = performance.now() + 30;
    for (; !next.done && performance.now() < until; next = rows.next()) out.push(next.value);
    onProgress(out);
    await new Promise((r) => setTimeout(r, 0));
  }
  return out;
}

async function traceOf(item, onProgress) {
  const key = `${item.id}|${engines()}`;
  if (traces.has(key)) return traces.get(key);
  let result;
  try {
    const { samples, sampleRate } = await decode(await item.blob.arrayBuffer());
    const dur = samples.length / sampleRate;
    const trace = await drain(analyzeSamples(samples, sampleRate, settings.analyzer), (rows) => onProgress(rows.length ? rows[rows.length - 1][0] / dur : 0));
    result = { trace, reanalysed: true };
  } catch (err) {
    if (!item.trace) throw err;
    console.warn(err);
    result = { trace: item.trace, reanalysed: false };
  }
  traces.set(key, result);
  return result;
}

// ------------------------------------------------------------------ picker --
function renderPick() {
  const box = $('cmpPick');
  box.replaceChildren(...items.map((it) => {
    const input = el('input', { type: 'checkbox', checked: picked.has(it.id), disabled: !picked.has(it.id) && picked.size >= MAX_PICK });
    input.addEventListener('change', () => {
      if (input.checked) picked.add(it.id); else picked.delete(it.id);
      renderPick();
    });
    return el('label', { className: 'check cmp-item' }, input, el('span', {}, it.title, el('small', { textContent: it.meta })));
  }));
  if (!items.length) box.append(el('p', { className: 'muted', textContent: 'No clips yet. You can still add files from this device.' }));
  $('cmpGo').disabled = busy || picked.size < 2;
}

async function refreshItems() {
  let recs = [];
  try { recs = await listRecordings(); } catch (err) { console.warn(err); }
  items = [
    ...imported,
    ...recs.map((r) => ({
      id: r.id, created: r.created, blob: r.blob, trace: r.trace,
      title: shortDate(r.created), time: clock(r.created), meta: ` ${clock(r.created)} · ${fmtDuration(r.duration)}`,
    })),
  ];
  const known = new Set(items.map((it) => it.id));
  [...picked].filter((id) => !known.has(id)).forEach((id) => picked.delete(id));
  renderPick();
}

function addFiles(files) {
  [...files].forEach((f, i) => {
    const id = `file-${Date.now()}-${i}`;
    imported.unshift({ id, created: f.lastModified || Date.now(), blob: f, trace: null, title: f.name, meta: ' from this device' });
    if (picked.size < MAX_PICK) picked.add(id);
  });
  refreshItems();
}

// ----------------------------------------------------------------- results --
const signed = (v, digits) => `${v >= 0 ? '+' : '−'}${Math.abs(v).toFixed(digits)}`;
const VALUE = {
  Hz: (v) => `${Math.round(v)} Hz`,
  st: (v) => `${v.toFixed(1)} st`,
  '%': (v) => `${Math.round(v * 100)}%`,
  dB: (v) => `${v.toFixed(1)} dB`,
  '': (v) => v.toFixed(2),
};
const CHANGE_TEXT = {
  st: (v) => `${signed(v, 1)} st`,
  pct: (v) => `${signed(v, 0)}%`,
  points: (v) => `${signed(v, 0)} pts`,
  diff: (v, unit) => `${signed(v, unit === '' ? 2 : 1)}${unit && ` ${unit}`}`,
};
const fmtChange = (c, m) => (!c ? '' : c.steady ? 'about the same' : CHANGE_TEXT[m.change](c.value, m.unit));

function cell(text, change) {
  return el('td', {}, el('b', { textContent: text }), change ? el('small', { className: 'cmp-ch', textContent: change }) : null);
}

const pctOf = (k) => Math.round((k - 1) * 100);
const GROUPS = {
  pitch: { title: 'Pitch', note: () => {
    const bands = activeBands();
    return bands.length ? `Your bands: ${bands.map((b) => `${b.label} ${b.lo}–${b.hi} Hz`).join(', ')}. Pitch changes are in semitones (12 = an octave).` : 'Pitch changes are in semitones (12 = an octave).';
  } },
  resonance: { title: 'Resonance (formants)', note: () => `Changes are in percent. For context, published averages put women's F1, F2 and F3 about ${ELVIN_F_OVER_M.map(pctOf).map((p) => `+${p}%`).join(', ')} above men's across Australian English vowels (Elvin et al. 2016), or ${HILLENBRAND_F_OVER_M.map(pctOf).map((p) => `+${p}%`).join(', ')} for American English (Hillenbrand & Clark 2009). That's a group average, not a target for one clip, and the words you say move these a lot.` },
  weight: { title: 'Weight', note: () => `Weight is a rough score from 0 (light) to 1 (heavy); "light" is below ${settings.lightMax}. It's still uncalibrated and shifts with the vowel.` },
};

function groupTable(rows, profiles, labels, group) {
  const head = el('tr', {}, el('th', { scope: 'col' }), ...labels.map((l) => el('th', { scope: 'col', textContent: l })));
  const body = rows.filter((r) => r.group === group).map((r) => el('tr', {},
    el('th', { scope: 'row', textContent: r.label }),
    ...r.values.map((v, i) => cell(
      Number.isFinite(v) ? `${r.key === 'f1Median' && profiles[i].f1Approx ? '≈ ' : ''}${VALUE[r.unit](v)}` : '–',
      fmtChange(r.changes[i], r)))));
  return el('div', { className: 'cmp-scroll' }, el('table', { className: 'cmp-table' }, el('thead', {}, head), el('tbody', {}, ...body)));
}

function wordTable(a, b, labels) {
  const m = matchTokens(a.tokens, b.tokens);
  if (m.kind === 'none') {
    return el('p', { className: 'muted small-print', textContent: 'Word-by-word pairs show up when both clips say the same words, like the hVd list from the recording script.' });
  }
  const fmt = (v, f) => (Number.isFinite(v) ? f(v) : '–');
  const span = (x, y) => (Number.isFinite(x) && Number.isFinite(y) ? `${Math.round(x)}→${Math.round(y)}` : '');
  const head = el('tr', {}, ...['', 'pitch', 'F1', 'F2', 'F3'].map((t) => el('th', { scope: 'col', textContent: t })));
  const body = m.rows.map((r) => el('tr', {},
    el('th', { scope: 'row', textContent: r.label }),
    cell(fmt(CHANGE.st(r.a.f0, r.b.f0), CHANGE_TEXT.st), span(r.a.f0, r.b.f0)),
    ...[1, 2, 3].map((k) => cell(fmt(CHANGE.pct(r.a[`f${k}`], r.b[`f${k}`]), CHANGE_TEXT.pct), span(r.a[`f${k}`], r.b[`f${k}`])))));
  const how = m.kind === 'words'
    ? `Both clips read the hVd list, so each word is paired with itself (the middle value over repeats). A skipped word shifts the ones after it.`
    : `Both clips have ${m.rows.length} words, paired in order. That only means something if they say the same words.`;
  return el('div', {},
    el('p', { className: 'muted small-print', textContent: `${labels[0]} → ${labels[labels.length - 1]}, in Hz underneath. ${how}` }),
    el('div', { className: 'cmp-scroll' }, el('table', { className: 'cmp-table cmp-words' }, el('thead', {}, head), el('tbody', {}, ...body))));
}

function renderResults(chosen, results) {
  const opts = { loudDb: settings.loudDb, lightMax: settings.lightMax };
  const profiles = results.map((r) => profile(r.trace, activeBands(), opts));
  const labels = chosen.map((it) => (it.time && chosen.filter((o) => o.title === it.title).length > 1 ? `${it.title}, ${it.time}` : it.title));
  const rows = compareProfiles(profiles);
  const fromTrace = chosen.filter((_, i) => !results[i].reanalysed).map((it) => it.title);
  $('cmpOut').replaceChildren(...[
    el('p', { className: 'cmp-lede', textContent: `Each clip next to ${labels[0]}, the earliest. Changes, not grades.` }),
    ...Object.entries(GROUPS).flatMap(([key, g]) => [
      el('h3', { textContent: g.title }), groupTable(rows, profiles, labels, key), el('p', { className: 'muted small-print', textContent: g.note() }),
    ]),
    el('h3', { textContent: 'Word by word' }),
    wordTable(profiles[0], profiles[profiles.length - 1], labels),
    el('p', { className: 'muted small-print', textContent: `Every clip was analysed just now with the same engines (${engines()}), so they compare like with like. Mic, room, distance, mood and the words you say all nudge these numbers, so small changes are mostly everyday wobble. "≈" marks F1 when pitch is high enough that F1 is probably on a harmonic.` }),
    fromTrace.length ? el('p', { className: 'muted small-print', textContent: `${fromTrace.join(', ')} couldn't be decoded in this browser, so its saved readings were used (no F3 or H1–H2*, and possibly older engines).` }) : null,
  ].filter(Boolean));
}

async function runCompare() {
  if (busy) return;
  const chosen = items.filter((it) => picked.has(it.id)).sort((a, b) => a.created - b.created);
  busy = true;
  renderPick();
  const status = $('cmpStatus');
  try {
    const results = [];
    for (const [i, it] of chosen.entries()) {
      results.push(await traceOf(it, (frac) => { status.textContent = `Listening to ${it.title} (${i + 1} of ${chosen.length})… ${Math.round(frac * 100)}%`; }));
    }
    status.textContent = '';
    renderResults(chosen, results);
  } catch (err) {
    console.warn(err);
    status.textContent = `I couldn't read one of those (${err.message || err}). WAV files work everywhere; other formats depend on the browser.`;
  } finally {
    busy = false;
    renderPick();
  }
}

export function init() {
  $('cmpAdd').addEventListener('click', () => $('cmpFile').click());
  $('cmpFile').addEventListener('change', (e) => { addFiles(e.target.files); e.target.value = ''; });
  $('cmpGo').addEventListener('click', runCompare);
}
export const show = refreshItems;
