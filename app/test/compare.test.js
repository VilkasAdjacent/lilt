// Clip comparison: change maths, word matching, and whole-signal analysis against synthetic truth.
import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzeSamples, profile, compareProfiles, matchTokens, utterances, HVD_WORDS } from '../src/compare.js';
import { synthVowel, VOWELS } from './synth.js';

const silence = (sec, fs) => new Float32Array(Math.round(sec * fs));
const join = (parts) => {
  const out = new Float32Array(parts.reduce((n, p) => n + p.length, 0));
  parts.reduce((o, p) => { out.set(p, o); return o + p.length; }, 0);
  return out;
};
const fs = 48000;
const clip = (f0, sex, vowels) => join(vowels.flatMap((v, i) => [silence(0.4, fs), synthVowel({ f0, formants: VOWELS[sex][v], fs, dur: 0.6, seed: i + 1 })]).concat([silence(0.5, fs)]));
const row = (rows, key) => rows.find((r) => r.key === key);

test('compareProfiles: semitones for pitch, percent for formants, points for fractions, all against the first clip', () => {
  const a = { f0Median: 150, f1Median: 500, inBandFrac: 0.2, weightMedian: 0.5 };
  const b = { f0Median: 300, f1Median: 550, inBandFrac: 0.5, weightMedian: 0.48 };
  const c = { f0Median: 151, f1Median: NaN, inBandFrac: 0.2, weightMedian: 0.3 };
  const rows = compareProfiles([a, b, c]);
  const f0 = row(rows, 'f0Median'), f1 = row(rows, 'f1Median'), band = row(rows, 'inBandFrac'), w = row(rows, 'weightMedian');
  assert.equal(f0.changes[0], null);
  assert.ok(Math.abs(f0.changes[1].value - 12) < 1e-9);
  assert.ok(Math.abs(f0.changes[2].value - 12 * Math.log2(151 / 150)) < 1e-9);
  assert.equal(f0.changes[2].steady, true);
  assert.ok(Math.abs(f1.changes[1].value - 10) < 1e-9);
  assert.equal(f1.changes[2], null); // nothing to compare
  assert.ok(Math.abs(band.changes[1].value - 30) < 1e-9);
  assert.equal(w.changes[1].steady, true);
  assert.ok(Math.abs(w.changes[2].value + 0.2) < 1e-9);
});

test('matchTokens: hVd readings pair by word even with different repeat counts', () => {
  const tok = (i, rep) => ({ f0: 100 + rep, f1: 300 + i, f2: 2000 + i, f3: 3000 });
  const three = [0, 1, 2].flatMap((rep) => HVD_WORDS.map((_, i) => tok(i, rep)));
  const once = HVD_WORDS.map((_, i) => tok(i, 10));
  const m = matchTokens(three, once);
  assert.equal(m.kind, 'words');
  assert.deepEqual(m.rows.map((r) => r.label), HVD_WORDS);
  assert.equal(m.rows[4].a.f0, 101); // median over the three reps
  assert.equal(m.rows[4].a.f1, 304);
  assert.equal(m.rows[4].b.f0, 110);
  // The 11 monophthongs alone also count as a list.
  assert.deepEqual(matchTokens(once.slice(0, 11), once.slice(0, 11)).rows.map((r) => r.label), HVD_WORDS.slice(0, 11));
  // Same count of something else: matched in order.
  const four = once.slice(0, 4);
  assert.deepEqual(matchTokens(four, four), { kind: 'order', rows: four.map((t, i) => ({ label: `${i + 1}`, a: t, b: t })) });
  assert.equal(matchTokens(four, once.slice(0, 5)).kind, 'none');
  assert.equal(matchTokens([], []).kind, 'none');
});

test('analysis of whole clips: pitch and formant changes recovered from synthetic voices', () => {
  const vowels = ['had', 'heed', 'hard'];
  const lo = profile([...analyzeSamples(clip(120, 'male', vowels), fs)]);
  const hi = profile([...analyzeSamples(clip(180, 'female', vowels), fs)]);
  assert.equal(lo.tokens.length, 3);
  assert.equal(hi.tokens.length, 3);
  const rows = compareProfiles([lo, hi]);
  const st = row(rows, 'f0Median').changes[1].value;
  const stTruth = 12 * Math.log2(180 / 120);
  assert.ok(Math.abs(st - stTruth) < 0.1, `pitch change ${st.toFixed(3)} st, truth ${stTruth.toFixed(3)}`);
  // Per-word formant change against the synthesis truth. 5 % per formant ≈ the analysis tolerance, so ≤ ~10 points.
  const m = matchTokens(lo.tokens, hi.tokens);
  assert.equal(m.kind, 'order');
  const errs = m.rows.flatMap((r, i) => [1, 2, 3].map((k) => {
    const truth = (VOWELS.female[vowels[i]][k - 1].F / VOWELS.male[vowels[i]][k - 1].F - 1) * 100;
    const got = (r.b[`f${k}`] / r.a[`f${k}`] - 1) * 100;
    return { what: `${vowels[i]} F${k}`, err: got - truth };
  }));
  const worst = errs.reduce((w, e) => (Math.abs(e.err) > Math.abs(w.err) ? e : w));
  assert.ok(Math.abs(worst.err) <= 10, `worst ${worst.what}: ${worst.err.toFixed(1)} points`);
});

test('utterances: a short gap inside a word does not split it; a pause does', () => {
  const r = (t, f0) => [t, f0, -30, 0.4, 500, 1500];
  const at = (from, to, f0) => Array.from({ length: Math.round((to - from) / 0.02) }, (_, i) => r(from + i * 0.02, f0));
  const trace = [...at(0, 0.3, 150), ...at(0.3, 0.4, null), ...at(0.4, 0.7, 150), ...at(0.7, 1.4, null), ...at(1.4, 1.8, 200)];
  const u = utterances(trace);
  assert.equal(u.length, 2);
  assert.equal(u[1].f0, 200);
});
