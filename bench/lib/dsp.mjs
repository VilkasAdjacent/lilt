// Small DSP toolkit used by the roll-our-own estimators (no dependencies).

// ---- in-place iterative radix-2 complex FFT. re/im: Float64Array of length n (power of 2)
const twiddleCache = new Map();
function twiddles(n) {
  let t = twiddleCache.get(n);
  if (!t) {
    t = { c: new Float64Array(n / 2), s: new Float64Array(n / 2), rev: new Uint32Array(n) };
    for (let i = 0; i < n / 2; i++) { t.c[i] = Math.cos((2 * Math.PI * i) / n); t.s[i] = -Math.sin((2 * Math.PI * i) / n); }
    const bits = Math.log2(n);
    for (let i = 0; i < n; i++) { let r = 0; for (let b = 0; b < bits; b++) r |= ((i >> b) & 1) << (bits - 1 - b); t.rev[i] = r; }
    twiddleCache.set(n, t);
  }
  return t;
}
export function fft(re, im) {
  const n = re.length, { c, s, rev } = twiddles(n);
  for (let i = 0; i < n; i++) { const j = rev[i]; if (j > i) { let t = re[i]; re[i] = re[j]; re[j] = t; t = im[i]; im[i] = im[j]; im[j] = t; } }
  for (let size = 2; size <= n; size <<= 1) {
    const half = size >> 1, step = n / size;
    for (let start = 0; start < n; start += size) {
      for (let k = 0, w = 0; k < half; k++, w += step) {
        const a = start + k, b = a + half;
        const tr = re[b] * c[w] - im[b] * s[w], ti = re[b] * s[w] + im[b] * c[w];
        re[b] = re[a] - tr; im[b] = im[a] - ti; re[a] += tr; im[a] += ti;
      }
    }
  }
}
export const nextPow2 = (n) => 1 << Math.ceil(Math.log2(n));

// ---- windows
export function hann(n, symmetric = true) { // symmetric matches numpy.hanning
  const w = new Float64Array(n), d = symmetric ? n - 1 : n;
  for (let i = 0; i < n; i++) w[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / d);
  return w;
}
export function praatGaussian(n) { // Praat's Gaussian analysis window (as used by To Formant (burg))
  const w = new Float64Array(n), e12 = Math.exp(-12), mid = 0.5 * (n + 1);
  for (let i = 0; i < n; i++) { const t = (i + 1 - mid) / (n + 1); w[i] = (Math.exp(-48 * t * t) - e12) / (1 - e12); }
  return w;
}

// ---- arbitrary-ratio band-limited resampler (Kaiser-windowed sinc), offline or per chunk.
function bessel0(x) { let s = 1, t = 1; for (let k = 1; k < 30; k++) { t *= (x / (2 * k)) ** 2; s += t; } return s; }
export function resample(x, fsIn, fsOut, halfZeros = 12, beta = 8) {
  const ratio = fsOut / fsIn, cutoff = Math.min(1, ratio) * 0.95; // normalised to input Nyquist
  const nOut = Math.floor(x.length * ratio), y = new Float32Array(nOut);
  const half = Math.ceil(halfZeros / cutoff), ib0 = bessel0(beta);
  for (let j = 0; j < nOut; j++) {
    const t = j / ratio, c = Math.floor(t);
    let acc = 0;
    for (let k = c - half + 1; k <= c + half; k++) {
      if (k < 0 || k >= x.length) continue;
      const d = t - k, u = d / half;
      if (u <= -1 || u >= 1) continue;
      const arg = Math.PI * cutoff * d;
      const sinc = arg === 0 ? 1 : Math.sin(arg) / arg;
      acc += x[k] * cutoff * sinc * (bessel0(beta * Math.sqrt(1 - u * u)) / ib0);
    }
    y[j] = acc;
  }
  return y;
}

// Fast version with a precomputed kernel table (used for speed tests / realtime use).
export function makeResampler(fsIn, fsOut, halfZeros = 12, beta = 8, oversample = 256) {
  const ratio = fsOut / fsIn, cutoff = Math.min(1, ratio) * 0.95, half = Math.ceil(halfZeros / cutoff), ib0 = bessel0(beta);
  const tab = new Float64Array(half * oversample + 2);
  for (let i = 0; i < tab.length; i++) {
    const d = i / oversample, u = d / half;
    const arg = Math.PI * cutoff * d;
    tab[i] = u >= 1 ? 0 : cutoff * (arg === 0 ? 1 : Math.sin(arg) / arg) * bessel0(beta * Math.sqrt(1 - u * u)) / ib0;
  }
  return function (x, nOut = Math.floor(x.length * ratio)) {
    const y = new Float32Array(nOut);
    for (let j = 0; j < nOut; j++) {
      const t = j / ratio, c = Math.floor(t);
      let acc = 0;
      const k0 = Math.max(0, c - half + 1), k1 = Math.min(x.length - 1, c + half);
      for (let k = k0; k <= k1; k++) {
        const p = Math.abs(t - k) * oversample, i = p | 0, f = p - i;
        acc += x[k] * (tab[i] + f * (tab[i + 1] - tab[i]));
      }
      y[j] = acc;
    }
    return y;
  };
}

export function frameAt(x, centre, n) { // zero-padded frame of length n centred on sample index `centre`
  const f = new Float32Array(n), s = Math.round(centre) - (n >> 1);
  for (let i = 0; i < n; i++) { const k = s + i; if (k >= 0 && k < x.length) f[i] = x[k]; }
  return f;
}
export function rmsDb(f) { let s = 0; for (let i = 0; i < f.length; i++) s += f[i] * f[i]; return 10 * Math.log10(s / f.length + 1e-20); }
