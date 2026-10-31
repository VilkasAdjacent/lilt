// Settings view bindings.

import { settings, setSetting } from '../settings.js';
import { registry } from '../analysis/index.js';
import { mic } from '../audio/capture.js';
import { clearRecordings } from '../store/db.js';
import { recentVoicedDb } from './live.js';

const $ = (id) => document.getElementById(id);

export function init(ctx) {
  // Theme + playback radios
  for (const name of ['theme', 'playback']) {
    for (const r of document.querySelectorAll(`input[name=${name}]`)) {
      r.checked = settings[name] === r.value;
      r.addEventListener('change', () => r.checked && setSetting(name, r.value));
    }
  }

  // Bands
  for (const c of document.querySelectorAll('input[name=band]')) {
    c.checked = settings.bands.includes(c.value);
    c.addEventListener('change', () => {
      const set = new Set(settings.bands);
      c.checked ? set.add(c.value) : set.delete(c.value);
      setSetting('bands', [...set]);
    });
  }
  const cb = settings.customBand;
  $('customOn').checked = !!cb;
  $('customLo').value = cb ? cb.lo : 160;
  $('customHi').value = cb ? cb.hi : 200;
  $('customRow').hidden = !cb;
  const saveCustom = () => {
    $('customRow').hidden = !$('customOn').checked;
    if (!$('customOn').checked) return setSetting('customBand', null);
    let lo = Number($('customLo').value), hi = Number($('customHi').value);
    if (!(lo > 0 && hi > 0)) return;
    if (lo > hi) [lo, hi] = [hi, lo];
    setSetting('customBand', { lo: Math.max(70, lo), hi: Math.min(400, hi) });
  };
  $('customOn').addEventListener('change', saveCustom);
  $('customLo').addEventListener('change', saveCustom);
  $('customHi').addEventListener('change', saveCustom);

  // Sliders
  const slider = (id, outId, key, fmt = (v) => v) => {
    const el = $(id), out = $(outId);
    el.value = settings[key];
    out.textContent = fmt(settings[key]);
    el.addEventListener('input', () => { out.textContent = fmt(Number(el.value)); setSetting(key, Number(el.value)); });
    return (v) => { el.value = v; out.textContent = fmt(v); };
  };
  const setLoud = slider('loudDb', 'loudOut', 'loudDb');
  slider('lightMax', 'lightOut', 'lightMax', (v) => Number(v).toFixed(2));
  slider('nudgeMin', 'nudgeOut', 'nudgeMin');
  $('loudCal').addEventListener('click', () => {
    if (!mic.running) return ctx.toast('Turn the mic on (Live tab) and talk at your "across the room" volume, then tap this again.');
    const db = recentVoicedDb(3);
    if (!Number.isFinite(db)) return ctx.toast('I didn\'t hear any voice in the last few seconds. Say something loud-ish, then tap again.');
    const v = Math.max(-50, Math.min(-10, Math.round(db - 2)));
    setSetting('loudDb', v); setLoud(v);
    ctx.toast(`Got it: "loud" now starts at ${v} dBFS.`, [], 3000);
  });

  // Analysis engines
  for (const [stage, id] of [['pitch', 'selPitch'], ['formants', 'selFormants'], ['weight', 'selWeight']]) {
    const sel = $(id);
    for (const name of Object.keys(registry[stage])) {
      const o = document.createElement('option'); o.value = name; o.textContent = registry[stage][name].label || name; sel.appendChild(o);
    }
    sel.value = settings.analyzer[stage] || sel.options[0].value;
    sel.addEventListener('change', () => {
      const a = { ...settings.analyzer, [stage]: sel.value };
      setSetting('analyzerPicked', true);
      setSetting('analyzer', a);
      mic.setAnalyzer(a);
    });
  }
  const engineInfo = () => {
    const where = mic.analysisMode === 'worker' ? 'Analysis runs in a background worker.'
      : mic.analysisMode === 'main' ? 'Analysis runs on the main thread (this browser has no module workers).' : '';
    $('engineInfo').textContent = `${where} Only the built-in engines exist for now. Others (Meyda, essentia.js, aubio) can be plugged in later.`.trim();
  };
  engineInfo();
  mic.addEventListener('state', engineInfo);

  $('wipeAll').addEventListener('click', async () => {
    const btn = $('wipeAll');
    if (btn.dataset.armed !== '1') {
      btn.dataset.armed = '1'; btn.textContent = 'Really? Tap again to delete everything';
      setTimeout(() => { btn.dataset.armed = ''; btn.textContent = 'Delete all recordings'; }, 4000);
      return;
    }
    btn.dataset.armed = ''; btn.textContent = 'Delete all recordings';
    try { await clearRecordings(); ctx.toast('All recordings deleted.', [], 2500); } catch (e) { ctx.toast(`Couldn't delete (${e.message || e}).`); }
    showStorage();
  });
}

async function showStorage() {
  try {
    if (!navigator.storage || !navigator.storage.estimate) return;
    const { usage } = await navigator.storage.estimate();
    const persisted = navigator.storage.persisted ? await navigator.storage.persisted() : false;
    $('storageInfo').textContent = `Recordings live in this browser only. Using about ${(usage / 1e6).toFixed(1)} MB${persisted ? ', and the browser has promised to keep it' : ''}.`;
  } catch { /* ignore */ }
}

export function show() { showStorage(); }
