// Accuracy benchmark: every JS pitch / formant / tilt method vs Praat (and vs known truth on synth).
//   node bench.mjs          -> results/accuracy.json (+ results/tracks/*.json per file)
// Reads data/truth.json (praat_truth.py) and data/tilt_ref.json (tilt_ref.py).
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { readWav } from "./lib/wav.mjs";
import { frameAt, rmsDb, makeResampler } from "./lib/dsp.mjs";
import { FRAME, FMIN, FMAX, THRESH, makePitchMethods, essentiaOffline, makeFormantMethods, makeMeyda } from "./lib/methods.mjs";
import { makeH1H2, makeLtas } from "./lib/tilt.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const truth = JSON.parse(readFileSync(join(HERE, "data/truth.json"), "utf8"));
const tiltRef = Object.fromEntries(JSON.parse(readFileSync(join(HERE, "data/tilt_ref.json"), "utf8")).files.map((f) => [f.name, f]));
mkdirSync(join(HERE, "results/tracks"), { recursive: true });

const FS = 48000, HOP = 480; // offline trackers: 10 ms hop
const GATE_DB = 40; // common energy gate for all JS methods: frame RMS < (99th pct - 40 dB) => unvoiced
const ONLY = process.env.BENCH_ONLY; // optional substring filter on file names (debugging)

const pitchMethods = await makePitchMethods(FS);
const PITCH_NAMES = [...Object.keys(pitchMethods), "ess_pyin", "ess_melodia"];
const meyda = makeMeyda(FS);
const h1h2 = makeH1H2({ fs: FS });

const cents = (a, b) => 1200 * Math.log2(a / b);
const pct = (arr, q) => { if (!arr.length) return null; const s = [...arr].sort((x, y) => x - y); const i = (s.length - 1) * q, lo = Math.floor(i); return s[lo] + (s[Math.min(lo + 1, s.length - 1)] - s[lo]) * (i - lo); };
const r2 = (v, d = 2) => (v == null || !isFinite(v) ? null : Math.round(v * 10 ** d) / 10 ** d);

// --- accumulators: acc[group][method] = { abs:[], rawAbs:[], gross, octave, both, agree, n, refV, libVgivenRef, refU, libVgivenU }
const F0ACC = {};
function f0acc(group, meth) {
  F0ACC[group] ??= {};
  return (F0ACC[group][meth] ??= { abs: [], rawAbs: [], rawGross: 0, both: 0, gross: 0, octave: 0, agree: 0, n: 0, refV: 0, hit: 0, refU: 0, fa: 0 });
}
function addF0(group, meth, ref, est, raw) { // ref/est/raw: arrays (ref -1 = excluded frame, 0 = unvoiced)
  const a = f0acc(group, meth);
  for (let i = 0; i < ref.length; i++) {
    const r = ref[i];
    if (r < 0) continue;
    const ev = est[i] > 0;
    a.n++;
    if (r > 0) {
      a.refV++;
      if (raw[i] > 0) { const c = Math.abs(cents(raw[i], r)); a.rawAbs.push(c); if (c > 50) a.rawGross++; } else a.rawAbs.push(2400);
      if (ev) {
        a.hit++; a.agree++; a.both++;
        const c = Math.abs(cents(est[i], r));
        a.abs.push(c);
        if (c > 50) a.gross++;
        if (c > 600) a.octave++;
      }
    } else {
      a.refU++;
      if (ev) a.fa++; else a.agree++;
    }
  }
}
function summF0(a) {
  return {
    frames_both_voiced: a.both,
    median_abs_cents: r2(pct(a.abs, 0.5)), p95_abs_cents: r2(pct(a.abs, 0.95)),
    gross_gt50c_pct: r2((100 * a.gross) / Math.max(a.both, 1)), octave_gt600c_pct: r2((100 * a.octave) / Math.max(a.both, 1)),
    voicing_agreement_pct: r2((100 * a.agree) / Math.max(a.n, 1)), voiced_recall_pct: r2((100 * a.hit) / Math.max(a.refV, 1)),
    false_voiced_pct: a.refU ? r2((100 * a.fa) / a.refU) : null,
    raw_median_abs_cents: r2(pct(a.rawAbs, 0.5)), raw_p95_abs_cents: r2(pct(a.rawAbs, 0.95)), raw_gross_gt50c_pct: r2((100 * a.rawGross) / Math.max(a.refV, 1)),
  };
}

