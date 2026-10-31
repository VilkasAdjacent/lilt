// Creaky voice (vocal fry) detection, per analysis frame. Pure, DOM-free.
//
// Creak is sparse, irregular glottal pulses: each one rings the vocal tract and
// decays before the next arrives, so a very-short-term power contour shows
// isolated peaks with deep valleys between them (Ishi, Sakakibara, Ishiguro &
// Hagita 2008, "power peaks"). Modal voice at speaking F0 has peaks too, but
// they come every 3–12 ms. A frame reads as creaky when it has energy and
//   - its prominent pulses are spaced like F0 < maxPulseHz, or
//   - they are irregular (period-to-period jitter or alternating amplitudes,
//     i.e. period doubling), or
//   - pitchy found a periodicity below maxPulseHz.
// A 43 ms frame holds only 1–3 creak pulses, so the per-frame call is noisy by
// design; the utterance summary (practice/prosody.js) counts frames.

import { dbfs } from './dsp.js';

export const defaults = {
  minDb: -55,        // below this the frame is too quiet to judge
  bandHz: [100, 1500], // where glottal pulses ring through F1 (Ishi et al. 2008)
  winMs: 3,          // very-short-term power window
  stepMs: 1,
  minRiseDb: 9,      // peak above the valleys either side of it
  isolatedRiseDb: 15, // a lone pulse in an aperiodic frame: creak below ~45 Hz
  maxPulseHz: 70,    // pulse rate below this is creak, not low modal voice
  minPulseMs: 3,
  jitter: 0.25,      // mean |ΔT|/T between consecutive pulse intervals
  alternateDb: 4,    // mean |ΔdB| between consecutive pulse peaks
};

/** One-pole high-pass then two one-pole low-passes: a cheap glottal-pulse band. */
function bandPass(x, fs, [lo, hi]) {
  const a = Math.exp((-2 * Math.PI * lo) / fs);
  const b = Math.exp((-2 * Math.PI * hi) / fs);
  const y = new Float32Array(x.length);
  let px = 0, hp = 0, l1 = 0, l2 = 0;
  for (let i = 0; i < x.length; i++) {
    hp = a * (hp + x[i] - px);
    px = x[i];
    l1 = (1 - b) * hp + b * l1;
    l2 = (1 - b) * l1 + b * l2;
    y[i] = l2;
  }
  return y;
}

/** Power contour in dB, one value per step. */
function powerContour(x, fs, winMs, stepMs) {
  const win = Math.max(1, Math.round((winMs * fs) / 1000));
  const step = Math.max(1, Math.round((stepMs * fs) / 1000));
  const n = Math.max(0, Math.floor((x.length - win) / step) + 1);
  const out = new Float64Array(n);
  for (let k = 0; k < n; k++) {
    let e = 0;
    for (let i = k * step; i < k * step + win; i++) e += x[i] * x[i];
    out[k] = 10 * Math.log10(e / win + 1e-20);
  }
  return out;
}

/**
 * Peaks of the power contour that rise at least minRise dB above the lowest
 * point between them and the previous and next higher-or-equal neighbour
 * (topographic prominence, both sides). Returns [{ i, db, rise }].
 */
function prominentPeaks(p, minRise, minGap) {
  const isMax = (i) => p[i] > p[i - 1] && p[i] >= p[i + 1];
  const candidates = Array.from({ length: Math.max(0, p.length - 2) }, (_, k) => k + 1).filter(isMax);
  const valley = (i, dir) => {
    let lo = p[i];
    for (let j = i + dir; j >= 0 && j < p.length && p[j] <= p[i]; j += dir) lo = Math.min(lo, p[j]);
    return lo;
  };
  const kept = candidates
    .map((i) => ({ i, db: p[i], rise: p[i] - Math.max(valley(i, -1), valley(i, 1)) }))
    .filter((q) => q.rise >= minRise);
  // Keep the louder of two peaks closer than minGap (one pulse's ringing).
  return kept.reduce((acc, q) => {
    const last = acc[acc.length - 1];
    if (last && q.i - last.i < minGap) {
      if (q.db > last.db) acc[acc.length - 1] = q;
      return acc;
    }
    return [...acc, q];
  }, []);
}

const mean = (a) => a.reduce((s, v) => s + v, 0) / a.length;
const diffs = (a) => a.slice(1).map((v, k) => v - a[k]);

/**
 * estimate(frame, sampleRate, { f0, clarity }) ->
 *   { creak: boolean, pulses, pulseHz, jitter, alternateDb }
 * f0/clarity are pitchy's answer for the same frame (f0 NaN when unvoiced).
 */
export function estimate(frame, sampleRate, { f0 = NaN } = {}, opts = {}) {
  const o = { ...defaults, ...opts };
  const none = { creak: false, pulses: 0, pulseHz: NaN, jitter: NaN, alternateDb: NaN };
  if (dbfs(frame) < o.minDb) return none;
  // pitchy only reports f0 at clarity >= 0.8: a periodic frame at a modal rate.
  if (f0 >= o.maxPulseHz) return none;
  if (f0 > 0) return { ...none, creak: true };
  const p = powerContour(bandPass(frame, sampleRate, o.bandHz), sampleRate, o.winMs, o.stepMs);
  const peaks = prominentPeaks(p, o.minRiseDb, Math.round(o.minPulseMs / o.stepMs));
  if (peaks.length < 2) return { ...none, pulses: peaks.length, creak: peaks.length === 1 && peaks[0].rise >= o.isolatedRiseDb };
  const periods = diffs(peaks.map((q) => q.i * o.stepMs));
  const pulseHz = 1000 / mean(periods);
  const jitter = periods.length > 1 ? mean(diffs(periods).map(Math.abs)) / mean(periods) : 0;
  const alternateDb = mean(diffs(peaks.map((q) => q.db)).map(Math.abs));
  const sparse = pulseHz < o.maxPulseHz;
  // Irregularity only means creak when the pulses are already well separated;
  // fast pulses in an aperiodic frame are more likely noise or a transition.
  const irregular = pulseHz < 2 * o.maxPulseHz && (jitter > o.jitter || alternateDb > o.alternateDb);
  return { creak: sparse || irregular, pulses: peaks.length, pulseHz, jitter, alternateDb };
}

export default { name: 'pulses', estimate };
