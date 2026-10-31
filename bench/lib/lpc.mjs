// Roll-our-own LPC formant tracker.
// Pipeline per frame: (signal already resampled to fsLpc = 2 * ceiling) -> pre-emphasis
// (Praat-style, from 50 Hz) -> Praat Gaussian window (2 x windowLength) -> autocorrelation
// -> Levinson-Durbin -> polynomial roots (Durand-Kerner + Newton polish) -> pole
// frequencies/bandwidths -> F1..F3 picking.
import { praatGaussian } from "./dsp.mjs";

export function levinson(r, p) {
  const a = new Float64Array(p + 1), tmp = new Float64Array(p + 1);
  a[0] = 1;
  let e = r[0];
  if (e <= 0) return { a, e: 0 };
  for (let i = 1; i <= p; i++) {
    let acc = r[i];
    for (let j = 1; j < i; j++) acc += a[j] * r[i - j];
    const k = -acc / e;
    tmp.set(a);
    for (let j = 1; j < i; j++) a[j] = tmp[j] + k * tmp[i - j];
    a[i] = k;
    e *= 1 - k * k;
    if (e <= 0) break;
  }
  return { a, e };
}

// Roots of z^p + a1 z^(p-1) + ... + ap  (monic, real coefficients). Returns {re, im} arrays.
export function polyRoots(a) {
  const p = a.length - 1;
  const re = new Float64Array(p), im = new Float64Array(p);
  // initial guesses on a circle of radius 0.9, rotated off the real axis
  for (let i = 0; i < p; i++) { const th = (2 * Math.PI * i) / p + 0.4; re[i] = 0.9 * Math.cos(th); im[i] = 0.9 * Math.sin(th); }
  const evalP = (zr, zi) => { // Horner
    let pr = 1, pi = 0;
    for (let k = 1; k <= p; k++) { const nr = pr * zr - pi * zi + a[k], ni = pr * zi + pi * zr; pr = nr; pi = ni; }
    return [pr, pi];
  };
  for (let iter = 0; iter < 500; iter++) {
    let maxStep = 0;
    for (let i = 0; i < p; i++) {
      const [pr, pi] = evalP(re[i], im[i]);
      let dr = 1, di = 0;
      for (let j = 0; j < p; j++) {
        if (j === i) continue;
        const xr = re[i] - re[j], xi = im[i] - im[j];
        const nr = dr * xr - di * xi, ni = dr * xi + di * xr; dr = nr; di = ni;
      }
      const den = dr * dr + di * di || 1e-300;
      const sr = (pr * dr + pi * di) / den, si = (pi * dr - pr * di) / den;
      re[i] -= sr; im[i] -= si;
      maxStep = Math.max(maxStep, Math.abs(sr) + Math.abs(si));
    }
    if (maxStep < 1e-12) break;
  }
  // Newton polish
  for (let i = 0; i < p; i++) {
    for (let it = 0; it < 3; it++) {
      let pr = 1, pi = 0, qr = 0, qi = 0; // p(z) and p'(z)
      for (let k = 1; k <= p; k++) {
        const nqr = qr * re[i] - qi * im[i] + pr, nqi = qr * im[i] + qi * re[i] + pi; qr = nqr; qi = nqi;
        const npr = pr * re[i] - pi * im[i] + a[k], npi = pr * im[i] + pi * re[i]; pr = npr; pi = npi;
      }
      const den = qr * qr + qi * qi;
      if (!(den > 0)) break;
      re[i] -= (pr * qr + pi * qi) / den; im[i] -= (pi * qr - pr * qi) / den;
    }
  }
  return { re, im };
}

export function polesToFormants(a, fs, { fmin = 50, fmaxMargin = 50 } = {}) {
  const { re, im } = polyRoots(a);
  const out = [];
  for (let i = 0; i < re.length; i++) {
    if (im[i] <= 0) continue;
    const f = (Math.atan2(im[i], re[i]) * fs) / (2 * Math.PI);
    const r = Math.hypot(re[i], im[i]);
    const bw = (-Math.log(r) * fs) / Math.PI;
    if (f > fmin && f < fs / 2 - fmaxMargin) out.push({ f, bw });
  }
  out.sort((x, y) => x.f - y.f);
  return out;
}

export function makeLpcFormants({ fs, windowLength = 0.025, order = 10, preEmphFrom = 50, maxBw = Infinity }) {
  const n = Math.round(2 * windowLength * fs) | 1; // Praat: actual Gaussian window is twice "window length"
  const w = praatGaussian(n);
  const alpha = Math.exp((-2 * Math.PI * preEmphFrom) / fs);
  const seg = new Float64Array(n), r = new Float64Array(order + 1);
  return {
    n,
    // x: signal at fs; centre: sample index
    analyse(x, centre) {
      const s = Math.round(centre) - (n >> 1);
      let prev = s - 1 >= 0 && s - 1 < x.length ? x[s - 1] : 0;
      for (let i = 0; i < n; i++) {
        const k = s + i, v = k >= 0 && k < x.length ? x[k] : 0;
        seg[i] = (v - alpha * prev) * w[i];
        prev = v;
      }
      for (let lag = 0; lag <= order; lag++) {
        let acc = 0;
        for (let i = lag; i < n; i++) acc += seg[i] * seg[i - lag];
        r[lag] = acc;
      }
      if (r[0] <= 0) return null;
      r[0] *= 1 + 1e-9; // tiny white-noise correction for numerical safety
      const { a } = levinson(r, order);
      return this.fromCoeffs(a);
    },
    fromCoeffs(a) {
      const poles = polesToFormants(a, fs);
      const picked = poles.filter((p) => p.bw < maxBw).slice(0, 3);
      return { F: picked.map((p) => p.f), B: picked.map((p) => p.bw), poles };
    },
  };
}
