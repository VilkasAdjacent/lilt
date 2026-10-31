// node --test test/
import test from 'node:test';
import assert from 'node:assert/strict';

import { synthVowel, VOWELS, mulberry32 } from './synth.js';
import {
  TOL, F0_GRID, measureF0, measureFormants, formantCases, f1HighCases, overFrames, median, FORMANT_IMPLS,
} from './cases.js';
import { createAnalyzer, defaultChoice, normalizeChoice } from '../src/analysis/index.js';
import * as lpc10 from '../src/analysis/formants-lpc10.js';
import * as dap from '../src/analysis/formants-dap.js';
import { lpcToResonances } from '../src/analysis/lpc.js';
import * as weight from '../src/analysis/weight.js';
import * as pitch from '../src/analysis/pitch.js';
import { dbfs } from '../src/analysis/dsp.js';

// ---------------------------------------------------------------- F0 -------
for (const fs of [48000, 44100]) {
  for (const f0 of F0_GRID) {
    test(`F0 ${f0} Hz @ ${fs} within ±${TOL.f0Cents} cents (clean)`, () => {
      for (const [sex, vowel] of [['male', 'hard'], ['female', 'heed'], ['female', 'whod']]) {
        const r = measureF0({ f0, sex, vowel, fs });
        assert.ok(r.voicedFrac > 0.95, `${sex} ${vowel}: voiced only ${r.voicedFrac}`);
        assert.ok(r.worstCents <= TOL.f0Cents, `${sex} ${vowel}: worst frame ${r.worstCents.toFixed(2)} c`);
      }
    });
  }
}

test('F0 with 1% jitter, 5% shimmer, breathiness 0.5: median within ±10 cents', () => {
  for (const f0 of [100, 150, 200, 250]) {
    const r = measureF0({ f0, jitter: 0.01, shimmer: 0.05, breathiness: 0.5, seed: 7 });
    assert.ok(Math.abs(r.medianCents) <= TOL.f0Cents, `${f0}: ${r.medianCents.toFixed(2)} c`);
    assert.ok(r.voicedFrac > 0.9, `${f0}: voiced ${r.voicedFrac}`);
  }
});

test('defaults: pitchy with clarity >= 0.8, lpc12 formants; old "lpc" setting maps to lpc12', () => {
  assert.equal(pitch.defaults.minClarity, 0.8);
  assert.equal(pitch.defaults.minF0, 60);
  assert.deepEqual(defaultChoice, { pitch: 'pitchy', formants: 'lpc12', weight: 'h1h2' });
  assert.equal(normalizeChoice({ formants: 'lpc' }).formants, 'lpc12');
  assert.equal(normalizeChoice({ formants: 'lpc10' }).formants, 'lpc10');
  assert.equal(normalizeChoice({ formants: 'nope' }).formants, 'lpc12');
});

test('silence and white noise are unvoiced', () => {
  const fs = 48000;
  const silent = new Float32Array(2048);
  assert.ok(Number.isNaN(pitch.estimate(silent, fs).f0));
  const rnd = mulberry32(3);
  const noise = Float32Array.from({ length: 48000 }, () => (rnd() - 0.5) * 0.4);
  const voiced = overFrames(noise, fs, (fr) => pitch.estimate(fr, fs).f0).filter(Number.isFinite);
  assert.ok(voiced.length === 0, `noise voiced in ${voiced.length} frames`);
});

