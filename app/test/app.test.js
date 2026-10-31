// Non-DSP pure modules used by the app: WAV export and recording summaries.
import test from 'node:test';
import assert from 'node:assert/strict';
import { encodeWav, decodeWav, concatFloat32 } from '../src/audio/wav.js';
import { summarize, quantile, fmtDuration } from '../src/summary.js';
import { synthVowel, VOWELS } from './synth.js';

test('WAV: header fields and 16-bit round trip within 0.5 LSB', () => {
  const fs = 48000;
  const x = synthVowel({ f0: 180, formants: VOWELS.female.had, fs, dur: 0.25, peak: 0.9 });
  const buf = encodeWav(x, fs);
  assert.equal(buf.byteLength, 44 + x.length * 2);
  const v = new DataView(buf);
  assert.equal(v.getUint32(24, true), fs);
  assert.equal(v.getUint16(22, true), 1);
  assert.equal(v.getUint16(34, true), 16);
  const { samples, sampleRate } = decodeWav(buf);
  assert.equal(sampleRate, fs);
  assert.equal(samples.length, x.length);
  let worst = 0;
  for (let i = 0; i < x.length; i++) worst = Math.max(worst, Math.abs(samples[i] - x[i]));
  assert.ok(worst <= 0.5 / 32767 + 1e-7, `worst ${worst}`);
});

test('WAV: clips out-of-range samples instead of wrapping', () => {
  const { samples } = decodeWav(encodeWav(Float32Array.from([2, -2, 0]), 8000));
  assert.ok(samples[0] > 0.999 && samples[1] === -1 && samples[2] === 0);
});

test('concatFloat32 joins chunks in order', () => {
  const y = concatFloat32([Float32Array.from([1, 2]), Float32Array.from([3])]);
  assert.deepEqual([...y], [1, 2, 3]);
});

test('summarize: band fraction, loud-and-light fraction, medians', () => {
  // [t, f0, dbfs, weight, f1, f2]
  const tr = [
    [0.0, 150, -40, 0.3, 500, 1500],
    [0.1, 160, -20, 0.3, 500, 1500], // in band, loud, light
    [0.2, 170, -20, 0.8, 500, 1500], // in band, loud, heavy
    [0.3, 200, -40, 0.3, 500, 1500], // out of band
    [0.4, null, -70, null, null, null],
  ];
  const s = summarize(tr, [{ lo: 145, hi: 175 }], { loudDb: -28, lightMax: 0.45 });
  assert.equal(s.duration, 0.4);
  assert.equal(s.voicedFrac, 0.8);
  assert.equal(s.inBandFrac, 0.75);
  assert.equal(s.loudFrac, 0.5);
  assert.equal(s.loudLightFrac, 0.5);
  assert.equal(s.f0Median, 165);
  assert.equal(quantile([1, 2, 3, 4, 5], 0.5), 3);
  assert.equal(fmtDuration(125.4), '2:05');
});

test('RollingMedian: windowed median ignores single-frame outliers and expires old samples', async () => {
  const { RollingMedian } = await import('../src/ui/smoothing.js');
  const m = new RollingMedian(1);
  assert.ok(Number.isNaN(m.value(0)));
  // 150 Hz at ~47 fps with one octave error in the middle.
  for (let i = 0; i < 47; i++) m.push(i / 47, i === 20 ? 300 : 150);
  assert.equal(m.value(46 / 47), 150);
  m.push(0.99, NaN); // non-finite values are skipped
  assert.equal(m.count, 47);
  // Two seconds later with nothing new, the window is empty.
  assert.ok(Number.isNaN(m.value(3)));
  const e = new RollingMedian(1);
  e.push(0, 1); e.push(0.1, 3);
  assert.equal(e.value(0.1), 2); // even count: mean of the middle two
});
