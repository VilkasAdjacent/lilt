// Formant estimation, "lpc10" implementation (the default).
//
// Port of the benchmarked bench/lib/lpc.mjs (see research/library_comparison.md):
// it reproduces Praat's To Formant (burg) F1-F3 on real recordings to a median
// 0.1 / 0.1 / 0.3 %.
//
// Pipeline: resample the frame to 2 x ceiling (10 kHz for the 5000 Hz ceiling)
// with a Kaiser-windowed sinc -> pre-emphasis from 50 Hz (Praat-style) ->
// Praat Gaussian window of 2 x windowLength (50 ms) centred on the frame ->
// autocorrelation -> Levinson-Durbin, 10 poles -> roots (Durand-Kerner +
// Newton polish) -> keep poles in (50 Hz, fs/2 - 50 Hz) -> first three.
//
// The app frame (2048 samples at 48 kHz, 42.7 ms) is shorter than the 50 ms
// Gaussian; the missing edges are zero, where the window weight is < 2e-4.
//
// Same interface as formants.js:
//   estimate(frame, sampleRate, opts?) -> { f1, f2, f3, bw: [b1, b2, b3], fs } | null

import { makeResampler, praatGaussian, rms } from './dsp.js';
import { autocorr, levinson, lpcToResonances } from './lpc.js';

export const defaults = {
  ceiling: 5000,       // Hz; LPC runs at 2 x ceiling
  order: 10,           // poles (Praat: 2 x 5 formants)
  windowLength: 0.025, // s; Praat "window length" (the Gaussian is twice this)
  preEmphFrom: 50,     // Hz
  minFreq: 50,         // Hz; pole frequency range is (minFreq, fs/2 - edgeMargin)
  edgeMargin: 50,
  maxBandwidth: Infinity, // no bandwidth filter, as benchmarked
  silenceRms: 1e-4,
};

export function estimate(frame, sampleRate, opts = {}) {
  const o = { ...defaults, ...opts };
  if (rms(frame) < o.silenceRms) return null;

  const fs = 2 * o.ceiling;
  const x = sampleRate === fs ? frame : makeResampler(sampleRate, fs)(frame);
  const n = Math.round(2 * o.windowLength * fs) | 1;
  const w = praatGaussian(n);
  const alpha = Math.exp((-2 * Math.PI * o.preEmphFrom) / fs);

  // Windowed, pre-emphasised segment centred on the frame centre (zero outside).
  const s = Math.round(x.length / 2) - (n >> 1);
  const seg = new Float64Array(n);
  let prev = s - 1 >= 0 && s - 1 < x.length ? x[s - 1] : 0;
  for (let i = 0; i < n; i++) {
    const k = s + i, v = k >= 0 && k < x.length ? x[k] : 0;
    seg[i] = (v - alpha * prev) * w[i];
    prev = v;
  }

  const r = autocorr(seg, o.order);
  if (!(r[0] > 0)) return null;
  r[0] *= 1 + 1e-9; // tiny white-noise correction for numerical safety
  const lp = levinson(r, o.order);
  if (!lp) return null;

  const cands = lpcToResonances(lp.a, fs, { polish: true }).filter(
    (c) => c.freq > o.minFreq && c.freq < fs / 2 - o.edgeMargin && c.bw < o.maxBandwidth,
  );
  const f = [NaN, NaN, NaN], bw = [NaN, NaN, NaN];
  for (let i = 0; i < 3 && i < cands.length; i++) {
    f[i] = cands[i].freq;
    bw[i] = cands[i].bw;
  }
  return { f1: f[0], f2: f[1], f3: f[2], bw, fs, order: o.order, candidates: cands };
}

export default { name: 'lpc10', label: 'LPC-10, Praat-style (default)', estimate };