// --- formant accumulators: FACC[group][method] = { F1:{absHz:[],absPct:[]}, ..., missing, n }
const FACC = {};
function addFormant(group, meth, ref, est) {
  FACC[group] ??= {};
  const a = (FACC[group][meth] ??= { F1: { hz: [], pc: [] }, F2: { hz: [], pc: [] }, F3: { hz: [], pc: [] }, n: 0, missing: 0 });
  a.n++;
  if (!est || est.length < 3) { a.missing++; return; }
  for (let k = 0; k < 3; k++) {
    const d = Math.abs(est[k] - ref[k]);
    a["F" + (k + 1)].hz.push(d); a["F" + (k + 1)].pc.push((100 * d) / ref[k]);
  }
}
function summF(a) {
  const o = { frames: a.n, missing_pct: r2((100 * a.missing) / Math.max(a.n, 1)) };
  for (const k of ["F1", "F2", "F3"]) o[k] = { median_abs_hz: r2(pct(a[k].hz, 0.5), 0), median_abs_pct: r2(pct(a[k].pc, 0.5), 1), p90_abs_pct: r2(pct(a[k].pc, 0.9), 1), within10pct: r2((100 * a[k].pc.filter((x) => x <= 10).length) / Math.max(a[k].pc.length, 1), 1) };
  return o;
}

const groupOf = (f) => (f.kind === "real" ? "real" : f.group === "weight" ? "synth_weight" : `synth_${f.snr ? "snr" + f.snr : "clean"}`);
const perFile = [];
const tiltRows = [];
const resamplers = {};

