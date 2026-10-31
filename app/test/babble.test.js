// Procedural café babble: its rhythm, and what it does to the analysis when the
// mic hears it (phone speaker, no echo cancellation).
import test from 'node:test';
import assert from 'node:assert/strict';

import { BABBLE_RATE, TALKERS, mulberry32, syllablePlan, syllableEnvelope, renderTalker, babbleMix } from '../src/audio/babble-synth.js';
import { NoiseFloor, voiceDb } from '../src/practice/noise.js';
import { UtteranceTracker, scoreOverNoise } from '../src/practice/feedback.js';
import { createAnalyzer } from '../src/analysis/index.js';
import { makeResampler, dbfs } from '../src/analysis/dsp.js';
import { synthVowel, VOWELS } from './synth.js';
import { overFrames, median, cents, TOL } from './cases.js';

/**
 * Centre (Hz) of the strongest 1/3-octave band, 0.5–16 Hz, of an envelope's
 * modulation spectrum: the way speech modulation spectra are usually read
 * (Houtgast & Steeneken), where running speech peaks around 3–5 Hz.
 */
function modulationPeak(env, rate) {
  const fsEnv = 100, hop = Math.round(rate / fsEnv);
  const e = Float64Array.from({ length: Math.floor(env.length / hop) }, (_, i) => env[i * hop]);
  const mean = e.reduce((s, v) => s + v, 0) / e.length;
  const power = (f) => {
    const w = (2 * Math.PI * f) / fsEnv;
    const [re, im] = e.reduce(([r, m], v, i) => [r + (v - mean) * Math.cos(w * i), m + (v - mean) * Math.sin(w * i)], [0, 0]);
    return re * re + im * im;
  };
  const bands = Array.from({ length: 16 }, (_, k) => 0.5 * 2 ** (k / 3));
  const bandPower = (fc) => {
    const lo = fc * 2 ** (-1 / 6), hi = fc * 2 ** (1 / 6), step = 0.05;
    return Array.from({ length: Math.ceil((hi - lo) / step) }, (_, i) => power(lo + i * step)).reduce((s, p) => s + p, 0);
  };
  const powers = bands.map(bandPower);
  return bands[powers.indexOf(Math.max(...powers))];
}

test('babble envelope: syllable-rate modulation (3–5.5/s), silent at both ends so loops are seamless', () => {
  for (const seed of [1, 2, 3, 4]) {
    const plan = syllablePlan(12, mulberry32(seed));
    const n = 12 * BABBLE_RATE;
    const env = syllableEnvelope(plan, n);
    const peak = modulationPeak(env, BABBLE_RATE);
    assert.ok(peak >= 2.5 && peak <= 6, `seed ${seed}: modulation peak ${peak.toFixed(1)} Hz`);
    assert.equal(env[0], 0);
    assert.equal(env[n - 1], 0);
  }
});

test('voiceDb: takes the floor\'s power out of the mic level', () => {
  const sum = 10 * Math.log10(2 * 10 ** (-20 / 10)); // −20 dB voice + −20 dB floor = −16.99 dB
  assert.ok(Math.abs(voiceDb(sum, -20) - -20) < 1e-9);
  assert.equal(voiceDb(-30, NaN), -30);
  assert.equal(voiceDb(-30, -30), -Infinity);
});

test('scoreOverNoise: ignores the café, judges loudness above the floor, notices slipping back', () => {
  const ctx = { bands: [], loudDb: -28, lightMax: 0.45, floorDb: -30, noisy: true, quiet: { f0: 190, f2: 1900 } };
  const cur = { f0: 190, f2: 1900, dbfs: -26, weight: 0.3 };
  assert.equal(scoreOverNoise({ ...cur, dbfs: -28 }, ctx), null, 'no louder than the floor: the café, not you');
  // −26 dBFS at the mic reads "loud", but with a −30 dBFS floor taken out the voice is at −28.2.
  assert.equal(scoreOverNoise(cur, ctx).state, 'quiet');
  const loud = { ...cur, dbfs: -20 };
  assert.equal(scoreOverNoise(loud, ctx).state, 'yay');
  assert.equal(scoreOverNoise({ ...loud, f0: 160 }, ctx).state, 'info', 'pitch dropped 3 st');
  assert.equal(scoreOverNoise({ ...loud, f2: 1700 }, ctx).state, 'info', 'F2 10 % darker');
  assert.equal(scoreOverNoise({ ...loud, weight: 0.7 }, ctx).state, 'heavy');
});

