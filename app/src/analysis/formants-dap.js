// Formant estimation, "dap" implementation: discrete all-pole modelling
// (El-Jaroudi & Makhoul 1991) on the harmonic peaks at the known F0.
//
// Autocorrelation LPC fits the whole line spectrum of a voiced frame, so at
// high F0 a low F1 is pulled onto a harmonic. DAP instead measures the
// spectrum only at the harmonics k*F0 and fits an all-pole model to those
// points under the Itakura-Saito distance; between harmonics the model is
// free, so the resonance can sit where the harmonic amplitudes say it is.
//
// Pipeline: Hann-windowed zero-padded FFT -> harmonic peak powers and
// frequencies up to maxHarmonicHz -> pre-emphasis applied in the frequency
// domain -> discrete autocorrelation of the harmonics -> LPC as the start ->
// DAP fixed-point iterations -> roots (refit at fallbackOrder if a pole sits on
// the unit circle) -> narrow resonances -> first three.
// The model rate is fixed (modelRate), independent of the input sample rate.
//
// Same interface as formants.js; needs ctx.f0 (createAnalyzer passes it):
//   estimate(frame, sampleRate, { f0, ...opts }) -> { f1, f2, f3, bw, fs } | null

import { fft, hannWindow, nextPow2, rms } from './dsp.js';
import { levinson, lpcToResonances } from './lpc.js';

export const defaults = {
  modelRate: 12000,     // Hz; the all-pole model's sampling rate (as lpc12 at 48 kHz)
  order: 12,
  maxHarmonicHz: 5400,  // harmonics above this are not fitted (lpc12's decimation cut-off)
  preEmph: 0.97,
  maxIter: 40,
  tol: 1e-7,            // stop when no coefficient moves by more than this
  minBandwidth: 25,     // Hz; a pole narrower than this sits on the unit circle between harmonics,
                        // where the fit pays nothing for it (DAP's known failure mode)
  fallbackOrder: 10,
  maxBandwidth: 500,
  minFreq: 120,
  silenceRms: 1e-4,
};

const bufs = new Map();
function buffers(n) {
  let b = bufs.get(n);
  if (!b) { b = { re: new Float64Array(n), im: new Float64Array(n), pow: new Float64Array(n / 2 + 1) }; bufs.set(n, b); }
  return b;
}

/**
 * Harmonic peaks of a frame: { freq, power } per harmonic k*f0 <= maxHz.
 * Each is the largest bin within ±f0/3 of k*f0, refined by parabolic
 * interpolation on log power, so jitter in the harmonic positions is followed.
 */
export function harmonicPeaks(frame, sampleRate, f0, maxHz) {
  const nfft = nextPow2(frame.length) * 4;
  const { re, im, pow } = buffers(nfft);
  const w = hannWindow(frame.length, true);
  re.fill(0); im.fill(0);
  for (let i = 0; i < frame.length; i++) re[i] = frame[i] * w[i];
  fft(re, im);
  for (let k = 0; k < pow.length; k++) pow[k] = re[k] * re[k] + im[k] * im[k] + 1e-30;
  const binHz = sampleRate / nfft;
  const count = Math.floor(Math.min(maxHz, sampleRate / 2 - f0) / f0);
  return Array.from({ length: count }, (_, i) => {
    const centre = (i + 1) * f0;
    const lo = Math.max(1, Math.round((centre - f0 / 3) / binHz));
    const hi = Math.min(pow.length - 2, Math.round((centre + f0 / 3) / binHz));
    let best = lo;
    for (let k = lo + 1; k <= hi; k++) if (pow[k] > pow[best]) best = k;
    const [a, b, c] = [pow[best - 1], pow[best], pow[best + 1]].map(Math.log);
    const den = a - 2 * b + c;
    const shift = den < 0 ? Math.max(-0.5, Math.min(0.5, (0.5 * (a - c)) / den)) : 0;
    return { freq: (best + shift) * binHz, power: Math.exp(b - 0.25 * (a - c) * shift) };
  });
}

/** Cholesky factor of the symmetric positive-definite Toeplitz matrix R(|i-j|), i,j = 1..p. */
function choleskyToeplitz(r, p) {
  const L = Array.from({ length: p }, () => new Float64Array(p));
  for (let i = 0; i < p; i++) {
    for (let j = 0; j <= i; j++) {
      let s = r[Math.abs(i - j)];
      for (let k = 0; k < j; k++) s -= L[i][k] * L[j][k];
      if (i === j) {
        if (!(s > 0)) return null;
        L[i][i] = Math.sqrt(s);
      } else L[i][j] = s / L[j][j];
    }
  }
  return L;
}

