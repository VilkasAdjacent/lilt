# Analysis tests

Run `npm test` (or plain `node --test`) from `app/`. Run `npm run report` (`node scripts/report.js`) to print every case's **actual** error for every formant implementation, plus formant time per frame. Options: `--impl lpc10|lpc12|dap` runs one implementation, `--snr 30` adds white noise to the formant cases, `--breathiness 0.5` uses a breathier source for them, `--sweep` summarises F1 over F0 180–300 Hz in 10 Hz steps for all 8 vowel sets instead of the test grid, and `--order N` tries a different LPC order for lpc12.

All signals come from `synth.js`. That's a Rosenberg glottal pulse at a known F0, with optional jitter, shimmer and a `breathiness` control. Breathiness raises the open quotient, makes the pulse more symmetric, adds extra tilt and adds aspiration noise. For creaky voice, `openQuotient` overrides the open phase (0.3 = pressed), and `alternate` makes every other pulse that fraction weaker and its period longer by half that fraction (period doubling). Synthetic fry here is F0 25–65 Hz with 20 % jitter, 30 % shimmer and open quotient 0.3. The pulse goes through Klatt cascade resonators F1–F5 with known frequencies and bandwidths (B = 50 + 0.06·F). The formant sets are rough AusE heed/had/hard/who'd values for male-like and female-like voices. They are **synthetic truth, not norms**. Frames are 2048 samples (43 ms at 48 kHz), hop 1024, and the result is the median over a 0.5–0.6 s vowel.

## Defaults under test

| Stage | Default | Alternative |
|---|---|---|
| pitch | `pitchy`: MPM key threshold k = 0.92, voicing gate clarity ≥ **0.8**, sub-60 Hz guard | – |
| formants | `lpc10` (`formants-lpc10.js`, selectable): port of `bench/lib/lpc.mjs`. Resample to 10 kHz (Kaiser sinc), pre-emphasis from 50 Hz, Praat Gaussian window (50 ms), 10 poles, Durand–Kerner roots + Newton polish, no bandwidth filter | **`lpc12`** (`formants.js`, DEFAULT): the original tracker. Decimate by 4, 0.97 pre-emphasis, Hamming, 12 poles, BW < 500 Hz |
| formants | | `dap` (`formants-dap.js`, selectable): discrete all-pole modelling (El-Jaroudi & Makhoul 1991). Harmonic peaks at k·F0 up to 5.4 kHz from an 8192-point FFT, 0.97 pre-emphasis applied to them, a 12-pole Itakura–Saito fit to those points only (model rate 12 kHz, ≤ 40 fixed-point iterations), refit with 10 poles if any pole is narrower than 25 Hz, BW < 500 Hz |
| weight | `h1h2`: H1–H2 and tilt ported from `bench/lib/tilt.mjs` | – |

Every formant test runs once per registered implementation (`formants [lpc10] …`, `formants [lpc12] …`, `formants [dap] …`) with the same fixed tolerances. Each frame gets the F0 that pitchy measures on that frame, as in the app; only `dap` uses it.

## Tolerances (fixed, not tuned to pass)

