// Plays the procedural café (babble-synth.js) on an AudioContext. It runs on the
// mic's context, so closing the mic closes the café with it.

import { BABBLE_RATE, TALKERS, renderTalker, renderClatter, roomImpulse, babbleMix } from './babble-synth.js';

// Different loop lengths, so the room doesn't audibly repeat.
const talkerSeconds = (i) => 9.7 + 1.37 * i;
const CLATTER_SECONDS = 23;
const FADE_SEC = 0.6;
const WET = 0.45;

// The same room every time, so it's rendered once. That takes a moment on a
// phone, so the Practice view calls this ahead of time, when the page is idle.
let rendered = null;
export const prepareBabble = () => rendered ?? (rendered = {
  talkers: Array.from({ length: TALKERS }, (_, i) => renderTalker({ seconds: talkerSeconds(i), seed: 101 + i })),
  clatter: renderClatter({ seconds: CLATTER_SECONDS, seed: 7 }),
});

function toBuffer(ctx, channels, rate = BABBLE_RATE) {
  const buf = ctx.createBuffer(channels.length, channels[0].length, rate);
  channels.forEach((c, i) => buf.copyToChannel(c, i));
  return buf;
}

/** Starts the café at `level` (0 quiet .. 1 busy), fading in. Returns { setLevel, stop }. */
export function startBabble(ctx, level) {
  const { talkers, clatter } = prepareBabble();
  const now = ctx.currentTime;
  const master = ctx.createGain();
  master.gain.value = 0;
  master.connect(ctx.destination);
  const reverb = ctx.createConvolver();
  // A convolver's impulse has to be at the context's own rate (it's short, so cheap to render).
  reverb.buffer = toBuffer(ctx, roomImpulse({ rate: ctx.sampleRate }), ctx.sampleRate);
  const wet = ctx.createGain();
  wet.gain.value = WET;
  reverb.connect(wet).connect(master);

  const strand = (samples, pan, startFrac) => {
    const src = ctx.createBufferSource();
    src.buffer = toBuffer(ctx, [samples]);
    src.loop = true;
    const gain = ctx.createGain();
    gain.gain.value = 0;
    const panner = ctx.createStereoPanner?.();
    if (panner) panner.pan.value = pan;
    const out = panner ? src.connect(gain).connect(panner) : src.connect(gain);
    out.connect(master);
    out.connect(reverb);
    src.start(now, startFrac * (samples.length / BABBLE_RATE));
    return { src, gain };
  };
  // Spread around the listener, each loop starting at a different point.
  const voices = talkers.map((t, i) => strand(t, ((i * 0.37) % 1) * 1.2 - 0.6, (i * 0.618) % 1));
  const clinks = strand(clatter, 0.3, 0);

  const setLevel = (l) => {
    const mix = babbleMix(l), t = ctx.currentTime;
    voices.forEach((v, i) => v.gain.gain.setTargetAtTime(mix.talkers[i], t, 0.3));
    clinks.gain.gain.setTargetAtTime(mix.clatter, t, 0.3);
    master.gain.setTargetAtTime(mix.master, t, FADE_SEC);
  };
  setLevel(level);

  let stopped = false;
  const stop = () => {
    if (stopped || ctx.state === 'closed') { stopped = true; return; }
    stopped = true;
    const t = ctx.currentTime;
    master.gain.setTargetAtTime(0, t, 0.08);
    [...voices, clinks].forEach((v) => v.src.stop(t + 0.5));
    setTimeout(() => master.disconnect(), 600);
  };
  return { setLevel: (l) => { if (!stopped && ctx.state !== 'closed') setLevel(l); }, stop };
}
