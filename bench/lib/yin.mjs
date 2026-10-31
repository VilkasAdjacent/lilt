// Roll-our-own YIN (de Cheveigne & Kawahara 2002), difference function computed via FFT
// cross-correlation (O(N log N)), cumulative-mean-normalised, absolute threshold, parabolic
// interpolation. Returns { f0, aperiodicity } (f0 = 0 when unvoiced).
import { fft, nextPow2 } from "./dsp.mjs";

export function makeYin({ fs, frameSize = 2048, fmin = 60, fmax = 800, threshold = 0.15, voicedMax = 0.3 }) {
  const tauMax = Math.min(Math.floor(fs / fmin), frameSize >> 1);
  const tauMin = Math.max(2, Math.floor(fs / fmax));
  const W = frameSize - tauMax; // integration window
  const n = nextPow2(frameSize + W);
  const ar = new Float64Array(n), ai = new Float64Array(n), br = new Float64Array(n), bi = new Float64Array(n);
  const d = new Float64Array(tauMax + 2), cum = new Float64Array(frameSize + 1);
  return function yin(x) {
    ar.fill(0); ai.fill(0); br.fill(0); bi.fill(0);
    for (let i = 0; i < W; i++) ar[i] = x[i];
    for (let i = 0; i < frameSize; i++) br[i] = x[i];
    fft(ar, ai); fft(br, bi);
    // conj(A) * B -> r(tau) = sum_j a[j] b[j+tau]
    for (let k = 0; k < n; k++) {
      const re = ar[k] * br[k] + ai[k] * bi[k], im = ar[k] * bi[k] - ai[k] * br[k];
      ar[k] = re; ai[k] = -im; // conj for inverse via forward FFT
    }
    fft(ar, ai); // ar[tau]/n = r(tau)
    cum[0] = 0;
    for (let i = 0; i < frameSize; i++) cum[i + 1] = cum[i] + x[i] * x[i];
    const e0 = cum[W];
    d[0] = 1;
    let run = 0;
    for (let tau = 1; tau <= tauMax; tau++) {
      const et = cum[tau + W] - cum[tau];
      const dt = Math.max(0, e0 + et - (2 * ar[tau]) / n);
      run += dt;
      d[tau] = run > 0 ? (dt * tau) / run : 1;
    }
    let tau = -1;
    for (let t = tauMin; t < tauMax; t++) {
      if (d[t] < threshold) { while (t + 1 < tauMax && d[t + 1] < d[t]) t++; tau = t; break; }
    }
    if (tau < 0) { // no dip under threshold: global minimum
      let best = Infinity;
      for (let t = tauMin; t < tauMax; t++) if (d[t] < best) { best = d[t]; tau = t; }
    }
    const ap = d[tau];
    let shift = 0;
    if (tau > 1 && tau < tauMax) {
      const a = d[tau - 1], b = d[tau], c = d[tau + 1], den = a - 2 * b + c;
      if (den > 0) shift = (0.5 * (a - c)) / den;
    }
    const f0 = fs / (tau + shift);
    return { f0: ap <= voicedMax ? f0 : 0, rawF0: f0, aperiodicity: ap };
  };
}
