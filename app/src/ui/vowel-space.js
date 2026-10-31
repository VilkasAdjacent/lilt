// Live vowel space (a panel in Live): F1×F2 chart with the live vowel (1 s
// median plus a short fading trail), your captured corner vowels and their
// scaled target rings, and the capture flow that saves those vowels on this device.

import { mic } from '../audio/capture.js';
import { settings, setSetting, onSettings } from '../settings.js';
import { colors, fitCanvas } from './draw.js';
import { readouts } from './live.js';
import { F1_APPROX_ABOVE_F0 } from '../analysis/index.js';
import { UtteranceTracker } from '../practice/feedback.js';
import { CORNERS, REFERENCE, SCALE_PRESETS, RING, vowelTargets, captureVowel, plotAxes, inRing } from '../vowels.js';

const $ = (id) => document.getElementById(id);
const TRAIL_SEC = 1.5;
const CAPTURE_TIMEOUT_SEC = 8;
const F2_GRID = [1000, 1500, 2000, 2500, 3000];
const F1_GRID = [300, 400, 600, 800, 1000];

let app = null, visible = false, raf = 0;
const trail = []; // { t, f1, f2, approx }, oldest first
let capture = null; // { key, tracker, frames, since }

const isOpen = () => visible && $('vowelCard').open;
const wordOf = (key) => CORNERS.find((c) => c.key === key).word;
const isApprox = (f0) => f0 > F1_APPROX_ABOVE_F0;
const setStatus = (text) => { $('vowelStatus').textContent = text; };

// ---------------------------------------------------------------- capture --
async function startCapture(key) {
  if (capture && capture.key === key) return endCapture('');
  if (!mic.running) await app.startMic();
  if (!mic.running) return;
  const { word, sound } = CORNERS.find((c) => c.key === key);
  capture = { key, tracker: new UtteranceTracker({ minSec: 0.2, gapSec: 0.25 }), frames: [], since: NaN };
  setStatus(`Say "${word}" once, the way you'd normally say it. Holding "${sound}" for a second works too.`);
  renderButtons();
}

function endCapture(message) {
  capture = null;
  setStatus(message);
  renderButtons();
}

function feedCapture(r) {
  capture.frames.push(r);
  if (!(capture.since <= r.t)) capture.since = r.t;
  const word = wordOf(capture.key);
  const utterance = capture.tracker.push(r);
  if (utterance) {
    const v = captureVowel(capture.frames.filter((f) => f.t >= utterance.start && f.t <= utterance.end));
    if (!v) return endCapture(`I didn't quite catch a clear vowel. Tap "${word}" to try again, no rush.`);
    setSetting('vowels', { ...settings.vowels, [capture.key]: v });
    return endCapture(`Saved "${word}" ✓${isApprox(v.f0) ? ' Your pitch was up high, so its F1 is a rough guess. F2 is the one that matters most here.' : ''}`);
  }
  if (r.t - capture.since > CAPTURE_TIMEOUT_SEC) endCapture(`I didn't hear a vowel that time. Tap "${word}" whenever you're ready.`);
}

function renderButtons() {
  $('vowelBtns').replaceChildren(...CORNERS.map(({ key, word }) => {
    const v = settings.vowels[key];
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'btn btn-soft btn-small';
    b.setAttribute('aria-pressed', String(capture?.key === key));
    const label = document.createElement('span');
    label.textContent = word;
    const detail = document.createElement('small');
    detail.textContent = capture?.key === key ? 'listening…'
      : v ? `F1 ${isApprox(v.f0) ? '≈' : ''}${Math.round(v.f1)} · F2 ${Math.round(v.f2)}` : 'tap, then say it';
    b.append(label, detail);
    b.addEventListener('click', () => startCapture(key));
    return b;
  }));
  $('vowelForget').hidden = !Object.keys(settings.vowels).length;
}

function renderScale() {
  const same = (a, b) => ['f1', 'f2', 'f3'].every((k) => a[k] === b[k]);
  for (const r of document.querySelectorAll('input[name=vowelScale]')) r.checked = same(settings.vowelScale, SCALE_PRESETS[r.value]);
}

