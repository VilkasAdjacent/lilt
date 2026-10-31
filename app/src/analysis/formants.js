// Formant estimation by LPC root-solving ("lpc12" implementation; the
// original app formant tracker, kept as a selectable alternative. The default
// is lpc10 in formants-lpc10.js).
//
// Pipeline: decimate to ~10-12 kHz -> pre-emphasis -> Hamming window ->
// autocorrelation LPC (Levinson-Durbin, order ~fs/1000) -> roots of A(z)
// -> keep narrow-bandwidth resonances -> first three = F1..F3.
//
// Interface shared by every formant implementation:
//   estimate(frame: Float32Array, sampleRate: number, opts?) ->
//     { f1, f2, f3, bw: [b1, b2, b3], fs } | null
// Values are Hz; any formant that could not be found is NaN.

import { decimate, decimationFactor, preEmphasis, hamming, rms } from './dsp.js';
import { autocorr, levinson, lpcToResonances } from './lpc.js';

export const defaults = {
  minRate: 10000,     // decimate so that the LPC rate is >= this (48k -> 12k, 44.1k -> 11.025k)
  preEmph: 0.97,
  maxBandwidth: 500,  // Hz; wider roots are treated as spectral shaping, not formants
  minFreq: 120,       // Hz; reject near-DC roots (glottal / tilt poles)
  silenceRms: 1e-4,
  order: null,        // default round(fs/1000): 12 at 12 kHz (see test/README.md for why not 2 + fs/1000)
};

export function estimate(frame, sampleRate, opts = {}) {
  const o = { ...defaults, ...opts };
  if (rms(frame) < o.silenceRms) return null;

  const factor = decimationFactor(sampleRate, o.minRate);
  const fs = sampleRate / factor;
  const x = decimate(frame, factor);
  const y = preEmphasis(x, o.preEmph);
  const w = hamming(y.length);
  for (let i = 0; i < y.length; i++) y[i] *= w[i];

  const order = o.order ?? Math.round(fs / 1000);
  const r = autocorr(y, order);
  r[0] *= 1 + 1e-9; // tiny white-noise floor for numerical stability
  const lp = levinson(r, order);
  if (!lp) return null;

  const cands = lpcToResonances(lp.a, fs).filter(
    (c) => c.freq > o.minFreq && c.freq < fs / 2 - 100 && c.bw < o.maxBandwidth,
  );
  const f = [NaN, NaN, NaN], bw = [NaN, NaN, NaN];
  for (let i = 0; i < 3 && i < cands.length; i++) {
    f[i] = cands[i].freq;
    bw[i] = cands[i].bw;
  }
  return { f1: f[0], f2: f[1], f3: f[2], bw, fs, order, candidates: cands };
}

export default { name: 'lpc12', label: 'LPC-12, decimate + Hamming (previous)', estimate };
