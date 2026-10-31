// Prints markdown tables from results/*.json (used to fill research/library_comparison.md).
//   node tables.mjs
import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
const HERE = dirname(fileURLToPath(import.meta.url));
const J = (p) => JSON.parse(readFileSync(join(HERE, "results", p), "utf8"));
const acc = J("accuracy.json");
const f = (v, d = 1) => (v == null ? "–" : Number(v).toFixed(d));

const groups = ["real", "synth_clean", "synth_snr40", "synth_snr20"];
console.log("\n### F0: median / p95 abs cents | gross>50c % | octave>600c % | voicing recall % (false-voiced %)\n");
const methods = Object.keys(acc.f0.real);
console.log("| method | " + groups.join(" | ") + " |");
console.log("|---|" + groups.map(() => "---").join("|") + "|");
for (const m of ["praat", ...methods]) {
  const cells = groups.map((g) => {
    const s = acc.f0[g]?.[m];
    if (!s) return "–";
    return `${f(s.median_abs_cents)} / ${f(s.p95_abs_cents)} · ${f(s.gross_gt50c_pct)}% · ${f(s.octave_gt600c_pct)}% · rec ${f(s.voiced_recall_pct, 0)}%${s.false_voiced_pct != null ? ` (fa ${f(s.false_voiced_pct, 0)}%)` : ""}`;
  });
  console.log(`| ${m} | ${cells.join(" | ")} |`);
}
console.log("\n### F0 raw (no voicing decision; all reference-voiced frames): median / p95 cents · gross %\n");
console.log("| method | " + groups.join(" | ") + " |");
console.log("|---|" + groups.map(() => "---").join("|") + "|");
for (const m of methods) console.log(`| ${m} | ${groups.map((g) => { const s = acc.f0[g]?.[m]; return s ? `${f(s.raw_median_abs_cents)} / ${f(s.raw_p95_abs_cents)} · ${f(s.raw_gross_gt50c_pct)}%` : "–"; }).join(" | ")} |`);

const realFiles = Object.keys(acc.f0).filter((g) => g.startsWith("real:"));
console.log("\n### F0 per real file (vs Praat): median / p95 cents · gross % · recall %\n");
const pm = ["pitchy", "own_yin", "aubio_yin", "aubio_yinfft", "ess_yin", "ess_yinfft", "ess_melodia", "ess_pyin"];
console.log("| file | " + pm.join(" | ") + " |");
console.log("|---|" + pm.map(() => "---").join("|") + "|");
for (const g of realFiles) console.log(`| ${g.slice(5)} | ${pm.map((m) => { const s = acc.f0[g][m]; return s ? `${f(s.median_abs_cents)} / ${f(s.p95_abs_cents)} · ${f(s.gross_gt50c_pct)}% · ${f(s.voiced_recall_pct, 0)}%` : "–"; }).join(" | ")} |`);

console.log("\n### Formants: median abs % error F1 / F2 / F3 (p90 F2 %) [frames]\n");
const fg = ["synth_clean", "synth_snr40", "synth_snr20", "synth_clean_vsPraat", "synth_snr40_vsPraat", "synth_snr20_vsPraat", "real"];
const fms = ["praat", ...Object.keys(acc.formants.real)];
console.log("| method | " + fg.join(" | ") + " |");
console.log("|---|" + fg.map(() => "---").join("|") + "|");
for (const m of fms) console.log(`| ${m} | ${fg.map((g) => { const s = acc.formants[g]?.[m]; return s ? `${f(s.F1.median_abs_pct)} / ${f(s.F2.median_abs_pct)} / ${f(s.F3.median_abs_pct)} (${f(s.F2.p90_abs_pct)}) [${s.frames}]` : "–"; }).join(" | ")} |`);
console.log("\n### Formants Hz (median abs): F1 / F2 / F3\n");
console.log("| method | " + fg.join(" | ") + " |");
console.log("|---|" + fg.map(() => "---").join("|") + "|");
for (const m of fms) console.log(`| ${m} | ${fg.map((g) => { const s = acc.formants[g]?.[m]; return s ? `${f(s.F1.median_abs_hz, 0)} / ${f(s.F2.median_abs_hz, 0)} / ${f(s.F3.median_abs_hz, 0)}` : "–"; }).join(" | ")} |`);
const rf = Object.keys(acc.formants).filter((g) => g.startsWith("real:"));
console.log("\n### Formants per real file vs Praat (own_lpc10): F1/F2/F3 median abs % [frames]\n");
for (const g of rf) { const s = acc.formants[g].own_lpc10; console.log(`| ${g.slice(5)} | ${f(s.F1.median_abs_pct)} / ${f(s.F2.median_abs_pct)} / ${f(s.F3.median_abs_pct)} | within10%: ${f(s.F1.within10pct, 0)}/${f(s.F2.within10pct, 0)}/${f(s.F3.within10pct, 0)} | [${s.frames}] |`); }

console.log("\n### Tilt\n");
console.log(JSON.stringify(acc.tilt.summary, null, 1));
console.log("\n| file | H1-H2 py | H1-H2 js | |js-py| med | H1-H2 js (pitchy F0) | LTAS Praat | LTAS py-welch | LTAS js | Meyda centroid Hz | Meyda slope |");
console.log("|---|---|---|---|---|---|---|---|---|---|");
for (const r of acc.tilt.files.filter((r) => r.group === "real" || r.group === "synth_weight"))
  console.log(`| ${r.name} | ${f(r.h1h2_py_median, 2)} | ${f(r.h1h2_js_median, 2)} | ${f(r.h1h2_js_minus_py_median_abs, 4)} | ${f(r.h1h2_js_pitchyF0_median, 2)} | ${f(r.ltas_py_praat, 2)} | ${f(r.ltas_py_welch, 2)} | ${f(r.ltas_js, 2)} | ${f(r.meyda_spectralCentroid_mean_hz, 0)} | ${r.meyda_spectralSlope_mean.toExponential(2)} |`);

if (existsSync(join(HERE, "results/size.json"))) {
  console.log("\n### Size\n");
  for (const r of J("size.json").rows) console.log(`| ${r.name} | ${r.error ? "ERR" : (r.min_bytes / 1024).toFixed(1)} | ${r.error ? "" : (r.min_gzip_bytes / 1024).toFixed(1)} | ${r.wasm_inlined ? (r.wasm_inlined.wasm_bytes / 1024).toFixed(0) + " KB inlined (" + (r.wasm_inlined.wasm_gzip_bytes / 1024).toFixed(0) + " KB gz raw)" : r.wasm_side_file ? (r.wasm_side_file.wasm_bytes / 1024).toFixed(0) + " KB side file (" + (r.wasm_side_file.wasm_gzip_bytes / 1024).toFixed(0) + " KB gz)" : "none"} | ${r.total_transfer_gzip_bytes ? (r.total_transfer_gzip_bytes / 1024).toFixed(1) : ""} |`);
}
if (existsSync(join(HERE, "results/speed.json"))) {
  const s = J("speed.json");
  console.log(`\n### Speed (${s.cpu}, Node ${s.node}, phone factor ${s.phone_factor})\n`);
  for (const [k, v] of Object.entries(s.results)) console.log(`| ${k} | ${v.desktop_median_ms.toFixed(3)} | ${v.desktop_p90_ms == null ? "–" : v.desktop_p90_ms.toFixed(3)} | ${v.phone_est_ms.toFixed(2)} |`);
}