for (const f of truth.files) {
  if (ONLY && !f.name.includes(ONLY)) continue;
  const t0 = Date.now();
  const { fs, x } = readWav(join(HERE, f.path));
  if (fs !== FS) throw new Error(`${f.name}: expected ${FS} Hz, got ${fs}`);
  const times = f.times, nT = times.length, group = groupOf(f);
  const track = { name: f.name, times, praat: f.f0_praat, truth: f.f0_true ?? null };

  // ---------------- pitch
  const levels = times.map((t) => rmsDb(frameAt(x, t * FS, FRAME)));
  const gate = pct(levels, 0.99) - GATE_DB;
  const est = {}, raw = {};
  for (const name of Object.keys(pitchMethods)) { est[name] = new Float64Array(nT); raw[name] = new Float64Array(nT); }
  for (let i = 0; i < nT; i++) {
    const fr = frameAt(x, times[i] * FS, FRAME);
    for (const [name, fn] of Object.entries(pitchMethods)) {
      let { f0, conf } = fn(fr);
      if (!(f0 >= FMIN * 0.9 && f0 <= FMAX * 1.1)) f0 = 0;
      raw[name][i] = f0;
      est[name][i] = f0 > 0 && conf >= THRESH[name] && levels[i] >= gate ? f0 : 0;
    }
  }
  // offline trackers: frame k centred at k*HOP (Essentia FrameCutter default startFromZero=false)
  const off = essentiaOffline(x, FS, HOP);
  for (const name of ["ess_pyin", "ess_melodia"]) {
    const tr = off[name];
    est[name] = new Float64Array(nT); raw[name] = new Float64Array(nT);
    if (!tr) { console.warn(f.name, name, off[name + "_error"]); continue; }
    for (let i = 0; i < nT; i++) {
      const k = Math.round((times[i] * FS) / HOP);
      const v = k >= 0 && k < tr.length ? tr[k] : 0;
      raw[name][i] = v > 0 ? v : 0;
      est[name][i] = v > 0 && levels[i] >= gate ? v : 0;
    }
  }
  const praatRef = f.f0_praat.map((v) => v);
  if (f.kind === "synth") {
    const tru = f.f0_true;
    // Praat itself vs truth
    addF0(group, "praat", tru, f.f0_praat, f.f0_praat);
    for (const name of PITCH_NAMES) { addF0(group, name, tru, est[name], raw[name]); addF0(group + "_vsPraat", name, tru.map((v, i) => (v < 0 ? -1 : praatRef[i])), est[name], raw[name]); }
  } else {
    for (const name of PITCH_NAMES) { addF0("real", name, praatRef, est[name], raw[name]); addF0("real:" + f.name, name, praatRef, est[name], raw[name]); }
  }
  for (const name of PITCH_NAMES) track[name] = Array.from(est[name], (v) => r2(v, 1));

  // ---------------- formants (resample to 2 x Praat ceiling)
  const fsL = 2 * f.praat_max_formant;
  resamplers[fsL] ??= makeResampler(FS, fsL);
  const xl = resamplers[fsL](x);
  const fm = makeFormantMethods(fsL);
  const fmTrack = {};
  for (const name of Object.keys(fm)) fmTrack[name] = [];
  // frame selection
  const sel = [];
  const P = f.formants_praat;
  if (f.kind === "synth") {
    if (f.group !== "weight") for (let i = 0; i < nT; i++) if (times[i] >= 0.1 && times[i] <= f.dur - 0.1) sel.push(i);
  } else {
    const inten = f.intensity, ithr = pct(inten.filter((v) => v > 0), 0.99) - 25;
    for (let i = 2; i < nT - 2; i++) {
      if (!(f.f0_praat[i] > 0) || inten[i] < ithr || P[i].some((v) => !(v > 0))) continue;
      let stable = true;
      for (let j = i - 2; j <= i + 2 && stable; j++) for (let k = 0; k < 3; k++) if (!(P[j][k] > 0) || Math.abs(P[j][k] - P[i][k]) / P[i][k] > 0.1) stable = false;
      if (stable) sel.push(i);
    }
  }
  for (const i of sel) {
    const c = times[i] * fsL;
    if (f.kind === "synth") addFormant(group, "praat", f.formants, P[i]);
    for (const [name, fn] of Object.entries(fm)) {
      const r = fn(xl, c);
      const F = r ? r.F : null;
      fmTrack[name].push(F ? F.map((v) => Math.round(v)) : null);
      if (f.kind === "synth") { addFormant(group, name, f.formants, F); addFormant(group + "_vsPraat", name, P[i], F); }
      else { addFormant("real", name, P[i], F); addFormant("real:" + f.name, name, P[i], F); }
    }
  }
  track.formant_frames = sel; track.formants_praat = sel.map((i) => P[i]); track.formants = fmTrack;

  // ---------------- tilt / weight (frames chosen by tilt_ref.py)
  const tr = tiltRef[f.name];
  if (tr) {
    const ltas = makeLtas({ fs: FS });
    const hhPraatF0 = [], hhPitchyF0 = [], hhDiff = [], meydaRows = [];
    tr.frames.forEach((i, j) => {
      const c = times[i] * FS;
      const v = h1h2(x, c, f.f0_praat[i]);
      if (isFinite(v)) { hhPraatF0.push(v); if (tr.h1h2[j] != null) hhDiff.push(v - tr.h1h2[j]); }
      const fp = est.pitchy[i];
      if (fp > 0) { const w = h1h2(x, c, fp); if (isFinite(w)) hhPitchyF0.push(w); }
      ltas.add(x, c);
      meydaRows.push(meyda(frameAt(x, c, FRAME)));
    });
    const mean = (k) => meydaRows.reduce((s, r) => s + r[k], 0) / Math.max(meydaRows.length, 1);
    tiltRows.push({
      name: f.name, group, tilt_db: f.tilt_db ?? null, open_phase: f.open_phase ?? null, frames: tr.frames.length,
      h1h2_py_median: tr.h1h2_median, h1h2_js_median: r2(pct(hhPraatF0, 0.5), 3), h1h2_js_minus_py_median_abs: r2(pct(hhDiff.map(Math.abs), 0.5), 4),
      h1h2_js_minus_py_p95_abs: r2(pct(hhDiff.map(Math.abs), 0.95), 4), h1h2_js_pitchyF0_median: r2(pct(hhPitchyF0, 0.5), 3),
      ltas_py_praat: tr.ltas_ratio_praat, ltas_py_welch: tr.ltas_ratio_welch, ltas_js: r2(ltas.ratio(), 3),
      meyda_spectralSlope_mean: mean("spectralSlope"), meyda_spectralCentroid_mean_bin: r2(mean("spectralCentroid"), 2),
      meyda_spectralCentroid_mean_hz: r2((mean("spectralCentroid") * FS) / FRAME, 1), meyda_spectralRolloff_mean_hz: r2(mean("spectralRolloff"), 1),
    });
  }
  writeFileSync(join(HERE, "results/tracks", f.name.replace(/\.wav$/, ".json")), JSON.stringify(track));
  perFile.push({ name: f.name, group, frames: nT, ms: Date.now() - t0 });
  process.stdout.write(`${f.name} (${Date.now() - t0} ms)\n`);
}

