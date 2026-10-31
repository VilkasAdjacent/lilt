// Bundle-size benchmark: esbuild (minify, ESM, browser) of the entry each library actually needs,
// then gzip -9 (node zlib). WASM: reports inlined base64 payloads (decoded) or the side .wasm file.
//   node size.mjs -> results/size.json
import { build } from "esbuild";
import { gzipSync } from "node:zlib";
import { readFileSync, writeFileSync, mkdirSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const NM = join(HERE, "node_modules");
mkdirSync(join(HERE, "results"), { recursive: true });

const entries = {
  pitchy: `export { PitchDetector } from "pitchy";`,
  // meyda/dist/esm imports "tslib" without declaring it (packaging bug in 5.6.3) -> use the shipped browser build
  meyda: `import "meyda/dist/web/meyda.min.js"; export default globalThis.Meyda;`,
  "essentia.js (core + wasm inlined as base64, essentia-wasm.es.js)": `export { EssentiaWASM } from "essentia.js/dist/essentia-wasm.es.js"; export { default as Essentia } from "essentia.js/dist/essentia.js-core.es.js";`,
  "essentia.js (core + essentia-wasm.web.js loader; .wasm fetched separately)": `export { EssentiaWASM } from "essentia.js/dist/essentia-wasm.web.js"; export { default as Essentia } from "essentia.js/dist/essentia.js-core.es.js";`,
  "aubiojs (wasm inlined as base64)": `export { default } from "aubiojs/build/aubio.esm.js";`,
  "own: YIN": `export { makeYin } from "./lib/yin.mjs";`,
  "own: LPC formants + resampler": `export { makeLpcFormants } from "./lib/lpc.mjs"; export { makeResampler } from "./lib/dsp.mjs";`,
  "own: H1-H2 + LTAS tilt": `export { makeH1H2, makeLtas } from "./lib/tilt.mjs";`,
  "own: all three": `export { makeYin } from "./lib/yin.mjs"; export { makeLpcFormants } from "./lib/lpc.mjs"; export { makeResampler } from "./lib/dsp.mjs"; export { makeH1H2, makeLtas } from "./lib/tilt.mjs";`,
};

function wasmInfo(text) {
  const m = text.match(/data:application\/octet-stream;base64,([A-Za-z0-9+/=]+)/);
  if (!m) return null;
  const bin = Buffer.from(m[1], "base64");
  return { inlined_base64_chars: m[1].length, wasm_bytes: bin.length, wasm_gzip_bytes: gzipSync(bin, { level: 9 }).length, magic_ok: bin.subarray(0, 4).toString("hex") === "0061736d" };
}

const rows = [];
for (const [name, contents] of Object.entries(entries)) {
  try {
    const r = await build({
      stdin: { contents, resolveDir: HERE, loader: "js" }, bundle: true, minify: true, format: "esm", platform: "browser",
      write: false, logLevel: "silent", external: ["fs", "path", "crypto", "module", "url"], target: "es2020",
    });
    const code = r.outputFiles[0].contents;
    const text = Buffer.from(code).toString("utf8");
    const row = { name, min_bytes: code.length, min_gzip_bytes: gzipSync(code, { level: 9 }).length, warnings: r.warnings.length };
    const w = wasmInfo(text);
    if (w) row.wasm_inlined = w;
    if (name.includes("web.js")) {
      const p = join(NM, "essentia.js/dist/essentia-wasm.web.wasm"), bin = readFileSync(p);
      row.wasm_side_file = { file: "essentia-wasm.web.wasm", wasm_bytes: statSync(p).size, wasm_gzip_bytes: gzipSync(bin, { level: 9 }).length };
      row.total_transfer_gzip_bytes = row.min_gzip_bytes + row.wasm_side_file.wasm_gzip_bytes;
    } else row.total_transfer_gzip_bytes = row.min_gzip_bytes;
    rows.push(row);
  } catch (e) {
    rows.push({ name, error: String(e.message || e).slice(0, 500) });
  }
}
writeFileSync(join(HERE, "results/size.json"), JSON.stringify({ generated: new Date().toISOString(), esbuild: (await import("esbuild")).version, rows }, null, 1));
for (const r of rows) console.log(r.name.padEnd(80), r.error ? "ERROR " + r.error : `${(r.min_bytes / 1024).toFixed(1)} KB min, ${(r.min_gzip_bytes / 1024).toFixed(1)} KB gz, total gz ${(r.total_transfer_gzip_bytes / 1024).toFixed(1)} KB${r.wasm_inlined ? `, inlined wasm ${(r.wasm_inlined.wasm_bytes / 1024).toFixed(0)} KB` : ""}`);
