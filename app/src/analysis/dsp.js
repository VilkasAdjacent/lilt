// Small, dependency-free DSP helpers. Everything here is a pure function on
// Float32Array / Float64Array so it runs identically in the browser and Node.

/** Hamming window of length n (cached). */
const winCache = new Map();
function cachedWindow(kind, n) {
  const key = kind + n;
  let w = winCache.get(key);
  if (!w) {
    w = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      const c = Math.cos((2 * Math.PI * i) / (n - 1));
      w[i] = kind === 'hamming' ? 0.54 - 0.46 * c : 0.5 - 0.5 * c;
    }
    winCache.set(key, w);
  }
  return w;
}
export const hamming = (n) => cachedWindow('hamming', n);
export const hann = (n) => cachedWindow('hann', n);

/** y[n] = x[n] - a*x[n-1] */
export function preEmphasis(x, a = 0.97) {
  const y = new Float64Array(x.length);
  y[0] = x[0];
  for (let i = 1; i < x.length; i++) y[i] = x[i] - a * x[i - 1];
  return y;
}

/** RMS of a signal. */
export function rms(x) {
  let s = 0;
  for (let i = 0; i < x.length; i++) s += x[i] * x[i];
  return Math.sqrt(s / Math.max(1, x.length));
}

/** RMS level in dB re digital full scale 1.0 (a full-scale sine reads -3.01). */
export function dbfs(x) {
  return 20 * Math.log10(Math.max(rms(x), 1e-9));
}

// ---------------------------------------------------------------------------
// Decimation: windowed-sinc low-pass FIR then keep every `factor`-th sample.
const firCache = new Map();
function lowpassFir(factor, taps) {
  const key = factor + ':' + taps;
  let h = firCache.get(key);
  if (h) return h;
  h = new Float64Array(taps);
  const fc = 0.9 / (2 * factor); // cutoff as fraction of input fs (0.45 of new fs)
  const m = (taps - 1) / 2;
  let sum = 0;
  for (let i = 0; i < taps; i++) {
    const t = i - m;
    const sinc = t === 0 ? 2 * fc : Math.sin(2 * Math.PI * fc * t) / (Math.PI * t);
    const w = 0.42 - 0.5 * Math.cos((2 * Math.PI * i) / (taps - 1)) + 0.08 * Math.cos((4 * Math.PI * i) / (taps - 1)); // Blackman
    h[i] = sinc * w;
    sum += h[i];
  }
  for (let i = 0; i < taps; i++) h[i] /= sum;
  firCache.set(key, h);
  return h;
}

/** Integer factor chosen so the new rate is >= minRate (default 10 kHz). */
export function decimationFactor(fs, minRate = 10000) {
  return Math.max(1, Math.floor(fs / minRate));
}

/** Low-pass and decimate by an integer factor. Returns Float64Array. */
export function decimate(x, factor) {
  if (factor <= 1) return Float64Array.from(x);
  const taps = 8 * factor * 2 + 1;
  const h = lowpassFir(factor, taps);
  const m = (taps - 1) / 2;
  const outLen = Math.floor(x.length / factor);
  const y = new Float64Array(outLen);
  for (let o = 0; o < outLen; o++) {
    const c = o * factor;
    let acc = 0;
    for (let k = 0; k < taps; k++) {
      const idx = c + k - m;
      if (idx >= 0 && idx < x.length) acc += h[k] * x[idx];
    }
    y[o] = acc;
  }
  return y;
}

// ---------------------------------------------------------------------------
// Radix-2 complex FFT (in place). re/im are Float64Array of power-of-two size.
export function fft(re, im) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      let t = re[i]; re[i] = re[j]; re[j] = t;
      t = im[i]; im[i] = im[j]; im[j] = t;
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    const wr = Math.cos(ang), wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const a = i + k, b = a + len / 2;
        const tr = re[b] * cr - im[b] * ci;
        const ti = re[b] * ci + im[b] * cr;
        re[b] = re[a] - tr; im[b] = im[a] - ti;
        re[a] += tr; im[a] += ti;
        const ncr = cr * wr - ci * wi;
        ci = cr * wi + ci * wr;
        cr = ncr;
      }
    }
  }
}

