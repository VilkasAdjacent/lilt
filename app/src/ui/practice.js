// Practice view: one shuffled exercise with its readouts and per-attempt
// feedback, plus the full list to browse. Also fills the Home teaser card.

import { mic } from '../audio/capture.js';
import { settings, setSetting, activeBands } from '../settings.js';
import { hzToNote } from '../analysis/index.js';
import { KINDS, EXERCISES, pickExercise } from '../practice/exercises.js';
import { UtteranceTracker, scoreAttempt } from '../practice/feedback.js';
import { sessionCare } from '../practice/prosody.js';
import { NoiseFloor, voiceDb, hearsNoise } from '../practice/noise.js';
import { startBabble, prepareBabble } from '../audio/babble.js';
import { drawPitchTrace } from './draw.js';
import { history, readouts, weightWord } from './live.js';

const $ = (id) => document.getElementById(id);
function el(tag, props, children = []) {
  const node = Object.assign(document.createElement(tag), props);
  node.append(...children);
  return node;
}

const SEEN_MAX = 10;
const ATTEMPTS_MAX = 6;

const WATCH_HINT = {
  pitch: 'Watch the pitch line and the dashed 10 s average.',
  resonance: 'Watch F2, comparing a word with itself rather than with different words.',
  loudlight: 'Watch loudness go up while weight stays light.',
};
const SCORE_HINT = {
  step: 'Each attempt shows its step from the one before.',
  contrast: "Each attempt is compared with the one before: F2 should move, pitch shouldn't.",
  band: 'Each attempt shows where its pitch sat.',
  loudlight: 'Each attempt: was it loud, and did it stay light?',
  shape: "After each phrase you'll see its shape: how far the pitch moved and how it ended. Just information.",
  ending: 'Each phrase: did the last word stay smooth and level, or lift?',
  noise: 'Each try with the café on: loud but light, and did pitch and resonance hold up against your quiet try?',
};

let current = null, visible = false, raf = 0;
const tracker = new UtteranceTracker();
let lastAttempt = null, attempts = [], tries = [], careShown = false;

// ------------------------------------------------------------------ café --
// Short doses: the café closes itself after a few minutes.
const BABBLE_MAX_MS = 3 * 60000;
const floor = new NoiseFloor();
let babble = null, babbleTimer = 0, babbleRested = false, quietTry = null, babbleNote = '';

function stopBabble({ rested = false } = {}) {
  clearTimeout(babbleTimer);
  if (babble) babble.stop();
  babble = null;
  babbleRested = rested;
  floor.clear();
  renderBabble();
}

async function toggleBabble(startMic) {
  if (babble) { stopBabble(); return; }
  if (!mic.running) await startMic();
  if (!mic.running || !mic.ctx || !current.babble) { renderBabble(); return; }
  babble = startBabble(mic.ctx, settings.babbleLevel);
  babbleRested = false;
  floor.clear();
  babbleTimer = setTimeout(() => stopBabble({ rested: true }), BABBLE_MAX_MS);
  renderBabble();
}

function babbleNoteText() {
  if (babble) {
    return hearsNoise(floor.db, settings.loudDb)
      ? '≈ The mic can hear the café, so loudness, weight and F2 are rougher right now. One earbud in keeps them sharp.'
      : 'Café on. Stay light and let the room be loud.';
  }
  if (babbleRested) return "That's a few minutes of café, which is a lovely dose 🌙 Rest your voice a moment, and start it again if you like.";
  if (mic.running && !mic.ctx) return "The café needs Web Audio, which this browser isn't offering here.";
  return 'Do your quiet try first, with the café off. One earbud in is best: the mic hears only you.';
}

function renderBabble() {
  $('babbleBtn').setAttribute('aria-pressed', String(!!babble));
  $('babbleBtn').textContent = babble ? '☕ Stop the café' : '☕ Start the café';
  const text = babbleNoteText();
  if (text !== babbleNote) $('babbleNote').textContent = babbleNote = text;
}

function choose(ex) {
  current = ex;
  setSetting('exercisesSeen', [...settings.exercisesSeen.filter((id) => id !== ex.id), ex.id].slice(-SEEN_MAX));
  tracker.clear();
  lastAttempt = null;
  quietTry = null;
  attempts = [];
  tries = [];
  careShown = false;
  stopBabble();
  renderCards();
}
const shuffle = () => choose(pickExercise({ kind: settings.exerciseKind, recent: settings.exercisesSeen }));

