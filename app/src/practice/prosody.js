// Phrase shape and creak, per utterance. Pure, Node-testable.
// Descriptive on purpose: intonation range is reported, never scored, and
// creak is located (end of phrase vs throughout) so the feedback can tell a
// style choice from a tired voice. Nothing here rewards more of either.
//
// frames: { t, voiced, f0, creak } as the analyser emits them, all from one
// utterance (UtteranceTracker keeps voiced and creaky frames).

import { quantile } from '../summary.js';
import { hzToSemitones } from '../analysis/index.js';

export const SHAPE = {
  finalSec: 0.2,  // phrase-final F0 = last 200 ms vs the phrase median (research/targets.md measure)
  moveSt: 1,      // a final rise or fall at least this big
  levelSt: 2,     // 5–95 % range under this, over at least levelSec, reads as level
  levelSec: 1.5,
  minFrames: 8,
};

export const CREAK = {
  minRun: 3,         // creak frames: one plosive burst lights up at most 2 overlapping frames
  maxStepSec: 0.05,  // bridges one missed frame (hop is 21–23 ms)
  finalSec: 0.4,     // or the second half of a shorter utterance
  endShare: 0.3,     // of the final window
  restMax: 0.15,     // ...while the rest of the phrase stays under this
  throughoutShare: 0.3,
  someShare: 0.1,
};

/**
 * Which frames sit inside a creak run: at least minRun creak frames, each within
 * maxStepSec of the last (so one missed frame is bridged, a pause is not).
 * Times matter because the tracker keeps only sounding frames.
 */
export function creakRuns(frames, { minRun, maxStepSec } = CREAK) {
  const runs = frames.filter((f) => f.creak).reduce((acc, { t }) => {
    const last = acc[acc.length - 1];
    return last && t - last.end <= maxStepSec
      ? [...acc.slice(0, -1), { ...last, end: t, n: last.n + 1 }]
      : [...acc, { start: t, end: t, n: 1 }];
  }, []).filter((r) => r.n >= minRun);
  return frames.map(({ t }) => runs.some((r) => t >= r.start && t <= r.end));
}

const share = (flags) => (flags.length ? flags.filter(Boolean).length / flags.length : 0);

/**
 * Where creak sat in an utterance and how much of it there was.
 * where: 'none' | 'some' | 'end' (phrase-final only) | 'throughout'
 */
export function creakSummary(frames, o = CREAK) {
  if (!frames.length) return { share: 0, finalShare: 0, restShare: 0, where: 'none' };
  const flags = creakRuns(frames, o);
  // A short word's "end" is its second half, not the whole word.
  const cut = frames[frames.length - 1].t - Math.min(o.finalSec, (frames[frames.length - 1].t - frames[0].t) / 2);
  const final = flags.filter((_, i) => frames[i].t > cut);
  const rest = flags.filter((_, i) => frames[i].t <= cut);
  const all = share(flags), finalShare = share(final), restShare = share(rest);
  const where = restShare >= o.throughoutShare ? 'throughout'
    : finalShare >= o.endShare && restShare < o.restMax ? 'end'
      : all >= o.someShare ? 'some' : 'none';
  return { share: all, finalShare, restShare, where };
}

/**
 * Pitch contour of an utterance in semitones re its own median, from modal
 * voiced frames (creaky ones are left out: their F0 is not intonation).
 * Returns null when there's too little voicing to say.
 */
export function phraseShape(frames, o = SHAPE) {
  const modal = frames.filter((f) => f.voiced && f.f0 > 0 && !f.creak);
  if (modal.length < o.minFrames) return null;
  const mid = quantile(modal.map((f) => f.f0), 0.5);
  const st = modal.map((f) => hzToSemitones(f.f0, mid));
  const spanSt = quantile(st, 0.95) - quantile(st, 0.05);
  const cut = modal[modal.length - 1].t - o.finalSec;
  const finalSt = quantile(st.filter((_, i) => modal[i].t > cut), 0.5);
  const ending = finalSt >= o.moveSt ? 'rise' : finalSt <= -o.moveSt ? 'fall' : 'level';
  const level = spanSt < o.levelSt && modal[modal.length - 1].t - modal[0].t >= o.levelSec;
  return { median: mid, spanSt, finalSt, ending, level };
}

const ENDING_WORD = { rise: 'lifts at the end', fall: 'falls at the end', level: 'ends level' };

export function describeShape(shape) {
  if (!shape) return '';
  const span = `${shape.spanSt.toFixed(1)} st`;
  return `Shape: ${shape.level ? `fairly level (${span})` : `moved ${span}`}, ${ENDING_WORD[shape.ending]}`;
}

export function describeCreak(creak) {
  return {
    none: '',
    some: 'A little creak here and there.',
    end: 'A touch of creak at the end. That\'s a style choice, nothing wrong.',
    throughout: 'Creaky through a lot of that one. More breath and ease might help, or a rest if your voice feels tired 💧',
  }[creak.where];
}

const mean = (a) => a.reduce((s, v) => s + v, 0) / a.length;

/**
 * A kind nudge from the attempts so far (oldest first), or null:
 * creak becoming more frequent, or (when `pitch`) the average pitch sliding down.
 * Both are common signs of a tiring voice.
 */
export function sessionCare(utterances, { pitch = true, window = 3, creakShare = 0.25, creakRise = 0.15, dropSt = 1.5 } = {}) {
  if (utterances.length < 2 * window) return null;
  const first = utterances.slice(0, window), last = utterances.slice(-window);
  const creakNow = mean(last.map((u) => u.creak.share));
  const creakThen = mean(first.map((u) => u.creak.share));
  if (creakNow >= creakShare && creakNow - creakThen >= creakRise) {
    return { kind: 'creak', text: 'Creak has been showing up more over the last few tries. That\'s often a voice getting tired. A sip of water, a few easy hums, or a little break? 💧' };
  }
  const drop = hzToSemitones(quantile(last.map((u) => u.f0), 0.5), quantile(first.map((u) => u.f0), 0.5));
  if (pitch && drop <= -dropSt) {
    return { kind: 'drift', text: `Your last few tries sat about ${Math.abs(drop).toFixed(1)} st lower than your first ones. Pitch often slides down as a voice tires. Resting here is completely fine 💧` };
  }
  return null;
}
