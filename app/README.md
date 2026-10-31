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

## Offline

After the first online visit, the service worker (`sw.js`) has every published file cached, so the app opens and works offline. Online it always fetches first, so a deploy shows up on the next load and never mixes old and new modules. The precache list is `src/offline.json`. After adding, removing or renaming a file in `src/` or `vendor/`, run `npm run offline-list`; a test fails until the list matches.

## Test

```sh
cd app
npm test               # node --test: DSP recovery on synthetic vowels, WAV, summaries, clip comparison
npm run report         # prints the actual errors for every case (markdown)
```

Tolerances and current results are in [`test/README.md`](test/README.md). Node 20+ is needed. It was developed on Node 24.

## Deploy to GitHub Pages

Deployment is handled by `.github/workflows/pages.yml` at the repo root. See the root `README.md` for the one-time setup. The workflow runs `npm test`, then publishes **only** `index.html`, `sw.js`, `manifest.webmanifest`, `src/` and `vendor/`. All paths are relative and routing uses the hash, so the app works under `https://<user>.github.io/<repo>/`.

Don't use "Deploy from a branch". It would publish the whole repo, including `research/`.

## Layout

```
index.html               all view markup (Home, Practice, Live, Record, Clips, Settings, About)
sw.js                    offline support: precaches src/offline.json, then network first with the cache as fallback
manifest.webmanifest     install metadata (icon: src/icon.svg)
src/main.js              router, theme, session timer + rest nudge, tiny session, mic button
src/settings.js          settings (localStorage) + target bands
src/summary.js           per-recording stats (pure)
src/vowels.js            vowel space (pure): corner vowels, scale presets, targets, capture median, plot axes, rings
src/compare.js           clip comparison (pure): whole-signal analysis, per-clip profile, changes, word matching
src/norms.js             published formant norms (Elvin 2016, Hillenbrand & Clark 2009), context only
src/audio/capture.js     getUserMedia (EC/NS/AGC off + warning), AudioWorklet → ScriptProcessor
                         → MediaRecorder fallback, recording (PCM chunks stay on the main thread)
src/audio/analysis-host.js  runs analysis in a module Web Worker, or on the main thread as a fallback
src/audio/analysis-worker.js  the Worker: sliding 2048 frame + createAnalyzer()
src/audio/frame.js       sliding-frame helper shared by both paths
src/audio/capture-worklet.js
src/audio/wav.js         16-bit WAV encode/decode (pure)
src/audio/babble-synth.js  procedural café babble (pure): talkers, clatter, room impulse, level mix
src/audio/babble.js      plays it on the mic's AudioContext (looped buffers, panning, reverb, fades)
src/store/db.js          IndexedDB recordings
src/ui/*.js              views + canvas drawing (practice.js: Practice tab + Home teaser;
                         tips.js: Home tip card + About tip list;
                         vowel-space.js: the Live "Vowel space" panel,
                         compare-view.js: Compare clips inside Clips)
src/practice/            pure, Node-testable
  exercises.js           the exercise pool (kinds, steps, what to watch, how to score) + shuffle
                         (pickAvoiding: random pick that skips recent ids, shared with tips)
  tips.js                short voice-care / noise / everyday / going-easy / support tips
  feedback.js            utterance segmenter + per-attempt scorers (pitch step, F2 contrast, band, loud × light,
                         phrase shape, phrase ending, over the noise) and the quieter per-attempt notes
  prosody.js             phrase shape (semitone range, final rise/fall/level), where creak sat, session care nudges
  noise.js               noise floor at the mic (median of unvoiced frames) + the voice's level above it
src/analysis/            ALL DSP. Pure functions on Float32Array, run in Node too
  index.js               plug-in registry + createAnalyzer() (the only thing the UI calls)
  pitch.js               pitchy (MPM), clarity ≥ 0.8, subharmonic guard
  formants-lpc10.js      "lpc10" (selectable): port of bench/lib/lpc.mjs. Resample to 10 kHz → pre-emphasis
                         from 50 Hz → Praat Gaussian → 10 poles → Durand–Kerner + Newton roots
  formants.js            "lpc12" (previous): decimate → 0.97 pre-emphasis → Hamming → 12 poles, BW < 500
  lpc.js                 autocorr, Levinson, root finding (shared)
  weight.js              H1–H2 + 1–4 kHz vs 50–1000 Hz tilt (ports of bench/lib/tilt.mjs),
                         Iseli–Alwan H1*–H2*, alpha ratio, weight 0..1
  creak.js               per-frame creak (vocal fry) flag from very-short-term power pulses + pitchy's answer
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

Every frame also carries `creak` (boolean, from `creak.js`; not a swappable stage). Creaky frames are usually *not* `voiced`, because pitchy can't find a modal period in them.

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

## Vowel space

A collapsible panel in Live: an F1×F2 chart in the phonetics orientation (F2 falls to the right, F1 grows downward, both log-scaled). It shows:
- **Live vowel:** the 1 s median F1/F2 as a big dot, with a 1.5 s fading trail. When F0 > 200 Hz (`f1Approx`), the dot becomes a tall grey dashed ellipse labelled "F1 ≈", and the rings ignore F1.
- **Your vowels:** *heed / had / hard / who'd*, captured in the panel. Tap a word and say it once. The capture is the median over the middle 60 % of the voiced frames of that one utterance, which skips the consonant glides at each end. Captured vowels are kept in settings (`localStorage`, this device only) and are never part of the code.
- **Target rings:** each captured vowel × one factor per formant (`settings.vowelScale`). Every vowel gets the same factors, so the shape of the vowel space, which is the accent, stays the same and only its size changes. The presets are "A little smaller" (land: ×1.128 / 1.100 / 1.057 for F1/F2/F3) and "Further" (aim: ×1.273 / 1.210 / 1.118, the adult female/male ratio; land is half of it on a log scale). A ring is ±5 % in F2 and ±10 % in F1, as an ellipse in log frequency, and it fills pink while the live vowel is inside it.
- **Before any capture:** generic reference rings (Peterson & Barney women's means), labelled as orientation only.

Saved settings are parsed on load. Unknown corners and implausible formants are dropped, and missing or out-of-range factors fall back to land. Tests cover the pure maths (`test/vowels.test.js`).

## Comparing clips

*Clips → Compare clips* is the in-app counterpart of `analysis/compare.py`. Pick two to four saved clips, or add local files (WAV everywhere; other formats if the browser's `decodeAudioData` can read them). Files are decoded in the page and never uploaded or stored.

- **Same engines for every clip.** Each clip's audio is decoded and re-analysed with the current engines (`analyzeSamples` in `compare.js`: the live `createAnalyzer` + sliding frame, 2048/1024), pulled in ~30 ms slices so the page stays responsive. Results are cached per clip and engine choice for the visit. A saved clip the browser can't decode falls back to its stored trace (no F3 or H1–H2*).
- **What's shown,** each against the earliest clip: pitch median, 5th and 95th percentiles (change in semitones), 5–95 % range and SD in semitones, time in your bands; F1/F2/F3 medians over voiced frames (change in %); weight median, loud-and-light fraction, H1–H2* and LTAS tilt (dB). Changes under a small threshold read "about the same". Context lines give the target bands and the published women/men formant ratios (Elvin et al. 2016 AusE, Hillenbrand & Clark 2009).
- **Word by word** (first vs last clip): utterances come from the Practice segmenter. A reading of the hVd list (18 words, or the 11 monophthongs, any number of times through) pairs by word, with the median over repeats; otherwise clips with the same word count (≤ 24) pair in order.
- **Not ported from compare.py / run.py:** CPPS, H1–A3*, VTL, the glide and sustained-vowel tasks, and the DP alignment that tolerates a skipped hVd word. A skipped or extra word shifts the labels after it.

## Intonation and creak feedback

Both are descriptive. Range is reported, never scored up, and nothing rewards creak.

- **Where it shows.** Practice attempts get a quieter note line under the main feedback: the phrase shape and, if any, where creak sat. "Steer the average" and "Tell a friend" score the shape as information only. "Carry the last word" scores the ending: smooth and level or lifting is the ✓, and a creaky or dropping ending gets a gentle "keep the air going". Live shows one "Last phrase:" line under the pitch trace.
- **Phrase shape** (`prosody.js`, per utterance from `UtteranceTracker`). Semitones re the phrase's own median F0, modal voiced frames only (creaky frames are left out, so a fry tail doesn't read as a big fall). Range is the 5–95 % span. The ending is the median of the last 200 ms against the phrase median: ≥ +1 st rise, ≤ −1 st fall, otherwise level. A phrase of 1.5 s or more under 2 st reads "fairly level", without advice.
- **Creak per frame** (`creak.js`). A frame needs ≥ −55 dBFS, and pitchy must not have found a period at ≥ 70 Hz (a confident modal frame is never creak). Then any of these: pitchy found a period under 70 Hz; prominent pulses in a 100–1500 Hz, 3 ms power contour (≥ 9 dB above the valleys either side, after Ishi et al. 2008) are spaced like < 70 Hz; they are irregular (jitter > 25 % or > 4 dB alternating peaks, below 140 Hz); or a single pulse stands ≥ 15 dB out of an aperiodic frame (fry below ~45 Hz has only one pulse per 43 ms frame).
- **Creak per utterance.** Creak frames count only in runs of ≥ 3 within 50 ms of each other, which removes plosive bursts (≤ 2 frames) and stray flags across pauses. "End" = ≥ 30 % of the last 0.4 s (or the second half of a shorter word) with < 15 % before it: "a style choice, nothing wrong". "Throughout" = ≥ 30 % before the end: a kind nudge towards breath and ease, or rest. "Some" = ≥ 10 % overall.
- **Session care.** After 6 attempts on one exercise, Practice compares the last 3 with the first 3, once per exercise. Creak share up by ≥ 15 points to ≥ 25 %, or (except in step drills) the median pitch down ≥ 1.5 st, adds a water-and-rest nudge.

## Café noise (babble practice)

Exercises with `babble: true` show a *Start the café* button and a quiet → busy slider. No audio files are involved; the room is synthesised.
- **What it is:** 8 talkers, each a pulse train plus breath noise through three formant resonators that glide to a new vowel every syllable (3–5.5 syllables/s, in phrases), plus cup clinks and a short stereo room reverb. They're rendered once (about 0.15 s on a desktop, at 16 kHz) when a café exercise is shown, then looped at different lengths and start points. The level joins talkers one by one (3 → 8) and raises the room by 18 dB.
- **Lifecycle:** it plays on the mic's AudioContext, so stopping the mic stops it. It also stops on leaving Practice, changing exercise, hiding the tab, and after 3 minutes (a kind "rest a moment" note).
- **Mic leak:** the app turns echo cancellation off, so on the phone speaker the mic hears the café. The app doesn't try to cancel it, because an adaptive filter over a phone's speaker-to-mic path isn't reliable enough to trust. Instead:
  - The UI recommends one earbud: the mic hears only you, and the other ear still hears your own voice.
  - The talkers are deliberately rough (±12 % jitter, breathy), so the pitch clarity gate rejects them. Leaked café alone is ≤ 1.3 % voiced frames and never makes an attempt (`test/babble.test.js`).
  - `noise.js` tracks the floor (the median dBFS of unvoiced frames over 6 s), and "loud" is judged on the voice's own level with the floor's power taken out.
  - When the floor is within 12 dB of the "loud" threshold, the café note says so and readings and attempts get a "≈": weight and F2 are rougher then.
- **Scoring (`noise`):** a try with the café off becomes the reference. Each try with it on gets loud × light, plus whether pitch held (no drop of more than 1.5 st) and resonance held (F2 no more than 5 % darker). Before there's a reference, it's checked against the band instead.

## Known limitations

- **Why lpc12 is the default, not lpc10.** lpc10 reproduces Praat on real recordings (research/library_comparison.md). On this app's noise-free synthetic grid it misses F2/F3 on all 64 cases, because a spare pole lands between F1 and F2. With a noise floor it passes most male cases, but female vowels still fail. lpc12 passes 60 of 64. Numbers are in `test/README.md`. Check lpc10 on real female speech. lpc10 is selectable in Settings.
- LPC F1 locks onto a harmonic at high F0, for every method. It is biased toward 2·F0 on close vowels (ee/oo) from F0 ≈ 180 Hz, and the UI marks F1 "≈" above 200 Hz. See `test/README.md`.
- The weight score is an uncalibrated heuristic, and it depends on the vowel. The thresholds in `weight.js` are placeholders until there are real recordings.
- dBFS depends on the mic and browser. Use *Settings → "use my current level"* to set the "loud" threshold.
- Analysis runs about 47 frames/s (hop 1024 at 48 kHz) in the Worker. The research estimates ≈ 3.3 ms per frame, phone-scaled, for this pipeline.
- The tilt measure changed (now dB, 1–4 kHz vs 50–1000 Hz, not dB/octave), so weight scores from before this change aren't comparable with new ones.
- The creak detector is only checked on synthetic fry, so it needs listening checks on real speech. Synthetic numbers are in `test/README.md`. Creak at 70–100 Hz that pitchy still reads as periodic (likely for a higher modal voice) is not detected by design, so phrase-final creak from a ~200 Hz voice may be missed.
- The café has only been checked numerically and in headless Chrome, not listened to. Whether it reads as a busy room, and how much a phone speaker leaks into the mic, still need checking on a real device.
