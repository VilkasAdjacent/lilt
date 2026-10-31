# Analysis tests

Run `npm test` (or plain `node --test`) from `app/`. Run `npm run report` (`node scripts/report.js`) to print every case's **actual** error for every formant implementation. Options: `--impl lpc10|lpc12` runs one implementation, `--snr 30` adds white noise to the formant cases, and `--order N` tries a different LPC order for lpc12.

All signals come from `synth.js`. That's a Rosenberg glottal pulse at a known F0, with optional jitter, shimmer and a `breathiness` control. Breathiness raises the open quotient, makes the pulse more symmetric, adds extra tilt and adds aspiration noise. The pulse goes through Klatt cascade resonators F1–F5 with known frequencies and bandwidths (B = 50 + 0.06·F). The formant sets are rough AusE heed/had/hard/who'd values for male-like and female-like voices. They are **synthetic truth, not norms**. Frames are 2048 samples (43 ms at 48 kHz), hop 1024, and the result is the median over a 0.5–0.6 s vowel.

## Defaults under test

| Stage | Default | Alternative |
|---|---|---|
| pitch | `pitchy`: MPM key threshold k = 0.92, voicing gate clarity ≥ **0.8**, sub-60 Hz guard | – |
| formants | `lpc10` (`formants-lpc10.js`, selectable): port of `bench/lib/lpc.mjs`. Resample to 10 kHz (Kaiser sinc), pre-emphasis from 50 Hz, Praat Gaussian window (50 ms), 10 poles, Durand–Kerner roots + Newton polish, no bandwidth filter | **`lpc12`** (`formants.js`, DEFAULT): the original tracker. Decimate by 4, 0.97 pre-emphasis, Hamming, 12 poles, BW < 500 Hz |
| weight | `h1h2`: H1–H2 and tilt ported from `bench/lib/tilt.mjs` | – |

Every formant test runs once per registered implementation (`formants [lpc10] …`, `formants [lpc12] …`) with the same fixed tolerances.

## Tolerances (fixed, not tuned to pass)

| What | Tolerance | Grid |
|---|---|---|
| F0, clean | every frame within ±10 cents, ≥95 % frames voiced | 90–300 Hz (13 values) × {male hard, female heed, female who'd} × {48, 44.1 kHz} |
| F0, 1 % jitter + 5 % shimmer + breathiness 0.5 | median within ±10 cents, ≥90 % voiced | 100, 150, 200, 250 Hz |
| F1–F3, F0 ≤ 200 Hz | ±max(5 %, 60 Hz) | male F0 90–200, female 150–200 |
| F1–F3, 200 < F0 ≤ 300 Hz (looser: harmonics are sparse, so LPC is biased) | ±max(10 %, 100 Hz) | male 220–250, female 220–300 |
| lpc10 port fidelity | F1–F3 within 2 Hz of `bench/lib/lpc.mjs` (whole-signal resample) | 4 clean vowels × 3 frames |
| `f1Approx` flag | off at F0 150 and 190 Hz, on at 220 and 280 Hz | |
| H1–H2 vs breathiness 0 → 1 | strictly increasing | 4 voice/vowel/F0 combos |
| weight score vs breathiness | strictly decreasing | same |
| LTAS over frames vs per-frame tilt, steady vowel | ±0.5 dB | |
| dBFS | sine reads 20·log10(A/√2) ± 0.05 dB; ×2 gain reads +6.02 ± 0.01 dB | |
| WAV export | 16-bit round trip within ½ LSB | |

## Results (current code)

`npm test`: 177 tests, **108 pass, 0 fail, 69 todo**. The todos are 65 for lpc10 and 4 for lpc12; see below.

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
