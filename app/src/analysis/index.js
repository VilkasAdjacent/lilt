// Analysis front door. The UI only talks to this file.
//
// Each stage is a plug-in object { name, estimate(frame, sampleRate, ctx) }.
// To swap pitchy / the LPC for another library (Meyda, essentia.js, aubio-wasm,
// ...), write a module with the same shape and register it here, then pick it
// in Settings (or pass { pitch: 'name' } to createAnalyzer).
//
// Async/WASM implementations: do the async init before registering, then keep
// `estimate` synchronous so the per-frame loop stays simple.

import pitchy from './pitch.js';
import lpc10 from './formants-lpc10.js';
import lpc12 from './formants.js';
import h1h2, { tiltDb } from './weight.js';
import { dbfs } from './dsp.js';

export const registry = {
  pitch: { pitchy },
  formants: { lpc10, lpc12 },
  weight: { h1h2 },
};

/**
 * Above this F0 every LPC method (Praat included) tends to lock F1 onto a
 * harmonic (research/library_comparison.md, section 3), so F1 is flagged as
 * approximate (`f1Approx`) and the UI greys it out with a "≈".
 */
export const F1_APPROX_ABOVE_F0 = 200;

/** Old saved settings used names that no longer exist. */
const RENAMED = { formants: { lpc: 'lpc12' } };
export function normalizeChoice(choice = {}) {
  const out = { ...defaultChoice };
  for (const stage of Object.keys(defaultChoice)) {
    let name = choice[stage];
    if (name && RENAMED[stage] && RENAMED[stage][name]) name = RENAMED[stage][name];
    if (name && registry[stage][name]) out[stage] = name;
  }
  return out;
}

export function register(stage, impl) {
  if (!registry[stage]) throw new Error(`unknown stage ${stage}`);
  registry[stage][impl.name] = impl;
}

export const defaultChoice = { pitch: 'pitchy', formants: 'lpc12', weight: 'h1h2' };

/**
 * createAnalyzer({ sampleRate, pitch?, formants?, weight?, ltasFrames? })
 * returns { analyze(frame) -> Result, choice }
 *
 * Result = {
 *   dbfs,                    // RMS level, dB re full scale 1.0
 *   f0, clarity,             // Hz (NaN if unvoiced)
 *   f1, f2, f3,              // Hz (NaN if unvoiced / not found)
 *   f1Approx: boolean,       // F0 > F1_APPROX_ABOVE_F0: F1 is probably on a harmonic
 *   h1h2, h1h2c, tilt, alpha, weight,  // see weight.js (NaN if unvoiced)
 *   ltas,                    // dB, 1-4 kHz vs 50-1000 Hz over the last `ltasFrames`
 *                            // voiced frames (power-averaged = the benchmarked LTAS ratio)
 *   voiced: boolean
 * }
 */
export function createAnalyzer({ sampleRate, ltasFrames = 48, ...choice } = {}) {
  const c = normalizeChoice(choice);
  const P = registry.pitch[c.pitch];
  const F = registry.formants[c.formants];
  const W = registry.weight[c.weight];
  const ltasRing = [];

  function analyze(frame) {
    const out = {
      dbfs: dbfs(frame), f0: NaN, clarity: 0, f1: NaN, f2: NaN, f3: NaN, f1Approx: false,
      h1h2: NaN, h1h2c: NaN, tilt: NaN, alpha: NaN, weight: NaN, ltas: NaN, voiced: false,
    };
    const p = P.estimate(frame, sampleRate);
    out.f0 = p.f0;
    out.clarity = p.clarity;
    if (!Number.isFinite(p.f0)) return out;
    out.voiced = true;
    out.f1Approx = p.f0 > F1_APPROX_ABOVE_F0;
    const fm = F.estimate(frame, sampleRate, { f0: p.f0 });
    if (fm) { out.f1 = fm.f1; out.f2 = fm.f2; out.f3 = fm.f3; }
    const w = W.estimate(frame, sampleRate, { f0: p.f0, formants: fm });
    if (w) {
      out.h1h2 = w.h1h2; out.h1h2c = w.h1h2c; out.tilt = w.tilt; out.alpha = w.alpha; out.weight = w.weight;
      if (w.ltasLo > 0 && w.ltasHi > 0) {
        ltasRing.push([w.ltasLo, w.ltasHi]);
        if (ltasRing.length > ltasFrames) ltasRing.shift();
        let lo = 0, hi = 0;
        for (const [l, h] of ltasRing) { lo += l; hi += h; }
        out.ltas = tiltDb(lo, hi);
      }
    }
    return out;
  }
  return { analyze, choice: { pitch: P.name, formants: F.name, weight: W.name } };
}

export const hzToSemitones = (hz, ref = 440) => 12 * Math.log2(hz / ref);
export function hzToNote(hz) {
  if (!(hz > 0)) return '';
  const names = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
  const midi = Math.round(69 + 12 * Math.log2(hz / 440));
  return names[midi % 12] + (Math.floor(midi / 12) - 1);
}
