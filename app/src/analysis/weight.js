// Vocal-weight proxy ("h1h2" implementation).
//
// H1-H2 and the tilt measure are ports of the benchmarked bench/lib/tilt.mjs
// (see research/library_comparison.md, section 4). On the Praat weight series,
// H1-H2 orders open quotient perfectly and the band-ratio tilt orders source
// tilt perfectly (Spearman 1.0 each).
//
// Interface shared by every weight implementation:
//   estimate(frame: Float32Array, sampleRate: number, { f0, formants? }) ->
//     { h1h2, h1h2c, tilt, alpha, weight, ltasLo, ltasHi } | null
//
//   h1h2  : H1-H2 in dB, uncorrected. Symmetric Hann window of max(3 periods,
//           20 ms) centred on the frame (capped at the frame length), zero-padded
//           FFT, harmonic level = max dB bin within +/-10 % of k*F0.
//   h1h2c : H1*-H2* with Iseli & Alwan (2004) formant correction, if F1/F2 given
//   tilt  : spectral tilt, L(1-4 kHz) - L(50-1000 Hz) in dB, mean power per bin
//           in each band of a periodic-Hann power spectrum (the frame-level
//           version of the benchmarked LTAS ratio; more negative = steeper
//           roll-off = typically lighter). Capped at 4 kHz on purpose: above it,
//           noise and phone codecs (HE-AAC SBR) contaminate the measure.
//   alpha : classic alpha ratio, summed energy 1-5 kHz vs 50 Hz-1 kHz, dB
//           (not benchmarked; informational only)
//   ltasLo, ltasHi : the mean band powers behind `tilt`, so callers can average
//           them over frames into a true LTAS ratio (createAnalyzer does this).
//   weight: 0 (light) .. 1 (heavy). A HEURISTIC blend of uncorrected H1-H2 and
//           tilt. Uncalibrated: thresholds are placeholders.
//
// Higher H1-H2 ~ breathier/lighter (more open quotient); lower or negative
// H1-H2 ~ pressed/heavier. Loudness changes all of these, which is the point
// of showing weight next to dBFS.

import { fft, hannWindow, nextPow2, rms } from './dsp.js';

export const defaults = {
  silenceRms: 3e-4,
  nfft: null,     // H1-H2 FFT size; null = auto, bins <= ~6 Hz (8192 at 44.1/48 kHz).
                  // 16384 at 48 kHz reproduces the Python reference bit for bit, at twice the cost.
  harmonicTol: 0.1,
  lowBand: [50, 1000], highBand: [1000, 4000],
  // Calibration for the 0..1 weight score (see clamp01 below). Placeholders.
  h1h2Light: 12, h1h2Heavy: -4,
  tiltLight: -30, tiltHeavy: -10,
  useCorrected: false,
};

const clamp01 = (v) => Math.min(1, Math.max(0, v));

/** dB gain of a single digital 2-pole resonator at f, normalised to 0 dB at DC. */
function resonatorDb(f, F, B, fs) {
  const r = Math.exp((-Math.PI * B) / fs);
  const th = (2 * Math.PI * F) / fs;
  const w = (2 * Math.PI * f) / fs;
  const mag = (x) => {
    const a = Math.hypot(1 - r * Math.cos(th - x), r * Math.sin(th - x));
    const b = Math.hypot(1 - r * Math.cos(th + x), r * Math.sin(th + x));
    return a * b;
  };
  return 20 * Math.log10(mag(0) / mag(w));
}

const bufs = new Map();
function buffers(n) {
  let b = bufs.get(n);
  if (!b) { b = { re: new Float64Array(n), im: new Float64Array(n) }; bufs.set(n, b); }
  return b;
}

/** H1 and H2 levels (dB) as in bench/lib/tilt.mjs makeH1H2. */
export function harmonicLevels(frame, fs, f0, nfft, tol = 0.1) {
  let n = Math.max(Math.round((3 / f0) * fs), Math.floor(0.02 * fs));
  n = Math.min(n, nfft, frame.length);
  const i0 = (frame.length >> 1) - (n >> 1);
  const w = hannWindow(n, true);
  const { re, im } = buffers(nfft);
  re.fill(0); im.fill(0);
  for (let i = 0; i < n; i++) re[i] = frame[i0 + i] * w[i];
  fft(re, im);
  const peak = (fc) => {
    const lo = Math.max(1, Math.ceil((fc * (1 - tol) * nfft) / fs));
    const hi = Math.min(nfft / 2, Math.floor((fc * (1 + tol) * nfft) / fs));
    let best = -Infinity;
    for (let k = lo; k <= hi; k++) { const v = 10 * Math.log10(re[k] * re[k] + im[k] * im[k] + 1e-24); if (v > best) best = v; }
    return best;
  };
  return { h1: peak(f0), h2: peak(2 * f0) };
}