// ------------------------------------------------------------------- draw --
function drawGrid(g, ax, P, w, h, dpr) {
  g.lineWidth = 1 * dpr;
  g.strokeStyle = P.grid;
  g.fillStyle = P.soft;
  g.font = `600 ${10 * dpr}px ${P.font}`;
  g.textAlign = 'center'; g.textBaseline = 'top';
  for (const f of F2_GRID) {
    const x = ax.x(f);
    g.beginPath(); g.moveTo(x, ax.y(ax.f1[0])); g.lineTo(x, ax.y(ax.f1[1])); g.stroke();
    g.fillText(String(f), x, 4 * dpr);
  }
  g.textAlign = 'right'; g.textBaseline = 'middle';
  for (const f of F1_GRID) {
    const y = ax.y(f);
    g.beginPath(); g.moveTo(ax.x(ax.f2[1]), y); g.lineTo(ax.x(ax.f2[0]), y); g.stroke();
    g.fillText(String(f), w - 3 * dpr, y);
  }
  g.font = `700 ${11 * dpr}px ${P.font}`;
  g.textAlign = 'left'; g.textBaseline = 'bottom';
  g.fillText('← F2  front', 4 * dpr, h - 4 * dpr);
  g.textAlign = 'right';
  g.fillText('F1 ↓', w - 3 * dpr, h - 4 * dpr);
}

/** Ellipse spanning the ring in log frequency, so it matches inRing(). */
function ring(g, ax, t, scale = 1) {
  const rx = Math.abs(ax.x(t.f2 * RING.f2 ** scale) - ax.x(t.f2));
  const ry = Math.abs(ax.y(t.f1 * RING.f1 ** scale) - ax.y(t.f1));
  g.beginPath(); g.ellipse(ax.x(t.f2), ax.y(t.f1), Math.max(rx, 1), Math.max(ry, 1), 0, 0, 2 * Math.PI);
}

/** Under the ring: targets sit below-left of your own vowels, so this side stays clear of the own-vowel lines. */
function label(g, ax, P, dpr, text, t, scale = 1) {
  g.fillStyle = P.ink; g.font = `700 ${12 * dpr}px ${P.font}`;
  g.textAlign = 'center'; g.textBaseline = 'top';
  g.fillText(text, ax.x(t.f2), ax.y(t.f1 * RING.f1 ** scale) + 3 * dpr);
}

function drawReference(g, ax, P, dpr) {
  const [fill, line] = P.band.custom;
  g.setLineDash([5 * dpr, 4 * dpr]); g.lineWidth = 1.5 * dpr;
  for (const { key, word } of CORNERS) {
    const t = REFERENCE[key];
    ring(g, ax, t, 2); g.globalAlpha = 0.6; g.fillStyle = fill; g.fill(); g.strokeStyle = line; g.stroke(); g.globalAlpha = 1;
    label(g, ax, P, dpr, word, t, 2);
  }
  g.setLineDash([]);
}

function drawOwn(g, ax, P, dpr, targets, you) {
  const [fill, line] = P.band.femme;
  // Your own vowel quadrilateral, faint: the shape the targets keep.
  g.strokeStyle = P.soft; g.lineWidth = 1.5 * dpr; g.globalAlpha = 0.5;
  g.beginPath();
  targets.forEach(({ own }, i) => g[i ? 'lineTo' : 'moveTo'](ax.x(own.f2), ax.y(own.f1)));
  if (targets.length === CORNERS.length) g.closePath();
  g.stroke(); g.globalAlpha = 1;
  for (const { word, own, target } of targets) {
    const ox = ax.x(own.f2), oy = ax.y(own.f1), tx = ax.x(target.f2), ty = ax.y(target.f1);
    g.strokeStyle = P.soft; g.lineWidth = 1.5 * dpr; g.setLineDash([2 * dpr, 4 * dpr]);
    g.beginPath(); g.moveTo(ox, oy); g.lineTo(tx, ty); g.stroke();
    const landed = you && inRing(you, target);
    ring(g, ax, target);
    g.fillStyle = landed ? P.pink : fill; g.globalAlpha = landed ? 0.55 : 1; g.fill(); g.globalAlpha = 1;
    g.setLineDash(landed ? [] : [5 * dpr, 4 * dpr]); g.strokeStyle = line; g.lineWidth = (landed ? 2.5 : 1.5) * dpr; g.stroke();
    g.setLineDash([]);
    g.fillStyle = P.soft;
    g.beginPath(); g.arc(ox, oy, 4 * dpr, 0, 2 * Math.PI); g.fill();
    label(g, ax, P, dpr, word, target);
  }
}

