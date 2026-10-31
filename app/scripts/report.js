// Prints the actual recovery errors for every test case (not pass/fail).
//   node scripts/report.js             -> markdown tables, every formant implementation
//   node scripts/report.js --impl lpc12 -> only one formant implementation
//   node scripts/report.js --order 14  -> try a different LPC order (lpc12 only)
//   node scripts/report.js --snr 30    -> add white noise at 30 dB SNR to the formant cases
import { TOL, F0_GRID, measureF0, measureFormants, formantCases, overFrames, median, FORMANT_IMPLS } from '../test/cases.js';
import { synthVowel, VOWELS } from '../test/synth.js';
import { createAnalyzer } from '../src/analysis/index.js';
import * as lpc12 from '../src/analysis/formants.js';

const arg = (name) => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : undefined; };
if (arg('--order')) lpc12.defaults.order = Number(arg('--order'));
const impls = arg('--impl') ? [arg('--impl')] : FORMANT_IMPLS;
const snr = arg('--snr') !== undefined ? Number(arg('--snr')) : undefined;

console.log('## F0 (clean, worst frame |cents| over male hard, female heed, female whod)\n');
console.log('| F0 | 48 kHz | 44.1 kHz |\n|---|---|---|');
for (const f0 of F0_GRID) {
  const row = [48000, 44100].map((fs) =>
    Math.max(...[['male', 'hard'], ['female', 'heed'], ['female', 'whod']].map(([sex, vowel]) => measureF0({ f0, sex, vowel, fs }).worstCents)));
  console.log(`| ${f0} | ${row.map((v) => v.toFixed(2)).join(' | ')} |`);
}

console.log('\n## F0 with jitter 1%, shimmer 5%, breathiness 0.5 (seed 7)\n');
console.log('| F0 | median cents | worst frame cents | voiced |\n|---|---|---|---|');
for (const f0 of [100, 150, 200, 250]) {
  const r = measureF0({ f0, jitter: 0.01, shimmer: 0.05, breathiness: 0.5, seed: 7 });
  console.log(`| ${f0} | ${r.medianCents.toFixed(2)} | ${r.worstCents.toFixed(1)} | ${(100 * r.voicedFrac).toFixed(0)}% |`);
}

for (const impl of impls) {
  const cond = snr !== undefined ? `white noise SNR ${snr} dB` : 'noise-free';
  console.log(`\n## Formants [${impl}] (median over frames, 48 kHz, ${cond}${impl === 'lpc12' ? `, order ${lpc12.defaults.order ?? 'auto'}` : ''})\n`);
  console.log('| case | F0 | F1 err | F2 err | F3 err | tol | pass |\n|---|---|---|---|---|---|---|');
  const worstLow = [0, 0, 0];
  let pass = 0, n = 0;
  for (const c of formantCases()) {
    const r = measureFormants({ ...c, impl, snr });
    const tol = c.band === 'low' ? TOL.formantLow : TOL.formantHigh;
    const ok = r.truth.every((F, i) => Math.abs(r.errHz[i]) <= tol(F));
    n++; if (ok) pass++;
    if (c.band === 'low') r.errPct.forEach((e, i) => { worstLow[i] = Math.max(worstLow[i], Math.abs(e)); });
    const cell = (i) => `${r.errHz[i] >= 0 ? '+' : ''}${r.errHz[i].toFixed(0)} Hz (${r.errPct[i].toFixed(1)}%)`;
    console.log(`| ${c.sex} ${c.vowel} | ${c.f0} | ${cell(0)} | ${cell(1)} | ${cell(2)} | ${c.band === 'low' ? '5%/60' : '10%/100'} | ${ok ? 'yes' : '**NO**'} |`);
  }
  console.log(`\n[${impl}] ${pass}/${n} pass (${cond}). Worst |error| for F0 <= 200, all cases: F1 ${worstLow[0].toFixed(1)}%, F2 ${worstLow[1].toFixed(1)}%, F3 ${worstLow[2].toFixed(1)}%`);
}

console.log('\n## H1-H2 (dB), tilt (dB, 1-4 kHz vs 50-1000 Hz) and weight vs breathiness 0, .25, .5, .75, 1\n');
const fs = 48000;
for (const [sex, vowel, f0] of [['male', 'hard', 110], ['male', 'had', 150], ['female', 'hard', 200], ['female', 'heed', 220]]) {
  const rows = [0, 0.25, 0.5, 0.75, 1].map((b) => {
    const A = createAnalyzer({ sampleRate: fs });
    const x = synthVowel({ f0, formants: VOWELS[sex][vowel], fs, breathiness: b, seed: 11 });
    const res = overFrames(x, fs, (fr) => A.analyze(fr));
    return { h: median(res.map((r) => r.h1h2)), w: median(res.map((r) => r.weight)), t: median(res.map((r) => r.tilt)) };
  });
  console.log(`- ${sex} ${vowel} @ ${f0}: H1-H2 ${rows.map((r) => r.h.toFixed(1)).join(' → ')}; tilt ${rows.map((r) => r.t.toFixed(1)).join(' → ')}; weight ${rows.map((r) => r.w.toFixed(2)).join(' → ')}`);
}
