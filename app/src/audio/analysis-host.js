// Where per-frame analysis runs: a module Web Worker when the browser supports
// one, otherwise the main thread. Both paths have the same API:
//
//   const host = createAnalysisHost(onResult)
//   host.configure(sampleRate, choice)   start of a mic session (clears the frame)
//   host.setChoice(choice)               engine change mid-session
//   host.push(block, t, keep)            1024-sample block; keep = caller still needs it
//   host.mode                            'worker' | 'main'
//
// Worker path: blocks go over postMessage with their buffer TRANSFERRED (a copy
// is transferred when the caller keeps the block for recording). No
// SharedArrayBuffer, so GitHub Pages needs no COOP/COEP headers. If the worker
// falls more than MAX_IN_FLIGHT blocks behind, new blocks only slide the frame
// and are not analysed, so the display drops frames rather than lagging.
//
// Fallback: chosen by feature detection (does `new Worker(url, { type: 'module' })`
// read the `type` option?), never by user agent. A worker that fails to load or
// doesn't report ready within READY_TIMEOUT_MS also falls back to the main thread.

import { createAnalyzer } from '../analysis/index.js';
import { FRAME, pushBlock } from './frame.js';

const MAX_IN_FLIGHT = 4;
const READY_TIMEOUT_MS = 5000;

/** True if this browser supports module workers. No UA sniffing. */
export function supportsModuleWorker() {
  if (typeof Worker === 'undefined' || typeof URL === 'undefined' || typeof Blob === 'undefined') return false;
  let supported = false;
  let url = null;
  try {
    url = URL.createObjectURL(new Blob([''], { type: 'text/javascript' }));
    const w = new Worker(url, { get type() { supported = true; return 'module'; } });
    w.terminate();
  } catch { /* not supported, or blob workers blocked */ }
  if (url) URL.revokeObjectURL(url);
  return supported;
}

function mainThreadEngine(onResult) {
  let analyzer = null, ring = new Float32Array(FRAME), sampleRate = 48000;
  return {
    mode: 'main',
    configure(fs, choice) { sampleRate = fs; ring = new Float32Array(FRAME); analyzer = createAnalyzer({ sampleRate, ...choice }); },
    setChoice(choice) { analyzer = createAnalyzer({ sampleRate, ...choice }); },
    push(block, t) {
      pushBlock(ring, block);
      if (!analyzer) return;
      let res;
      try { res = analyzer.analyze(ring); } catch (err) { console.warn('analysis error', err); return; }
      res.t = t;
      onResult(res);
    },
  };
}

function workerEngine(onResult, onFail) {
  const w = new Worker(new URL('./analysis-worker.js', import.meta.url), { type: 'module' });
  let gen = 0, inFlight = 0, ready = false, failed = false, config = null;
  const fail = (why) => {
    if (failed) return;
    failed = true;
    clearTimeout(timer);
    try { w.terminate(); } catch { /* ignore */ }
    onFail(why, config);
  };
  const timer = setTimeout(() => { if (!ready) fail('worker did not start'); }, READY_TIMEOUT_MS);
  w.onerror = (e) => { if (!ready) { e.preventDefault && e.preventDefault(); fail(e.message || 'worker failed to load'); } else console.warn('analysis worker error', e.message || e); };
  w.onmessageerror = () => console.warn('analysis worker: message could not be decoded');
  w.onmessage = (e) => {
    const m = e.data;
    if (m.type === 'ready') { ready = true; clearTimeout(timer); return; }
    if (m.gen !== gen) return; // result from a previous session
    if (m.type === 'frame' || m.type === 'skip' || m.type === 'error') inFlight = Math.max(0, inFlight - 1);
    if (m.type === 'frame') onResult(m.res);
    else if (m.type === 'error') console.warn('analysis error (worker)', m.message);
  };
  return {
    mode: 'worker',
    get failed() { return failed; },
    configure(sampleRate, choice) {
      gen++; inFlight = 0;
      config = { sampleRate, choice };
      w.postMessage({ type: 'config', sampleRate, choice, gen, frame: FRAME });
    },
    setChoice(choice) {
      if (config) config.choice = choice;
      w.postMessage({ type: 'choice', choice });
    },
    push(block, t, keep) {
      if (failed) return;
      const b = keep ? block.slice() : block;
      const analyze = inFlight < MAX_IN_FLIGHT;
      inFlight++;
      w.postMessage({ type: 'block', block: b, t, gen, analyze }, [b.buffer]);
    },
  };
}

export function createAnalysisHost(onResult, { preferWorker = true, onModeChange = () => {} } = {}) {
  let engine;
  const useMain = (why, config) => {
    if (why) console.warn(`Lilt: analysis worker unavailable (${why}); analysing on the main thread.`);
    engine = mainThreadEngine(onResult);
    if (config) engine.configure(config.sampleRate, config.choice);
    onModeChange('main', why);
  };
  if (preferWorker && supportsModuleWorker()) {
    try { engine = workerEngine(onResult, useMain); } catch (err) { useMain(String((err && err.message) || err)); }
  } else {
    useMain(preferWorker ? 'module workers not supported' : '');
  }
  return {
    get mode() { return engine.mode; },
    configure: (fs, choice) => engine.configure(fs, choice),
    setChoice: (choice) => engine.setChoice(choice),
    push: (block, t, keep) => engine.push(block, t, keep),
  };
}
