// Canvas drawing: pitch trace with target bands, loud x light scatter,
// and SVG sparklines for the library. Colours come from CSS variables.

import { activeBands } from '../settings.js';

let palette = null;
export function refreshPalette() {
  const cs = getComputedStyle(document.documentElement);
  const v = (n) => cs.getPropertyValue(n).trim();
  palette = {
    ink: v('--ink'), soft: v('--ink-soft'), grid: v('--grid'), trace: v('--trace'), hot: v('--trace-hot'),
    pink: v('--pink'), purple: v('--purple'), sun: v('--sun'),
    band: {
      androgynous: [v('--band-a'), v('--band-a-line')],
      femme: [v('--band-f'), v('--band-f-line')],
      custom: [v('--band-c'), v('--band-c-line')],
    },
    font: v('--font-display'),
  };
  return palette;
}
export const colors = () => palette || refreshPalette();

/** Size a canvas's backing store to its CSS box * devicePixelRatio. */
export function fitCanvas(canvas) {
  const dpr = Math.min(window.devicePixelRatio || 1, 3);
  const r = canvas.getBoundingClientRect();
  const w = Math.max(1, Math.round(r.width * dpr)), h = Math.max(1, Math.round(r.height * dpr));
  if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
  return { ctx: canvas.getContext('2d'), w, h, dpr };
}

export const F_LO = 70, F_HI = 400;
const yOf = (f, h, pad) => {
  const t = (Math.log(f) - Math.log(F_LO)) / (Math.log(F_HI) - Math.log(F_LO));
  return pad + (1 - t) * (h - 2 * pad);
};

export const inAnyBand = (f0, bands = activeBands()) => bands.some((b) => f0 >= b.lo && f0 <= b.hi);

/**
 * Draw a pitch trace. points: [{t, f0}] (f0 NaN/null = gap).
 * tStart..tEnd is the visible window. playhead: optional t.
 */
export function drawPitchTrace(canvas, points, tStart, tEnd, { playhead = null, avg = NaN } = {}) {
  const P = colors();
  const { ctx, w, h, dpr } = fitCanvas(canvas);
  const pad = 8 * dpr;
  ctx.clearRect(0, 0, w, h);
  const bands = activeBands();

  // Bands
  for (const b of bands) {
    const [fill, line] = P.band[b.kind] || P.band.custom;
    const y1 = yOf(b.hi, h, pad), y2 = yOf(b.lo, h, pad);
    ctx.fillStyle = fill;
    ctx.fillRect(0, y1, w, y2 - y1);
    ctx.strokeStyle = line;
    ctx.lineWidth = 1.5 * dpr;
    ctx.setLineDash([6 * dpr, 5 * dpr]);
    ctx.beginPath(); ctx.moveTo(0, y1); ctx.lineTo(w, y1); ctx.moveTo(0, y2); ctx.lineTo(w, y2); ctx.stroke();
    ctx.setLineDash([]);
  }
  // Grid labels
  ctx.font = `600 ${11 * dpr}px ${P.font}`;
  ctx.textBaseline = 'middle';
  for (const f of [100, 150, 200, 250, 300]) {
    const y = yOf(f, h, pad);
    ctx.strokeStyle = P.grid; ctx.lineWidth = 1 * dpr;
    ctx.beginPath(); ctx.moveTo(30 * dpr, y); ctx.lineTo(w, y); ctx.stroke();
    ctx.fillStyle = P.soft;
    ctx.fillText(String(f), 4 * dpr, y);
  }
  // Trace. Live points carry f0s (1 s median): draw raw f0 thin and faint
  // underneath, the smoothed line bold on top. Recorded traces have only f0.
  const span = Math.max(1e-3, tEnd - tStart);
  const xOf = (t) => ((t - tStart) / span) * w;
  const hasSmooth = points.some((p) => p.f0s > 0);
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  const line = (key, width, alpha, maxGap) => {
    ctx.lineWidth = width * dpr; ctx.globalAlpha = alpha;
    let prev = null;
    for (const p of points) {
      if (p.t < tStart - 0.2) { prev = null; continue; }
      const ok = p[key] > 0;
      if (ok && prev && p.t - prev.t < maxGap) {
        ctx.strokeStyle = inAnyBand(p[key], bands) ? P.hot : P.trace;
        ctx.beginPath();
        ctx.moveTo(xOf(prev.t), yOf(clampF(prev[key]), h, pad));
        ctx.lineTo(xOf(p.t), yOf(clampF(p[key]), h, pad));
        ctx.stroke();
      }
      prev = ok ? p : null;
    }
    ctx.globalAlpha = 1;
  };
  if (hasSmooth) { line('f0', 1.5, 0.35, 0.12); line('f0s', 4, 1, 0.12); } else line('f0', 3.5, 1, 0.12);
  // 10 s average: dashed line across the trace, with its value at the left.
  if (avg > 0) {
    const y = yOf(clampF(avg), h, pad);
    ctx.strokeStyle = P.ink; ctx.lineWidth = 2 * dpr; ctx.setLineDash([10 * dpr, 6 * dpr]);
    ctx.beginPath(); ctx.moveTo(30 * dpr, y); ctx.lineTo(w, y); ctx.stroke(); ctx.setLineDash([]);
    ctx.fillStyle = P.ink; ctx.font = `700 ${11 * dpr}px ${P.font}`; ctx.textBaseline = 'bottom';
    ctx.fillText(`avg ${Math.round(avg)}`, 34 * dpr, y - 2 * dpr);
  }
  // Current dot (live mode: last point at right edge)
  const last = points[points.length - 1];
  const lastF = last && (hasSmooth ? last.f0s : last.f0);
  if (playhead == null && lastF > 0 && tEnd - last.t < 0.15) {
    const x = xOf(last.t), y = yOf(clampF(lastF), h, pad);
    ctx.fillStyle = inAnyBand(lastF, bands) ? P.pink : P.purple;
    ctx.strokeStyle = P.ink; ctx.lineWidth = 2.5 * dpr;
    ctx.beginPath(); ctx.arc(Math.min(x, w - 9 * dpr), y, 7 * dpr, 0, 2 * Math.PI); ctx.fill(); ctx.stroke();
  }
  if (playhead != null) {
    const x = xOf(playhead);
    ctx.strokeStyle = P.ink; ctx.lineWidth = 2 * dpr;
    ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke();
  }
}
const clampF = (f) => Math.min(F_HI, Math.max(F_LO, f));

