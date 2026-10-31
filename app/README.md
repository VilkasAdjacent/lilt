# Lilt

A gentle, private voice-practice web app. It shows live pitch with target bands, loudness **next to** vocal weight ("loud but light"), formants, and recordings with WAV export. It's a static site with no server and no uploads. Audio never leaves the device.

## Run locally

```sh
npx serve app          # from the repo root, then open the printed http://localhost:3000
```

The mic needs a secure context. `localhost` works. To test on a phone over LAN you need https, for example `npx serve app --ssl-cert ... --ssl-key ...`, or a tunnel. Alternatively, deploy to Pages (below) and test there.

There's no build step. It's plain ES modules, and the dependencies are vendored in `vendor/`:
- pitchy 4.1.0 + fft.js, MIT
- Fredoka and Nunito fonts, OFL

The page does not use SharedArrayBuffer or need COOP/COEP headers.

## Test

```sh
cd app
npm test               # node --test: DSP recovery on synthetic vowels, WAV, summaries
npm run report         # prints the actual errors for every case (markdown)
```

Tolerances and current results are in [`test/README.md`](test/README.md). Node 20+ is needed. It was developed on Node 24.

## Deploy to GitHub Pages

Deployment is handled by `.github/workflows/pages.yml` at the repo root. See the root `README.md` for the one-time setup. The workflow runs `npm test`, then publishes **only** `index.html`, `src/` and `vendor/`. All paths are relative and routing uses the hash, so the app works under `https://<user>.github.io/<repo>/`.

Don't use "Deploy from a branch". It would publish the whole repo, including `research/`.

## Layout

```
index.html               all view markup (Home, Practice, Live, Record, Clips, Settings, About)
src/main.js              router, theme, session timer + rest nudge, tiny session, mic button
src/settings.js          settings (localStorage) + target bands
src/summary.js           per-recording stats (pure)
src/audio/capture.js     getUserMedia (EC/NS/AGC off + warning), AudioWorklet → ScriptProcessor
                         → MediaRecorder fallback, recording (PCM chunks stay on the main thread)
src/audio/analysis-host.js  runs analysis in a module Web Worker, or on the main thread as a fallback
src/audio/analysis-worker.js  the Worker: sliding 2048 frame + createAnalyzer()
src/audio/frame.js       sliding-frame helper shared by both paths
src/audio/capture-worklet.js
src/audio/wav.js         16-bit WAV encode/decode (pure)
src/store/db.js          IndexedDB recordings
src/ui/*.js              views + canvas drawing (practice.js: Practice tab + Home teaser)
src/practice/            pure, Node-testable
  exercises.js           the exercise pool (kinds, steps, what to watch, how to score) + shuffle
  feedback.js            utterance segmenter + per-attempt scorers (pitch step, F2 contrast, band, loud × light)
src/analysis/            ALL DSP. Pure functions on Float32Array, run in Node too
  index.js               plug-in registry + createAnalyzer() (the only thing the UI calls)
  pitch.js               pitchy (MPM), clarity ≥ 0.8, subharmonic guard
  formants-lpc10.js      "lpc10" (selectable): port of bench/lib/lpc.mjs. Resample to 10 kHz → pre-emphasis
                         from 50 Hz → Praat Gaussian → 10 poles → Durand–Kerner + Newton roots
  formants.js            "lpc12" (previous): decimate → 0.97 pre-emphasis → Hamming → 12 poles, BW < 500
  lpc.js                 autocorr, Levinson, root finding (shared)
  weight.js              H1–H2 + 1–4 kHz vs 50–1000 Hz tilt (ports of bench/lib/tilt.mjs),
                         Iseli–Alwan H1*–H2*, alpha ratio, weight 0..1
  dsp.js                 windows, FFT, decimation, Kaiser-sinc resampler, dBFS
test/                    synth.js (glottal source + formant cascade), cases.js, *.test.js
scripts/report.js        error tables
```

## Swapping analysis libraries

Each stage is an object `{ name, estimate(frame, sampleRate, ctx) }` with these return shapes:

- **pitch:** `{ f0, clarity }`
- **formants:** `{ f1, f2, f3, bw }`
- **weight:** `{ h1h2, h1h2c, tilt, alpha, weight }` (it may also return `ltasLo`/`ltasHi`, the band powers that `createAnalyzer` averages into `ltas`)

Current defaults: `pitchy` (clarity ≥ 0.8), **`lpc12`** formants (`lpc10` selectable; reverted as default until checked on real female speech) and `h1h2` weight. `createAnalyzer` also returns `f1Approx` (true when F0 > 200 Hz: F1 is probably on a harmonic, and the UI shows it greyed with "≈") and `ltas`, the tilt power-averaged over the last ~1 s of voiced frames. Old saved settings that name the formant engine `lpc` are mapped to `lpc12`.

The analysis modules are pure and DOM-free, because they run inside the Worker.

Write a module with that shape and `register('pitch', impl)` it in `analysis/index.js`. It then shows up in *Settings → Analysis engines*.

For WASM libraries (essentia.js, aubio), do the async init before registering, and keep `estimate` synchronous. Add the new implementation to the test loops in `test/analysis.test.js` so it gets the same tolerances.

## Where analysis runs

`analysis-host.js` sends each 1024-sample block to a **module Web Worker** (`analysis-worker.js`), which holds the sliding frame and posts results back as `frame` events.
- **Transfer:** the block's buffer is transferred with `postMessage`. While a PCM recording is running, a copy is transferred instead, so the main thread keeps the original. There is no SharedArrayBuffer, so GitHub Pages needs no COOP/COEP headers.
- **Backlog:** if the Worker falls more than 4 blocks behind, new blocks only slide the frame and aren't analysed. The display drops frames rather than lagging.
- **Fallback:** the main thread analyses when module workers aren't supported. That is decided by feature detection: does `new Worker(blobUrl, { type: 'module' })` read the `type` option? It never looks at the user agent. The same fallback applies when the Worker fails to load or doesn't report ready within 5 s.
- **Where to see it:** *Settings → Analysis engines* says which path is in use, and `lilt.mic.analysisMode` is `'worker'` or `'main'`.
- **Unchanged:** recording, WAV export and IndexedDB stay on the main thread.

## Known limitations

- **Why lpc12 is the default, not lpc10.** lpc10 reproduces Praat on real recordings (research/library_comparison.md). On this app's noise-free synthetic grid it misses F2/F3 on all 64 cases, because a spare pole lands between F1 and F2. With a noise floor it passes most male cases, but female vowels still fail. lpc12 passes 60 of 64. Numbers are in `test/README.md`. Check lpc10 on real female speech. lpc10 is selectable in Settings.
- LPC F1 locks onto a harmonic at high F0, for every method. It is biased toward 2·F0 on close vowels (ee/oo) from F0 ≈ 180 Hz, and the UI marks F1 "≈" above 200 Hz. See `test/README.md`.
- The weight score is an uncalibrated heuristic, and it depends on the vowel. The thresholds in `weight.js` are placeholders until there are real recordings.
- dBFS depends on the mic and browser. Use *Settings → "use my current level"* to set the "loud" threshold.
- Analysis runs about 47 frames/s (hop 1024 at 48 kHz) in the Worker. The research estimates ≈ 3.3 ms per frame, phone-scaled, for this pipeline.
- The tilt measure changed (now dB, 1–4 kHz vs 50–1000 Hz, not dB/octave), so weight scores from before this change aren't comparable with new ones.
- No offline service worker yet.
