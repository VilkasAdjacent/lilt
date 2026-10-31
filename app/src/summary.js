// Summaries of a recorded analysis trace. Pure, Node-testable.
// trace rows: [t, f0|null, dbfs|null, weight|null, f1|null, f2|null]

const finite = (a) => a.filter((v) => v != null && Number.isFinite(v));
export function quantile(arr, q) {
  const s = finite(arr).sort((a, b) => a - b);
  if (!s.length) return NaN;
  const i = (s.length - 1) * q, lo = Math.floor(i), hi = Math.ceil(i);
  return s[lo] + (s[hi] - s[lo]) * (i - lo);
}

export function summarize(trace, bands = [], { loudDb = -28, lightMax = 0.45 } = {}) {
  const voiced = trace.filter((r) => r[1] > 0);
  const f0 = voiced.map((r) => r[1]);
  const dur = trace.length ? trace[trace.length - 1][0] : 0;
  const inBand = voiced.filter((r) => bands.some((b) => r[1] >= b.lo && r[1] <= b.hi)).length;
  const loud = voiced.filter((r) => r[2] >= loudDb);
  const loudLight = loud.filter((r) => r[3] != null && r[3] <= lightMax).length;
  return {
    duration: dur,
    voicedFrac: trace.length ? voiced.length / trace.length : 0,
    f0Median: quantile(f0, 0.5),
    f0P10: quantile(f0, 0.1),
    f0P90: quantile(f0, 0.9),
    inBandFrac: voiced.length ? inBand / voiced.length : 0,
    weightMedian: quantile(voiced.map((r) => r[3]), 0.5),
    dbfsMedian: quantile(voiced.map((r) => r[2]), 0.5),
    loudFrac: voiced.length ? loud.length / voiced.length : 0,
    loudLightFrac: loud.length ? loudLight / loud.length : NaN, // of loud moments, how many were light
    f1Median: quantile(voiced.map((r) => r[4]), 0.5),
    f2Median: quantile(voiced.map((r) => r[5]), 0.5),
  };
}

export function fmtDuration(sec) {
  const s = Math.max(0, Math.round(sec));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
