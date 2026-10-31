// Module Web Worker: per-frame analysis off the main thread.
//
// Protocol (all plain postMessage; no SharedArrayBuffer, so no COOP/COEP):
//   in : { type: 'config', sampleRate, choice, gen }      new analyzer + cleared frame
//        { type: 'choice', choice }                       new analyzer, keep the frame
//        { type: 'block', block: Float32Array, t, gen, analyze }   (block buffer transferred)
//   out: { type: 'ready' }
//        { type: 'frame', res, gen }                      res as analysis/index.js returns it, plus t
//        { type: 'skip', gen }                            block consumed, not analysed (backlog)
//        { type: 'error', message, gen }

import { createAnalyzer } from '../analysis/index.js';
import { pushBlock } from './frame.js';

let analyzer = null, sampleRate = 48000, ring = null, gen = 0;

self.onmessage = (e) => {
  const m = e.data;
  if (m.type === 'config') {
    sampleRate = m.sampleRate;
    gen = m.gen;
    ring = new Float32Array(m.frame);
    analyzer = createAnalyzer({ sampleRate, ...m.choice });
  } else if (m.type === 'choice') {
    analyzer = createAnalyzer({ sampleRate, ...m.choice });
  } else if (m.type === 'block') {
    if (!ring || m.gen !== gen) return; // stale block from a previous session
    pushBlock(ring, m.block);
    if (!m.analyze || !analyzer) { self.postMessage({ type: 'skip', gen }); return; }
    try {
      const res = analyzer.analyze(ring);
      res.t = m.t;
      self.postMessage({ type: 'frame', res, gen });
    } catch (err) {
      self.postMessage({ type: 'error', message: String((err && err.message) || err), gen });
    }
  }
};

self.postMessage({ type: 'ready' });
