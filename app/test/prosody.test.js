// Creak detection against synthetic truth (frame and utterance level), and the
// phrase-shape maths. Numbers in README.md.
import test from 'node:test';
import assert from 'node:assert/strict';
import { synthVowel, VOWELS, mulberry32 } from './synth.js';
import { overFrames, FRAME, HOP } from './cases.js';
import { createAnalyzer } from '../src/analysis/index.js';
import * as pitch from '../src/analysis/pitch.js';
import * as creak from '../src/analysis/creak.js';
import { UtteranceTracker } from '../src/practice/feedback.js';
import { phraseShape, sessionCare, creakRuns } from '../src/practice/prosody.js';

const fs = 48000;
const creakRate = (x) => {
  const r = overFrames(x, fs, (fr) => creak.estimate(fr, fs, pitch.estimate(fr, fs)).creak);
  return r.filter(Boolean).length / r.length;
};
const addNoise = (x, snrDb, seed) => {
  const rnd = mulberry32(seed);
  const power = x.reduce((s, v) => s + v * v, 0) / x.length;
  const amp = Math.sqrt(12 * power) * 10 ** (-snrDb / 20);
  return x.map((v) => v + (rnd() - 0.5) * amp);
};
const creaky = ({ f0, sex = 'female', vowel = 'hard', seed = 1, dur = 1, peak = 0.5 }) => synthVowel({
  f0, formants: VOWELS[sex][vowel], fs, dur, jitter: 0.2, shimmer: 0.3, openQuotient: 0.3, seed, peak,
});
const doubled = ({ f0, sex = 'male', vowel = 'hard' }) => synthVowel({
  f0, formants: VOWELS[sex][vowel], fs, dur: 1, jitter: 0.03, shimmer: 0.1, openQuotient: 0.35, alternate: 0.5, seed: 4,
});
const modal = ({ f0, sex, vowel, breathiness = 0, seed = 3, dur = 1, peak = 0.5 }) => synthVowel({
  f0, formants: VOWELS[sex][vowel], fs, dur, jitter: 0.01, shimmer: 0.05, breathiness, seed, peak,
});

test('creak frames: hit rate >= 50 % in every creaky condition, >= 75 % on average', () => {
  const conds = [
    ...[25, 35, 50, 65].flatMap((f0) => ['male', 'female'].flatMap((sex) => ['heed', 'hard'].map((vowel) => [`fry ${sex} ${vowel} ${f0}`, creaky({ f0, sex, vowel, seed: 11 })]))),
    ...[80, 110, 150].flatMap((f0) => ['male', 'female'].map((sex) => [`doubled ${sex} ${f0}`, doubled({ f0, sex })])),
    ...[35, 50].map((f0) => [`fry ${f0} + noise 20 dB`, addNoise(creaky({ f0, seed: 5 }), 20, 9)]),
  ];
  const rates = conds.map(([label, x]) => [label, creakRate(x)]);
  for (const [label, r] of rates) assert.ok(r >= 0.5, `${label}: hit ${(r * 100).toFixed(0)} %`);
  const avg = rates.reduce((s, [, r]) => s + r, 0) / rates.length;
  assert.ok(avg >= 0.75, `mean hit ${(avg * 100).toFixed(1)} %`);
});

test('creak frames: false alarms <= 2 % over modal voice, none above 10 % in any condition', () => {
  const conds = [
    ...[75, 85, 100, 120, 150].flatMap((f0) => ['heed', 'hard', 'whod'].flatMap((vowel) => [0, 0.5, 1].map((b) => [`male ${vowel} ${f0} b${b}`, modal({ f0, sex: 'male', vowel, breathiness: b, seed: f0 + 7 })]))),
    ...[150, 180, 220, 280].flatMap((f0) => ['heed', 'hard', 'whod'].flatMap((vowel) => [0, 0.5, 1].map((b) => [`female ${vowel} ${f0} b${b}`, modal({ f0, sex: 'female', vowel, breathiness: b, seed: f0 + 7 })]))),
    ...[80, 100, 120].map((f0) => [`male hard ${f0} + noise 10 dB`, addNoise(modal({ f0, sex: 'male', vowel: 'hard' }), 10, 2)]),
  ];
  const rates = conds.map(([label, x]) => [label, creakRate(x)]);
  for (const [label, r] of rates) assert.ok(r <= 0.1, `${label}: false alarm ${(r * 100).toFixed(0)} %`);
  const avg = rates.reduce((s, [, r]) => s + r, 0) / rates.length;
  assert.ok(avg <= 0.02, `mean false alarm ${(avg * 100).toFixed(2)} %`);
});

