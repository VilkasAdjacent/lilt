// App shell: routing, theme, session timer + gentle nudges, mic button.

import { mic } from './audio/capture.js';
import { settings, onSettings } from './settings.js';
import { refreshPalette } from './ui/draw.js';
import { fmtDuration } from './summary.js';
import * as home from './ui/home.js';
import * as live from './ui/live.js';
import * as record from './ui/record.js';
import * as library from './ui/library.js';
import * as settingsView from './ui/settings-view.js';

const $ = (id) => document.getElementById(id);
const VIEWS = ['home', 'live', 'record', 'library', 'settings', 'about'];
const modules = { home, live, record, library, settings: settingsView };
let current = null;

// ------------------------------------------------------------------ theme --
function applyTheme() {
  const t = settings.theme;
  if (t === 'light' || t === 'dark') document.documentElement.dataset.theme = t;
  else delete document.documentElement.dataset.theme;
  refreshPalette();
}
applyTheme();
onSettings(({ key }) => { if (key === 'theme') applyTheme(); });
matchMedia('(prefers-color-scheme: dark)').addEventListener?.('change', applyTheme);

// ------------------------------------------------------------------ toast --
let toastTimer = null;
/** toast(message, [{label, onClick}], ms) */
export function toast(msg, actions = [], ms = 6000) {
  const el = $('toast');
  el.replaceChildren();
  const p = document.createElement('div');
  p.textContent = msg;
  el.appendChild(p);
  if (actions.length) {
    const row = document.createElement('div');
    row.className = 'row-btns';
    for (const a of actions) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'btn btn-small ' + (a.soft ? 'btn-soft' : '');
      b.textContent = a.label;
      b.addEventListener('click', () => { hideToast(); a.onClick && a.onClick(); });
      row.appendChild(b);
    }
    el.appendChild(row);
  }
  el.hidden = false;
  clearTimeout(toastTimer);
  if (ms) toastTimer = setTimeout(hideToast, ms);
}
export function hideToast() { $('toast').hidden = true; }

// ---------------------------------------------------------------- routing --
function route() {
  const name = (location.hash.replace(/^#\/?/, '') || 'home').split('?')[0];
  const view = VIEWS.includes(name) ? name : 'home';
  if (view === current) return;
  if (current && modules[current] && modules[current].hide) modules[current].hide();
  current = view;
  for (const sec of document.querySelectorAll('.view')) sec.hidden = sec.dataset.view !== view;
  for (const a of document.querySelectorAll('.tabbar a')) {
    if (a.dataset.tab === view || (view === 'about' && a.dataset.tab === 'settings')) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
  }
  if (modules[view] && modules[view].show) modules[view].show();
  updateFab();
  window.scrollTo(0, 0);
}
export const currentView = () => current;

// ------------------------------------------------------- session + nudges --
const session = {
  ms: 0,             // mic-on time this session
  lastTick: 0,
  lastOff: 0,
  nudged: false,
  tiny: null,        // { endMs } when a tiny session is running
};

function tick() {
  const now = performance.now();
  if (mic.running) {
    if (session.lastTick) session.ms += now - session.lastTick;
    session.lastTick = now;
  } else {
    session.lastTick = 0;
  }
  const pill = $('sessionPill');
  pill.hidden = !mic.running && session.ms < 1000;
  if (session.tiny) {
    const left = Math.max(0, session.tiny.endMs - session.ms);
    $('sessionTime').textContent = `${fmtDuration(left / 1000)} left`;
    pill.classList.add('tiny');
    if (left <= 0) finishTiny();
  } else {
    $('sessionTime').textContent = fmtDuration(session.ms / 1000);
    pill.classList.remove('tiny');
  }
  const nudgeMs = settings.nudgeMin * 60000;
  pill.classList.toggle('nudge', session.ms >= nudgeMs);
  if (mic.running && !session.nudged && session.ms >= nudgeMs) {
    session.nudged = true;
    toast(`That's ${settings.nudgeMin} minutes of voice work. Your voice did lovely things. This is a really good place to stop and sip some water 💧`, [
      { label: 'Stop here', onClick: () => stopMic() },
      { label: 'A little longer', soft: true },
    ], 0);
  }
}
setInterval(tick, 500);

export function startTiny() {
  session.tiny = { endMs: session.ms + 2 * 60000 };
  location.hash = '#/live';
  return startMic();
}
function finishTiny() {
  session.tiny = null;
  stopMic();
  toast('Two minutes, done! 🌸 That counts. Want a bit more, or call it a day?', [
    { label: 'Done for now', onClick: () => { location.hash = '#/home'; } },
    { label: '2 more minutes', soft: true, onClick: () => startTiny() },
  ], 0);
}

// ---------------------------------------------------------------- mic/fab --
let wakeLock = null;
export async function startMic() {
  try {
    if (session.lastOff && performance.now() - session.lastOff > 20 * 60000) { session.ms = 0; session.nudged = false; }
    mic.setAnalyzer(settings.analyzer);
    await mic.start();
    try { wakeLock = navigator.wakeLock ? await navigator.wakeLock.request('screen') : null; } catch { wakeLock = null; }
    const w = $('constraintWarn');
    if (mic.ignored.length) {
      w.textContent = `Heads up: your browser kept ${mic.ignored.join(', ').replace('echoCancellation', 'echo cancellation').replace('noiseSuppression', 'noise suppression').replace('autoGainControl', 'auto gain')} switched on, so loudness and weight readings may be squished. Headphones or a different browser can help.`;
      w.hidden = false;
    } else w.hidden = true;
    if (mic.mode === 'mediarecorder') toast('Live analysis is not available in this browser, but recording still works.');
  } catch (err) {
    console.warn(err);
    session.tiny = null;
    const denied = err && (err.name === 'NotAllowedError' || err.name === 'SecurityError');
    toast(denied
      ? "I couldn't get the mic. That's okay! If you want to try again, allow microphone access for this site in your browser settings."
      : `The mic didn't start (${err && err.message ? err.message : err}).`, [], 9000);
  }
  updateFab();
}
export function stopMic() {
  if (mic.recording) record.stopAndSave();
  mic.stop();
  session.lastOff = performance.now();
  if (wakeLock) { wakeLock.release().catch(() => {}); wakeLock = null; }
  updateFab();
}

export function updateFab() {
  const wrap = $('fabWrap'), fab = $('fab'), label = $('fabLabel');
  const show = current === 'live' || current === 'record';
  wrap.hidden = !show;
  if (!show) return;
  fab.classList.toggle('rec', current === 'record');
  if (current === 'record') {
    fab.setAttribute('aria-pressed', String(mic.recording));
    label.textContent = mic.recording ? 'Stop & save' : 'Start recording';
  } else {
    fab.setAttribute('aria-pressed', String(mic.running));
    label.textContent = mic.running ? 'Stop mic' : 'Start mic';
  }
}

$('fab').addEventListener('click', async () => {
  if (current === 'record') {
    if (mic.recording) { await record.stopAndSave(); }
    else {
      if (!mic.running) await startMic();
      if (mic.running) record.begin();
    }
  } else if (mic.running) {
    session.tiny = null;
    stopMic();
  } else {
    await startMic();
  }
  updateFab();
});
mic.addEventListener('state', updateFab);

// -------------------------------------------------------------------- init --
for (const m of Object.values(modules)) m.init && m.init({ toast, startMic, stopMic, startTiny, updateFab });
window.addEventListener('hashchange', route);
route();

// Debug handle for the console / headless checks (no secrets in here).
window.lilt = { mic, settings };
