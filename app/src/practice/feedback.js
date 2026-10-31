// Per-attempt feedback for practice drills. Pure, Node-testable.
// An utterance is a run of voiced frames; pauses shorter than gapSec (consonants,
// breaths mid-phrase) don't end it, and runs shorter than minSec are blips.

import { quantile } from '../summary.js';
import { hzToSemitones, hzToNote } from '../analysis/index.js';

const median = (frames, key) => quantile(frames.map((f) => f[key]), 0.5);

export class UtteranceTracker {
  constructor({ minSec = 0.25, gapSec = 0.3 } = {}) {
    this.minSec = minSec;
    this.gapSec = gapSec;
    this.voiced = [];
  }
  /** Feed every analysis frame; returns a finished utterance summary or null. */
  push(frame) {
    if (frame.voiced) { this.voiced.push(frame); return null; }
    const last = this.voiced[this.voiced.length - 1];
    if (!last || frame.t - last.t < this.gapSec) return null;
    const run = this.voiced;
    this.voiced = [];
    if (last.t - run[0].t < this.minSec) return null;
    return {
      start: run[0].t, end: last.t,
      f0: median(run, 'f0'), f1: median(run, 'f1'), f2: median(run, 'f2'), f3: median(run, 'f3'),
      dbfs: median(run, 'dbfs'), weight: median(run, 'weight'),
    };
  }
  clear() { this.voiced = []; }
}

const signed = (v, digits = 1) => `${v >= 0 ? '+' : '−'}${Math.abs(v).toFixed(digits)}`;
const pitchLabel = (hz) => `${Math.round(hz)} Hz (${hzToNote(hz)})`;

/** The size of the step from one attempt to the next, against the asked-for [lo, hi] semitones. */
export function scoreStep(prev, cur, [lo, hi]) {
  const st = hzToSemitones(cur.f0, prev.f0);
  const size = Math.abs(st);
  const step = `${hzToNote(prev.f0)} → ${hzToNote(cur.f0)}, ${signed(st)} st`;
  if (size < 0.5) return { state: 'under', st, text: `${step}: about the same pitch` };
  if (size < lo) return { state: 'under', st, text: `${step}: a smaller step than asked` };
  if (size <= hi) return { state: 'yay', st, text: `${step}: just the step asked for ✓` };
  // An octave is the habitual overshoot this drill is for, so name it.
  if (size >= 9) return { state: 'over', st, text: `${step}: nearly an octave! Try half as far?` };
  return { state: 'over', st, text: `${step}: a bigger step than asked` };
}

/** Same word twice: did resonance (F2) move while pitch held still? */
export function scoreContrast(prev, cur) {
  const st = hzToSemitones(cur.f0, prev.f0);
  const f2Pct = (cur.f2 / prev.f2 - 1) * 100;
  if (!Number.isFinite(f2Pct)) return { state: 'info', text: `${pitchLabel(cur.f0)}. I couldn't catch F2 that time.` };
  const moved = `F2 ${signed(f2Pct, 0)}%, pitch ${signed(st)} st`;
  if (Math.abs(st) > 1) return { state: 'info', text: `${moved}: pitch moved too. Keep the note, change only the size?` };
  if (Math.abs(f2Pct) >= 3) return { state: 'yay', text: `${moved}: ${f2Pct > 0 ? 'brighter' : 'darker'} at the same pitch ✓` };
  return { state: 'under', text: `${moved}: barely changed. Try a bigger difference in size?` };
}

export function scoreBand(cur, bands) {
  const hit = bands.some((b) => cur.f0 >= b.lo && cur.f0 <= b.hi);
  if (hit) return { state: 'yay', text: `${pitchLabel(cur.f0)}: in your band ✓` };
  if (!bands.length) return { state: 'info', text: pitchLabel(cur.f0) };
  const below = cur.f0 < Math.min(...bands.map((b) => b.lo));
  return { state: 'info', text: `${pitchLabel(cur.f0)}: ${below ? 'below' : 'above'} the band` };
}

export function scoreLoudLight(cur, { loudDb, lightMax }) {
  if (cur.dbfs < loudDb) return { state: 'quiet', text: 'Nice and easy. A bit louder, keeping it light?' };
  if (!(cur.weight <= lightMax)) return { state: 'heavy', text: 'Loud, but leaning heavy. More breath and space, less push?' };
  return { state: 'yay', text: 'Loud and light ✓' };
}

const SCORERS = {
  step: { paired: true, score: (prev, cur, spec) => scoreStep(prev, cur, spec.st) },
  contrast: { paired: true, score: (prev, cur) => scoreContrast(prev, cur) },
  band: { paired: false, score: (_, cur, spec, ctx) => scoreBand(cur, ctx.bands) },
  loudlight: { paired: false, score: (_, cur, spec, ctx) => scoreLoudLight(cur, ctx) },
};

/**
 * Feedback for the latest attempt under an exercise's `score` spec.
 * ctx: { bands, loudDb, lightMax }. Paired scorers compare with the previous attempt.
 */
export function scoreAttempt(spec, prev, cur, ctx) {
  const scorer = SCORERS[spec.kind];
  if (scorer.paired && !prev) return { state: 'info', text: `${pitchLabel(cur.f0)}. Now the next one.` };
  return scorer.score(prev, cur, spec, ctx);
}
