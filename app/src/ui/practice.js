// Practice view: one shuffled exercise with its readouts and per-attempt
// feedback, plus the full list to browse. Also fills the Home teaser card.

import { mic } from '../audio/capture.js';
import { settings, setSetting, activeBands } from '../settings.js';
import { hzToNote } from '../analysis/index.js';
import { KINDS, EXERCISES, pickExercise } from '../practice/exercises.js';
import { UtteranceTracker, scoreAttempt } from '../practice/feedback.js';
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
};

let current = null, visible = false, raf = 0;
const tracker = new UtteranceTracker();
let lastAttempt = null, attempts = [];

function choose(ex) {
  current = ex;
  setSetting('exercisesSeen', [...settings.exercisesSeen.filter((id) => id !== ex.id), ex.id].slice(-SEEN_MAX));
  tracker.clear();
  lastAttempt = null;
  attempts = [];
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
  $('pxHint').textContent = [WATCH_HINT[current.watch] || 'Eyes off the screen for this one, if you like.', current.score && SCORE_HINT[current.score.kind]]
    .filter(Boolean).join(' ');
  for (const box of document.querySelectorAll('#pxReadouts [data-watch]')) box.classList.toggle('watching', box.dataset.watch === current.watch);
  renderAttempts();
}

function renderAttempts() {
  const list = $('pxAttempts');
  list.hidden = !current.score;
  list.replaceChildren(...(attempts.length
    ? attempts.map((a) => el('li', { textContent: a.text, className: `attempt ${a.state}` }))
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
  $('pxLL').textContent = shown(r.weight) ? `${r.dbfs >= settings.loudDb ? 'loud' : 'quiet'} · ${weightWord(r.weight)}` : '–';
}
const kick = () => { if (visible && !raf) raf = requestAnimationFrame(render); };

function onFrame(e) {
  kick();
  if (!visible || !current.score) return;
  const u = tracker.push(e.detail);
  if (!u) return;
  const result = scoreAttempt(current.score, lastAttempt, u, { bands: activeBands(), loudDb: settings.loudDb, lightMax: settings.lightMax });
  lastAttempt = u;
  attempts = [result, ...attempts].slice(0, ATTEMPTS_MAX);
  renderAttempts();
}

export function init() {
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
    if (!mic.running) { tracker.clear(); lastAttempt = null; }
    if (visible) { renderAttempts(); kick(); }
  });
  window.addEventListener('resize', kick);
}
export function show() { visible = true; renderAttempts(); kick(); }
export function hide() { visible = false; tracker.clear(); }