export function nextPow2(n) {
  let p = 1;
  while (p < n) p <<= 1;
  return p;
}

/**
 * Hann-windowed magnitude spectrum in dB, zero-padded to nfft.
 * Returns { db: Float64Array(nfft/2+1), binHz }.
 */
export function magnitudeSpectrumDb(x, fs, nfft = nextPow2(x.length) * 2) {
  const w = hann(x.length);
  const re = new Float64Array(nfft), im = new Float64Array(nfft);
  let wsum = 0;
  for (let i = 0; i < x.length; i++) { re[i] = x[i] * w[i]; wsum += w[i]; }
  fft(re, im);
  const half = nfft / 2 + 1;
  const db = new Float64Array(half);
  const norm = 2 / wsum; // sinusoid of amplitude A reads ~ 20log10(A)
  for (let k = 0; k < half; k++) {
    db[k] = 20 * Math.log10(Math.hypot(re[k], im[k]) * norm + 1e-12);
  }
  return { db, binHz: fs / nfft };
}

// ---------------------------------------------------------------------------
// Ported from bench/lib/dsp.mjs (the benchmarked implementations).

/** Hann window; symmetric (numpy.hanning) or periodic. Cached. */
const hannCache = new Map();
export function hannWindow(n, symmetric = true) {
  const key = n + (symmetric ? 's' : 'p');
  let w = hannCache.get(key);
  if (!w) {
    w = new Float64Array(n);
    const d = symmetric ? n - 1 : n;
    for (let i = 0; i < n; i++) w[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / d);
    hannCache.set(key, w);
  }
  return w;
}

/** Praat's Gaussian analysis window (as used by To Formant (burg)). Cached. */
const gaussCache = new Map();
export function praatGaussian(n) {
  let w = gaussCache.get(n);
  if (!w) {
    w = new Float64Array(n);
    const e12 = Math.exp(-12), mid = 0.5 * (n + 1);
    for (let i = 0; i < n; i++) { const t = (i + 1 - mid) / (n + 1); w[i] = (Math.exp(-48 * t * t) - e12) / (1 - e12); }
    gaussCache.set(n, w);
  }
  return w;
}

function bessel0(x) { let s = 1, t = 1; for (let k = 1; k < 30; k++) { t *= (x / (2 * k)) ** 2; s += t; } return s; }

/**
 * Arbitrary-ratio band-limited resampler (Kaiser-windowed sinc, cutoff 0.95 x the
 * lower Nyquist) with a precomputed kernel table. Returns fn(x, nOut?) -> Float32Array.
 * Cached per (fsIn, fsOut).
 */
const resamplerCache = new Map();
export function makeResampler(fsIn, fsOut, halfZeros = 12, beta = 8, oversample = 256) {
  const key = `${fsIn}:${fsOut}:${halfZeros}:${beta}:${oversample}`;
  const cached = resamplerCache.get(key);
  if (cached) return cached;
  const ratio = fsOut / fsIn, cutoff = Math.min(1, ratio) * 0.95, half = Math.ceil(halfZeros / cutoff), ib0 = bessel0(beta);
  const tab = new Float64Array(half * oversample + 2);
  for (let i = 0; i < tab.length; i++) {
    const d = i / oversample, u = d / half;
    const arg = Math.PI * cutoff * d;
    tab[i] = u >= 1 ? 0 : cutoff * (arg === 0 ? 1 : Math.sin(arg) / arg) * bessel0(beta * Math.sqrt(1 - u * u)) / ib0;
  }
  const fn = function (x, nOut = Math.floor(x.length * ratio)) {
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
  resamplerCache.set(key, fn);
  return fn;
}
