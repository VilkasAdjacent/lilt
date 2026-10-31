// Display smoothing for the Live view. A time-windowed median: robust to the
// single-frame jumps LPC and pitch trackers make (an octave error or a formant
// swap moves a mean, but barely moves a median), and it holds a value briefly
// through consonants instead of dropping to "–" on every unvoiced frame.

export const SMOOTH_SEC = 1; // readouts and meters
export const AVG_SEC = 10;   // the slow "where your pitch sits" average

export class RollingMedian {
  constructor(sec) { this.sec = sec; this.buf = []; } // {t, v}, oldest first
  push(t, v) {
    if (Number.isFinite(v)) this.buf.push({ t, v });
    this.trim(t);
  }
  trim(now) {
    const cut = now - this.sec;
    let i = 0;
    while (i < this.buf.length && this.buf[i].t <= cut) i++;
    if (i) this.buf.splice(0, i);
  }
  /** Median of the samples within `sec` of `now`, or NaN if there are none. */
  value(now) {
    if (now != null) this.trim(now);
    const n = this.buf.length;
    if (!n) return NaN;
    const s = this.buf.map((b) => b.v).sort((a, b) => a - b);
    return n % 2 ? s[n >> 1] : (s[n / 2 - 1] + s[n / 2]) / 2;
  }
  get count() { return this.buf.length; }
  clear() { this.buf.length = 0; }
}
