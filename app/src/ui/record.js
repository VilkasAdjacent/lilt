// Record view: prompt card, live mini trace, record -> WAV -> IndexedDB.

import { mic } from '../audio/capture.js';
import { encodeWav } from '../audio/wav.js';
import { putRecording, requestPersist } from '../store/db.js';
import { settings, activeBands } from '../settings.js';
import { summarize, fmtDuration } from '../summary.js';
import { drawPitchTrace } from './draw.js';
import { history } from './live.js';
import { statsGrid } from './library.js';

const $ = (id) => document.getElementById(id);

const PROMPTS = [
  'Hi! Could I please get a medium oat latte?',
  'Hey, sorry, is anyone sitting here?',
  'Excuse me! You dropped your scarf!',
  "Good morning, I'm calling about my appointment.",
  'Oh my gosh, look at that dog. Look at its little boots.',
  'One, two, three, four, five, a little louder each time.',
  'Mm-hmm. Yeah! No, totally. That makes sense.',
  'The rainbow is a division of white light into many beautiful colours.',
  'Whee! Sparkles! Wow. Okay. Normal voice now.',
  'Could you speak up? I said: CAN YOU PASS THE SALT, PLEASE!',
];
let promptIdx = Math.floor(Math.random() * PROMPTS.length);

let ctx = null, visible = false, raf = 0;

export function init(c) {
  ctx = c;
  $('promptText').textContent = PROMPTS[promptIdx];
  $('promptNext').addEventListener('click', () => {
    promptIdx = (promptIdx + 1) % PROMPTS.length;
    $('promptText').textContent = PROMPTS[promptIdx];
  });
  mic.addEventListener('frame', () => { if (visible && !raf) raf = requestAnimationFrame(render); });
  mic.addEventListener('state', () => { if (visible) raf = raf || requestAnimationFrame(render); });
}

function render() {
  raf = 0;
  const now = mic.running && history.length ? history[history.length - 1].t : 0;
  drawPitchTrace($('recTrace'), history, now - settings.traceSeconds, now);
  if (mic.recording) {
    const t = (Date.now() - recStarted) / 1000;
    $('recTime').textContent = fmtDuration(t);
    $('recHint').textContent = 'Recording… tap again to stop and save';
  } else if (mic.running) {
    $('recHint').textContent = 'Mic is on. Tap the big button to record';
  } else {
    $('recHint').textContent = 'Tap the big button to start';
  }
}

let recStarted = 0;
export function begin() {
  mic.startRecording();
  recStarted = Date.now();
  $('recSaved').hidden = true;
  $('recTime').textContent = '0:00';
  render();
}

export async function stopAndSave() {
  const res = await mic.stopRecording();
  ctx.updateFab();
  if (!res) return;
  let blob, duration, sampleRate = null;
  if (res.kind === 'pcm') {
    sampleRate = res.sampleRate;
    duration = res.samples.length / sampleRate;
    blob = new Blob([encodeWav(res.samples, sampleRate)], { type: 'audio/wav' });
  } else {
    blob = res.blob;
    duration = (Date.now() - res.started) / 1000;
  }
  if (duration < 0.5) { ctx.toast('That one was a bit too short to keep. No worries!'); return; }
  const bands = activeBands();
  const rec = {
    id: `${res.started}-${Math.random().toString(36).slice(2, 7)}`,
    created: res.started,
    duration,
    sampleRate,
    mime: blob.type,
    blob,
    trace: res.trace,
    bands,
    summary: summarize(res.trace, bands, { loudDb: settings.loudDb, lightMax: settings.lightMax }),
  };
  try {
    await putRecording(rec);
    requestPersist();
  } catch (err) {
    console.warn(err);
    ctx.toast(`Couldn't save that one (${err.message || err}). Sorry!`);
    return;
  }
  const card = $('recSaved');
  card.replaceChildren();
  const h = document.createElement('h2'); h.textContent = 'Saved! 🎀';
  const p = document.createElement('p'); p.className = 'muted';
  p.textContent = 'Here are a few numbers. Just information, no grades.';
  const a = document.createElement('a'); a.className = 'btn btn-soft btn-small'; a.href = '#/library'; a.textContent = 'See it in Clips';
  card.append(h, p, statsGrid(rec.summary), a);
  card.hidden = false;
  render();
}

export function show() { visible = true; render(); }
export function hide() { visible = false; }
