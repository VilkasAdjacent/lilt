// Live view: pitch trace + bands, loudness next to weight, loud x light
// scatter, resonance details. Also owns the shared recent-history buffer the
// Record view draws from.

import { mic } from '../audio/capture.js';
import { settings, activeBands, onSettings } from '../settings.js';
import { drawPitchTrace, drawScatter, refreshPalette } from './draw.js';
import { hzToNote, F1_APPROX_ABOVE_F0 } from '../analysis/index.js';
import { RollingMedian, SMOOTH_SEC, AVG_SEC } from './smoothing.js';

const $ = (id) => document.getElementById(id);

// ---------------------------------------------------------------- history --
export const history = []; // {t, f0, f0s, dbfs, weight}: f0 = median-of-3, f0s = SMOOTH_SEC median
// Every readout and meter shows a SMOOTH_SEC rolling median of voiced frames
// (loudness: of all frames), so a number stays readable while it moves.
const STAGES = ['f0', 'weight', 'f1', 'f2', 'f3', 'h1h2', 'clarity', 'dbfs'];
const med = Object.fromEntries(STAGES.map((k) => [k, new RollingMedian(SMOOTH_SEC)]));
const avg10 = new RollingMedian(AVG_SEC);
const smooth = { f0s: [], lastVoiced: -1, t: 0, last: null };

mic.addEventListener('frame', (e) => {
  const r = e.detail;
  smooth.t = r.t;
  smooth.last = r;
  // Median-of-3 on F0 for the thin raw trace (kills single-frame blips).
  let f0 = NaN;
  if (r.voiced) {
    smooth.f0s.push(r.f0);
    if (smooth.f0s.length > 3) smooth.f0s.shift();
    f0 = [...smooth.f0s].sort((a, b) => a - b)[smooth.f0s.length >> 1];
    smooth.lastVoiced = r.t;
    for (const k of ['f0', 'weight', 'f1', 'f2', 'f3', 'h1h2', 'clarity']) med[k].push(r.t, r[k]);
    avg10.push(r.t, r.f0);
  } else {
    smooth.f0s.length = 0;
  }
  med.dbfs.push(r.t, r.dbfs < -90 ? -90 : r.dbfs);
  const f0s = med.f0.value(r.t);
  history.push({ t: r.t, f0, f0s: r.voiced ? f0s : NaN, dbfs: r.dbfs, weight: r.voiced ? r.weight : NaN });
  const keep = r.t - Math.max(12, settings.traceSeconds + 2);
  while (history.length && history[0].t < keep) history.shift();
  dirty = true;
});
mic.addEventListener('state', () => {
  if (!mic.running) {
    history.length = 0; smooth.f0s.length = 0; smooth.lastVoiced = -1;
    for (const m of Object.values(med)) m.clear();
    avg10.clear();
    dirty = true;
  }
});
const sm = (k) => med[k].value(smooth.t);
/** Shown while there's anything voiced in the smoothing window. */
const haveVoice = () => mic.running && med.f0.value(smooth.t) > 0;

export const voicedRecently = () => mic.running && smooth.t - smooth.lastVoiced < 0.35;
/** Median voiced dBFS over the last few seconds (for loudness calibration). */
export function recentVoicedDb(sec = 3) {
  const v = history.filter((h) => h.f0 > 0 && h.t > smooth.t - sec).map((h) => h.dbfs).sort((a, b) => a - b);
  return v.length ? v[v.length >> 1] : NaN;
}

// ------------------------------------------------------------------- view --
let visible = false, dirty = true, raf = 0, llState = '', llSince = 0;

const CHEERS = ['Loud AND light! ✨', 'Big voice, tiny weight 💖', "That's the one! 🌟", 'Ooh, sparkly. Keep that!', 'Projecting like a pro ✦'];

function bandText(f0) {
  const bands = activeBands();
  const hit = bands.filter((b) => f0 >= b.lo && f0 <= b.hi);
  if (hit.length) return ['in', `in ${hit[hit.length - 1].label.toLowerCase()} ✨`];
  const near = bands.some((b) => f0 >= b.lo - 10 && f0 <= b.hi + 10);
  if (near) return ['near', 'so close'];
  const lo = Math.min(...bands.map((b) => b.lo));
  return ['out', f0 < lo ? 'below the band' : 'above the band'];
}

function render() {
  raf = 0;
  if (!visible) return;
  if (dirty) {
    dirty = false;
    const now = mic.running ? smooth.t : 0;
    const avg = mic.running && avg10.count >= 20 ? avg10.value(now) : NaN;
    drawPitchTrace($('liveTrace'), history, now - settings.traceSeconds, now, { avg });
    const age = 4;
    const you = haveVoice() ? { dbfs: sm('dbfs'), weight: sm('weight') } : null;
    drawScatter($('llScatter'), history.filter((h) => h.t > now - age && h.f0 > 0).map((h) => ({ ...h, age: (now - h.t) / age })), {
      loudDb: settings.loudDb, lightMax: settings.lightMax, you,
    });
    updateReadouts();
  }
  if (mic.running) raf = requestAnimationFrame(render);
}