// ---------------------------------------------------------- formants -------
// Every registered formant implementation runs through the same grid and the
// same fixed tolerances. Cases that miss are kept as `todo` (reported, not
// hidden, not counted as suite failures) so a better implementation shows up as
// "todo passing". See README.md for the numbers.
const KNOWN_FAIL = {
  // lpc10 (selectable, not default; the benchmarked Praat-equivalent LPC) misses on EVERY case of
  // this noise-free grid: the synthetic source has almost no energy at 4-5 kHz,
  // so 10 poles at 10 kHz spend a wide-bandwidth spare pole between F1 and F2
  // (e.g. male heed @ 120: poles 288, 912 (BW 2020), 2263, 2930 Hz). This is the
  // failure mode research/library_comparison.md documents for Praat Burg too
  // (noise-free F3 median error 40 %). With a noise floor most male cases pass;
  // see README.md.
  lpc10: new Set(formantCases().map((c) => `${c.sex}/${c.vowel}/${c.f0}`)),
  lpc12: new Set([
    // F1 low (290-380 Hz) with F0 >= 180: LPC F1 is pulled toward 2*F0.
    'male/heed/180', 'male/heed/200', 'male/whod/200',
    // High F0, sparse harmonics: a spurious pole between F2 and F3 is picked as F3.
    'female/hard/275',
  ]),
  // Same spurious pole between F1 and F2 as lpc12 (poles ~750, 1270, 1700 Hz vs 920 / 1500).
  dap: new Set(['female/hard/275']),
};
// F1 alone at F0 180-300 Hz under the low-F0 tolerance. Autocorrelation LPC
// (lpc10, lpc12) pulls a low F1 toward a harmonic; dap fits only the harmonics.
const LPC_F1_HIGH_MISS = [
  'male/heed/180', 'male/heed/200', 'male/heed/220', 'male/whod/200', 'male/whod/220', 'male/whod/250',
  'female/heed/220', 'female/heed/250', 'female/had/250', 'female/hard/275',
  'female/whod/220', 'female/whod/250', 'female/whod/275',
];
const KNOWN_F1_HIGH_MISS = {
  lpc10: new Set(LPC_F1_HIGH_MISS),
  lpc12: new Set(LPC_F1_HIGH_MISS),
  // Close vowels: dap reads F1 about +50 Hz high (the glottal source's H2 > H1 is
  // fitted as a higher F1). female hard 275: an extra pole between F1 and F2.
  dap: new Set(['female/heed/275', 'female/hard/275', 'female/whod/220', 'female/whod/300']),
};
const KNOWN_FAIL_441 = { lpc10: true, lpc12: false, dap: false };

for (const impl of FORMANT_IMPLS) {
  for (const c of formantCases()) {
    const key = `${c.sex}/${c.vowel}/${c.f0}`;
    const tol = c.band === 'low' ? TOL.formantLow : TOL.formantHigh;
    const label = c.band === 'low' ? '±max(5%,60Hz)' : '±max(10%,100Hz) [high F0]';
    test(`formants [${impl}] ${key} ${label}`, { todo: KNOWN_FAIL[impl]?.has(key) ? `known ${impl} miss` : false }, () => {
      const r = measureFormants({ ...c, impl });
      r.truth.forEach((F, i) => {
        assert.ok(Math.abs(r.errHz[i]) <= tol(F),
          `F${i + 1}: truth ${F}, got ${r.got[i].toFixed(0)} (${r.errPct[i].toFixed(1)}%)`);
      });
    });
  }

  for (const c of f1HighCases()) {
    const key = `${c.sex}/${c.vowel}/${c.f0}`;
    test(`F1 at high F0 [${impl}] ${key} ±max(5%,60Hz)`, { todo: KNOWN_F1_HIGH_MISS[impl]?.has(key) ? `known ${impl} miss` : false }, () => {
      const r = measureFormants({ ...c, impl });
      assert.ok(Math.abs(r.errHz[0]) <= TOL.f1HighF0(r.truth[0]),
        `F1: truth ${r.truth[0]}, got ${r.got[0].toFixed(0)} (${r.errPct[0].toFixed(1)}%)`);
    });
  }

  test(`formants [${impl}] also work at 44.1 kHz (female had @ 180, male hard @ 120)`, { todo: KNOWN_FAIL_441[impl] ? `known ${impl} miss` : false }, () => {
    for (const c of [{ sex: 'female', vowel: 'had', f0: 180 }, { sex: 'male', vowel: 'hard', f0: 120 }]) {
      const r = measureFormants({ ...c, fs: 44100, impl });
      r.truth.forEach((F, i) => assert.ok(Math.abs(r.errHz[i]) <= TOL.formantLow(F),
        `${c.sex} ${c.vowel} F${i + 1}: ${r.got[i].toFixed(0)} vs ${F}`));
    }
  });
}

