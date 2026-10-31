// Procedural café babble, rendered once into loopable buffers. Pure, Node-testable.
// Nothing here is recorded speech. Each "talker" is a jittery pulse train plus
// breath noise through three formant resonators that glide to a new vowel every
// syllable, gated by a syllable-rate envelope. A handful of talkers, some cup
// clinks and a short room reverb read as a busy room rather than as hiss.
//
// The talkers are deliberately rough (±12 % per-period jitter, breathy), like
// voices smeared by a room, so that when the phone speaker leaks the café into
// the mic the pitch tracker's clarity gate rejects it instead of tracking it
// (test/babble.test.js measures this).

export const BABBLE_RATE = 16000; // speech band only; Web Audio resamples to the context rate
export const TALKERS = 8;

export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const uniform = (random, lo, hi) => lo + (hi - lo) * random();
const clamp01 = (v) => Math.min(1, Math.max(0, v));

/**
 * Syllables [{ start, len, peak }] in seconds: 3–5.5 per second, in phrases of
 * 4–14 with 0.2–0.6 s pauses between. It starts on a pause and every syllable
 * ends before `seconds`, so an envelope built from it is silent at both ends
 * and loops without a click.
 */
export function syllablePlan(seconds, random) {
  const next = (t, left, plan) => {
    if (left === 0) return next(t + uniform(random, 0.2, 0.6), 4 + Math.floor(random() * 11), plan);
    const len = 1 / uniform(random, 3, 5.5);
    if (t + len > seconds) return plan;
    plan.push({ start: t, len, peak: uniform(random, 0.45, 1) });
    return next(t + len, left - 1, plan);
  };
  return next(0, 0, []);
}

/** A half-sine bump per syllable, so loudness dips between syllables as it does at consonants. */
export function syllableEnvelope(plan, n, rate = BABBLE_RATE) {
  const env = new Float32Array(n);
  for (const { start, len, peak } of plan) {
    const s0 = Math.round(start * rate), m = Math.round(len * rate);
    for (let i = 0; i < m && s0 + i < n; i++) env[s0 + i] = peak * Math.sin((Math.PI * i) / m);
  }
  return env;
}

// Rough adult (F1, F2) vowel targets, scaled per talker by vocal-tract size.
const VOWEL_TARGETS = [[730, 1090], [530, 1840], [270, 2290], [300, 870], [570, 840], [660, 1720], [490, 1350], [440, 1020], [400, 1900]];

function resonator(rate) {
  let y1 = 0, y2 = 0, a = 0, b = 0, c = 0;
  return {
    tune(f, bw) {
      c = -Math.exp((-2 * Math.PI * bw) / rate);
      b = 2 * Math.exp((-Math.PI * bw) / rate) * Math.cos((2 * Math.PI * f) / rate);
      a = 1 - b - c;
    },
    step(x) {
      const y = a * x + b * y1 + c * y2;
      y2 = y1; y1 = y;
      return y;
    },
  };
}

function normalise(x, targetRms) {
  let power = 0;
  for (let i = 0; i < x.length; i++) power += x[i] * x[i];
  const k = power > 0 ? targetRms / Math.sqrt(power / x.length) : 0;
  for (let i = 0; i < x.length; i++) x[i] *= k;
  return x;
}

const TUNE_EVERY = 32;  // samples between resonator retunes
const GLIDE_SEC = 0.04; // formant and pitch glide time constant

