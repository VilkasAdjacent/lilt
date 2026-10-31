// Voicing-threshold sweep on real recordings (vs Praat voicing + F0) for the viable
// per-frame trackers. Shows the recall / false-voicing / accuracy trade-off of each confidence.
//   node sweep.mjs -> results/voicing_sweep.json
import { readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { readWav } from "./lib/wav.mjs";
import { frameAt, rmsDb } from "./lib/dsp.mjs";
import { FRAME, FMIN, FMAX, makePitchMethods } from "./lib/methods.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const truth = JSON.parse(readFileSync(join(HERE, "data/truth.json"), "utf8"));
const FS = 48000, GATE_DB = 40;
const all = await makePitchMethods(FS);
const M = ["pitchy", "own_yin", "aubio_yin", "ess_yinfft"];
const TH = { pitchy: [0.5, 0.6, 0.7, 0.8, 0.85, 0.9, 0.95], own_yin: [0.5, 0.6, 0.7, 0.75, 0.8, 0.85, 0.9], aubio_yin: [0.5, 0.6, 0.7, 0.8, 0.85, 0.9], ess_yinfft: [0.3, 0.4, 0.5, 0.6, 0.7, 0.8] };
const rows = Object.fromEntries(M.map((m) => [m, []]));
for (const f of truth.files.filter((f) => f.kind === "real")) {
  const { x } = readWav(join(HERE, f.path));
  const lv = f.times.map((t) => rmsDb(frameAt(x, t * FS, FRAME)));
  const s = [...lv].sort((a, b) => a - b), gate = s[Math.floor(0.99 * (s.length - 1))] - GATE_DB;
  f.times.forEach((t, i) => {
    const fr = frameAt(x, t * FS, FRAME);
    for (const m of M) {
      let { f0, conf } = all[m](fr);
      if (!(f0 >= FMIN * 0.9 && f0 <= FMAX * 1.1) || lv[i] < gate) { f0 = 0; conf = -1; }
      rows[m].push([f.f0_praat[i], f0, conf]);
    }
  });
}
const out = {};
for (const m of M) {
  out[m] = TH[m].map((th) => {
    let refV = 0, hit = 0, refU = 0, fa = 0; const errs = [];
    for (const [r, f0, c] of rows[m]) {
      const v = f0 > 0 && c >= th;
      if (r > 0) { refV++; if (v) { hit++; errs.push(Math.abs(1200 * Math.log2(f0 / r))); } } else { refU++; if (v) fa++; }
    }
    errs.sort((a, b) => a - b);
    const q = (p) => errs.length ? errs[Math.floor(p * (errs.length - 1))] : null;
    return { threshold: th, recall_pct: +(100 * hit / refV).toFixed(1), false_voiced_pct: +(100 * fa / refU).toFixed(1), median_cents: +q(0.5).toFixed(2), p95_cents: +q(0.95).toFixed(1), gross_gt50c_pct: +(100 * errs.filter((e) => e > 50).length / Math.max(errs.length, 1)).toFixed(2) };
  });
}
writeFileSync(join(HERE, "results/voicing_sweep.json"), JSON.stringify({ generated: new Date().toISOString(), note: "real files pooled, vs Praat; common energy gate 40 dB below 99th pct", sweep: out }, null, 1));
for (const m of M) { console.log(m); for (const r of out[m]) console.log("  ", JSON.stringify(r)); }