// Port fidelity: the app's lpc10 must give the same F1-F3 as the benchmarked
// bench/lib/lpc.mjs (whole-signal resample to 10 kHz, then analyse) on the same
// frames. Differences come only from resampling each 2048-sample frame on its
// own; the Gaussian window is < 2e-4 at the frame edges.
const benchLpc = await import('../../bench/lib/lpc.mjs').catch(() => null);
const benchDsp = await import('../../bench/lib/dsp.mjs').catch(() => null);
test('lpc10 matches bench/lib/lpc.mjs within 2 Hz (F1-F3, clean vowels)', { skip: !benchLpc && 'bench/ not present' }, () => {
  const fs = 48000;
  const L = benchLpc.makeLpcFormants({ fs: 10000, order: 10 });
  let worst = 0;
  for (const [sex, vowel, f0] of [['male', 'heed', 120], ['male', 'hard', 150], ['female', 'had', 180], ['female', 'whod', 220]]) {
    const x = synthVowel({ f0, formants: VOWELS[sex][vowel], fs, dur: 0.6 });
    const y = benchDsp.resample(x, fs, 10000);
    for (const t of [0.2, 0.3, 0.4]) {
      const ref = L.analyse(y, t * 10000);
      const c = Math.round(t * fs);
      const got = lpc10.estimate(x.subarray(c - 1024, c + 1024), fs);
      [got.f1, got.f2, got.f3].forEach((g, i) => { worst = Math.max(worst, Math.abs(g - ref.F[i])); });
    }
  }
  assert.ok(worst <= 2, `worst |app - bench| = ${worst.toFixed(2)} Hz`);
});

// The DAP fixed point must recover an all-pole envelope exactly from its
// samples at sparse harmonics. Ordinary LPC on the same points (the iteration's
// starting point) is biased: that bias is what the iterations remove.
test('dapFit recovers an exact all-pole envelope from harmonics of 250 Hz (F1-F3 within 1 Hz)', () => {
  const fs = 12000, f0 = 250;
  const formants = VOWELS.female.heed;
  const resonatorPower = (f, { F, B }) => {
    const r = Math.exp((-Math.PI * B) / fs), th = (2 * Math.PI * F) / fs, w = (2 * Math.PI * f) / fs;
    return 1 / (Math.hypot(1 - r * Math.cos(th - w), r * Math.sin(th - w)) * Math.hypot(1 - r * Math.cos(th + w), r * Math.sin(th + w))) ** 2;
  };
  const freqs = Array.from({ length: 21 }, (_, i) => (i + 1) * f0);
  const w = Float64Array.from(freqs, (f) => (2 * Math.PI * f) / fs);
  const P = Float64Array.from(freqs, (f) => formants.reduce((p, fm) => p * resonatorPower(f, fm), 1));
  const firstThree = (a) => lpcToResonances(a, fs).filter((c) => c.bw < 500).slice(0, 3).map((c) => c.freq);
  const errs = (a) => firstThree(a).map((f, i) => Math.abs(f - formants[i].F));
  const dapErr = Math.max(...errs(dap.dapFit(w, P, 10, { maxIter: 200, tol: 1e-12 })));
  const lpcErr = Math.max(...errs(dap.dapFit(w, P, 10, { maxIter: 0 })));
  assert.ok(dapErr <= 1, `DAP worst ${dapErr.toFixed(2)} Hz`);
  assert.ok(lpcErr > 10, `LPC on the same harmonics should be biased, worst ${lpcErr.toFixed(2)} Hz`);
});