function drawLive(g, ax, P, dpr, you, targets) {
  const newest = trail[trail.length - 1];
  for (const p of trail) {
    g.globalAlpha = 0.1 + 0.5 * (1 - (newest.t - p.t) / TRAIL_SEC);
    g.fillStyle = P.purple;
    g.beginPath(); g.arc(ax.x(p.f2), ax.y(p.f1), 3 * dpr, 0, 2 * Math.PI); g.fill();
  }
  g.globalAlpha = 1;
  if (!you) return;
  const x = ax.x(you.f2), y = ax.y(you.f1);
  const landed = targets.some((t) => inRing(you, t.target));
  g.strokeStyle = P.ink; g.lineWidth = 2.5 * dpr;
  // Approximate F1: stretch the dot vertically and grey it, since only F2 is trustworthy.
  if (you.approx) {
    g.fillStyle = landed ? P.pink : P.soft; g.globalAlpha = 0.6; g.setLineDash([4 * dpr, 3 * dpr]);
    g.beginPath(); g.ellipse(x, y, 8 * dpr, 24 * dpr, 0, 0, 2 * Math.PI); g.fill(); g.globalAlpha = 1; g.stroke(); g.setLineDash([]);
    g.fillStyle = P.soft; g.font = `700 ${11 * dpr}px ${P.font}`; g.textAlign = x > ax.x(1500) ? 'right' : 'left'; g.textBaseline = 'middle';
    g.fillText('F1 ≈', x + (x > ax.x(1500) ? -12 : 12) * dpr, y);
  } else {
    g.fillStyle = landed ? P.pink : P.purple;
    g.beginPath(); g.arc(x, y, 9 * dpr, 0, 2 * Math.PI); g.fill(); g.stroke();
  }
}

function draw() {
  raf = 0;
  if (!isOpen()) return;
  const P = colors();
  const { ctx: g, w, h, dpr } = fitCanvas($('vowelPlot'));
  const ax = plotAxes({ w, h, pad: 28 * dpr });
  g.clearRect(0, 0, w, h);
  drawGrid(g, ax, P, w, h, dpr);
  const targets = vowelTargets(settings.vowels, settings.vowelScale);
  const r = readouts();
  const newest = trail[trail.length - 1];
  const you = r.voiced && newest ? newest : null;
  if (targets.length) drawOwn(g, ax, P, dpr, targets, you);
  else drawReference(g, ax, P, dpr);
  if (newest && mic.running) drawLive(g, ax, P, dpr, you, targets);
}

function kick() { if (!raf && isOpen()) raf = requestAnimationFrame(draw); }

const EMPTY_HINT = 'Nothing saved yet, so the yellow rings are generic vowels, just for orientation. Tap a word below and say it to save your own. They stay on this device.';
function emptyHint() {
  if (!capture && !Object.keys(settings.vowels).length) setStatus(EMPTY_HINT);
  else if ($('vowelStatus').textContent === EMPTY_HINT) setStatus('');
}

// ------------------------------------------------------------------- init --
export function init(ctx) {
  app = ctx;
  renderButtons();
  renderScale();
  emptyHint();
  mic.addEventListener('frame', (e) => {
    const r = e.detail;
    if (capture) feedCapture(r);
    if (!isOpen()) return;
    const { f0, f1, f2 } = readouts();
    if (f1 > 0 && f2 > 0) trail.push({ t: r.t, f1, f2, approx: isApprox(f0) });
    while (trail.length && trail[0].t < r.t - TRAIL_SEC) trail.shift();
    kick();
  });
  mic.addEventListener('state', () => {
    if (!mic.running) { trail.length = 0; if (capture) endCapture(''); emptyHint(); }
    kick();
  });
  onSettings(({ key }) => {
    if (key === 'vowels') { renderButtons(); emptyHint(); }
    if (key === 'vowelScale') renderScale();
    kick();
  });
  for (const r of document.querySelectorAll('input[name=vowelScale]')) {
    r.addEventListener('change', () => r.checked && setSetting('vowelScale', { ...SCALE_PRESETS[r.value] }));
  }
  $('vowelForget').addEventListener('click', () => app.toast('Forget your saved vowels on this device?', [
    { label: 'Forget them', onClick: () => setSetting('vowels', {}) },
    { label: 'Keep them', soft: true },
  ], 0));
  $('vowelCard').addEventListener('toggle', kick);
  window.addEventListener('resize', kick);
}
export function show() { visible = true; kick(); }
export function hide() { visible = false; }