/** One talker, `seconds` long, RMS 0.1, silent at both ends. jitter: per-period F0 spread (fraction). */
export function renderTalker({ seconds, seed, rate = BABBLE_RATE, jitter = 0.12, breath = 0.015 }) {
  const random = mulberry32(seed);
  const f0Base = uniform(random, 95, 235);
  const size = 1.18 - (0.33 * (f0Base - 95)) / 140; // higher voices tend to have shorter tracts
  const plan = syllablePlan(seconds, random);
  const targets = plan.map(() => {
    const [f1, f2] = VOWEL_TARGETS[Math.floor(random() * VOWEL_TARGETS.length)];
    return { f1: f1 / size, f2: f2 / size, f0: f0Base * 2 ** (uniform(random, -2.5, 2.5) / 12) };
  });
  const n = Math.round(seconds * rate);
  const env = syllableEnvelope(plan, n, rate);
  const out = new Float32Array(n);
  const [r1, r2, r3] = [resonator(rate), resonator(rate), resonator(rate)];
  r3.tune(2600 / size, 250);
  const glide = 1 - Math.exp(-TUNE_EVERY / (GLIDE_SEC * rate));
  const tilt = Math.exp((-2 * Math.PI * 300) / rate); // one-pole source roll-off, about −6 dB/oct net
  const starts = plan.map((s) => s.start * rate);
  let k = 0, f1 = targets[0]?.f1 ?? 500, f2 = targets[0]?.f2 ?? 1500, f0 = f0Base, phase = 0, src = 0, periodScale = 1;
  for (let i = 0; i < n; i++) {
    while (k + 1 < starts.length && i >= starts[k + 1]) k++;
    if (i % TUNE_EVERY === 0 && targets.length) {
      const t = targets[k];
      f1 += (t.f1 - f1) * glide; f2 += (t.f2 - f2) * glide; f0 += (t.f0 - f0) * glide;
      r1.tune(f1, 90); r2.tune(f2, 130);
    }
    phase += (f0 * periodScale) / rate;
    let pulse = 0;
    if (phase >= 1) {
      phase -= 1;
      pulse = uniform(random, 0.8, 1.2);
      periodScale = 1 + jitter * (random() * 2 - 1);
    }
    src = (1 - tilt) * pulse + tilt * src;
    out[i] = r3.step(r2.step(r1.step(src + breath * (random() * 2 - 1)))) * env[i];
  }
  return normalise(out, 0.1);
}

/** Cup clinks (damped partials) and soft thuds, Poisson-spaced; silent at both ends. Peak 0.5. */
export function renderClatter({ seconds, seed, rate = BABBLE_RATE, perSec = 0.6 }) {
  const random = mulberry32(seed);
  const n = Math.round(seconds * rate);
  const out = new Float32Array(n);
  const nyquistSafe = 0.45 * rate;
  const events = (t, acc) => (t >= seconds ? acc : events(t - Math.log(1 - random()) / perSec, [...acc, t]));
  for (const t of events(0.3, [])) {
    const clink = random() < 0.7;
    const tau = clink ? uniform(random, 0.015, 0.06) : 0.025;
    const s0 = Math.round(t * rate), m = Math.round(6 * tau * rate);
    if (s0 + m >= n) continue;
    const amp = uniform(random, 0.2, 1);
    const f = uniform(random, 2200, 5200), g = Math.min(f * uniform(random, 1.4, 2.7), nyquistSafe);
    const lp = Math.exp((-2 * Math.PI * 400) / rate);
    let thud = 0;
    for (let i = 0; i < m; i++) {
      const decay = amp * Math.exp(-i / (tau * rate));
      if (clink) out[s0 + i] += decay * (Math.sin((2 * Math.PI * f * i) / rate) + 0.5 * Math.sin((2 * Math.PI * g * i) / rate));
      else out[s0 + i] += decay * (thud = (1 - lp) * (random() * 2 - 1) * 8 + lp * thud);
    }
  }
  const peak = out.reduce((p, v) => Math.max(p, Math.abs(v)), 0);
  return peak > 0 ? out.map((v) => (0.5 * v) / peak) : out;
}

/** A short, decorrelated stereo room tail: exponentially decaying noise with a 10 ms gap. */
export function roomImpulse({ seconds = 0.8, rt60 = 0.6, seed = 3, rate = BABBLE_RATE }) {
  const random = mulberry32(seed);
  const gap = Math.round(0.01 * rate);
  const channel = () => Float32Array.from({ length: Math.round(seconds * rate) }, (_, i) => (i < gap
    ? 0
    : (random() * 2 - 1) * Math.exp((-6.9 * (i - gap)) / (rt60 * rate))));
  return [channel(), channel()];
}

/**
 * Gains for a level from 0 (quiet café) to 1 (busy café). Talkers join one by
 * one (3 at the quietest, all 8 at the busiest, the next one fading in between),
 * nearer talkers a little louder; the whole room rises 18 dB across the range.
 */
export function babbleMix(level) {
  const l = clamp01(level);
  const count = 3 + (TALKERS - 3) * l;
  return {
    talkers: Array.from({ length: TALKERS }, (_, i) => clamp01(count - i) * (1 - 0.06 * i)),
    clatter: 0.12 + 0.3 * l,
    master: 10 ** ((-26 + 18 * l) / 20),
  };
}

export const parseBabbleLevel = (v) => (typeof v === 'number' && Number.isFinite(v) ? clamp01(v) : 0.3);