/** Band powers of one frame as in bench/lib/tilt.mjs makeLtas (periodic Hann, pow-2 length). */
export function bandPowers(frame, fs, o = defaults) {
  let n = 1;
  while (n * 2 <= frame.length) n *= 2;
  const i0 = (frame.length >> 1) - (n >> 1);
  const w = hannWindow(n, false);
  const { re, im } = buffers(n);
  for (let i = 0; i < n; i++) { re[i] = frame[i0 + i] * w[i]; im[i] = 0; }
  fft(re, im);
  let lo = 0, cLo = 0, hi = 0, cHi = 0, aLo = 0, aHi = 0;
  for (let k = 0; k <= n / 2; k++) {
    const f = (k * fs) / n, p = re[k] * re[k] + im[k] * im[k];
    if (f >= o.lowBand[0] && f < o.lowBand[1]) { lo += p; cLo++; }
    if (f >= o.highBand[0] && f < o.highBand[1]) { hi += p; cHi++; }
    if (f >= 50 && f < 1000) aLo += p;
    else if (f >= 1000 && f < 5000) aHi += p;
  }
  return { lo: lo / Math.max(cLo, 1), hi: hi / Math.max(cHi, 1), alpha: 10 * Math.log10((aHi + 1e-30) / (aLo + 1e-30)) };
}

/** L(high) - L(low) in dB from mean band powers. */
export const tiltDb = (lo, hi) => 10 * Math.log10(hi + 1e-30) - 10 * Math.log10(lo + 1e-30);

/** The 0..1 score from H1-H2 and tilt (dB). */
export function weightScore(h1h2, tilt, o = defaults) {
  const lightH = clamp01((h1h2 - o.h1h2Heavy) / (o.h1h2Light - o.h1h2Heavy));
  const lightT = Number.isFinite(tilt) ? clamp01((tilt - o.tiltHeavy) / (o.tiltLight - o.tiltHeavy)) : lightH;
  return 1 - (0.6 * lightH + 0.4 * lightT);
}

export function estimate(frame, sampleRate, ctx = {}) {
  const o = { ...defaults, ...ctx.opts };
  const f0 = ctx.f0;
  if (!(f0 > 0) || rms(frame) < o.silenceRms) return null;

  const nfft = o.nfft ?? nextPow2(Math.ceil(sampleRate / 6));
  const { h1, h2 } = harmonicLevels(frame, sampleRate, f0, nfft, o.harmonicTol);
  const h1h2 = h1 - h2;

  let h1h2c = NaN;
  const fm = ctx.formants;
  if (fm && fm.f1 > 0 && fm.f2 > 0) {
    const fs = sampleRate;
    const bws = fm.bw || [];
    const corr = (f) =>
      resonatorDb(f, fm.f1, bws[0] > 0 ? bws[0] : 80, fs) +
      resonatorDb(f, fm.f2, bws[1] > 0 ? bws[1] : 100, fs);
    h1h2c = h1 - corr(f0) - (h2 - corr(2 * f0));
  }

  const bp = bandPowers(frame, sampleRate, o);
  const tilt = tiltDb(bp.lo, bp.hi);

  // Score uses UNcorrected H1-H2: the Iseli-Alwan correction is only as good as
  // the F1 estimate, and LPC F1 is biased toward a harmonic at high F0.
  const hh = o.useCorrected && Number.isFinite(h1h2c) ? h1h2c : h1h2;
  const weight = weightScore(hh, tilt, o);

  return { h1h2, h1h2c, tilt, alpha: bp.alpha, weight, ltasLo: bp.lo, ltasHi: bp.hi };
}

export default { name: 'h1h2', label: 'H1–H2 + 1–4 kHz tilt', estimate };