function updateReadouts() {
  const voiced = haveVoice();
  const f0 = voiced ? sm('f0') : NaN;
  const chip = $('bandChip');
  if (!mic.running) {
    $('pitchHz').textContent = '–'; $('pitchNote').innerHTML = '&nbsp;';
    chip.dataset.state = 'idle'; chip.textContent = 'mic off';
  } else if (Number.isFinite(f0)) {
    $('pitchHz').textContent = Math.round(f0);
    $('pitchNote').textContent = hzToNote(f0);
    const [st, txt] = bandText(f0);
    chip.dataset.state = st; chip.textContent = txt;
  } else {
    chip.dataset.state = 'idle'; chip.textContent = 'listening…';
  }

  // Loudness meter: -60..0 dBFS
  const db = sm('dbfs');
  const pct = (v, lo, hi) => `${Math.max(0, Math.min(100, ((v - lo) / (hi - lo)) * 100))}%`;
  $('loudFill').style.width = mic.running && Number.isFinite(db) ? pct(db, -60, 0) : '0%';
  $('loudMark').style.left = pct(settings.loudDb, -60, 0);
  $('loudNum').textContent = mic.running && Number.isFinite(db) ? (db <= -90 ? 'silent' : Math.round(db)) : '–';

  const w = sm('weight');
  $('weightFill').style.width = voiced && Number.isFinite(w) ? pct(w, 0, 1) : '0%';
  $('weightMark').style.left = pct(settings.lightMax, 0, 1);
  $('weightWord').textContent = voiced && Number.isFinite(w) ? (w < 0.3 ? 'light ✨' : w < 0.5 ? 'lightish' : w < 0.7 ? 'medium' : 'heavy') : '–';

  // Loud & light chip, with a little hysteresis so it doesn't flicker.
  let st = 'idle';
  if (voiced && Number.isFinite(w)) st = db >= settings.loudDb ? (w <= settings.lightMax ? 'yay' : 'heavy') : 'quiet';
  const now = performance.now();
  if (st !== llState && now - llSince > 300) {
    llState = st; llSince = now;
    const el = $('llChip');
    el.dataset.state = st;
    el.textContent = {
      idle: mic.running ? 'Get loud, stay light. I\'ll cheer.' : 'Start the mic and I\'ll keep you company.',
      quiet: 'Nice and easy. A bit louder, keeping it light?',
      yay: CHEERS[Math.floor(Math.random() * CHEERS.length)],
      heavy: 'Loud, but leaning heavy. More breath and space, less push?',
    }[st];
  }

  const fmt = (v) => (voiced && Number.isFinite(v) ? Math.round(v) : '–');
  // Above ~200 Hz F0, LPC F1 tends to sit on a harmonic: grey it out with "≈".
  const f1 = sm('f1');
  const f1Approx = Number.isFinite(f0) && f0 > F1_APPROX_ABOVE_F0 && Number.isFinite(f1);
  const f1El = $('f1');
  f1El.textContent = f1Approx ? `≈${fmt(f1)}` : fmt(f1);
  f1El.classList.toggle('approx', f1Approx);
  f1El.title = f1Approx ? `Approximate: above ${F1_APPROX_ABOVE_F0} Hz pitch, F1 often locks onto a harmonic.` : '';
  $('f2').textContent = fmt(sm('f2')); $('f3').textContent = fmt(sm('f3'));
  const r = smooth.last;
  const h1h2 = sm('h1h2');
  $('h1h2').textContent = voiced && Number.isFinite(h1h2) ? `${h1h2.toFixed(1)} dB` : '–';
  // ltas is already averaged over ~1 s of voiced frames by the analyser.
  const tiltV = r && Number.isFinite(r.ltas) ? r.ltas : r && r.tilt;
  $('tilt').textContent = voiced && Number.isFinite(tiltV) ? `${tiltV.toFixed(0)} dB` : '–';
  const clarity = sm('clarity');
  $('clarity').textContent = voiced && Number.isFinite(clarity) ? clarity.toFixed(2) : '–';
  const a = avg10.count >= 20 ? avg10.value(smooth.t) : NaN;
  $('pitchAvg').textContent = mic.running && Number.isFinite(a) ? `${AVG_SEC} s average: ${Math.round(a)} Hz` : '';
}

function renderLegend() {
  const el = $('bandLegend');
  el.replaceChildren();
  for (const b of activeBands()) {
    const s = document.createElement('span');
    const i = document.createElement('i');
    i.style.background = `var(--band-${b.kind === 'androgynous' ? 'a' : b.kind === 'femme' ? 'f' : 'c'})`;
    i.style.borderColor = `var(--band-${b.kind === 'androgynous' ? 'a' : b.kind === 'femme' ? 'f' : 'c'}-line)`;
    s.append(i, `${b.label} ${b.lo}–${b.hi} Hz`);
    el.appendChild(s);
  }
}

export function kick() { dirty = true; if (!raf && visible) raf = requestAnimationFrame(render); }

export function init() {
  renderLegend();
  onSettings(({ key }) => {
    if (key === 'bands' || key === 'customBand') renderLegend();
    if (key === 'theme') refreshPalette();
    kick();
  });
  mic.addEventListener('frame', () => { if (visible && !raf) raf = requestAnimationFrame(render); });
  mic.addEventListener('state', kick);
  window.addEventListener('resize', kick);
}
export function show() { visible = true; llState = ''; kick(); }
export function hide() { visible = false; }
