// Roll-our-own spectral-tilt / "vocal weight" measures.
//  * H1-H2 (uncorrected): Hann window of max(3 periods, 20 ms) centred on the frame, zero-padded
//    FFT (nfft 16384 at 48 kHz = 2.9 Hz bins), harmonic peak = max dB bin within +/-10 % of k*F0.
//    Same definition as analysis/measures.py:harmonic_measures (H1H2) and bench/tilt_ref.py.
//  * LTAS band ratio L(1-4 kHz) - L(0.05-1 kHz) in dB from averaged Hann power spectra of
//    voiced frames (Welch). Capped at 4 kHz because the phone files are HE-AAC with SBR above.
import { fft, hann } from "./dsp.mjs";

export function makeH1H2({ fs, nfft = 16384 }) {
  const re = new Float64Array(nfft), im = new Float64Array(nfft);
  const winCache = new Map();
  const db = (k) => 10 * Math.log10(re[k] * re[k] + im[k] * im[k] + 1e-24);
  function peak(fc, tol = 0.1) {
    const lo = Math.max(1, Math.ceil((fc * (1 - tol) * nfft) / fs)), hi = Math.min(nfft / 2, Math.floor((fc * (1 + tol) * nfft) / fs));
    let best = -Infinity;
    for (let k = lo; k <= hi; k++) { const v = db(k); if (v > best) best = v; }
    return best;
  }
  return function h1h2(x, centre, f0) {
    if (!(f0 > 0)) return NaN;
    let n = Math.max(Math.round((3 / f0) * fs), Math.floor(0.02 * fs));
    n = Math.min(n, nfft);
    const i0 = Math.round(centre) - (n >> 1);
    if (i0 < 0 || i0 + n > x.length) return NaN;
    let w = winCache.get(n);
    if (!w) { w = hann(n); winCache.set(n, w); }
    re.fill(0); im.fill(0);
    for (let i = 0; i < n; i++) re[i] = x[i0 + i] * w[i];
    fft(re, im);
    return peak(f0) - peak(2 * f0);
  };
}

export function makeLtas({ fs, n = 2048 }) {
  const w = hann(n, false), re = new Float64Array(n), im = new Float64Array(n);
  const acc = new Float64Array(n / 2 + 1);
  let frames = 0;
  return {
    add(x, centre) {
      const i0 = Math.round(centre) - (n >> 1);
      if (i0 < 0 || i0 + n > x.length) return;
      for (let i = 0; i < n; i++) { re[i] = x[i0 + i] * w[i]; im[i] = 0; }
      fft(re, im);
      for (let k = 0; k <= n / 2; k++) acc[k] += re[k] * re[k] + im[k] * im[k];
      frames++;
    },
    bandDb(lo, hi) {
      let s = 0, c = 0;
      for (let k = 0; k <= n / 2; k++) { const f = (k * fs) / n; if (f >= lo && f < hi) { s += acc[k]; c++; } }
      return 10 * Math.log10(s / Math.max(c, 1) / Math.max(frames, 1) + 1e-30);
    },
    ratio() { return this.bandDb(1000, 4000) - this.bandDb(50, 1000); },
    get frames() { return frames; },
  };
}
