// Per-attempt feedback for practice drills. Pure, Node-testable.
// An utterance is a run of voiced or creaky frames (creak is often unvoiced to
// the pitch tracker, and phrase-final creak belongs to the phrase); pauses
// shorter than gapSec (consonants, breaths mid-phrase) don't end it, and runs
// shorter than minSec are blips. A run needs minVoiced modal frames too: noise
// (a café, the room) trips the creak cues now and then, and creak alone isn't
// someone speaking.

import { quantile } from '../summary.js';
import { hzToSemitones, hzToNote } from '../analysis/index.js';
import { phraseShape, creakSummary, describeShape, describeCreak } from './prosody.js';
import { voiceDb, hearsNoise } from './noise.js';

const median = (frames, key) => quantile(frames.map((f) => f[key]), 0.5);

export class UtteranceTracker {
  constructor({ minSec = 0.25, gapSec = 0.3, minVoiced = 6 } = {}) {
    this.minSec = minSec;
    this.gapSec = gapSec;
    this.minVoiced = minVoiced;
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
    if (run.filter((f) => f.voiced).length < this.minVoiced) return null;
    return {
      start: run[0].t, end: last.t,
      f0: median(run, 'f0'), f1: median(run, 'f1'), f2: median(run, 'f2'), f3: median(run, 'f3'),
      dbfs: median(run, 'dbfs'), weight: median(run, 'weight'),
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

// Under the café, for "loud but light" in noise. The voice's level has the
// noise floor taken out, and "holding up" is against the latest try made with
// the café off (or the band, before there is one): noise tends to pull pitch
// down and resonance darker, back toward old habits.
const NOISE_VOICE = {
  quiet: 'Easy and light. Fine to stay there; if they\'d miss it, lean in or add breath rather than push',
  heavy: 'Loud, but leaning heavy. Noise pulls everyone that way. Lighter and brighter, and let the room be loud?',
  yay: 'Loud and light over the noise',
};
const PITCH_DROP_ST = -1.5;
const F2_DARKER_PCT = -5;

function holdingUp(cur, quiet, bands) {
  if (!quiet) {
    const band = scoreBand(cur, bands);
    return { ok: band.state === 'yay', text: band.text };
  }
  const st = hzToSemitones(cur.f0, quiet.f0);
  const f2Pct = (cur.f2 / quiet.f2 - 1) * 100;
  const pitch = st < PITCH_DROP_ST ? `Pitch dropped ${signed(st)} st` : `Pitch held (${signed(st)} st)`;
  const f2 = !Number.isFinite(f2Pct) ? '' : f2Pct < F2_DARKER_PCT ? `, F2 ${signed(f2Pct, 0)}%, a bit darker` : ', resonance held';
  return { ok: st >= PITCH_DROP_ST && !(f2Pct < F2_DARKER_PCT), text: `${pitch}${f2}, against your quiet try.` };
}

/**
 * ctx: { bands, loudDb, lightMax, floorDb, noisy (café playing), quiet (latest try with it off) }.
 * Null when the "utterance" was no louder than the floor: probably the café's own voices.
 */
export function scoreOverNoise(cur, ctx) {
  const { floorDb, loudDb, noisy, quiet, bands } = ctx;
  if (cur.dbfs - floorDb < 3) return null;
  const rough = hearsNoise(floorDb, loudDb) ? '≈ ' : '';
  if (!noisy) return { state: 'info', text: `${rough}Quiet try: ${pitchLabel(cur.f0)}. Now the same with the café on.` };
  const { state } = scoreLoudLight({ ...cur, dbfs: voiceDb(cur.dbfs, floorDb) }, ctx);
  const held = holdingUp(cur, quiet, bands);
  const win = state === 'yay' && held.ok;
  return { state: state === 'yay' && !win ? 'info' : state, text: `${rough}${NOISE_VOICE[state]}${win ? ' ✓' : '.'} ${held.text}` };
}

const SCORERS = {
  step: { paired: true, score: (prev, cur, spec) => scoreStep(prev, cur, spec.st) },
  contrast: { paired: true, score: (prev, cur) => scoreContrast(prev, cur) },
  band: { paired: false, score: (_, cur, spec, ctx) => scoreBand(cur, ctx.bands) },
  loudlight: { paired: false, score: (_, cur, spec, ctx) => scoreLoudLight(cur, ctx) },
  shape: { paired: false, score: (_, cur) => scoreShape(cur), notes: ['creak'] },
  ending: { paired: false, score: (_, cur) => scoreEnding(cur), notes: [] },
  noise: { paired: false, score: (_, cur, spec, ctx) => scoreOverNoise(cur, ctx) },
};
const NOTES = {
  shape: (cur) => describeShape(cur.shape),
  creak: (cur) => describeCreak(cur.creak),
};

/**
 * Feedback for the latest attempt under an exercise's `score` spec.
 * ctx: { bands, loudDb, lightMax }, plus floorDb, noisy, quiet for 'noise'. Paired scorers
 * compare with the previous attempt. Null means it wasn't an attempt, so ignore it.
 * notes: quieter lines about phrase shape and creak, unless the scorer already covers them.
 */
export function scoreAttempt(spec, prev, cur, ctx) {
  const scorer = SCORERS[spec.kind];
  const notes = (scorer.notes || Object.keys(NOTES)).map((k) => NOTES[k](cur)).filter(Boolean);
  if (!(cur.f0 > 0)) return { state: 'info', text: "Mostly creak that time, so I couldn't read the pitch.", notes };
  if (scorer.paired && !prev) return { state: 'info', text: `${pitchLabel(cur.f0)}. Now the next one.`, notes };
  const result = scorer.score(prev, cur, spec, ctx);
  return result && { ...result, notes };
}
