// Shared test grid + measurement helpers (used by *.test.js and scripts/report.js).

import { synthVowel, VOWELS, mulberry32 } from './synth.js';
import { createAnalyzer, registry, defaultChoice } from '../src/analysis/index.js';
import * as pitch from '../src/analysis/pitch.js';

/** Formant implementations every formant test runs against. */
export const FORMANT_IMPLS = Object.keys(registry.formants);
export const DEFAULT_FORMANTS = defaultChoice.formants;

export const FRAME = 2048; // what the app uses at 48 kHz (~43 ms)
export const HOP = 1024;

export const median = (a) => {
  const s = a.filter(Number.isFinite).sort((x, y) => x - y);
  return s.length ? s[s.length >> 1] : NaN;
};
export const cents = (f, ref) => 1200 * Math.log2(f / ref);

/** Run fn over all full frames of x (skipping 50 ms at each edge). */
export function overFrames(x, fs, fn, frame = FRAME, hop = HOP) {
  const out = [];
  const edge = Math.round(0.05 * fs);
  for (let s = edge; s + frame <= x.length - edge; s += hop) out.push(fn(x.subarray(s, s + frame)));
  return out;
}

// --- Tolerances (stated up front; see README.md) ---------------------------
export const TOL = {
  f0Cents: 10,
  formantLow: (F) => Math.max(0.05 * F, 60),   // F0 <= 200 Hz
  formantHigh: (F) => Math.max(0.10 * F, 100), // 200 < F0 <= 300 Hz (LPC degrades)
  f1HighF0: (F) => Math.max(0.05 * F, 60),     // F1 alone at F0 180-300 Hz: the low-F0 band, not loosened
};

export const F0_GRID = [90, 100, 110, 120, 135, 150, 165, 180, 200, 220, 250, 275, 300];
export const FORMANT_F0 = {
  male: { low: [90, 100, 120, 150, 180, 200], high: [220, 250] },
  female: { low: [150, 165, 180, 200], high: [220, 250, 275, 300] },
};

/** F1-only grid at high F0, where LPC F1 locks onto a harmonic. */
export const F1_HIGH_F0 = { male: [180, 200, 220, 250], female: [180, 200, 220, 250, 275, 300] };
export const f1HighCases = () =>
  Object.entries(F1_HIGH_F0).flatMap(([sex, f0s]) =>
    Object.keys(VOWELS[sex]).flatMap((vowel) => f0s.map((f0) => ({ sex, vowel, f0 }))));

/** Median F0 over frames and worst per-frame error, in cents. */
export function measureF0({ f0, sex = 'female', vowel = 'had', fs = 48000, ...rest }) {
  const A = createAnalyzer({ sampleRate: fs });
  const x = synthVowel({ f0, formants: VOWELS[sex][vowel], fs, dur: 0.5, ...rest });
  const ests = overFrames(x, fs, (fr) => A.analyze(fr).f0);
  const errs = ests.map((e) => cents(e, f0));
  return {
    medianCents: cents(median(ests), f0),
    worstCents: Math.max(...errs.map((e) => (Number.isFinite(e) ? Math.abs(e) : Infinity))),
    voicedFrac: ests.filter(Number.isFinite).length / ests.length,
  };
}

/** Add white noise at `snr` dB (relative to the signal's mean power). Seeded. */
export function addNoise(x, snr, seed = 5) {
  const rnd = mulberry32(seed);
  let p = 0;
  for (const v of x) p += v * v;
  const a = Math.sqrt(((p / x.length) / 10 ** (snr / 10)) * 12); // uniform: var = a^2/12
  return x.map((v) => v + (rnd() - 0.5) * a);
}

/**
 * Median F1..F3 over frames vs truth, for formant implementation `impl`.
 * `snr` (dB) optionally adds white noise; the pass/fail tests are noise-free.
 */
export function measureFormants({ f0, sex, vowel, fs = 48000, impl = DEFAULT_FORMANTS, opts, snr, ...rest }) {
  const F = registry.formants[impl];
  const truth = VOWELS[sex][vowel].slice(0, 3).map((r) => r.F);
  let x = synthVowel({ f0, formants: VOWELS[sex][vowel], fs, dur: 0.6, ...rest });
  if (Number.isFinite(snr)) x = addNoise(x, snr);
  const frame = Math.round((FRAME * fs) / 48000);
  // Each frame gets the F0 the app would give it: pitchy on the same frame.
  const ests = overFrames(x, fs, (fr) => F.estimate(fr, fs, { f0: pitch.estimate(fr, fs).f0, ...opts }), frame);
  const got = [0, 1, 2].map((i) => median(ests.map((e) => (e ? [e.f1, e.f2, e.f3][i] : NaN))));
  const errHz = got.map((g, i) => g - truth[i]);
  return { truth, got, errHz, errPct: errHz.map((e, i) => (100 * e) / truth[i]) };
}

export function formantCases() {
  const out = [];
  for (const sex of ['male', 'female'])
    for (const vowel of Object.keys(VOWELS[sex]))
      for (const band of ['low', 'high'])
        for (const f0 of FORMANT_F0[sex][band]) out.push({ sex, vowel, f0, band });
  return out;
}