test('f1Approx is set only above F0 200 Hz', () => {
  const fs = 48000;
  for (const [f0, want] of [[150, false], [190, false], [220, true], [280, true]]) {
    const A = createAnalyzer({ sampleRate: fs });
    const x = synthVowel({ f0, formants: VOWELS.female.had, fs, dur: 0.3 });
    const flags = overFrames(x, fs, (fr) => A.analyze(fr)).filter((r) => r.voiced).map((r) => r.f1Approx);
    assert.ok(flags.length && flags.every((f) => f === want), `${f0} Hz: ${flags}`);
  }
});

// ------------------------------------------------------------ weight -------
const BREATH = [0, 0.25, 0.5, 0.75, 1];
const weightRuns = [
  { sex: 'male', vowel: 'hard', f0: 110 },
  { sex: 'male', vowel: 'had', f0: 150 },
  { sex: 'female', vowel: 'hard', f0: 200 },
  { sex: 'female', vowel: 'heed', f0: 220 },
];

function weightCurve({ sex, vowel, f0 }, key) {
  const fs = 48000;
  const A = createAnalyzer({ sampleRate: fs });
  return BREATH.map((b) => {
    const x = synthVowel({ f0, formants: VOWELS[sex][vowel], fs, breathiness: b, seed: 11 });
    return median(overFrames(x, fs, (fr) => A.analyze(fr)[key]));
  });
}

for (const run of weightRuns) {
  test(`H1-H2 increases monotonically with breathiness (${run.sex} ${run.vowel} @ ${run.f0})`, () => {
    const v = weightCurve(run, 'h1h2');
    for (let i = 1; i < v.length; i++)
      assert.ok(v[i] > v[i - 1], `not increasing: ${v.map((n) => n.toFixed(1)).join(' -> ')}`);
  });
  test(`weight score decreases monotonically with breathiness (${run.sex} ${run.vowel} @ ${run.f0})`, () => {
    const v = weightCurve(run, 'weight');
    for (let i = 1; i < v.length; i++)
      assert.ok(v[i] < v[i - 1], `not decreasing: ${v.map((n) => n.toFixed(2)).join(' -> ')}`);
  });
}

test('LTAS tilt over frames equals the per-frame tilt on a steady vowel (±0.5 dB)', () => {
  const fs = 48000;
  const A = createAnalyzer({ sampleRate: fs });
  const x = synthVowel({ f0: 180, formants: VOWELS.female.had, fs, dur: 0.6 });
  const res = overFrames(x, fs, (fr) => A.analyze(fr));
  const last = res[res.length - 1];
  assert.ok(Math.abs(last.ltas - median(res.map((r) => r.tilt))) < 0.5, `${last.ltas} vs ${median(res.map((r) => r.tilt))}`);
});

test('weight is null without a valid F0', () => {
  assert.equal(weight.estimate(new Float32Array(2048).fill(0.1), 48000, { f0: NaN }), null);
});

// ---------------------------------------------------------- loudness -------
test('dBFS: sine of amplitude A reads 20log10(A/sqrt2) within 0.05 dB', () => {
  for (const A of [1, 0.5, 0.1, 0.01]) {
    const x = Float32Array.from({ length: 4800 }, (_, i) => A * Math.sin((2 * Math.PI * 200 * i) / 48000));
    assert.ok(Math.abs(dbfs(x) - 20 * Math.log10(A / Math.SQRT2)) < 0.05);
  }
});

test('dBFS: doubling a vowel adds 6.02 dB', () => {
  const x = synthVowel({ f0: 150, formants: VOWELS.female.had, peak: 0.2 });
  const y = x.map((v) => v * 2);
  assert.ok(Math.abs(dbfs(y) - dbfs(x) - 6.0206) < 0.01);
});