function choleskySolve(L, b) {
  const p = b.length, y = new Float64Array(p), x = new Float64Array(p);
  for (let i = 0; i < p; i++) {
    let s = b[i];
    for (let k = 0; k < i; k++) s -= L[i][k] * y[k];
    y[i] = s / L[i][i];
  }
  for (let i = p - 1; i >= 0; i--) {
    let s = y[i];
    for (let k = i + 1; k < p; k++) s -= L[k][i] * x[k];
    x[i] = s / L[i][i];
  }
  return x;
}

/**
 * DAP fit: inverse filter a = [1, a1..ap] minimising the Itakura-Saito
 * distance between powers P_m at angular frequencies w_m and g/|A(w_m)|^2.
 * Stationarity in a_i gives sum_k a_k R(i-k) = g*h(i), i = 1..p, with
 * R(n) = mean P_m cos(n w_m), h(i) = mean Re(e^{j w_m i} / conj A(w_m)) and
 * g = mean P_m |A(w_m)|^2. With h = 0 (true when the harmonics are dense) that
 * is ordinary LPC, which is the starting point; the fixed point is iterated.
 */
export function dapFit(w, P, order, { maxIter = defaults.maxIter, tol = defaults.tol } = {}) {
  const N = w.length;
  // cos/sin(k w_m) for k = 0..order, row-major by k
  const cos = new Float64Array((order + 1) * N), sin = new Float64Array((order + 1) * N);
  for (let k = 0; k <= order; k++) for (let m = 0; m < N; m++) { cos[k * N + m] = Math.cos(k * w[m]); sin[k * N + m] = Math.sin(k * w[m]); }
  const r = Float64Array.from({ length: order + 1 }, (_, n) => P.reduce((s, p, m) => s + p * cos[n * N + m], 0) / N);
  r[0] *= 1 + 1e-9;
  const start = levinson(r, order);
  const L = start && choleskyToeplitz(r, order);
  if (!L) return null;
  let a = start.a;
  const Ar = new Float64Array(N), Ai = new Float64Array(N), rhs = new Float64Array(order);
  for (let iter = 0; iter < maxIter; iter++) {
    let g = 0;
    for (let m = 0; m < N; m++) {
      let re = 0, im = 0;
      for (let k = 0; k <= order; k++) { re += a[k] * cos[k * N + m]; im -= a[k] * sin[k * N + m]; }
      // keep A / |A|^2, since e^{jwi} / conj(A) = e^{jwi} * A / |A|^2
      const mag2 = re * re + im * im;
      g += P[m] * mag2;
      Ar[m] = re / mag2; Ai[m] = im / mag2;
    }
    g /= N;
    for (let i = 1; i <= order; i++) {
      let s = 0;
      for (let m = 0; m < N; m++) s += cos[i * N + m] * Ar[m] - sin[i * N + m] * Ai[m];
      rhs[i - 1] = (g * s) / N - r[i];
    }
    const next = new Float64Array(order + 1);
    next[0] = 1;
    next.set(choleskySolve(L, rhs), 1);
    const moved = next.reduce((mx, v, k) => Math.max(mx, Math.abs(v - a[k])), 0);
    a = next;
    if (moved < tol) break;
  }
  return a;
}

/** Resonances of a fit at `order`, or null; `degenerate` flags a pole on the unit circle. */
function fitResonances(w, P, order, o) {
  const a = dapFit(w, P, order, o);
  if (!a) return null;
  const inBand = lpcToResonances(a, o.modelRate).filter((c) => c.freq > o.minFreq && c.freq < o.modelRate / 2 - 100);
  return {
    order,
    degenerate: inBand.some((c) => c.bw < o.minBandwidth),
    cands: inBand.filter((c) => c.bw < o.maxBandwidth),
  };
}

export function estimate(frame, sampleRate, opts = {}) {
  const o = { ...defaults, ...opts };
  if (!(o.f0 > 0) || rms(frame) < o.silenceRms) return null;
  const fs = o.modelRate;
  const peaks = harmonicPeaks(frame, sampleRate, o.f0, Math.min(o.maxHarmonicHz, fs / 2 - o.f0 / 2));
  if (peaks.length <= o.order / 2) return null;
  const w = Float64Array.from(peaks, (p) => (2 * Math.PI * p.freq) / fs);
  const P = Float64Array.from(peaks, (p, m) => p.power * (1 - 2 * o.preEmph * Math.cos(w[m]) + o.preEmph * o.preEmph));

  const full = fitResonances(w, P, o.order, o);
  const fit = full?.degenerate && o.fallbackOrder ? fitResonances(w, P, o.fallbackOrder, o) ?? full : full;
  if (!fit) return null;
  const [f, bw] = [(c) => c.freq, (c) => c.bw].map((get) => [0, 1, 2].map((i) => (fit.cands[i] ? get(fit.cands[i]) : NaN)));
  return { f1: f[0], f2: f[1], f3: f[2], bw, fs, order: fit.order, candidates: fit.cands };
}

export default { name: 'dap', label: 'DAP, fits the harmonics only (experimental, for high F0)', estimate };
