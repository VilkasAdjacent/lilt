// Uniform wrappers around every pitch / formant / tilt implementation under test.
// Each per-frame pitch method: (frame Float32Array[FRAME] at 48 kHz) -> { f0, conf } (f0 = 0 means unvoiced).
import { createRequire } from "node:module";
import { PitchDetector } from "pitchy";
import Meyda from "meyda";
import aubioInit from "aubiojs";
import { makeYin } from "./yin.mjs";
import { makeLpcFormants } from "./lpc.mjs";
import { praatGaussian } from "./dsp.mjs";

const require = createRequire(import.meta.url);

export const FRAME = 2048; // 42.7 ms at 48 kHz: >= 2.5 periods of 60 Hz
export const FMIN = 60, FMAX = 800; // common search range (Praat truth uses 60-600)

// Voicing thresholds (a priori, from each library's docs/defaults, not tuned on this data):
export const THRESH = {
  pitchy: 0.9, // clarity (pitchy README example uses 0.9-ish; MPM paper k=0.9 for peak picking)
  aubio_yin: 0.8, // aubio confidence = 1 - CMNDF minimum; aubio default tolerance 0.15
  aubio_yinfast: 0.8,
  aubio_yinfft: 0, // aubiojs 0.2.1 getConfidence() returns 0 for yinfft in our tests -> energy gate only
  aubio_mcomb: 0, // no meaningful confidence
  aubio_specacf: 0.5,
  ess_yin: 0.8, // Essentia PitchYin confidence = 1 - CMNDF min
  ess_yinfft: 0.6, // Essentia PitchYinFFT confidence
  own_yin: 0.7, // our YIN: aperiodicity <= 0.3
};

export async function makePitchMethods(fs) {
  const m = {};
  const det = PitchDetector.forFloat32Array(FRAME);
  det.minVolumeDecibels = -100; // common energy gate is applied outside
  m.pitchy = (x) => { const [f, c] = det.findPitch(x, fs); return { f0: f, conf: c }; };

  const A = await aubioInit();
  for (const meth of ["yin", "yinfast", "yinfft", "mcomb", "specacf"]) {
    const p = new A.Pitch(meth, FRAME, FRAME, fs); // hop == buffer: each call analyses exactly this frame
    p.setSilence(-100);
    m["aubio_" + meth] = (x) => { const f = p.do(x); return { f0: f, conf: p.getConfidence() }; };
  }

  const ess = getEssentia();
  m.ess_yin = (x) => {
    const v = ess.arrayToVector(x);
    const r = ess.PitchYin(v, FRAME, true, FMAX, FMIN, fs, 0.15);
    v.delete();
    return { f0: r.pitch, conf: r.pitchConfidence };
  };
  m.ess_yinfft = (x) => {
    const v = ess.arrayToVector(x);
    const w = ess.Windowing(v, true, FRAME, "hann").frame;
    const s = ess.Spectrum(w, FRAME).spectrum;
    const r = ess.PitchYinFFT(s, FRAME, true, FMAX, FMIN, fs, 1);
    v.delete(); w.delete(); s.delete();
    return { f0: r.pitch, conf: r.pitchConfidence };
  };

  const yin = makeYin({ fs, frameSize: FRAME, fmin: FMIN, fmax: FMAX, threshold: 0.15, voicedMax: 1 });
  m.own_yin = (x) => { const r = yin(x); return { f0: r.rawF0, conf: 1 - r.aperiodicity }; };
  return m;
}

let _ess = null;
export function getEssentia() {
  if (!_ess) {
    const { EssentiaWASM, Essentia } = require("essentia.js");
    _ess = new Essentia(EssentiaWASM);
  }
  return _ess;
}

// Whole-signal (offline) Essentia pitch trackers. Return { times, f0 } (Hz, 0 = unvoiced).
export function essentiaOffline(x, fs, hop) {
  const ess = getEssentia();
  const out = {};
  const v = ess.arrayToVector(x);
  try {
    const r = ess.PitchYinProbabilistic(v, FRAME, hop, 0.1, "zero", false, fs);
    const f = Array.from(ess.vectorToArray(r.pitch));
    r.pitch.delete(); r.voicedProbabilities.delete();
    out.ess_pyin = f;
  } catch (e) { out.ess_pyin_error = String(e); }
  try {
    // PitchMelodia (monophonic): frameSize, guessUnvoiced=false, harmonicWeight, hopSize, magnitudeCompression,
    // magnitudeThreshold, maxFrequency, minDuration, minFrequency, numberHarmonics, peakDistributionThreshold,
    // peakFrameThreshold, pitchContinuity, referenceFrequency, sampleRate, timeContinuity
    const r = ess.PitchMelodia(v, 10, 3, FRAME, false, 0.8, hop, 1, 40, FMAX, 100, FMIN, 20, 0.9, 0.9, 27.5625, 55, fs, 100);
    out.ess_melodia = Array.from(ess.vectorToArray(r.pitch));
    r.pitch.delete(); r.pitchConfidence.delete();
  } catch (e) { out.ess_melodia_error = String(e); }
  v.delete();
  return out;
}

// Formant methods operate on the signal already resampled to fsLpc (= 2 x ceiling).
export function makeFormantMethods(fsLpc) {
  const own10 = makeLpcFormants({ fs: fsLpc, order: 10 });
  const own12 = makeLpcFormants({ fs: fsLpc, order: 12 });
  const own12bw = makeLpcFormants({ fs: fsLpc, order: 12, maxBw: 400 });
  const ess = getEssentia();
  const n = own10.n, w = praatGaussian(n), alpha = Math.exp((-2 * Math.PI * 50) / fsLpc);
  const seg = new Float32Array(n);
  const essLpc = (x, c) => {
    const s = Math.round(c) - (n >> 1);
    let prev = s - 1 >= 0 ? x[s - 1] : 0;
    for (let i = 0; i < n; i++) { const k = s + i, v = k >= 0 && k < x.length ? x[k] : 0; seg[i] = (v - alpha * prev) * w[i]; prev = v; }
    const v = ess.arrayToVector(seg);
    const r = ess.LPC(v, 10, fsLpc, "regular");
    const a = Float64Array.from(ess.vectorToArray(r.lpc));
    v.delete(); r.lpc.delete(); r.reflection.delete();
    return own10.fromCoeffs(a);
  };
  return {
    own_lpc10: (x, c) => own10.analyse(x, c),
    own_lpc12: (x, c) => own12.analyse(x, c),
    own_lpc12_bw400: (x, c) => own12bw.analyse(x, c),
    ess_lpc10: essLpc,
  };
}

// Meyda spectral features on a 2048-sample Hann frame (Meyda has no pitch or formant extractor).
export function makeMeyda(fs) {
  Meyda.bufferSize = FRAME;
  Meyda.sampleRate = fs;
  Meyda.windowingFunction = "hanning";
  return (x) => Meyda.extract(["spectralSlope", "spectralCentroid", "spectralRolloff", "spectralFlatness"], x);
}
