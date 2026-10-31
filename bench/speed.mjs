// Per-frame compute time in Node (V8), single thread.
//   node speed.mjs -> results/speed.json
// Frames: 2048 samples @ 48 kHz (42.7 ms window) taken every 10 ms from a real voiced recording.
// Each method is run on BATCH consecutive frames; time/frame = batch time / BATCH; we report the
// median (and p90) over all batches after a warm-up pass (JIT + wasm tier-up).
import { writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import os from "node:os";
import { readWav } from "./lib/wav.mjs";
import { frameAt, makeResampler } from "./lib/dsp.mjs";
import { FRAME, makePitchMethods, essentiaOffline, makeFormantMethods, makeMeyda } from "./lib/methods.mjs";
import { makeH1H2, makeLtas } from "./lib/tilt.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
mkdirSync(join(HERE, "results"), { recursive: true });
const FS = 48000, NFR = 1200, BATCH = 50;
const PHONE_FACTOR = Number(process.env.PHONE_FACTOR || 4); // see research/library_comparison.md

const { x } = readWav(join(HERE, "../analysis/cache/baseline/02_sustained.wav"));
const start = Math.floor(2 * FS);
const frames = Array.from({ length: NFR }, (_, i) => frameAt(x, start + i * 480, FRAME));

function timeIt(fn) {
  for (let i = 0; i < 200; i++) fn(frames[i % NFR], i % NFR); // warm-up
  const per = [];
  for (let rep = 0; rep < 2; rep++)
    for (let b = 0; b + BATCH <= NFR; b += BATCH) {
      const t0 = process.hrtime.bigint();
      for (let i = b; i < b + BATCH; i++) fn(frames[i], i);
      per.push(Number(process.hrtime.bigint() - t0) / 1e6 / BATCH);
    }
  per.sort((a, b) => a - b);
  return { median_ms: per[per.length >> 1], p90_ms: per[Math.floor(per.length * 0.9)] };
}

const res = {};
const pm = await makePitchMethods(FS);
for (const [name, fn] of Object.entries(pm)) res["pitch:" + name] = timeIt((f) => fn(f));

// formants: includes resampling a 48 kHz chunk (window + filter tails) to 10 kHz, then LPC analysis
const fsL = 10000, rs = makeResampler(FS, fsL), fm = makeFormantMethods(fsL);
const chunkLen = Math.ceil(0.05 * FS) + 2 * 300; // 50 ms window + resampler tails (approx.)
for (const [name, fn] of Object.entries(fm)) {
  res["formant:" + name + " (incl. resample)"] = timeIt((f, i) => {
    const c = x.subarray(start + i * 480 - (chunkLen >> 1), start + i * 480 + (chunkLen >> 1));
    const y = rs(c);
    return fn(y, y.length / 2);
  });
}
{ // LPC analysis only, on a pre-resampled signal
  const xl = rs(x.subarray(start - FS, start + NFR * 480 + FS));
  for (const [name, fn] of Object.entries(fm)) res["formant:" + name + " (LPC only)"] = timeIt((f, i) => fn(xl, (FS + i * 480) * fsL / FS));
}

const h = makeH1H2({ fs: FS });
res["tilt:H1-H2 (nfft 16384)"] = timeIt((f, i) => h(x, start + i * 480, 120));
const h4 = makeH1H2({ fs: FS, nfft: 8192 });
res["tilt:H1-H2 (nfft 8192)"] = timeIt((f, i) => h4(x, start + i * 480, 120));
const lt = makeLtas({ fs: FS });
res["tilt:LTAS accumulate (2048 FFT)"] = timeIt((f, i) => lt.add(x, start + i * 480));
const mey = makeMeyda(FS);
res["tilt:meyda slope+centroid+rolloff+flatness"] = timeIt((f) => mey(f));

// offline Essentia trackers: whole-signal call on 10 s, reported per 10 ms hop
{
  const seg = x.subarray(start, start + 10 * FS);
  essentiaOffline(seg.subarray(0, FS), FS, 480);
  const t0 = process.hrtime.bigint();
  essentiaOffline(seg, FS, 480);
  const ms = Number(process.hrtime.bigint() - t0) / 1e6;
  res["pitch:ess_pyin+ess_melodia (offline, both, per 10 ms hop)"] = { median_ms: ms / 1000, p90_ms: null };
}

const out = {
  generated: new Date().toISOString(), node: process.version, v8: process.versions.v8,
  cpu: os.cpus()[0].model, cores: os.cpus().length, frame: `${FRAME} samples @ ${FS} Hz, hop 10 ms`,
  phone_factor: PHONE_FACTOR, budget_note: "real-time budget at 10 ms hop = 10 ms/frame on the audio thread; AudioWorklet render quantum = 128 samples (2.67 ms @ 48 kHz)",
  results: Object.fromEntries(Object.entries(res).map(([k, v]) => [k, { desktop_median_ms: +v.median_ms.toFixed(4), desktop_p90_ms: v.p90_ms == null ? null : +v.p90_ms.toFixed(4), phone_est_ms: +(v.median_ms * PHONE_FACTOR).toFixed(3) }])),
};
writeFileSync(join(HERE, "results/speed.json"), JSON.stringify(out, null, 1));
console.log(out.cpu, out.node);
for (const [k, v] of Object.entries(out.results)) console.log(k.padEnd(64), v.desktop_median_ms.toFixed(4), "ms  phone~", v.phone_est_ms);
