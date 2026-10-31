// F0 estimation, "pitchy" implementation (McLeod Pitch Method via pitchy 4.1).
//
// Interface shared by every pitch implementation:
//   estimate(frame: Float32Array, sampleRate: number, opts?) ->
//     { f0: number (Hz, NaN if unvoiced), clarity: number 0..1 }
//
// pitchy keeps preallocated buffers per input length, so detectors are cached.
//
// Subharmonic guard: pitchy searches every lag up to the frame length. With
// jitter at low F0 the 3rd/4th-period NSDF peak can beat the 1st by a hair
// and pitchy returns F0/3 or F0/4 (e.g. 33 Hz for a 100 Hz voice). When its
// answer is below minF0 we re-run the MPM peak-pick on pitchy's own NSDF,
// restricted to lags in [fs/maxF0, fs/minF0]. In-range answers are untouched.

import { PitchDetector } from '../../vendor/pitchy/index.js';
import { rms } from './dsp.js';

export const defaults = {
  minF0: 60,
  maxF0: 700,
  minClarity: 0.8,  // voicing gate on pitchy's clarity. research/library_comparison.md: 0.9 drops
                    // too many voiced frames on real speech; 0.8 keeps ~70 % of Praat's voiced
                    // frames with < 1 % gross errors.
  silenceRms: 3e-4, // ~ -70 dBFS
  k: 0.92,          // MPM key-maximum threshold. 0.9 or lower gives octave-up errors
                    // on /i/ when F1 ~ 2*F0 (see test/README.md)
};

const detectors = new Map();
function detectorFor(n, k) {
  const key = n + ':' + k;
  let d = detectors.get(key);
  if (!d) {
    d = PitchDetector.forFloat32Array(n);
    d.clarityThreshold = k;
    detectors.set(key, d);
  }
  return d;
}

/** MPM peak-pick on an NSDF buffer, restricted to [lo, hi] lags. */
function restrictedMpm(nsdf, lo, hi, k) {
  const keys = [];
  // Skip the initial positive lobe, then take the max of each positive lobe.
  let i = 1;
  while (i < nsdf.length && nsdf[i] > 0) i++;
  let best = -1, bestVal = -Infinity;
  for (; i < Math.min(nsdf.length - 1, hi + 2); i++) {
    if (nsdf[i] > 0) {
      if (nsdf[i] > bestVal) { bestVal = nsdf[i]; best = i; }
    } else if (best > 0) {
      if (best >= lo && best <= hi) keys.push(best);
      best = -1; bestVal = -Infinity;
    }
  }
  if (best >= lo && best <= hi) keys.push(best);
  if (!keys.length) return null;
  const nMax = Math.max(...keys.map((j) => nsdf[j]));
  const j = keys.find((x) => nsdf[x] >= k * nMax);
  // Parabolic interpolation.
  const a = nsdf[j - 1], b = nsdf[j], c = nsdf[j + 1];
  const den = a - 2 * b + c;
  const shift = den !== 0 ? (0.5 * (a - c)) / den : 0;
  return { lag: j + shift, clarity: Math.min(1, b - 0.25 * (a - c) * shift) };
}

export function estimate(frame, sampleRate, opts = {}) {
  const o = { ...defaults, ...opts };
  const x = frame instanceof Float32Array ? frame : Float32Array.from(frame);
  if (rms(x) < o.silenceRms) return { f0: NaN, clarity: 0 };
  const d = detectorFor(x.length, o.k);
  let [f0, clarity] = d.findPitch(x, sampleRate);
  if (f0 > 0 && f0 < o.minF0) {
    const r = restrictedMpm(d._nsdfBuffer, Math.floor(sampleRate / o.maxF0), Math.ceil(sampleRate / o.minF0), o.k);
    if (r) { f0 = sampleRate / r.lag; clarity = r.clarity; }
  }
  const voiced = clarity >= o.minClarity && f0 >= o.minF0 && f0 <= o.maxF0;
  return { f0: voiced ? f0 : NaN, clarity };
}

export default { name: 'pitchy', estimate };
