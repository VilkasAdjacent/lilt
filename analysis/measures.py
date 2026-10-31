"""Acoustic measures for the voice-training baseline.

Everything here is Praat (via parselmouth) or plain numpy/scipy, so it can be
re-run on a new recording set and compared like-for-like.

Conventions
-----------
* Semitones are re 100 Hz unless stated (st = 12*log2(f/100)).
* Formant measures are Praat Burg (5 formants, 25 ms window, pre-emphasis 50 Hz).
* Spectral / harmonic measures are restricted to < 4 kHz: the phone recordings are
  HE-AAC, whose spectral band replication (SBR) synthesises the band above the
  core-codec crossover (a notch near 3.75-4 kHz is visible in these files).
"""
from __future__ import annotations

import math
import numpy as np
import parselmouth as pm
from parselmouth.praat import call

C_SOUND_CM_S = 35000.0  # speed of sound in warm humid air, cm/s (VTL estimate)


def st(f, ref=100.0):
    return 12.0 * np.log2(np.asarray(f, dtype=float) / ref)


# --------------------------------------------------------------------------- F0
def pitch_two_pass(snd: pm.Sound, floor0=60.0, ceil0=700.0, time_step=0.01):
    """Two-pass F0 (adapted from De Looze & Hirst 2008): a wide first pass, then
    floor = 0.75*Q1 and ceiling = 2.0*Q3 (2.0 rather than Hirst's 1.5 so a real
    octave jump in a 'femme attempt' is not clipped away)."""
    p1 = snd.to_pitch_ac(time_step=time_step, pitch_floor=floor0, pitch_ceiling=ceil0)
    f = p1.selected_array["frequency"]
    v = f[f > 0]
    if len(v) < 20:
        return p1, (floor0, ceil0)
    q1, q3 = np.percentile(v, [25, 75])
    floor = max(50.0, 0.75 * q1)
    ceil = min(1000.0, max(2.0 * q3, floor + 150))
    p2 = snd.to_pitch_ac(time_step=time_step, pitch_floor=floor, pitch_ceiling=ceil)
    return p2, (floor, ceil)


def f0_stats(freqs):
    v = np.asarray([x for x in freqs if x > 0], float)
    if len(v) < 10:
        return None
    p5, p50, p95 = np.percentile(v, [5, 50, 95])
    s = st(v)
    return {
        "n_frames": int(len(v)),
        "median_hz": round(float(p50), 1),
        "mean_hz": round(float(v.mean()), 1),
        "p5_hz": round(float(p5), 1),
        "p95_hz": round(float(p95), 1),
        "median_st_re100": round(float(st(p50)), 2),
        "p5_st_re100": round(float(st(p5)), 2),
        "p95_st_re100": round(float(st(p95)), 2),
        "range_5_95_st": round(float(st(p95) - st(p5)), 2),
        "sd_st": round(float(s.std(ddof=1)), 2),
    }


# --------------------------------------------------------------------- formants
def formant_obj(snd, ceiling, time_step=0.005):
    return snd.to_formant_burg(time_step=time_step, max_number_of_formants=5,
                               maximum_formant=ceiling, window_length=0.025,
                               pre_emphasis_from=50.0)


def formants_at(fobj, t, half_win=0.0125, n=4):
    """Median of each formant (and bandwidth) over frames within +/- half_win of t."""
    ts = np.arange(t - half_win, t + half_win + 1e-9, 0.005)
    out = {}
    for i in range(1, n + 1):
        fv = [fobj.get_value_at_time(i, x) for x in ts]
        bv = [fobj.get_bandwidth_at_time(i, x) for x in ts]
        fv = [x for x in fv if x and not math.isnan(x)]
        bv = [x for x in bv if x and not math.isnan(x)]
        out[f"F{i}"] = float(np.median(fv)) if fv else float("nan")
        out[f"B{i}"] = float(np.median(bv)) if bv else float("nan")
    return out


def vtl_from_formants(fs_by_index: dict[int, float]):
    """Uniform-tube VTL: F_i = (2i-1) c / 4L.  Least-squares fit of F_i on (i-0.5)
    through the origin gives dF; L = c / (2 dF)  (formant-spacing method,
    cf. Fitch 1997; Reby & McComb 2003).  Should be applied to formants averaged
    over many vowels so the vocal tract approximates a neutral tube."""
    idx = np.array(sorted(fs_by_index))
    F = np.array([fs_by_index[i] for i in idx])
    x = idx - 0.5
    dF = float((x * F).sum() / (x * x).sum())
    return {"delta_f_hz": round(dF, 1), "vtl_cm": round(C_SOUND_CM_S / (2 * dF), 2),
            "formants_used": [int(i) for i in idx]}


