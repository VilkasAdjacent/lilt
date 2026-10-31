// Autocorrelation-method LPC + polynomial root finding. Pure functions.

/** Biased autocorrelation r[0..maxLag]. */
export function autocorr(x, maxLag) {
  const r = new Float64Array(maxLag + 1);
  const n = x.length;
  for (let lag = 0; lag <= maxLag; lag++) {
    let s = 0;
    for (let i = lag; i < n; i++) s += x[i] * x[i - lag];
    r[lag] = s;
  }
  return r;
}

/**
 * Levinson-Durbin recursion.
 * Returns { a, err } where a = [1, a1, ..., ap] is the inverse filter
 * A(z) = 1 + a1 z^-1 + ... + ap z^-p, or null if r[0] is ~0.
 */
export function levinson(r, p) {
  if (!(r[0] > 1e-12)) return null;
  let a = new Float64Array(p + 1);
  a[0] = 1;
  let err = r[0];
  for (let i = 1; i <= p; i++) {
    let acc = r[i];
    for (let j = 1; j < i; j++) acc += a[j] * r[i - j];
    const k = -acc / err;
    const next = Float64Array.from(a);
    for (let j = 1; j < i; j++) next[j] = a[j] + k * a[i - j];
    next[i] = k;
    a = next;
    err *= 1 - k * k;
    if (err <= 0) break;
  }
  return { a, err };
}

/**
 * All complex roots of the monic polynomial z^p + c1 z^(p-1) + ... + cp,
 * given coefficients [1, c1, ..., cp], via Durand-Kerner (Weierstrass)
 * iteration. Returns arrays { re, im }.
 */
export function polyRoots(coeffs, maxIter = 500, tol = 1e-12) {
  const p = coeffs.length - 1;
  const re = new Float64Array(p), im = new Float64Array(p);
  // Initial guesses on a circle of radius ~0.9 with an irrational angle offset.
  for (let k = 0; k < p; k++) {
    const ang = (2 * Math.PI * k) / p + 0.4;
    re[k] = 0.9 * Math.cos(ang);
    im[k] = 0.9 * Math.sin(ang);
  }
  for (let iter = 0; iter < maxIter; iter++) {
    let maxDelta = 0;
    for (let k = 0; k < p; k++) {
      // Evaluate polynomial at z_k (Horner).
      let vr = 1, vi = 0;
      const zr = re[k], zi = im[k];
      for (let j = 1; j <= p; j++) {
        const tr = vr * zr - vi * zi + coeffs[j];
        vi = vr * zi + vi * zr;
        vr = tr;
      }
      // Denominator: prod (z_k - z_j).
      let dr = 1, di = 0;
      for (let j = 0; j < p; j++) {
        if (j === k) continue;
        const er = zr - re[j], ei = zi - im[j];
        const tr = dr * er - di * ei;
        di = dr * ei + di * er;
        dr = tr;
      }
      const den = dr * dr + di * di || 1e-30;
      const qr = (vr * dr + vi * di) / den;
      const qi = (vi * dr - vr * di) / den;
      re[k] -= qr;
      im[k] -= qi;
      const d = Math.hypot(qr, qi);
      if (d > maxDelta) maxDelta = d;
    }
    if (maxDelta < tol) break;
  }
  return { re, im };
}

/**
 * A few Newton steps on each root, in place (as in bench/lib/lpc.mjs).
 */
export function polishRoots(coeffs, re, im, iters = 3) {
  const p = coeffs.length - 1;
  for (let i = 0; i < re.length; i++) {
    for (let it = 0; it < iters; it++) {
      let pr = 1, pi = 0, qr = 0, qi = 0; // p(z) and p'(z)
      for (let k = 1; k <= p; k++) {
        const nqr = qr * re[i] - qi * im[i] + pr, nqi = qr * im[i] + qi * re[i] + pi; qr = nqr; qi = nqi;
        const npr = pr * re[i] - pi * im[i] + coeffs[k], npi = pr * im[i] + pi * re[i]; pr = npr; pi = npi;
      }
      const den = qr * qr + qi * qi;
      if (!(den > 0)) break;
      re[i] -= (pr * qr + pi * qi) / den; im[i] -= (pi * qr - pr * qi) / den;
    }
  }
  return { re, im };
}

/**
 * Convert LPC inverse-filter coefficients to resonance candidates.
 * Returns [{ freq, bw }] sorted by frequency (upper half-plane roots only).
 * { polish: true } adds Newton polishing (used by the lpc10 implementation).
 */
export function lpcToResonances(a, fs, { polish = false } = {}) {
  const { re, im } = polyRoots(a);
  if (polish) polishRoots(a, re, im);
  const out = [];
  for (let k = 0; k < re.length; k++) {
    if (im[k] <= 1e-9) continue;
    const mag = Math.hypot(re[k], im[k]);
    const freq = (Math.atan2(im[k], re[k]) * fs) / (2 * Math.PI);
    const bw = (-Math.log(Math.max(mag, 1e-9)) * fs) / Math.PI;
    out.push({ freq, bw });
  }
  out.sort((x, y) => x.freq - y.freq);
  return out;
}
