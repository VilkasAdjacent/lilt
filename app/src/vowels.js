// Vowel space: your own corner vowels, the same vowels scaled to a shorter
// apparent vocal tract, and the F1×F2 plot geometry. Pure, Node-testable.
//
// Where a vowel sits relative to the others is accent; the overall formant
// scale is vocal-tract size. So a target is your own vowel times one factor per
// formant, the same for every vowel: the shape of your vowel space is kept.

import { quantile } from './summary.js';

export const CORNERS = [
  { key: 'heed', word: 'heed', sound: 'ee' },
  { key: 'had', word: 'had', sound: 'a' },
  { key: 'hard', word: 'hard', sound: 'ah' },
  { key: 'whod', word: "who'd", sound: 'oo' },
];

// "aim" is the adult female/male formant ratio (geometric mean over vowels,
// Elvin, Williams & Escudero 2016); "land" is half of that step on a log scale.
export const SCALE_PRESETS = {
  land: { f1: 1.128, f2: 1.100, f3: 1.057 },
  aim: { f1: 1.273, f2: 1.210, f3: 1.118 },
};

// Orientation only, for before any vowels are captured: adult women's means
// from Peterson & Barney 1952 (US English), so not anyone's accent in particular.
export const REFERENCE = {
  heed: { f1: 310, f2: 2790 },
  had: { f1: 860, f2: 2050 },
  hard: { f1: 850, f2: 1220 },
  whod: { f1: 370, f2: 950 },
};

const FORMANTS = ['f1', 'f2', 'f3'];
const FACTOR_RANGE = [1, 1.5];
const PLAUSIBLE = { f1: [150, 1500], f2: [500, 3500] };

const inRange = (v, [lo, hi]) => typeof v === 'number' && v >= lo && v <= hi;
const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : NaN);

export function parseScale(raw) {
  const src = isObject(raw) ? raw : {};
  return Object.fromEntries(FORMANTS.map((k) => [k, inRange(src[k], FACTOR_RANGE) ? src[k] : SCALE_PRESETS.land[k]]));
}

/** Captured vowels keyed by corner; anything unknown or implausible is dropped. */
export function parseVowels(raw) {
  const src = isObject(raw) ? raw : {};
  return Object.fromEntries(CORNERS
    .map(({ key }) => [key, src[key]])
    .filter(([, v]) => isObject(v) && inRange(v.f1, PLAUSIBLE.f1) && inRange(v.f2, PLAUSIBLE.f2))
    .map(([key, v]) => [key, { f1: v.f1, f2: v.f2, f3: num(v.f3), f0: num(v.f0) }]));
}

export const scaleVowel = (v, scale) => Object.fromEntries(FORMANTS.map((k) => [k, v[k] * scale[k]]));

/** [{ key, word, sound, own, target }] for the captured corners, in corner order. */
export const vowelTargets = (vowels, scale) => CORNERS
  .filter(({ key }) => vowels[key])
  .map((c) => ({ ...c, own: vowels[c.key], target: scaleVowel(vowels[c.key], scale) }));

/**
 * One vowel from the frames of a single utterance ("heed", or a held "ee"):
 * the median over the middle of the voiced part, because the first and last
 * stretches are the glide in from the consonant and out into the next one.
 */
export function captureVowel(frames, { trim = 0.2, minFrames = 5 } = {}) {
  const voiced = frames.filter((f) => f.voiced && f.f1 > 0 && f.f2 > 0).sort((a, b) => a.t - b.t);
  const cut = Math.floor(voiced.length * trim);
  const core = voiced.slice(cut, voiced.length - cut);
  if (core.length < minFrames) return null;
  const median = (k) => quantile(core.map((f) => f[k]), 0.5);
  return { f1: median('f1'), f2: median('f2'), f3: median('f3'), f0: median('f0') };
}

/**
 * Phonetics-chart axes on log frequency: F2 falls to the right, F1 grows downward.
 * Values outside the range clamp to the edge.
 */
export function plotAxes({ w, h, pad, f1 = [200, 1100], f2 = [700, 3300] }) {
  const frac = (v, [lo, hi]) => (Math.log(Math.min(hi, Math.max(lo, v))) - Math.log(lo)) / (Math.log(hi) - Math.log(lo));
  return {
    f1, f2,
    x: (hz) => pad + (1 - frac(hz, f2)) * (w - 2 * pad),
    y: (hz) => pad + frac(hz, f1) * (h - 2 * pad),
  };
}

// Ring half-widths: F2 is the lever being trained, so its ring is tight (half
// the land step); F1 moves with jaw and vowel height and gets more room.
export const RING = { f1: 1.1, f2: 1.05 };

/** Inside the target ring (an ellipse in log frequency). An approximate F1 isn't held against you. */
export function inRing(p, target, ring = RING) {
  const d = (k) => Math.log(p[k] / target[k]) / Math.log(ring[k]);
  return (p.approx ? 0 : d('f1') ** 2) + d('f2') ** 2 <= 1;
}