# ------------------------------------------------------- harmonics / spectral tilt
def _resonator_db(f, F, B, fs):
    """Gain (dB) at f of a digital 2-pole resonator normalised to 0 dB at DC.
    Used for Iseli & Alwan (2004/2007)-style formant correction of harmonic
    amplitudes (the H1*-H2* / H1*-A3* of VoiceSauce)."""
    r = math.exp(-math.pi * B / fs)
    th = 2 * math.pi * F / fs
    w = 2 * math.pi * f / fs
    z1 = complex(math.cos(w), -math.sin(w))
    num = 1 - 2 * r * math.cos(th) + r * r
    den = 1 - 2 * r * math.cos(th) * z1 + r * r * z1 * z1
    return 20 * math.log10(abs(num / den))


def harmonic_measures(x, fs, t_centres, f0s, fm_list, win_periods=3.0, nfft=16384):
    """Per-frame H1, H2, A1, A3 (dB) from a Hann-windowed FFT, harmonic peaks
    picked within +/-10 % of k*F0. Returns uncorrected H1-H2, H1-A1, H1-A3 and
    formant-corrected H1*-H2*, H1*-A3*."""
    rows = []
    freqs = np.fft.rfftfreq(nfft, 1 / fs)
    for t, f0, fm in zip(t_centres, f0s, fm_list):
        if not (f0 and f0 > 0):
            continue
        F1, F2, F3 = fm.get("F1"), fm.get("F2"), fm.get("F3")
        if any(v is None or math.isnan(v) for v in (F1, F2, F3)):
            continue
        n = int(round(win_periods / f0 * fs))
        n = max(n, int(0.02 * fs))
        i0 = int(round(t * fs)) - n // 2
        if i0 < 0 or i0 + n > len(x):
            continue
        seg = x[i0:i0 + n] * np.hanning(n)
        mag = 20 * np.log10(np.abs(np.fft.rfft(seg, nfft)) + 1e-12)

        def peak(fc, tol=0.1):
            m = (freqs >= fc * (1 - tol)) & (freqs <= fc * (1 + tol))
            if not m.any():
                return float("nan"), float("nan")
            j = np.argmax(np.where(m, mag, -np.inf))
            return float(mag[j]), float(freqs[j])

        H1, _ = peak(f0)
        H2, _ = peak(2 * f0)

        def harm_near(F, half=0.2):
            # strongest harmonic within +/-20 % of the formant
            ks = [k for k in range(1, int(4000 / f0) + 1) if abs(k * f0 - F) <= half * F]
            if not ks:
                ks = [max(1, int(round(F / f0)))]
            best = max(ks, key=lambda k: peak(k * f0, 0.05)[0])
            a, fa = peak(best * f0, 0.05)
            return a, best * f0

        A1, fA1 = harm_near(F1)
        A3, fA3 = harm_near(F3)
        B = [min(max(fm.get(f"B{i}", 80) or 80, 40), 400) for i in (1, 2, 3)]

        def corr(f, nform):
            return sum(_resonator_db(f, Fi, Bi, fs) for Fi, Bi in list(zip((F1, F2, F3), B))[:nform])

        H1c = H1 - corr(f0, 2)
        H2c = H2 - corr(2 * f0, 2)
        A3c = A3 - corr(fA3, 3)
        rows.append({"H1H2": H1 - H2, "H1A1": H1 - A1, "H1A3": H1 - A3,
                     "H1H2c": H1c - H2c, "H1A3c": H1c - A3c})
    if not rows:
        return None
    out = {}
    for k in rows[0]:
        v = np.array([r[k] for r in rows])
        v = v[np.isfinite(v)]
        out[k + "_median_db"] = round(float(np.median(v)), 2)
    out["n_frames"] = len(rows)
    return out


def voiced_concat(snd: pm.Sound, pitch, min_int_db_below_peak=25.0):
    """Concatenate voiced, non-quiet frames (10 ms granularity) into one Sound."""
    x = snd.values[0]
    fs = snd.sampling_frequency
    it = snd.to_intensity(minimum_pitch=75, time_step=0.01)
    peak = np.percentile(it.values[0], 99)
    keep = []
    for t, f in zip(pitch.xs(), pitch.selected_array["frequency"]):
        if f <= 0:
            continue
        if it.get_value(t) is None or it.get_value(t) < peak - min_int_db_below_peak:
            continue
        a, b = int((t - 0.005) * fs), int((t + 0.005) * fs)
        if a >= 0 and b <= len(x):
            keep.append(x[a:b])
    if not keep:
        return None
    return pm.Sound(np.concatenate(keep), sampling_frequency=fs)


