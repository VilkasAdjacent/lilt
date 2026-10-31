// Comparing recordings: the in-app counterpart of analysis/compare.py. Pure, Node-testable.
//
// Rows are saved-trace rows with three extra columns:
//   [t, f0|null, dbfs, weight|null, f1|null, f2|null, f3|null, h1h2c|null, ltas|null]
// so summarize() reads them as it reads a saved trace.

import { createAnalyzer, hzToSemitones, F1_APPROX_ABOVE_F0 } from './analysis/index.js';
import { FRAME, pushBlock } from './audio/frame.js';
import { quantile, summarize } from './summary.js';
import { UtteranceTracker } from './practice/feedback.js';

const HOP = 1024;
const COL = { t: 0, f0: 1, dbfs: 2, weight: 3, f1: 4, f2: 5, f3: 6, h1h2c: 7, ltas: 8 };
const num = (v) => (Number.isFinite(v) ? v : null);

/** Analyse a whole signal block by block, as the live path does. Lazy, so the UI can yield between rows. */
export function* analyzeSamples(samples, sampleRate, choice = {}) {
  const analyzer = createAnalyzer({ sampleRate, ...choice });
  const ring = new Float32Array(FRAME);
  for (let end = HOP; end <= samples.length; end += HOP) {
    pushBlock(ring, samples.subarray(end - HOP, end));
    if (end < FRAME) continue;
    const r = analyzer.analyze(ring);
    yield [(end - FRAME / 2) / sampleRate, num(r.f0), num(r.dbfs), num(r.weight), num(r.f1), num(r.f2), num(r.f3), num(r.h1h2c), num(r.ltas)];
  }
}

const median = (xs) => quantile(xs, 0.5);
const column = (rows, key) => rows.map((r) => r[COL[key]]);
const sampleSd = (xs) => {
  const m = xs.reduce((s, x) => s + x, 0) / xs.length;
  return xs.length > 1 ? Math.sqrt(xs.reduce((s, x) => s + (x - m) ** 2, 0) / (xs.length - 1)) : NaN;
};

/** Words of one sitting: voiced runs, with short dips (consonants) bridged. */
export function utterances(trace, { minSec = 0.15, gapSec = 0.3 } = {}) {
  const tracker = new UtteranceTracker({ minSec, gapSec });
  const frames = trace.map((r) => ({ t: r[0], voiced: r[1] > 0, f0: r[1], dbfs: r[2], weight: r[3], f1: r[4], f2: r[5], f3: r[6] }));
  const flush = { t: (trace.length ? trace[trace.length - 1][0] : 0) + gapSec + 1, voiced: false };
  return [...frames, flush].map((f) => tracker.push(f)).filter(Boolean);
}

/** Everything the comparison shows about one clip. bands/opts as for summarize(). */
export function profile(trace, bands = [], opts = {}) {
  const voiced = trace.filter((r) => r[1] > 0);
  const f0 = column(voiced, 'f0');
  const s = summarize(trace, bands, opts);
  const f0P5 = quantile(f0, 0.05), f0P95 = quantile(f0, 0.95);
  return {
    ...s,
    f0P5, f0P95,
    f0RangeSt: hzToSemitones(f0P95, f0P5),
    f0SdSt: sampleSd(f0.map((f) => hzToSemitones(f, 100))),
    f3Median: median(column(voiced, 'f3')),
    h1h2cMedian: median(column(voiced, 'h1h2c')),
    ltasMedian: median(column(voiced, 'ltas')),
    f1Approx: s.f0Median > F1_APPROX_ABOVE_F0,
    tokens: utterances(trace),
  };
}

export const CHANGE = {
  st: (a, b) => hzToSemitones(b, a),
  pct: (a, b) => (b / a - 1) * 100,
  diff: (a, b) => b - a,
  points: (a, b) => (b - a) * 100,
};

