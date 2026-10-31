// Background-noise level at the mic, and the voice's own level on top of it.
// Pure, Node-testable.
//
// The floor is the median of recent unvoiced frames: between words the mic
// hears only the room, whether that's the app's café leaking from the speaker,
// noise from another device, or a real café. With headphones it stays at the
// quiet-room floor and nothing changes. A median rather than a low quantile,
// because babble swings several dB from frame to frame and the subtraction needs
// its typical power, not its quietest gaps. The user's own consonants can nudge
// it up during long stretches of talk; that over-subtracts, so the voice reads
// a little quieter, which is the safe side for a "don't push" drill.

import { quantile } from '../summary.js';

// A floor within this many dB of the "loud" threshold means the mic hears the
// noise well enough to shift loudness, weight and formant readings.
export const LEAK_MARGIN_DB = 12;

export class NoiseFloor {
  constructor({ sec = 6, q = 0.5, minFrames = 20 } = {}) {
    Object.assign(this, { sec, q, minFrames });
    this.buf = []; // {t, db}, oldest first
  }
  push(frame) {
    if (!frame.voiced && Number.isFinite(frame.dbfs)) this.buf.push({ t: frame.t, db: frame.dbfs });
    const cut = frame.t - this.sec;
    const stale = this.buf.findIndex((b) => b.t > cut);
    this.buf.splice(0, stale < 0 ? this.buf.length : stale);
  }
  /** dBFS, or NaN until there's enough to go on. */
  get db() { return this.buf.length >= this.minFrames ? quantile(this.buf.map((b) => b.db), this.q) : NaN; }
  clear() { this.buf.length = 0; }
}

/** The voice's own level: the mic level with the floor's power taken out (−Infinity if it's all floor). */
export function voiceDb(micDb, floorDb) {
  if (!Number.isFinite(floorDb)) return micDb;
  const voiceShare = 1 - 10 ** ((floorDb - micDb) / 10);
  return voiceShare > 0 ? micDb + 10 * Math.log10(voiceShare) : -Infinity;
}

export const hearsNoise = (floorDb, loudDb) => floorDb > loudDb - LEAK_MARGIN_DB;
