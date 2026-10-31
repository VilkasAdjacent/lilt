// Synthetic vowels with known ground truth, for testing the analysis code.
//
// Source: Rosenberg (1971) glottal flow pulse train at a known F0, optional
// jitter/shimmer, and a single "breathiness" control that raises the open
// quotient, makes the pulse more symmetric, adds spectral tilt (one-pole
// low-pass) and adds aspiration noise. Lip radiation = first difference.
// Creaky voice: low F0, a short open phase (`openQuotient`), large jitter and
// shimmer, and `alternate` (every other pulse weaker by that fraction and its
// period longer by half that fraction: diplophonia / period doubling).
// Filter: Klatt-style 2-pole digital resonators in cascade (F1..F5).
//
// All output is deterministic (seeded PRNG).

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

/** Rosenberg glottal flow for one period of n samples. */
function rosenbergPeriod(n, oq, sq) {
  const tp = (oq * n * sq) / (1 + sq); // opening
  const tn = (oq * n) / (1 + sq);      // closing
  const g = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    if (i < tp) g[i] = 0.5 * (1 - Math.cos((Math.PI * i) / tp));
    else if (i < tp + tn) g[i] = Math.cos((Math.PI * (i - tp)) / (2 * tn));
    else g[i] = 0;
  }
  return g;
}

/** Glottal source (flow derivative, i.e. with lip radiation). */
export function glottalSource({
  f0, fs = 48000, dur = 0.5, jitter = 0, shimmer = 0, breathiness = 0, noiseLevel = 1, seed = 1,
  openQuotient, alternate = 0,
}) {
  const rnd = mulberry32(seed);
  const gauss = () => {
    const u = Math.max(rnd(), 1e-12), v = rnd();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  };
  const b = Math.min(1, Math.max(0, breathiness));
  const oq = openQuotient ?? 0.45 + 0.35 * b;
  const sq = 2.5 - 1.5 * b;
  const N = Math.round(dur * fs);
  const flow = new Float64Array(N);
  let pos = 0;
  // Fractional-period accumulation keeps the long-run mean F0 exact.
  let phaseErr = 0;
  for (let k = 0; pos < N; k++) {
    const weak = alternate > 0 && k % 2 === 1;
    const f = (f0 * (1 + jitter * gauss())) / (weak ? 1 + alternate / 2 : 1);
    const exact = fs / f + phaseErr;
    const n = Math.max(4, Math.round(exact));
    phaseErr = exact - n;
    const amp = Math.max(0.05, 1 + shimmer * gauss()) * (weak ? 1 - alternate : 1);
    const g = rosenbergPeriod(n, oq, sq);
    for (let i = 0; i < n && pos + i < N; i++) flow[pos + i] = amp * g[i];
    pos += n;
  }
  // Spectral tilt (extra roll-off when breathy) and aspiration noise.
  const a = 0.75 * b;
  const out = new Float64Array(N);
  let prev = 0, lp = 0, energy = 0;
  for (let i = 0; i < N; i++) {
    lp = (1 - a) * flow[i] + a * lp;
    out[i] = lp - prev; // radiation (first difference)
    prev = lp;
    energy += out[i] * out[i];
  }
  // Aspiration noise, pulsed with the glottal flow, added after radiation so
  // its level is set relative to the voiced signal (noise ~ -20 dB at b = 1).
  const level = 0.1 * noiseLevel * b * Math.sqrt(energy / N);
  if (level > 0) for (let i = 0; i < N; i++) out[i] += level * gauss() * (0.5 + flow[i]);
  return out;
}

/** Klatt cascade resonator applied in place. */
export function resonate(x, F, B, fs) {
  const T = 1 / fs;
  const C = -Math.exp(-2 * Math.PI * B * T);
  const Bc = 2 * Math.exp(-Math.PI * B * T) * Math.cos(2 * Math.PI * F * T);
  const A = 1 - Bc - C;
  let y1 = 0, y2 = 0;
  for (let i = 0; i < x.length; i++) {
    const y = A * x[i] + Bc * y1 + C * y2;
    y2 = y1; y1 = y; x[i] = y;
  }
  return x;
}

/**
 * Synthesise a vowel. formants: [{F, B}, ...] (cascade, all of them are used).
 * Returns Float32Array normalised to peak `peak`.
 */
export function synthVowel({
  f0, formants, fs = 48000, dur = 0.5, jitter = 0, shimmer = 0, breathiness = 0,
  noiseLevel = 1, peak = 0.5, seed = 1, openQuotient, alternate = 0,
}) {
  const x = glottalSource({ f0, fs, dur, jitter, shimmer, breathiness, noiseLevel, seed, openQuotient, alternate });
  for (const { F, B } of formants) if (F < fs / 2) resonate(x, F, B, fs);
  let m = 0;
  for (let i = 0; i < x.length; i++) m = Math.max(m, Math.abs(x[i]));
  const out = new Float32Array(x.length);
  const k = m > 0 ? peak / m : 0;
  for (let i = 0; i < x.length; i++) out[i] = x[i] * k;
  return out;
}

// Rough textbook-ish targets loosely based on Australian English (AusE)
// hVd vowels. These are SYNTHETIC TRUTH only, not norms; the research agent
// is sourcing real AusE values (Cox and colleagues).
// F4/F5 are fixed "neutral" upper resonances to make the spectrum realistic;
// only F1-F3 are checked.
const bw = (F) => 50 + 0.06 * F; // gentle frequency-dependent bandwidth
const set = (f1, f2, f3, f4, f5) => [f1, f2, f3, f4, f5].map((F) => ({ F, B: bw(F) }));

export const VOWELS = {
  male: {
    heed: set(290, 2250, 2950, 3600, 4500),
    had: set(680, 1650, 2500, 3600, 4500),
    hard: set(750, 1250, 2550, 3600, 4500),
    whod: set(320, 1750, 2350, 3600, 4500), // AusE /ʉː/ is strongly fronted
  },
  female: {
    heed: set(360, 2750, 3300, 4300, 5000),
    had: set(850, 1950, 2950, 4300, 5000),
    hard: set(920, 1500, 2850, 4300, 5000),
    whod: set(380, 2050, 2700, 4300, 5000),
  },
};

/** Take a centred frame of length n from a signal. */
export function centreFrame(x, n, offset = 0) {
  const s = Math.floor((x.length - n) / 2) + offset;
  return x.subarray(s, s + n);
}