def ltas_tilt(snd_voiced: pm.Sound):
    """Long-term average spectrum of voiced speech:
    * band-energy ratio L(1-4 kHz) - L(0-1 kHz)  (an alpha-ratio variant capped at
      4 kHz because of the codec; less negative = more high-frequency energy =
      'lighter/brighter' or louder-pressed - interpret alongside H1-H2)
    * Praat LTAS slope 0-1 kHz vs 1-4 kHz (energy, dB).
    * L(2-4 kHz) - L(0-2 kHz) as a twang/'ring' indicator."""
    ltas = call(snd_voiced, "To Ltas", 50.0)

    def band_energy_db(lo, hi):
        f = np.arange(lo + 25, hi, 50.0)
        v = np.array([call(ltas, "Get value at frequency", float(fi), "Nearest") for fi in f])
        return 10 * np.log10(np.mean(10 ** (v / 10)))

    return {
        "ltas_1to4k_minus_0to1k_db": round(band_energy_db(1000, 4000) - band_energy_db(50, 1000), 2),
        "ltas_2to4k_minus_0to2k_db": round(band_energy_db(2000, 4000) - band_energy_db(50, 2000), 2),
        "praat_slope_0_1k_vs_1_4k_db": round(call(ltas, "Get slope", 0.0, 1000.0, 1000.0, 4000.0, "energy"), 2),
    }


def cpps(snd: pm.Sound):
    """Smoothed cepstral peak prominence, Praat implementation (60 Hz floor, 2 ms
    step, 5 kHz max, pre-emphasis 50 Hz; 20 ms time / 0.5 ms quefrency smoothing;
    60-330 Hz peak search; straight robust trend line from 1 ms) - Praat defaults,
    cf. Maryn & Weenink 2015; Murton et al. 2020 use 10 ms / 1 ms smoothing, so
    absolute values are not interchangeable with their cut-offs."""
    pc = call(snd, "To PowerCepstrogram", 60.0, 0.002, 5000.0, 50.0)
    # Praat's defaults for Get CPPS (straight, robust tilt line).  "Robust slow" is
    # ~100x slower in Praat 6.1.38 (17 s for 2 s of audio).
    tries = [
        (True, 0.02, 0.0005, 60.0, 330.0, 0.05, "Parabolic", 0.001, 0.0, "Straight", "Robust"),
    ]
    last = None
    for a in tries:
        try:
            return round(float(call(pc, "Get CPPS", *a)), 2)
        except Exception as e:  # signature differs between Praat versions
            last = e
    raise last


# -------------------------------------------------------------- segmentation
def voiced_runs(pitch, min_len=0.06, merge_gap=0.15):
    f = pitch.selected_array["frequency"]
    t = pitch.xs()
    runs, st_i = [], None
    for i, v in enumerate(f > 0):
        if v and st_i is None:
            st_i = i
        if (not v or i == len(f) - 1) and st_i is not None:
            runs.append([t[st_i], t[i - 1 if not v else i]])
            st_i = None
    merged = []
    for a, b in runs:
        if merged and a - merged[-1][1] < merge_gap:
            merged[-1][1] = b
        else:
            merged.append([a, b])
    return [(a, b) for a, b in merged if b - a >= min_len]


def vowel_core(snd, a, b, drop_db=10.0):
    """Within a voiced token [a,b], the contiguous stretch around the intensity
    peak that stays within drop_db of it (excludes the voiced /d/ closure)."""
    it = snd.to_intensity(minimum_pitch=75, time_step=0.005)
    ts = np.array([x for x in it.xs() if a <= x <= b])
    if len(ts) < 3:
        return a, b
    v = np.array([it.get_value(x) for x in ts])
    j = int(np.argmax(v))
    lo = j
    while lo > 0 and v[lo - 1] >= v[j] - drop_db:
        lo -= 1
    hi = j
    while hi < len(v) - 1 and v[hi + 1] >= v[j] - drop_db:
        hi += 1
    return float(ts[lo]), float(ts[hi])


def phrases(snd, min_pause=0.25, thresh_below_peak=30.0):
    it = snd.to_intensity(minimum_pitch=75, time_step=0.01)
    peak = np.percentile(it.values[0], 99)
    on = it.values[0] > peak - thresh_below_peak
    ts = it.xs()
    segs, s0 = [], None
    for i, v in enumerate(on):
        if v and s0 is None:
            s0 = ts[i]
        if not v and s0 is not None:
            segs.append([s0, ts[i]])
            s0 = None
    if s0 is not None:
        segs.append([s0, ts[-1]])
    merged = []
    for a, b in segs:
        if merged and a - merged[-1][1] < min_pause:
            merged[-1][1] = b
        else:
            merged.append([a, b])
    return [(a, b) for a, b in merged if b - a > 0.4]