/** Run the real analyser over a signal the way the app does, then segment it. */
function utterances(x) {
  const a = createAnalyzer({ sampleRate: fs });
  const tracker = new UtteranceTracker();
  const frames = Array.from({ length: Math.floor((x.length - FRAME) / HOP) + 1 }, (_, k) => ({
    ...a.analyze(x.subarray(k * HOP, k * HOP + FRAME)), t: (k * HOP + FRAME) / fs,
  }));
  return frames.map((f) => tracker.push(f)).filter(Boolean);
}
const join = (...parts) => {
  const out = new Float32Array(parts.reduce((s, p) => s + p.length, 0));
  parts.reduce((at, p) => { out.set(p, at); return at + p.length; }, 0);
  return out;
};
const silence = (sec) => new Float32Array(Math.round(sec * fs));
/** A plosive-like burst: 8 ms of decaying noise. */
const burst = (seed) => {
  const rnd = mulberry32(seed);
  return Float32Array.from({ length: 400 }, (_, i) => (rnd() - 0.5) * 0.6 * Math.exp(-i / 80));
};

test('creak per utterance: phrase-final creak reads "end", modal reads "none", all-creak reads "throughout"', () => {
  const v = (f0, dur, seed) => modal({ f0, sex: 'male', vowel: 'hard', dur, seed });
  const cases = [
    ['modal then a creaky tail', join(silence(0.3), v(110, 1.0, 1), creaky({ f0: 40, dur: 0.3, peak: 0.25 }), silence(0.6)), 'end'],
    ['modal only', join(silence(0.3), v(110, 1.3, 2), silence(0.6)), 'none'],
    ['syllables with plosive bursts', join(silence(0.3), ...[1, 2, 3, 4].flatMap((s) => [v(120, 0.25, s), silence(0.04), burst(s), silence(0.04)]), silence(0.6)), 'none'],
    ['creaky all through', join(silence(0.3), creaky({ f0: 45, dur: 1.2, seed: 3 }), silence(0.6)), 'throughout'],
  ];
  for (const [label, x, want] of cases) {
    const us = utterances(x);
    assert.equal(us.length, 1, `${label}: ${us.length} utterances`);
    assert.equal(us[0].creak.where, want, `${label}: ${JSON.stringify(us[0].creak)}`);
  }
});

test('creakRuns: bridges one missed frame, never a pause between sounding frames', () => {
  const hop = 1024 / 48000;
  const at = (ks) => ks.map((k) => ({ t: k * hop, creak: true }));
  assert.deepEqual(creakRuns(at([0, 1, 3])), [true, true, true]);
  // The tracker drops unvoiced frames, so three isolated flags arrive back to back in the list.
  assert.deepEqual(creakRuns(at([0, 4, 8])), [false, false, false]);
  assert.deepEqual(creakRuns(at([0, 1])), [false, false]);
});

const FPS = 47;
/** Frames whose F0 follows stAt(t) semitones re 180 Hz. */
const contour = (sec, stAt, extra = () => ({})) => Array.from({ length: Math.round(sec * FPS) }, (_, i) => {
  const t = i / FPS;
  return { t, voiced: true, f0: 180 * 2 ** (stAt(t) / 12), creak: false, ...extra(t) };
});

test('phraseShape: 5–95 % range, last-200-ms ending, creaky frames left out', () => {
  const glide = phraseShape(contour(1.2, (t) => -4 * Math.min(1, t / 1.2)));
  // A linear 4 st glide: the 5–95 % span is 90 % of it; the ending sits ~1.7 st under the median.
  assert.ok(Math.abs(glide.spanSt - 3.6) < 0.15, `span ${glide.spanSt}`);
  assert.equal(glide.ending, 'fall');
  const lift = phraseShape(contour(1.25, (t) => (t > 1 ? 2 : 0)));
  assert.equal(lift.ending, 'rise');
  assert.ok(Math.abs(lift.finalSt - 2) < 0.01, `final ${lift.finalSt}`);
  // A creaky tail read as 62 Hz "voiced" must not count as a 19 st fall.
  const tail = phraseShape(contour(1.9, () => 0, (t) => (t > 1.6 ? { f0: 62, creak: true } : {})));
  assert.equal(tail.ending, 'level');
  assert.ok(tail.spanSt < 0.01 && tail.level, JSON.stringify(tail));
});

test('sessionCare: nudges on rising creak or a sliding average, never before enough tries', () => {
  const u = (f0, share) => ({ f0, creak: { share } });
  assert.equal(sessionCare([u(180, 0), u(180, 0), u(180, 0.4)]), null);
  assert.equal(sessionCare([u(180, 0), u(180, 0.05), u(180, 0), u(180, 0.3), u(180, 0.4), u(180, 0.3)]).kind, 'creak');
  const sliding = [180, 182, 179, 165, 160, 162].map((f0) => u(f0, 0));
  assert.equal(sessionCare(sliding).kind, 'drift');
  assert.equal(sessionCare(sliding, { pitch: false }), null);
});