| What | Tolerance | Grid |
|---|---|---|
| F0, clean | every frame within ±10 cents, ≥95 % frames voiced | 90–300 Hz (13 values) × {male hard, female heed, female who'd} × {48, 44.1 kHz} |
| F0, 1 % jitter + 5 % shimmer + breathiness 0.5 | median within ±10 cents, ≥90 % voiced | 100, 150, 200, 250 Hz |
| F1–F3, F0 ≤ 200 Hz | ±max(5 %, 60 Hz) | male F0 90–200, female 150–200 |
| F1–F3, 200 < F0 ≤ 300 Hz (looser: harmonics are sparse, so LPC is biased) | ±max(10 %, 100 Hz) | male 220–250, female 220–300 |
| F1 alone at high F0 (the low-F0 band, not loosened) | ±max(5 %, 60 Hz) | male 180–250, female 180–300, all 4 vowels each (40 cases) |
| DAP fit on exact all-pole samples at harmonics of 250 Hz (female heed envelope, 10 poles) | F1–F3 within 1 Hz; plain LPC on the same points must miss by > 10 Hz | |
| lpc10 port fidelity | F1–F3 within 2 Hz of `bench/lib/lpc.mjs` (whole-signal resample) | 4 clean vowels × 3 frames |
| `f1Approx` flag | off at F0 150 and 190 Hz, on at 220 and 280 Hz | |
| H1–H2 vs breathiness 0 → 1 | strictly increasing | 4 voice/vowel/F0 combos |
| weight score vs breathiness | strictly decreasing | same |
| LTAS over frames vs per-frame tilt, steady vowel | ±0.5 dB | |
| dBFS | sine reads 20·log10(A/√2) ± 0.05 dB; ×2 gain reads +6.02 ± 0.01 dB | |
| WAV export | 16-bit round trip within ½ LSB | |
| creak hit rate, per frame | ≥ 50 % in every condition, ≥ 75 % on average | fry 25/35/50/65 Hz × {male, female} × {heed, hard}; period doubling (alternate 0.5) at 80/110/150 Hz × {male, female}; fry 35/50 Hz + white noise at 20 dB SNR |
| creak false alarms, per frame | ≤ 10 % in every condition, ≤ 2 % on average | modal (1 % jitter, 5 % shimmer) male 75–150 Hz and female 150–280 Hz × heed/hard/who'd × breathiness 0/0.5/1; male hard 80/100/120 Hz + noise at 10 dB SNR |
| creak per utterance | "end" / "none" / "none" / "throughout"; creak alone is no utterance | real analyser + `UtteranceTracker` over: 1 s modal + 0.3 s fry tail; 1.3 s modal; four syllables with 8 ms plosive bursts between; 0.25 s modal + 1.2 s fry; 1.2 s fry alone (an utterance needs ≥ 6 modal frames, because noise such as the café trips the creak cues now and then) |
| `creakRuns` | bridges one missed frame; three flags separated by pauses are not a run | |
| phrase shape | linear 4 st glide: span 3.6 ± 0.15 st, "fall"; +2 st last 250 ms: final within 0.01 st, "rise"; a fry tail flagged creak at 62 Hz leaves the shape level | |
| session care | creak share rising → "creak"; median pitch −1.5 st → "drift" (off for step drills); nothing before 6 attempts | |
| Café envelope | strongest 1/3-octave modulation band 2.5–6 Hz; silent first and last sample | 4 seeds, 12 s |
| Café alone into the mic (dry, −40 dBFS) | ≤ 10 % frames voiced, 0 attempts | quietest and busiest level, 9 s |
| Voice 10 dB over the busy café | ≥ 90 % voiced, F0 median ±10 cents, F2 ±max(5 %, 60 Hz) | female had @ 190 Hz |
| Voice 3 dB over the café | own level within ±1 dB after floor subtraction | same |

## Results (current code)

`npm test`: 392 tests, **292 pass, 0 fail, 100 todo**. The todos are 65 + 13 for lpc10, 4 + 13 for lpc12 and 1 + 4 for dap (formant grid + F1 at high F0); see below.

### F0

- **Clean:** worst single frame is 0.73 cents (tolerance 10), at 48 and 44.1 kHz.
- **Jitter/shimmer/breathy:** median error 3.1 / 1.2 / −0.6 / −1.8 cents at 100 / 150 / 200 / 250 Hz, with 100 % of frames voiced.
- These numbers are unchanged. The voicing gate was already clarity ≥ 0.8, which is the research recommendation (0.9 drops too many voiced frames on real speech). The synthetic tests can't tell 0.8 from 0.9 apart, because clean vowels read clarity ≈ 1.0.
- Before the subharmonic guard in `pitch.js`, the 100 Hz case was only 88 % voiced: pitchy picked a 3rd- or 4th-period peak (33 or 25 Hz). Lowering pitchy's MPM key threshold instead caused octave-up errors on female /i/, where F1 ≈ 2·F0. So k stays at 0.92.

### Formants: lpc12 (default) vs lpc10

The pass/fail grid is noise-free. `npm run report -- --snr N` adds white noise; those runs are shown for context and are not part of the suite.

| condition | lpc10 pass (of 64): male, female | lpc12 pass (of 64): male, female | lpc10 median abs err F1/F2/F3 | lpc12 median abs err F1/F2/F3 |
|---|---|---|---|---|
| **noise-free (the test grid)** | **0**: 0/32, 0/32 | **60**: 29/32, 31/32 | 3.8 / 41.9 / 32.0 % | 3.6 / 0.9 / 0.7 % |
| SNR 40 dB | 19: 19/32, 0/32 | 56: 27/32, 29/32 | 3.3 / 29.1 / 23.2 % | 3.4 / 0.9 / 0.7 % |
| SNR 30 dB | 32: 28/32, 4/32 | 55: 25/32, 30/32 | 3.2 / 2.7 / 2.4 % | 3.2 / 1.0 / 0.7 % |
| SNR 20 dB | 35: 22/32, 13/32 | 39: 16/32, 23/32 | 3.6 / 3.2 / 2.9 % | 3.5 / 1.1 / 1.3 % |

At 44.1 kHz (female had @ 180, male hard @ 120), the check passes for lpc12 and misses for lpc10 (`todo`).

**lpc10 misses all 64 noise-free cases, and they are all marked `todo`.**
- F1 is fine. It has the same error profile as lpc12.
- F2 and F3 are wrong because of the "spare pole" failure that `research/library_comparison.md` documents for both Praat Burg and this LPC. Our Rosenberg source plus cascade has almost no energy at 4–5 kHz, so 10 poles at 10 kHz spend a wide-bandwidth pole between F1 and F2. That pole is reported as "F2", and the true F2 is reported as "F3".
- Example, male heed @ 120: the poles are 288, **912 (BW 2020 Hz)**, 2263 and 2930 Hz, against a truth of 290 / 2250 / 2950.

With noise:
- **Male vowels recover once there is a noise floor.** At SNR 30 dB, 28 of 32 pass, and the 4 misses are the F1-on-a-harmonic cases that lpc12 misses too. At SNR 30 and 20 dB, lpc10 passes more male cases than lpc12.
- **Female vowels don't recover.** The synth puts female F4/F5 at 4300 and 5000 Hz, right at the 5000 Hz ceiling, so 10 poles below 5 kHz are not enough. The research used a 5500 Hz ceiling for its female synthetic vowels. With that here (`opts: { ceiling: 5500 }`, LPC at 11 kHz), only 43 of 64 pass at SNR 30.

The research found the opposite ranking on its Praat KlattGrid vowels and on real recordings, where lpc10 matches Praat to a median 0.1 / 0.1 / 0.3 %. The two synthetic sets disagree, and only the research set is backed by real speech. **Verify lpc10 on real female speech before trusting its F2/F3.** `lpc12` is one setting away (*Settings → Analysis engines*).

Port fidelity is tested separately. `lpc10` matches `bench/lib/lpc.mjs` within 2 Hz on clean vowels; the outputs are in fact identical to the Hz. Under noise they differ by up to about 10 Hz, because each 2048-sample frame is resampled on its own.

**lpc12: 60 of 64 pass.** These are the same 4 misses as before, still marked `todo`. Worst error for F0 ≤ 200 Hz on the passing cases is F2 2.6 % and F3 2.5 %.

| case | F0 | F1 | F2 | F3 | tolerance |
|---|---|---|---|---|---|
| male heed (F1 290) | 180 | +70 Hz (+24 %) | +0.7 % | −1.4 % | 5 % / 60 Hz |
| male heed | 200 | +83 Hz (+29 %) | +0.4 % | −0.9 % | 5 % / 60 Hz |
| male who'd (F1 320) | 200 | +79 Hz (+25 %) | +1.0 % | +1.8 % | 5 % / 60 Hz |
| female hard | 275 | −12 % | −11 % | −43 % (spurious pole picked as F3) | 10 % / 100 Hz |

**F1 at high F0 (both implementations).**
- Several passing high-F0 cases are close to the edge. Female heed and who'd F1 are +16 to +26 % at 220–275 Hz, which passes only under the loose band.
- The cause is the classic one: autocorrelation LPC fits the harmonic line spectrum, so a low F1 gets pulled toward 2·F0. The research found that every method, Praat included, does this above about 220 Hz.
- The analyzer now sets `f1Approx` when F0 > 200 Hz (`F1_APPROX_ABOVE_F0` in `analysis/index.js`). The Live view then greys F1 out and shows it with "≈".

### F1 at high F0: dap vs lpc12

The `F1 at high F0` tests check F1 alone at F0 180–300 Hz against the *low-F0* band, ±max(5 %, 60 Hz). lpc12 and lpc10 miss the same 13 of 40; dap misses 4. All misses are `todo`.

**Test grid (40 cases), |F1 error|:**

| condition | lpc12 in tolerance | dap in tolerance | lpc12 close vowels (heed, who'd): median / max | dap close: median / max | lpc12 open (had, hard): median / max | dap open: median / max |
|---|---|---|---|---|---|---|
| noise-free | 27 | **36** | 67 / 98 Hz | **54 / 65 Hz** | 25 / 110 Hz | **16** / 170 Hz |
| SNR 30 dB | 26 | **30** | 77 / 105 Hz | **59 / 89 Hz** | 24 / 99 Hz | **13** / 131 Hz |
| SNR 20 dB | 25 | **29** | 76 / 123 Hz | **61 / 104 Hz** | 26 / 80 Hz | **15 / 61 Hz** |
| breathiness 0.5 | **37** | 36 | 31 / 77 Hz | **14 / 34 Hz** | 30 / 153 Hz | 28 / 191 Hz |

**Sweep** (`--sweep`: F0 180, 190 … 300 × all 8 vowel sets, 104 cases), because a coarse F0 grid can land LPC on a lucky harmonic:

| condition | lpc12 in tolerance | dap in tolerance | close: lpc12 median / p90 / max | close: dap | open: lpc12 | open: dap |
|---|---|---|---|---|---|---|
| noise-free | 69 | **91** | 63 / 92 / 102 Hz | **54 / 62 / 72 Hz** | 25 / 67 / 117 Hz | **16 / 49** / 168 Hz |
| SNR 30 dB | 69 | **79** | 68 / 99 / 108 Hz | **56 / 81 / 89 Hz** | 24 / 59 / 106 Hz | **12 / 38** / 139 Hz |
| breathiness 0.5 | 86 | **89** | 27 / 58 / 77 Hz | **17 / 34 / 45 Hz** | **32 / 98 / 169 Hz** | 42 / 111 / 195 Hz |

**F2/F3 at F0 180–300 Hz** (test grid, median |error|): lpc12 1.1 / 0.8 %, dap 1.0 / 0.8 % noise-free; 1.4 / 0.7 % vs 1.3 / 0.8 % at SNR 30; 0.9 / 0.7 % vs 0.8 / 0.5 % breathy.

**Whole 64-case formant grid** (F1–F3, the usual tolerances):

| condition | lpc12 pass: male, female | dap pass: male, female | lpc12 median abs err F1/F2/F3 | dap median abs err F1/F2/F3 |
|---|---|---|---|---|
| noise-free | 60: 29/32, 31/32 | **63**: 32/32, 31/32 | 3.6 / 0.9 / 0.7 % | 3.7 / 1.0 / 0.7 % |
| SNR 40 dB | 56: 27/32, 29/32 | **59**: 29/32, 30/32 | 3.4 / 0.9 / 0.7 % | 2.4 / 0.8 / 0.8 % |
| SNR 30 dB | 55: 25/32, 30/32 | 56: 25/32, 31/32 | 3.2 / 1.0 / 0.7 % | 2.3 / 1.0 / 0.7 % |
| SNR 20 dB | 39: 16/32, 23/32 | 40: 15/32, 25/32 | 3.5 / 1.1 / 1.3 % | 2.9 / 1.6 / 1.2 % |

dap's one noise-free miss is lpc12's too: female hard @ 275 (F1 −170 Hz, F2 −231 Hz, F3 −1150 Hz; poles near 750, 1270, 1700 Hz instead of 920 / 1500). At SNR 30 both miss male who'd F3 at low F0 (dap picks the 5 kHz pole, +2.7 kHz; lpc12 +1.5 kHz). At SNR 20, female heed @ 180 has no third resonance under 500 Hz bandwidth in any frame, so dap's F3 is NaN there.

**Low F0 (no regression on the whole, but not better either).** Sweep F0 90–175 Hz in 5 Hz steps, 144 cases: |F1| median / p90 / max is 13 / 31 / 63 Hz for lpc12 and 10 / 34 / 49 Hz for dap noise-free, 11 / 28 / 69 vs 9 / 24 / 77 Hz at SNR 30, and 18 / 34 / 46 vs 21 / 34 / 45 Hz breathy. On the test grid, dap is worse on male hard at 90–150 Hz (F1 −31 to −40 Hz vs −3 to −27 Hz) and on male heed @ 150 (+34 vs +17 Hz). Its worst F1 for F0 ≤ 200 is 20.2 % (male heed @ 200), against lpc12's 28.6 %.

**Why dap still reads close-vowel F1 about +50 Hz high.** On *exact* all-pole samples at the harmonics, the DAP fit recovers F1–F3 to within 1 Hz (that's the unit test; plain LPC on the same points is 35 Hz off on F3). The harmonic amplitudes it measures on the synth match the analytic envelope to 0.01 dB. So the remaining bias comes from the source, not from the fit. The Rosenberg pulse has H2 about 1.7 dB above H1, and after pre-emphasis that rise is about 7.5 dB. With F0 above F1/2, the only evidence for F1 is the relative level of H1, H2 and H3, so a strong H2 reads as a higher F1. A breathier source (H1 dominant) shrinks the bias to about +16 Hz. On real voices this depends on voice quality, and no harmonic-only method can fully separate the two. Lowering pre-emphasis to 0.8–0.9 cut the noise-free close-vowel bias to +27 to +41 Hz, but it made open vowels worse and would be tuning to this synth. So it stays at 0.97, the same as lpc12.

**Order fallback.** DAP only sees the spectrum at the harmonics, so it can put a pole almost on the unit circle between two harmonics at no cost. That's the method's known failure. When any 12-pole root is narrower than 25 Hz, dap refits with 10 poles. On the sweep, the fallback brought open vowels from median / p90 30 / 84 Hz to 16 / 49 Hz, and it moved close vowels from 45 / 57 Hz to 54 / 62 Hz. Without it the breathy open-vowel p90 was 139 Hz. Raising the cap from 40 iterations to 80 or 200 barely changes anything (close-vowel median 54 → 55 Hz).

**Time per frame** (Node 24, this desktop, 2048 samples at 48 kHz, `npm run report`): lpc12 0.14 ms, lpc10 0.21 ms, dap 0.49 ms; on other vowels and F0s it measured 0.30–0.32 ms. A phone is maybe 3–5× slower, so about 1–2.5 ms, which fits the few-ms budget at 47 frames/s.

**Decision: dap stays selectable, not the default; `f1Approx` stays at 200 Hz.**
- dap clearly wins the problem it was built for: close-vowel F1 at F0 ≥ 220 Hz, where lpc12 is pulled to the 2nd harmonic. It also wins the in-tolerance count in every condition except breathy, where they are about even.
- But it is not a clear win overall:
  - Female heed and who'd at 180–200 Hz, around where the user is training now, read better on lpc12: +5 / +44 Hz vs +28 / +60 Hz (heed), −11 / +24 vs +15 / +51 Hz (who'd).
  - Open vowels at high F0 have worse outliers (max 168–195 Hz vs 117–169 Hz).
  - Breathy open vowels are worse on median.
  - Close-vowel F1 is still biased about +50 Hz, so the "≈" flag remains honest above 200 Hz.
- All of this is synthetic. Pick it in *Settings → Analysis engines* to compare on real speech. A hybrid (dap only above some F0) didn't have a clean crossover on this grid, so it isn't wired.

### Weight and tilt

These are ported from `bench/lib/tilt.mjs`:
- **H1–H2:** symmetric Hann window of max(3 periods, 20 ms), capped at the frame, zero-padded FFT, harmonic level = max bin within ±10 % of k·F0. The FFT is 8192 points at 44.1 or 48 kHz; 16384 reproduces the Python reference bit for bit at twice the cost. Previously the app used a Hann over the whole 2048-sample frame and ±12 %.
- **tilt:** L(1–4 kHz) − L(50–1000 Hz) in dB, from the mean power per bin of a periodic-Hann power spectrum. It replaces the old harmonic-regression slope in dB/octave. The analyzer also reports `ltas`, the power-averaged value over the last 48 voiced frames (about 1 s). That is the benchmarked LTAS ratio, and the Live view shows it.
- **weight score:** same interface and the same blend (0.6 × H1–H2, 0.4 × tilt). The tilt thresholds moved to the new dB scale: light −30 dB, heavy −10 dB. They are still uncalibrated placeholders.

Results:
- **H1–H2:** increases monotonically in all 4 runs, for example −2.6 → −0.5 → 2.4 → 7.0 → 17.5 dB (male hard, 110 Hz).
- **Weight:** decreases monotonically in all 4 runs:

  | run | weight at breathiness 0 → 1 |
  |---|---|
  | male hard @ 110 | 0.84 → 0.81 → 0.66 → 0.48 → 0.27 |
  | male had @ 150 | 0.85 → 0.77 → 0.66 → 0.48 → 0.20 |
  | female hard @ 200 | 0.99 → 0.91 → 0.81 → 0.63 → 0.39 |
  | female heed @ 220 | 0.73 → 0.59 → 0.44 → 0.23 → 0.00 |
- **Tilt alone** is not monotonic in breathiness on this synth, because aspiration noise fills the 1–4 kHz band. Male hard @ 110 reads −15.2 → −13.1 → −14.8 → −15.4 → −16.7 dB.
- Tilt also depends strongly on the vowel: /a/ reads about −5 to −17 dB, /i/ about −23 to −34 dB. Both points fit the research advice: read tilt together with H1–H2, and compare like with like.
- The score still uses *uncorrected* H1–H2. `h1h2c` (Iseli–Alwan) depends on the biased F1.

### Clip comparison (`compare.test.js`)

Two synthetic clips of three words (had, heed, hard) with pauses: male @ 120 Hz vs female @ 180 Hz, analysed end to end with `analyzeSamples` → `profile` → `compareProfiles` / `matchTokens`.
- Tolerances: median pitch change within 0.1 st of the truth (7.02 st); per-word F1–F3 change within 10 percentage points of the synthesis ratio (≈ two 5 % formant errors).
- Actual: pitch change error 0.0003 st. Per-word formant change errors (points): had +5.7 / +1.1 / −2.5, heed +2.3 / −2.7 / −1.1, hard +0.5 / −3.2 / −0.8 (F1 / F2 / F3). Worst: had F1, +5.7.

### Creak and phrase shape

Per-frame creak rate (`creak.js` on pitchy's answer for the same frame):

| condition | min | mean | max | n |
|---|---|---|---|---|
| fry 25 Hz | 59 % | 61 % | 63 % | 4 |
| fry 35 Hz | 83 % | 88 % | 95 % | 4 |
| fry 50 Hz | 95 % | 98 % | 100 % | 4 |
| fry 65 Hz | 78 % | 82 % | 85 % | 4 |
| period doubling 80/110/150 Hz | 98 % | 100 % | 100 % | 6 |
| fry 35/50 Hz + noise 20 dB | 98 % | 99 % | 100 % | 2 |
| **all creaky (hits)** | | **88 %** | | 24 |
| modal male 75–150 Hz × 3 vowels × breathiness 0/0.5/1 | 0 % | 0 % | 0 % | 45 |
| modal female 150–280 Hz × 3 vowels × breathiness 0/0.5/1 | 0 % | 0 % | 0 % | 36 |
| modal male hard 80/100/120 Hz + noise 10 dB | 0 % | 0 % | 0 % | 3 |
| **all modal (false alarms)** | | **0.00 %** | | 84 |
| not in the suite: "rough" modal, 3 % jitter, 15 % shimmer, male 80/100/120 Hz | 0 % | 5 % | 22 % | 6 |
| not in the suite: 8 ms noise bursts every 150 ms | | 17 % | | 1 |

- **Fry at 25 Hz is the weakest case.** A 43 ms frame holds one or two pulses, and a pulse near the frame edge has no valley on one side. The utterance logic bridges one missed frame, so a 25 Hz tail still forms runs.
- **The zero false-alarm rate is mostly the modal gate.** Every modal frame here is voiced by pitchy at ≥ 70 Hz. The pulse cues only see frames pitchy rejects: onsets, consonants, rough voice and creak. The "rough" voice (well past typical modal jitter and shimmer) trips the jitter cue in up to 22 % of frames, because the prominence test skips a weaker pulse. Bursts trip the lone-pulse cue in 17 % of frames, always in runs of ≤ 2. Neither condition is in the suite, which is why the ≥ 3-frame run rule exists.

Per utterance (real analyser + tracker): modal + fry tail reads **end** (25 % of sounding frames, 79 % of the last 0.4 s, 0 % before it). Modal only reads **none**, syllables with bursts read **none**, 0.25 s modal + 1.2 s fry reads **throughout**, and 1.2 s of fry alone makes no utterance (before the merge with café babble it read **throughout**; the café alone made 5 creak-only fake attempts at the quiet level, so a run now needs ≥ 6 modal frames). Phrase shape: the 4 st glide reads a 3.51 st span (expected 3.6: 56 frames quantised, tolerance 0.15) and a −1.63 st "fall". The +2 st ending reads +2.00 st "rise". The fry tail case reads a 0.00 st span, "level".

Cost: about 0.02–0.03 ms per frame in Node on a desktop CPU, so it fits easily within the Worker's per-frame budget.

### Café babble (`babble.test.js`)

This is the leak case: the phone speaker plays the café and the mic hears it, with no echo cancellation. The test mix is dry (no room reverb). In headless Chrome, the real Web Audio graph with reverb gave 1.3 / 0.4 / 0.4 % voiced at levels 0 / 0.3 / 1.

- **Café alone:** 1.2 % of frames voiced at the quietest level (3 talkers) and 0.2 % at the busiest. Neither produced an attempt.
  - Earlier versions started from 2 talkers. With no jitter, the quietest level was 67 % voiced; with 5 % jitter, 37 %. Both made fake attempts.
  - The talkers now have ±12 % jitter and more breath noise, so the clarity gate rejects them.
- **Voice 10 dB over:** 99 % voiced, F0 −0.0 cents, F2 1971 Hz against 1950 (+1.1 %). Weight read 0.90 alone and 0.89 over the café. That's reported, not asserted.
- **Voice 3 dB over:** the floor reads −39.5 dBFS for a −40 dBFS café. Uncorrected, the mic level is +1.91 dB off the voice alone. With the floor subtracted, it's −0.04 dB off.
  - A 10th-percentile floor (the first version) read −52 dBFS, 12 dB under the café's power, and corrected only to +1.5 dB. So the floor is now the median.

## lpc12 order: why round(fs/1000) and not 2 + fs/1000

This applies to `lpc12` only. `lpc10` is fixed at 10 poles at 10 kHz, as Praat is.

`lpc12` runs after decimation to about 12 kHz (48k/4) or 11.025 kHz (44.1k/4). The spec suggests 2 + fs/1000, which is 14 at 12 kHz. Run `npm run report -- --impl lpc12 --order 14` to reproduce:

| order | failing cases (of 64) | worst F2 at F0 ≤ 200 |
|---|---|---|
| 12 (default) | 4 | 2.6 % |
| 13 | 9 | 3.4 % |
| 14 | 11 | 50.6 % (female had @ 200: spurious poles between harmonics) |

At these F0s the extra poles get spent modelling individual harmonics, so order 12 is the default. `formants.defaults.order` overrides it.

## Caveat

The synthetic source is idealised. The cascade has no subglottal coupling, the noise model is simple, and there is no room or mic. Passing here is necessary but not sufficient. The research agent's real-recording benchmark (`bench/`) is the real test, and on it lpc10 is the better choice.

For `dap` in particular:
- Its remaining close-vowel F1 bias depends on the source's H1–H2. The synth has a single Rosenberg shape, so real voices may come out better or worse.
- It trusts the frame's F0. With an octave error from pitchy, it fits the wrong points.
- It has not been run on `bench/` or on real recordings yet.
