// Practice feedback: utterance segmentation and pitch-step scoring.
import test from 'node:test';
import assert from 'node:assert/strict';
import { UtteranceTracker, scoreStep, scoreAttempt } from '../src/practice/feedback.js';
import { KINDS, EXERCISES } from '../src/practice/exercises.js';
import { TIP_TOPICS, TIPS } from '../src/practice/tips.js';

const FPS = 47;
/** Frames at FPS for `sec` seconds starting at t0; f0 = NaN means unvoiced. */
const frames = (t0, sec, f0, extra = {}) => Array.from({ length: Math.round(sec * FPS) }, (_, i) => ({
  t: t0 + i / FPS, voiced: f0 > 0, f0, f2: 1600, dbfs: -30, weight: 0.3, ...extra,
}));

test('UtteranceTracker: splits on pauses, bridges consonant gaps, drops blips', () => {
  const seq = [
    ...frames(0, 0.3, 150),
    ...frames(0.3, 0.1, NaN), // a consonant, shorter than the gap: same utterance
    ...frames(0.4, 0.3, 150),
    ...frames(0.7, 0.5, NaN),
    ...frames(1.2, 0.1, 400), // a blip, too short to count
    ...frames(1.3, 0.5, NaN),
    ...frames(1.8, 0.5, 168, { f2: 1760 }),
    ...frames(2.3, 0.5, NaN),
  ];
  const tracker = new UtteranceTracker();
  const done = seq.map((f) => tracker.push(f)).filter(Boolean);
  assert.equal(done.length, 2);
  assert.equal(done[0].f0, 150);
  assert.ok(done[0].end - done[0].start > 0.6, `first utterance spans the consonant: ${done[0].end - done[0].start}`);
  assert.equal(done[1].f0, 168);
  assert.equal(done[1].f2, 1760);
});

test('scoreStep: semitone size against the asked-for range, either direction', () => {
  const range = [1.5, 3.5];
  const up = scoreStep({ f0: 150 }, { f0: 168 }, range); // +1.96 st
  assert.equal(up.state, 'yay');
  assert.ok(Math.abs(up.st - 1.96) < 0.01, `st ${up.st}`);
  assert.equal(scoreStep({ f0: 168 }, { f0: 150 }, range).state, 'yay');
  assert.equal(scoreStep({ f0: 150 }, { f0: 155 }, range).state, 'under');
  assert.equal(scoreStep({ f0: 150 }, { f0: 300 }, range).state, 'over');
});

test('exercise pool and tips: well-formed, unique ids, scorers that exist', () => {
  const ids = EXERCISES.map((e) => e.id);
  assert.equal(new Set(ids).size, ids.length, 'duplicate exercise id');
  Object.keys(KINDS).forEach((kind) => assert.ok(EXERCISES.some((e) => e.kind === kind), `no ${kind} exercise`));
  const utt = { f0: 160, f2: 1700, dbfs: -30, weight: 0.3, shape: null, creak: { share: 0, finalShare: 0, restShare: 0, where: 'none' } };
  const ctx = { bands: [{ lo: 150, hi: 170 }], loudDb: -35, lightMax: 0.45 };
  EXERCISES.forEach((e) => {
    assert.ok(e.kind in KINDS && e.title && e.blurb, e.id);
    assert.ok(e.steps.length && e.steps.every((s) => typeof s === 'string' && s), `${e.id} steps`);
    assert.ok([null, 'pitch', 'resonance', 'loudlight'].includes(e.watch), `${e.id} watch`);
    if (e.score) assert.equal(typeof scoreAttempt(e.score, utt, utt, ctx).text, 'string', `${e.id} scorer`);
  });
  const tipIds = TIPS.map((t) => t.id);
  assert.equal(new Set(tipIds).size, tipIds.length, 'duplicate tip id');
  TIPS.forEach((t) => assert.ok(t.topic in TIP_TOPICS && t.text, t.id));
});