// The café as a leaky speaker would put it into the mic: dry (no room reverb,
// which would only smear it further), at 48 kHz, scaled to `db` dBFS.
const FS = 48000;
const CAFE_DB = -40;
const scaleToDb = (x, db) => { const k = 10 ** ((db - dbfs(x)) / 20); return x.map((v) => v * k); };
function cafe(level, seconds) {
  const up = makeResampler(BABBLE_RATE, FS);
  const gains = babbleMix(level).talkers;
  const voices = Array.from({ length: TALKERS }, (_, i) => up(renderTalker({ seconds, seed: 101 + i })));
  return scaleToDb(Float32Array.from({ length: voices[0].length }, (_, j) => voices.reduce((s, v, i) => s + gains[i] * v[j], 0)), CAFE_DB);
}
const analyse = (x) => {
  const A = createAnalyzer({ sampleRate: FS });
  return overFrames(x, FS, (fr) => A.analyze(fr)).map((r, i) => ({ ...r, t: (i * 1024) / FS }));
};
const busy = cafe(1, 3);
const busyFrames = analyse(busy);
const mixWith = (voice) => voice.map((v, i) => v + busy[i]);
const vowel = (db) => scaleToDb(synthVowel({ f0: 190, formants: VOWELS.female.had, fs: FS, dur: 2.5, jitter: 0.005, seed: 3 }), db);

test('café alone, quiet and busy: at most 10 % of frames voiced, and never an attempt', (t) => {
  for (const [level, frames] of [[0, analyse(cafe(0, 9))], [1, analyse(cafe(1, 9))]]) {
    const voiced = frames.filter((r) => r.voiced).length / frames.length;
    const tracker = new UtteranceTracker();
    const attempts = frames.map((r) => tracker.push(r)).filter(Boolean);
    t.diagnostic(`level ${level}: ${(100 * voiced).toFixed(1)} % voiced, ${attempts.length} attempts`);
    assert.ok(voiced <= 0.1, `level ${level}: ${(100 * voiced).toFixed(1)} % voiced`);
    assert.equal(attempts.length, 0, `level ${level}: the café made ${attempts.length} attempts`);
  }
});

test('a voice 10 dB over the busy café: F0 and F2 within the clean tolerances', (t) => {
  const voice = vowel(CAFE_DB + 10);
  const res = analyse(mixWith(voice));
  const voiced = res.filter((r) => r.voiced);
  const f0Err = cents(median(voiced.map((r) => r.f0)), 190);
  const F2 = VOWELS.female.had[1].F, f2 = median(voiced.map((r) => r.f2));
  // Weight has no truth to hold it to, so it's reported, not asserted.
  const weight = (frames) => median(frames.filter((r) => r.voiced).map((r) => r.weight)).toFixed(2);
  t.diagnostic(`voiced ${(100 * voiced.length / res.length).toFixed(0)} %, F0 ${f0Err.toFixed(1)} c, F2 ${f2.toFixed(0)} Hz vs ${F2}, weight ${weight(analyse(voice))} alone → ${weight(res)} over the café`);
  assert.ok(voiced.length / res.length >= 0.9, `voiced ${(100 * voiced.length / res.length).toFixed(0)} %`);
  assert.ok(Math.abs(f0Err) <= TOL.f0Cents, `F0 median ${f0Err.toFixed(1)} c`);
  assert.ok(Math.abs(f2 - F2) <= TOL.formantLow(F2), `F2 ${f2.toFixed(0)} vs ${F2}`);
});

test('a voice only 3 dB over the café: its own level within 1 dB once the floor is taken out', (t) => {
  // The floor comes from café-only frames (the gaps between words); uncorrected, the mic reads +1.8 dB.
  const floor = new NoiseFloor();
  busyFrames.forEach((r) => floor.push(r));
  const voice = vowel(CAFE_DB + 3);
  const micDb = median(analyse(mixWith(voice)).map((r) => r.dbfs));
  const truth = median(overFrames(voice, FS, dbfs));
  const err = voiceDb(micDb, floor.db) - truth;
  t.diagnostic(`floor ${floor.db.toFixed(1)} dBFS (café ${CAFE_DB}); uncorrected ${(micDb - truth).toFixed(2)} dB, corrected ${err.toFixed(2)} dB`);
  assert.ok(Math.abs(err) <= 1, `corrected voice level ${err.toFixed(2)} dB off`);
});
