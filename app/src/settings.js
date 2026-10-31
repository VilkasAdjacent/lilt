// User settings, persisted in localStorage (wrapped: storage can throw in
// private mode). Change events let views react.

import { normalizeChoice, defaultChoice } from './analysis/index.js';
import { parseKind } from './practice/exercises.js';
import { parseVowels, parseScale, SCALE_PRESETS } from './vowels.js';

export const BAND_PRESETS = {
  androgynous: { label: 'Androgynous', lo: 145, hi: 175 },
  femme: { label: 'Femme-leaning', lo: 165, hi: 220 },
};

export const DEFAULTS = {
  theme: 'auto',            // auto | light | dark
  bands: ['androgynous', 'femme'], // which preset bands to shade
  customBand: null,         // { lo, hi } or null
  playback: 'audio',        // audio | visuals (hide self-playback)
  nudgeMin: 12,             // soft nudge after N minutes
  loudDb: -28,              // dBFS above which we call it "loud" (mic dependent)
  lightMax: 0.45,           // weight score below which we call it "light"
  analyzer: { ...defaultChoice },
  analyzerPicked: false,    // true once engines are chosen by hand in Settings
  traceSeconds: 8,
  exerciseKind: 'any',      // Practice shuffle filter: 'any' or a key of KINDS
  exercisesSeen: [],        // recent exercise ids, oldest first, so the shuffle avoids repeats
  vowels: {},               // captured corner vowels { heed: { f1, f2, f3, f0 }, ... }, this device only
  vowelScale: { ...SCALE_PRESETS.land }, // target = own vowel × these, per formant
};

const KEY = 'voice-garden-settings-v1';
const bus = new EventTarget();

function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const s = { ...DEFAULTS, ...JSON.parse(raw) };
      // Engines nobody picked by hand follow the current defaults (the whole
      // settings object is saved on any change, so a stale default sticks otherwise).
      s.analyzer = s.analyzerPicked ? normalizeChoice(s.analyzer) : { ...defaultChoice };
      s.exerciseKind = parseKind(s.exerciseKind);
      s.vowels = parseVowels(s.vowels);
      s.vowelScale = parseScale(s.vowelScale);
      s.exercisesSeen = Array.isArray(s.exercisesSeen) ? s.exercisesSeen.filter((id) => typeof id === 'string') : [];
      return s;
    }
  } catch { /* ignore */ }
  return { ...DEFAULTS };
}

export const settings = load();

export function setSetting(key, value) {
  settings[key] = value;
  try { localStorage.setItem(KEY, JSON.stringify(settings)); } catch { /* ignore */ }
  bus.dispatchEvent(new CustomEvent('change', { detail: { key, value } }));
}

export function onSettings(fn) {
  bus.addEventListener('change', (e) => fn(e.detail));
}

/** Target bands to draw: [{ lo, hi, label, kind }] */
export function activeBands() {
  const out = settings.bands.filter((b) => BAND_PRESETS[b]).map((b) => ({ ...BAND_PRESETS[b], kind: b }));
  if (settings.customBand && settings.customBand.hi > settings.customBand.lo) out.push({ ...settings.customBand, label: 'My band', kind: 'custom' });
  return out;
}