// ---------------- summaries
const f0Summary = {};
for (const [g, ms] of Object.entries(F0ACC)) { f0Summary[g] = {}; for (const [m, a] of Object.entries(ms)) f0Summary[g][m] = summF0(a); }
const fSummary = {};
for (const [g, ms] of Object.entries(FACC)) { fSummary[g] = {}; for (const [m, a] of Object.entries(ms)) fSummary[g][m] = summF(a); }

// tilt: rank agreement on the synthetic weight series (Spearman vs known tilt/OQ ordering) and vs python
function spearman(a, b) {
  const rk = (v) => { const idx = v.map((x, i) => [x, i]).sort((p, q) => p[0] - q[0]); const r = new Array(v.length); idx.forEach(([, i], k) => (r[i] = k)); return r; };
  const ra = rk(a), rb = rk(b), n = a.length, ma = (n - 1) / 2;
  let num = 0, da = 0, db = 0;
  for (let i = 0; i < n; i++) { num += (ra[i] - ma) * (rb[i] - ma); da += (ra[i] - ma) ** 2; db += (rb[i] - ma) ** 2; }
  return num / Math.sqrt(da * db);
}
const W = tiltRows.filter((r) => r.group === "synth_weight");
const tiltSummary = {
  h1h2_js_vs_py_median_abs_db_all_files: r2(pct(tiltRows.map((r) => r.h1h2_js_minus_py_median_abs).filter((v) => v != null), 0.5), 4),
  h1h2_js_vs_py_worst_p95_abs_db: r2(Math.max(...tiltRows.map((r) => r.h1h2_js_minus_py_p95_abs ?? 0)), 4),
  ltas_js_vs_py_welch_max_abs_db: r2(Math.max(...tiltRows.map((r) => Math.abs(r.ltas_js - r.ltas_py_welch))), 4),
  ltas_js_vs_praat_ltas_median_abs_db: r2(pct(tiltRows.map((r) => Math.abs(r.ltas_js - r.ltas_py_praat)), 0.5), 3),
  ltas_js_vs_praat_ltas_real_max_abs_db: r2(Math.max(...tiltRows.filter((r) => r.group === "real").map((r) => Math.abs(r.ltas_js - r.ltas_py_praat))), 3),
  weight_series: W.length ? {
    spearman_h1h2_vs_open_phase_within_tilt: [0, 10, 20, 30].map((t) => { const s = W.filter((r) => r.tilt_db === t); return r2(spearman(s.map((r) => r.h1h2_js_median), s.map((r) => r.open_phase)), 3); }),
    spearman_ltas_vs_tilt_within_oq: [0.4, 0.7, 0.9].map((o) => { const s = W.filter((r) => r.open_phase === o); return r2(spearman(s.map((r) => r.ltas_js), s.map((r) => -r.tilt_db)), 3); }),
    spearman_meyda_slope_vs_tilt_within_oq: [0.4, 0.7, 0.9].map((o) => { const s = W.filter((r) => r.open_phase === o); return r2(spearman(s.map((r) => r.meyda_spectralSlope_mean), s.map((r) => -r.tilt_db)), 3); }),
    spearman_meyda_centroid_vs_tilt_within_oq: [0.4, 0.7, 0.9].map((o) => { const s = W.filter((r) => r.open_phase === o); return r2(spearman(s.map((r) => r.meyda_spectralCentroid_mean_hz), s.map((r) => -r.tilt_db)), 3); }),
    spearman_meyda_centroid_vs_ltas_js_all12: r2(spearman(W.map((r) => r.meyda_spectralCentroid_mean_hz), W.map((r) => r.ltas_js)), 3),
  } : null,
};

const out = {
  generated: new Date().toISOString(), node: process.version, praat: truth.praat_version, parselmouth: truth.parselmouth,
  settings: { fs: FS, frame: FRAME, fmin: FMIN, fmax: FMAX, offline_hop: HOP, energy_gate_db_below_p99: GATE_DB, voicing_thresholds: THRESH,
    formant: { fs_lpc: "2 x Praat ceiling (10 kHz real/male synth, 11 kHz female synth)", window: "Praat Gaussian, 50 ms (= 2 x 0.025)", preemphasis_from_hz: 50 } },
  f0: f0Summary, formants: fSummary, tilt: { summary: tiltSummary, files: tiltRows }, files: perFile,
};
writeFileSync(join(HERE, "results/accuracy.json"), JSON.stringify(out, null, 1));
console.log("wrote results/accuracy.json");