// `steady`: changes smaller than this are within everyday recording-to-recording wobble.
export const MEASURES = [
  { group: 'pitch', key: 'f0Median', label: 'typical pitch', unit: 'Hz', change: 'st', steady: 0.5 },
  { group: 'pitch', key: 'f0P5', label: 'low end', unit: 'Hz', change: 'st', steady: 0.5 },
  { group: 'pitch', key: 'f0P95', label: 'high end', unit: 'Hz', change: 'st', steady: 0.5 },
  { group: 'pitch', key: 'f0RangeSt', label: 'range', unit: 'st', change: 'diff', steady: 1 },
  { group: 'pitch', key: 'f0SdSt', label: 'pitch movement', unit: 'st', change: 'diff', steady: 0.3 },
  { group: 'pitch', key: 'inBandFrac', label: 'time in your bands', unit: '%', change: 'points', steady: 5 },
  { group: 'resonance', key: 'f1Median', label: 'F1', unit: 'Hz', change: 'pct', steady: 3 },
  { group: 'resonance', key: 'f2Median', label: 'F2', unit: 'Hz', change: 'pct', steady: 3 },
  { group: 'resonance', key: 'f3Median', label: 'F3', unit: 'Hz', change: 'pct', steady: 3 },
  { group: 'weight', key: 'weightMedian', label: 'typical weight', unit: '', change: 'diff', steady: 0.05 },
  { group: 'weight', key: 'loudLightFrac', label: 'loud moments that were light', unit: '%', change: 'points', steady: 5 },
  { group: 'weight', key: 'h1h2cMedian', label: 'H1–H2*', unit: 'dB', change: 'diff', steady: 1 },
  { group: 'weight', key: 'ltasMedian', label: 'tilt (1–4 kHz vs low)', unit: 'dB', change: 'diff', steady: 1 },
];

/** One row per measure: each clip's value and its change from the first clip (null where there's nothing to compare). */
export function compareProfiles(profiles) {
  const [ref] = profiles;
  return MEASURES.map((m) => ({
    ...m,
    values: profiles.map((p) => p[m.key]),
    changes: profiles.map((p, i) => {
      const value = CHANGE[m.change](ref[m.key], p[m.key]);
      return i > 0 && Number.isFinite(value) ? { value, steady: Math.abs(value) < m.steady } : null;
    }),
  }));
}

export const HVD_WORDS = ['heed', 'hid', 'head', 'had', 'hard', 'hud', 'hod', 'hoard', 'hood', "who'd",
  'heard', 'hay', 'high', 'hoy', 'how', 'hoe', 'here', 'hair'];
// The full recording-script list, then its 11 monophthongs.
const WORD_LISTS = [HVD_WORDS, HVD_WORDS.slice(0, 11)];
const IN_ORDER_MAX = 24;

const medianToken = (tokens) => Object.fromEntries(['f0', 'f1', 'f2', 'f3'].map((k) => [k, median(tokens.map((t) => t[k]))]));

/**
 * Pair the words of two clips. A reading of a word list (any number of times through) pairs by word,
 * each word the median over its repeats; otherwise clips with the same short word count pair in order.
 * A missed or extra word shifts every later label, so a mismatch comes out as 'none' or as odd pairs.
 */
export function matchTokens(a, b) {
  const list = WORD_LISTS.find((w) => a.length && b.length && a.length % w.length === 0 && b.length % w.length === 0);
  if (list) {
    const ofWord = (tokens, i) => medianToken(tokens.filter((_, j) => j % list.length === i));
    return { kind: 'words', rows: list.map((label, i) => ({ label, a: ofWord(a, i), b: ofWord(b, i) })) };
  }
  if (a.length && a.length === b.length && a.length <= IN_ORDER_MAX) {
    return { kind: 'order', rows: a.map((t, i) => ({ label: `${i + 1}`, a: t, b: b[i] })) };
  }
  return { kind: 'none', rows: [] };
}
