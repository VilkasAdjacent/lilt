// Vowel-space maths: captured vowels → target rings, settings parsing, plot axes.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  SCALE_PRESETS, parseScale, parseVowels, vowelTargets, captureVowel, plotAxes, inRing,
} from '../src/vowels.js';

const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg}: ${a} vs ${b}`);

test('targets: each captured vowel times one factor per formant, in corner order', () => {
  const vowels = { whod: { f1: 350, f2: 1400, f3: 2300, f0: 120 }, heed: { f1: 280, f2: 2250, f3: 2900, f0: 120 } };
  const t = vowelTargets(vowels, SCALE_PRESETS.land);
  assert.deepEqual(t.map((v) => v.key), ['heed', 'whod']);
  near(t[0].target.f2, 2250 * 1.1, 1e-9, 'heed F2');
  near(t[1].target.f2, 1400 * 1.1, 1e-9, "who'd F2");
  near(t[0].target.f1, 280 * 1.128, 1e-9, 'heed F1');
  near(t[0].target.f3, 2900 * 1.057, 1e-9, 'heed F3');
  assert.equal(t[0].own, vowels.heed);
});

test('scale presets: land is half of aim on a log scale', () => {
  for (const k of ['f1', 'f2', 'f3']) near(SCALE_PRESETS.land[k] ** 2, SCALE_PRESETS.aim[k], 0.002, k);
});

test('parseScale: keeps valid factors, replaces missing or silly ones with land', () => {
  assert.deepEqual(parseScale(undefined), SCALE_PRESETS.land);
  assert.deepEqual(parseScale('x'), SCALE_PRESETS.land);
  assert.deepEqual(parseScale({ f1: 1.2, f2: 'big', f3: 0.5 }), { f1: 1.2, f2: SCALE_PRESETS.land.f2, f3: SCALE_PRESETS.land.f3 });
  assert.deepEqual(parseScale(SCALE_PRESETS.aim), SCALE_PRESETS.aim);
});

test('parseVowels: keeps only known corners with plausible F1/F2, drops the rest', () => {
  const raw = {
    heed: { f1: 280, f2: 2250, f3: 2900, f0: 120, extra: 1 },
    had: { f1: 'loud', f2: 1500 },
    hard: { f1: 800, f2: 9000 },
    whod: { f1: 330, f2: 1700 },
    hid: { f1: 400, f2: 2000 },
  };
  const v = parseVowels(raw);
  assert.deepEqual(Object.keys(v), ['heed', 'whod']);
  assert.deepEqual(v.heed, { f1: 280, f2: 2250, f3: 2900, f0: 120 });
  assert.deepEqual(v.whod, { f1: 330, f2: 1700, f3: NaN, f0: NaN });
  assert.deepEqual(parseVowels(null), {});
  assert.deepEqual(parseVowels([1, 2]), {});
});

test('captureVowel: median over the middle of the vowel, ignoring onset/offset and unvoiced frames', () => {
  const frames = Array.from({ length: 30 }, (_, i) => {
    const edge = i < 4 || i >= 26; // "h" glide in, "d" transition out
    return { t: i * 0.02, voiced: i !== 10, f0: 150, f1: edge ? 600 : 300 + (i % 3), f2: edge ? 1500 : 2200 + (i % 3), f3: 2800 };
  });
  const v = captureVowel(frames);
  near(v.f1, 301, 0.5, 'F1');
  near(v.f2, 2201, 0.5, 'F2');
  assert.equal(v.f3, 2800);
  assert.equal(v.f0, 150);
});

test('captureVowel: too short to trust gives null', () => {
  assert.equal(captureVowel([{ t: 0, voiced: true, f0: 150, f1: 300, f2: 2400, f3: 2800 }]), null);
  assert.equal(captureVowel([]), null);
});

test('plot axes: F2 decreases to the right, F1 increases downward, ends clamp', () => {
  const ax = plotAxes({ w: 400, h: 300, pad: 20 });
  assert.ok(ax.x(2500) < ax.x(1000), 'higher F2 is further left');
  assert.ok(ax.y(800) > ax.y(300), 'higher F1 is further down');
  near(ax.x(ax.f2[1]), 20, 1e-9, 'max F2 at left edge');
  near(ax.x(ax.f2[0]), 380, 1e-9, 'min F2 at right edge');
  near(ax.y(ax.f1[0]), 20, 1e-9, 'min F1 at top');
  near(ax.y(ax.f1[1]), 280, 1e-9, 'max F1 at bottom');
  assert.equal(ax.x(99999), 20);
  assert.equal(ax.y(1), 20);
});

test('inRing: elliptical in log-frequency; F1 ignored when approximate', () => {
  const t = { f1: 400, f2: 2000 };
  assert.ok(inRing({ f1: 400, f2: 2000 }, t));
  assert.ok(inRing({ f1: 400, f2: 2080 }, t), '+4% F2');
  assert.ok(!inRing({ f1: 400, f2: 2150 }, t), '+7.5% F2');
  assert.ok(!inRing({ f1: 470, f2: 2000 }, t), '+17% F1');
  assert.ok(!inRing({ f1: 430, f2: 2075 }, t), 'both near the edge: outside the ellipse');
  assert.ok(inRing({ f1: 470, f2: 2000, approx: true }, t), 'approximate F1 does not count');
});