/**
 * Loudness (x) vs weight (y, light at top) scatter of recent points.
 * pts: [{dbfs, weight, age}] age 0..1 (1 = oldest).
 */
export function drawScatter(canvas, pts, { loudDb, lightMax, xMin = -60, xMax = -5, you = null }) {
  const P = colors();
  const { ctx, w, h, dpr } = fitCanvas(canvas);
  ctx.clearRect(0, 0, w, h);
  const pad = 10 * dpr;
  const xOf = (d) => pad + ((Math.min(xMax, Math.max(xMin, d)) - xMin) / (xMax - xMin)) * (w - 2 * pad);
  const yOf = (wt) => pad + Math.min(1, Math.max(0, wt)) * (h - 2 * pad);
  // Sweet spot
  const xs = xOf(loudDb), ys = yOf(lightMax);
  ctx.fillStyle = P.band.femme[0];
  roundRect(ctx, xs, pad, w - pad - xs, ys - pad, 12 * dpr); ctx.fill();
  ctx.strokeStyle = P.band.femme[1]; ctx.setLineDash([6 * dpr, 5 * dpr]); ctx.lineWidth = 1.5 * dpr;
  roundRect(ctx, xs, pad, w - pad - xs, ys - pad, 12 * dpr); ctx.stroke(); ctx.setLineDash([]);
  // Labels
  ctx.fillStyle = P.soft; ctx.font = `600 ${11 * dpr}px ${P.font}`;
  ctx.textBaseline = 'top'; ctx.textAlign = 'right';
  ctx.fillText('loud & light ✦', w - pad - 6 * dpr, pad + 6 * dpr);
  ctx.textAlign = 'left'; ctx.fillText('light', pad + 4 * dpr, pad + 4 * dpr);
  ctx.textBaseline = 'bottom'; ctx.fillText('heavy', pad + 4 * dpr, h - pad - 2 * dpr);
  ctx.textAlign = 'right'; ctx.fillText('louder →', w - pad - 4 * dpr, h - pad - 2 * dpr);
  ctx.textAlign = 'left';
  // Points
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i];
    if (!Number.isFinite(p.dbfs) || !Number.isFinite(p.weight)) continue;
    const sweet = p.dbfs >= loudDb && p.weight <= lightMax;
    ctx.globalAlpha = 0.15 + 0.85 * (1 - p.age);
    ctx.fillStyle = sweet ? P.hot : P.purple;
    ctx.beginPath(); ctx.arc(xOf(p.dbfs), yOf(p.weight), (you ? 3 : i === pts.length - 1 ? 7 : 4) * dpr, 0, 2 * Math.PI); ctx.fill();
  }
  ctx.globalAlpha = 1;
  // "You": the 1 s median, a big outlined dot that moves calmly over the cloud.
  if (you && Number.isFinite(you.dbfs) && Number.isFinite(you.weight)) {
    const sweet = you.dbfs >= loudDb && you.weight <= lightMax;
    ctx.fillStyle = sweet ? P.pink : P.purple;
    ctx.strokeStyle = P.ink; ctx.lineWidth = 2.5 * dpr;
    ctx.beginPath(); ctx.arc(xOf(you.dbfs), yOf(you.weight), 9 * dpr, 0, 2 * Math.PI); ctx.fill(); ctx.stroke();
  }
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  if (w <= 0 || h <= 0) return;
  r = Math.min(r, w / 2, h / 2);
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
}

/** Small SVG sparkline of a recorded trace's pitch. */
export function sparklineSvg(trace) {
  const NS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', '0 0 100 40');
  svg.setAttribute('preserveAspectRatio', 'none');
  svg.setAttribute('aria-hidden', 'true');
  const H = 40, yv = (f) => H - ((Math.log(clampF(f)) - Math.log(F_LO)) / (Math.log(F_HI) - Math.log(F_LO))) * H;
  for (const b of activeBands()) {
    const r = document.createElementNS(NS, 'rect');
    r.setAttribute('x', 0); r.setAttribute('width', 100);
    r.setAttribute('y', yv(b.hi)); r.setAttribute('height', Math.max(0, yv(b.lo) - yv(b.hi)));
    svg.appendChild(r);
  }
  const dur = trace.length ? trace[trace.length - 1][0] || 1 : 1;
  let seg = [];
  const flush = () => {
    if (seg.length > 1) {
      const pl = document.createElementNS(NS, 'polyline');
      pl.setAttribute('points', seg.join(' '));
      svg.appendChild(pl);
    }
    seg = [];
  };
  let lastT = -1;
  const step = Math.max(1, Math.floor(trace.length / 300));
  for (let i = 0; i < trace.length; i += step) {
    const [t, f0] = trace[i];
    if (!(f0 > 0) || t - lastT > 0.15 * step) flush();
    if (f0 > 0) seg.push(`${((t / dur) * 100).toFixed(2)},${yv(f0).toFixed(2)}`);
    lastT = t;
  }
  flush();
  return svg;
}