function renderCards() {
  const kind = KINDS[current.kind];
  $('homeExKind').textContent = kind;
  $('homeExTitle').textContent = current.title;
  $('homeExBlurb').textContent = current.blurb;

  $('exKind').textContent = kind;
  $('exTitle').textContent = current.title;
  $('exBlurb').textContent = current.blurb;
  $('exSteps').replaceChildren(...current.steps.map((s) => el('li', { textContent: s })));
  $('exCare').hidden = !current.care;
  $('exCare').textContent = current.care ? `💧 ${current.care}` : '';
  $('exBabble').hidden = !current.babble;
  if (current.babble) (window.requestIdleCallback || setTimeout)(prepareBabble);
  $('pxHint').textContent = [WATCH_HINT[current.watch] || 'Eyes off the screen for this one, if you like.', current.score && SCORE_HINT[current.score.kind]]
    .filter(Boolean).join(' ');
  for (const box of document.querySelectorAll('#pxReadouts [data-watch]')) box.classList.toggle('watching', box.dataset.watch === current.watch);
  renderAttempts();
}

function renderAttempts() {
  const list = $('pxAttempts');
  list.hidden = !current.score;
  list.replaceChildren(...(attempts.length
    ? attempts.map((a) => el('li', { className: `attempt ${a.state}` }, [a.text, ...(a.notes || []).map((n) => el('span', { className: 'attempt-note', textContent: n }))]))
    : [el('li', { textContent: mic.running ? 'Listening for your first try…' : 'Start the mic and have a go.', className: 'attempt empty' })]));
}

function renderList() {
  $('exList').replaceChildren(...Object.entries(KINDS).map(([kind, label]) => el('div', { className: 'ex-group' }, [
    el('h3', { textContent: label }),
    el('div', { className: 'ex-picks' }, EXERCISES.filter((e) => e.kind === kind).map((e) => el('button', {
      type: 'button', className: 'btn btn-soft btn-small', textContent: e.title,
      onclick: () => { choose(e); $('exAll').open = false; window.scrollTo({ top: 0, behavior: 'smooth' }); },
    }))),
  ])));
}

function render() {
  raf = 0;
  if (!visible) return;
  const r = readouts();
  const now = mic.running ? r.t : 0;
  drawPitchTrace($('pxTrace'), history, now - settings.traceSeconds, now, { avg: r.avg });
  const shown = (v) => mic.running && Number.isFinite(v);
  $('pxPitch').textContent = shown(r.f0) ? Math.round(r.f0) : '–';
  $('pxNote').textContent = shown(r.f0) ? hzToNote(r.f0) : '';
  $('pxF2').textContent = shown(r.f2) ? Math.round(r.f2) : '–';
  // Over the café, "loud" is the voice's own level, with the noise the mic hears taken out.
  const rough = current.babble && hearsNoise(floor.db, settings.loudDb) ? '≈ ' : '';
  const level = current.babble ? voiceDb(r.dbfs, floor.db) : r.dbfs;
  $('pxLL').textContent = shown(r.weight) ? `${rough}${level >= settings.loudDb ? 'loud' : 'quiet'} · ${weightWord(r.weight)}` : '–';
  if (current.babble) renderBabble();
}
const kick = () => { if (visible && !raf) raf = requestAnimationFrame(render); };

function onFrame(e) {
  kick();
  floor.push(e.detail);
  if (!visible || !current.score) return;
  const u = tracker.push(e.detail);
  if (!u) return;
  const result = scoreAttempt(current.score, lastAttempt, u, {
    bands: activeBands(), loudDb: settings.loudDb, lightMax: settings.lightMax,
    floorDb: floor.db, noisy: !!babble, quiet: quietTry,
  });
  if (!result) return;
  if (u.f0 > 0) {
    lastAttempt = u;
    if (!babble) quietTry = u;
  }
  tries.push(u);
  const care = careShown ? null : sessionCare(tries, { pitch: current.score.kind !== 'step' });
  careShown = careShown || Boolean(care);
  attempts = [...(care ? [{ state: 'care', text: care.text }] : []), result, ...attempts].slice(0, ATTEMPTS_MAX);
  renderAttempts();
}

export function init({ startMic }) {
  const level = $('babbleLevel');
  level.value = settings.babbleLevel;
  level.addEventListener('input', () => {
    setSetting('babbleLevel', +level.value);
    if (babble) babble.setLevel(settings.babbleLevel);
  });
  $('babbleBtn').addEventListener('click', () => toggleBabble(startMic));
  document.addEventListener('visibilitychange', () => { if (document.hidden) stopBabble(); });
  const sel = $('exKindSel');
  sel.replaceChildren(...Object.entries({ any: 'Anything', ...KINDS }).map(([value, label]) => el('option', { value, textContent: label })));
  sel.value = settings.exerciseKind;
  sel.addEventListener('change', () => { setSetting('exerciseKind', sel.value); shuffle(); });
  $('exNext').addEventListener('click', shuffle);
  $('homeExNext').addEventListener('click', shuffle);
  renderList();
  shuffle();
  mic.addEventListener('frame', onFrame);
  mic.addEventListener('state', () => {
    if (!mic.running) { tracker.clear(); lastAttempt = null; quietTry = null; stopBabble(); }
    if (visible) { renderAttempts(); kick(); }
  });
  window.addEventListener('resize', kick);
}
export function show() { visible = true; renderAttempts(); kick(); }
export function hide() { visible = false; tracker.clear(); stopBabble(); }
