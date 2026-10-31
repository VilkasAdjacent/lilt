// Per-attempt feedback for practice drills. Pure, Node-testable.
// An utterance is a run of voiced or creaky frames (creak is often unvoiced to
// the pitch tracker, and phrase-final creak belongs to the phrase); pauses
// shorter than gapSec (consonants, breaths mid-phrase) don't end it, and runs
// shorter than minSec are blips.

import { quantile } from '../summary.js';
import { hzToSemitones, hzToNote } from '../analysis/index.js';
import { phraseShape, creakSummary, describeShape, describeCreak } from './prosody.js';

const median = (frames, key) => quantile(frames.map((f) => f[key]), 0.5);

export class UtteranceTracker {
  constructor({ minSec = 0.25, gapSec = 0.3 } = {}) {
    this.minSec = minSec;
    this.gapSec = gapSec;
    this.voiced = [];
  }
  /** Feed every analysis frame; returns a finished utterance summary or null. */
  push(frame) {
    if (frame.voiced || frame.creak) { this.voiced.push(frame); return null; }
    const last = this.voiced[this.voiced.length - 1];
    if (!last || frame.t - last.t < this.gapSec) return null;
    const run = this.voiced;
    this.voiced = [];
    if (last.t - run[0].t < this.minSec) return null;
    return {
      start: run[0].t, end: last.t,
      f0: median(run, 'f0'), f2: median(run, 'f2'), dbfs: median(run, 'dbfs'), weight: median(run, 'weight'),
      shape: phraseShape(run), creak: creakSummary(run),
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

/** Free talk: the phrase shape, as information only. */
export function scoreShape(cur) {
  return { state: 'info', text: describeShape(cur.shape) || `${pitchLabel(cur.f0)}. Too short to see a shape.` };
}

/** "Carry the last word": a smooth, level or lifting ending, not a creaky or dropping one. */
export function scoreEnding(cur) {
  if (cur.creak.where === 'end' || cur.creak.where === 'throughout') {
    return { state: 'under', text: 'The end went a little creaky. Keep the air going right through the last word?' };
  }
  if (!cur.shape) return { state: 'info', text: "I couldn't follow the pitch that time. One more?" };
  if (cur.shape.ending === 'fall') {
    return { state: 'under', text: `Dropped ${Math.abs(cur.shape.finalSt).toFixed(1)} st at the end. Try keeping it level, or lifting a little?` };
  }
  return { state: 'yay', text: `Smooth to the end, ${cur.shape.ending === 'rise' ? 'with a little lift' : 'and level'} ✓` };
}

const SCORERS = {
  step: { paired: true, score: (prev, cur, spec) => scoreStep(prev, cur, spec.st) },
  contrast: { paired: true, score: (prev, cur) => scoreContrast(prev, cur) },
  band: { paired: false, score: (_, cur, spec, ctx) => scoreBand(cur, ctx.bands) },
  loudlight: { paired: false, score: (_, cur, spec, ctx) => scoreLoudLight(cur, ctx) },
  shape: { paired: false, score: (_, cur) => scoreShape(cur), notes: ['creak'] },
  ending: { paired: false, score: (_, cur) => scoreEnding(cur), notes: [] },
};
const NOTES = {
  shape: (cur) => describeShape(cur.shape),
  creak: (cur) => describeCreak(cur.creak),
};

/**
 * Feedback for the latest attempt under an exercise's `score` spec.
 * ctx: { bands, loudDb, lightMax }. Paired scorers compare with the previous attempt.
 * notes: quieter lines about phrase shape and creak, unless the scorer already covers them.
 */
export function scoreAttempt(spec, prev, cur, ctx) {
  const scorer = SCORERS[spec.kind];
  const notes = (scorer.notes || Object.keys(NOTES)).map((k) => NOTES[k](cur)).filter(Boolean);
  if (!(cur.f0 > 0)) return { state: 'info', text: "Mostly creak that time, so I couldn't read the pitch.", notes };
  if (scorer.paired && !prev) return { state: 'info', text: `${pitchLabel(cur.f0)}. Now the next one.`, notes };
  return { ...scorer.score(prev, cur, spec, ctx), notes };
}
