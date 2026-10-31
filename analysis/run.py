"""Re-runnable acoustic analysis pipeline.

Usage (from the project root):
    analysis/.venv/Scripts/python.exe analysis/run.py recordings/baseline
    analysis/.venv/Scripts/python.exe analysis/run.py recordings/week4
    analysis/.venv/Scripts/python.exe analysis/run.py recordings/reference/candidates --generic

Writes analysis/results/<dirname>.json (and a short text summary to stdout).
Audio (m4a/wav/mp3/...) is decoded to 48 kHz mono 16-bit WAV in analysis/cache/<dirname>/
with the ffmpeg bundled in imageio-ffmpeg (no system ffmpeg needed).

Files are recognised by prefix, following recordings/RECORDING_SCRIPT.md:
    01_hvd  02_sustained  03_glide  04_stella  05_free  06_attempt
Anything else (or everything, with --generic) gets the generic connected-speech analysis.

Re-running after 4 weeks: record with the same phone, app, distance and room, drop the files
in a new folder and run this on it; compare the JSONs with analysis/compare.py.
"""
from __future__ import annotations

import argparse
import datetime as dt
import json
import math
import os
import subprocess
import sys

import numpy as np
import parselmouth as pm
from parselmouth.praat import call

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import measures as M  # noqa: E402

HVD_WORDS = ["heed", "hid", "head", "had", "hard", "hud", "hod", "hoard", "hood", "who'd",
             "heard", "hay", "high", "hoy", "how", "hoe", "here", "hair"]
MONOPHTHONGS = HVD_WORDS[:11]
SUSTAINED = ["ahh", "eee", "ooo", "ahh", "eee", "ooo"]
AUDIO_EXT = (".m4a", ".wav", ".mp3", ".aac", ".ogg", ".flac", ".opus", ".webm", ".3gp")


# ------------------------------------------------------------------ decoding
def ffmpeg_exe():
    import imageio_ffmpeg
    return imageio_ffmpeg.get_ffmpeg_exe()


def decode(src, cache_dir):
    os.makedirs(cache_dir, exist_ok=True)
    dst = os.path.join(cache_dir, os.path.splitext(os.path.basename(src))[0] + ".wav")
    if not os.path.exists(dst) or os.path.getmtime(dst) < os.path.getmtime(src):
        subprocess.run([ffmpeg_exe(), "-hide_banner", "-loglevel", "error", "-y", "-i", src,
                        "-map", "0:a:0", "-ac", "1", "-ar", "48000", "-c:a", "pcm_s16le", dst],
                       check=True)
    return dst


def r(x, n=1):
    if x is None:
        return None
    try:
        if not np.isfinite(x):
            return None
    except TypeError:
        return x
    return round(float(x), n)


# ------------------------------------------------------------- shared blocks
def formant_ceiling(median_f0):
    """Praat convention: 5000 Hz for adult male-sized tracts, 5500 Hz for female-sized.
    Chosen from median F0 as a proxy (speaker baseline -> 5000)."""
    return 5500.0 if median_f0 and median_f0 >= 165 else 5000.0


def long_term_formants(snd, pitch, ceiling, int_drop_db=20.0):
    """Median F1..F4 over voiced, loud frames (formant-dispersion / VTL inputs)."""
    fo = M.formant_obj(snd, ceiling, time_step=0.01)
    it = snd.to_intensity(minimum_pitch=75, time_step=0.01)
    peak = np.percentile(it.values[0], 99)
    rows = []
    for t, f in zip(pitch.xs(), pitch.selected_array["frequency"]):
        if f <= 0:
            continue
        iv = it.get_value(t)
        if iv is None or not np.isfinite(iv) or iv < peak - int_drop_db:
            continue
        row = [fo.get_value_at_time(i, t) for i in (1, 2, 3, 4)]
        if any(v is None or not np.isfinite(v) for v in row):
            continue
        rows.append(row)
    if len(rows) < 20:
        return None
    a = np.array(rows)
    med = np.median(a, axis=0)
    out = {f"F{i+1}_median_hz": r(med[i], 0) for i in range(4)}
    out["n_frames"] = len(rows)
    out["vtl_F1_F4"] = M.vtl_from_formants({i + 1: float(med[i]) for i in range(4)})
    out["vtl_F1_F3"] = M.vtl_from_formants({i + 1: float(med[i]) for i in range(3)})
    return out


def speech_harmonics(snd, pitch, ceiling, step=0.02):
    """H1-H2, H1*-H2*, H1-A3, H1*-A3* over voiced frames of running speech."""
    fo = M.formant_obj(snd, ceiling, time_step=0.005)
    ts, f0s, fms = [], [], []
    f = pitch.selected_array["frequency"]
    xs = pitch.xs()
    for i in range(1, len(f) - 1, max(1, int(round(step / 0.01)))):
        # require locally stable voicing (3 voiced frames, < 1 st change)
        if min(f[i - 1], f[i], f[i + 1]) <= 0:
            continue
        if abs(12 * math.log2(f[i + 1] / f[i - 1])) > 1.0:
            continue
        ts.append(xs[i])
        f0s.append(f[i])
        fms.append(M.formants_at(fo, xs[i], half_win=0.005, n=3))
    return M.harmonic_measures(snd.values[0], snd.sampling_frequency, ts, f0s, fms)


def phrase_final(snd, pitch, median_hz):
    """Phrase-final behaviour: the fall in the last voiced 200 ms of each phrase relative
    to the phrase median, and a creak proxy = share of loud-but-unvoiced or very-low-F0
    (< median - 7 st) frames in the last 250 ms vs the rest of the phrase.  Proxy only:
    Praat's AC tracker drops many creaky frames as unvoiced; no auditory check."""
    it = snd.to_intensity(minimum_pitch=75, time_step=0.01)
    peak = np.percentile(it.values[0], 99)
    xs = pitch.xs()
    f = pitch.selected_array["frequency"]
    low = median_hz * 2 ** (-7 / 12)
    falls, fin_flags, mid_flags, n = [], [], [], 0
    for a, b in M.voiced_runs(pitch, min_len=0.4, merge_gap=0.3):
        idx = [i for i, t in enumerate(xs) if a <= t <= b]
        vf = [(xs[i], f[i]) for i in idx if f[i] > 0]
        if len(vf) < 15:
            continue
        n += 1
        med = np.median([v for _, v in vf])
        tl = vf[-1][0]
        last = [v for t, v in vf if t >= tl - 0.2]
        falls.append(12 * math.log2(np.median(last) / med))
        for i in idx:
            iv = it.get_value(xs[i])
            if iv is None or not np.isfinite(iv) or iv < peak - 25:
                continue
            flag = (f[i] <= 0) or (f[i] < low)
            (fin_flags if xs[i] >= b - 0.25 else mid_flags).append(flag)
    if not n:
        return None
    return {"n_phrases": n, "phrase_def": "voiced runs merged over gaps < 0.3 s, >= 0.4 s long",
            "final_fall_st_median": r(np.median(falls), 2),
            "creak_proxy_final_pct": r(100 * np.mean(fin_flags), 1) if fin_flags else None,
            "creak_proxy_medial_pct": r(100 * np.mean(mid_flags), 1) if mid_flags else None}


def low_f0_creak_scan(snd, median_hz):
    """Second proxy: a 30 Hz-floor pitch pass; % of voiced frames below 70 Hz or below
    median-12 st (sub-modal, fry-range periodicity) in the whole file."""
    p = snd.to_pitch_ac(time_step=0.01, pitch_floor=30.0, pitch_ceiling=600.0)
    v = p.selected_array["frequency"]
    v = v[v > 0]
    if len(v) < 20:
        return None
    thr = min(70.0, median_hz * 0.5)
    return {"pct_voiced_frames_below": r(100 * np.mean(v < thr), 1), "threshold_hz": r(thr, 1)}


def generic_speech(snd, label, ceiling=None):
    p, (fl, ce) = M.pitch_two_pass(snd)
    f = p.selected_array["frequency"]
    st = M.f0_stats(f)
    if st is None:
        return {"error": "too little voicing"}
    ceiling = ceiling or formant_ceiling(st["median_hz"])
    out = {"label": label, "duration_s": r(snd.duration, 2), "pitch_floor_ceiling": [r(fl), r(ce)],
           "f0": st, "formant_ceiling_hz": ceiling}
    vc = M.voiced_concat(snd, p)
    out["cpps_whole_file_db"] = M.cpps(snd)
    out["cpps_voiced_db"] = M.cpps(vc) if vc is not None else None
    out["ltas"] = M.ltas_tilt(vc) if vc is not None else None
    out["harmonics"] = speech_harmonics(snd, p, ceiling)
    out["long_term_formants"] = long_term_formants(snd, p, ceiling)
    out["phrase_final"] = phrase_final(snd, p, st["median_hz"])
    out["low_f0_scan"] = low_f0_creak_scan(snd, st["median_hz"])
    out["f0_histogram_st_re100"] = f0_hist(f)
    out["octave_check"] = octave_check(f)
    return out


def f0_hist(f):
    v = M.st(f[f > 0])
    edges = np.arange(-12, 37, 1.0)
    h, _ = np.histogram(v, edges)
    return {"bin_lo_st": edges[:-1].tolist(), "counts": h.tolist()}


def octave_check(f):
    """Frame-to-frame jumps within voiced stretches >= 7 st (half an octave or more).
    Single-frame jumps that return are usually tracker octave errors, not voice."""
    jumps = []
    for i in range(1, len(f)):
        if f[i] > 0 and f[i - 1] > 0:
            d = 12 * math.log2(f[i] / f[i - 1])
            if abs(d) >= 7:
                jumps.append({"t": round(0.01 * i + 0.005, 2), "st": round(d, 1),
                              "from_hz": round(float(f[i - 1])), "to_hz": round(float(f[i]))})
    return {"n_jumps_ge_7st": len(jumps), "jumps_st": jumps[:40]}


# -------------------------------------------------------------------- tasks
def task_hvd(snd):
    p, _ = M.pitch_two_pass(snd)
    runs = M.voiced_runs(p)
    st = M.f0_stats(p.selected_array["frequency"])
    out = {"f0": st, "n_tokens_detected": len(runs)}
    sens = {}
    for ceiling in (4500.0, 5000.0, 5500.0):
        fo = M.formant_obj(snd, ceiling)
        toks = []
        for a, b in runs:
            c0, c1 = M.vowel_core(snd, a, b)
            mid = (c0 + c1) / 2
            fm = M.formants_at(fo, mid)
            toks.append({"t": r(mid, 3), "dur_core": r(c1 - c0, 3),
                         **{k: r(fm[k], 0) for k in ("F1", "F2", "F3", "B1", "B2", "B3")}})
        labels = align_hvd(toks)
        for tk, lab in zip(toks, labels):
            tk["word"] = lab
        per = {}
        for w in HVD_WORDS:
            ts = [t for t in toks if t["word"] == w]
            if not ts:
                continue
            per[w] = {"n": len(ts)}
            for k in ("F1", "F2", "F3"):
                vals = [t[k] for t in ts if t[k] is not None]
                per[w][k] = r(np.median(vals), 0) if vals else None
            per[w]["tokens"] = [{k: t[k] for k in ("t", "F1", "F2", "F3")} for t in ts]
        sens[str(int(ceiling))] = {"per_word": per, "tokens": toks}
    out["by_ceiling"] = sens
    out["primary_ceiling"] = "5000"
    return out


def align_hvd(toks):
    """Assign tokens to words. The list is read 3x in order; reps are split at the longest
    pauses. A rep with exactly 18 tokens is labelled in order. Other reps are aligned to a
    template (median log-F1/F2 of the cleanly-labelled reps) by monotonic DP that allows a
    skipped word or an extra token; extra tokens are labelled None."""
    n = len(toks)
    if n == 0:
        return []
    t = np.array([x["t"] for x in toks])
    gaps = np.diff(t)
    nrep = max(1, round(n / 18))
    cut = sorted(np.argsort(gaps)[::-1][:nrep - 1]) if nrep > 1 else []
    reps, s = [], 0
    for c in cut:
        reps.append(list(range(s, c + 1)))
        s = c + 1
    reps.append(list(range(s, n)))
    labels = [None] * n
    clean = [rp for rp in reps if len(rp) == 18]
    for rp in clean:
        for k, i in enumerate(rp):
            labels[i] = HVD_WORDS[k]
    if not clean:  # fall back: in-order labelling
        for i in range(n):
            labels[i] = HVD_WORDS[i % 18]
        return labels

    def feat(x):
        return np.array([math.log(x["F1"] or 1), math.log(x["F2"] or 1)])
    tmpl = []
    for k in range(18):
        tmpl.append(np.median([feat(toks[rp[k]]) for rp in clean], axis=0))
    labels = [None] * n
    for rp in reps:
        m, W = len(rp), 18
        INS, SKIP = 0.35, 0.35
        D = np.full((m + 1, W + 1), np.inf)
        bt = np.zeros((m + 1, W + 1), int)
        D[0, :] = np.arange(W + 1) * SKIP
        D[:, 0] = np.arange(m + 1) * INS
        for i in range(1, m + 1):
            fi = feat(toks[rp[i - 1]])
            for j in range(1, W + 1):
                c = [D[i - 1, j - 1] + float(np.linalg.norm(fi - tmpl[j - 1])),
                     D[i - 1, j] + INS, D[i, j - 1] + SKIP]
                bt[i, j] = int(np.argmin(c))
                D[i, j] = c[bt[i, j]]
        i, j = m, W
        while i > 0 and j > 0:
            if bt[i, j] == 0:
                labels[rp[i - 1]] = HVD_WORDS[j - 1]
                i, j = i - 1, j - 1
            elif bt[i, j] == 1:
                i -= 1
            else:
                j -= 1
    return labels


def task_sustained(snd):
    p, _ = M.pitch_two_pass(snd)
    runs = sorted(M.voiced_runs(p, min_len=1.0), key=lambda ab: ab[0])
    fs = snd.sampling_frequency
    out = []
    for k, (a, b) in enumerate(runs):
        lab = SUSTAINED[k] if k < len(SUSTAINED) else f"v{k}"
        a2, b2 = a + 0.4, b - 0.4  # steady middle part
        seg = snd.extract_part(a2, b2, preserve_times=False)
        sp, _ = M.pitch_two_pass(seg)
        f = sp.selected_array["frequency"]
        st = M.f0_stats(f)
        med = st["median_hz"] if st else 120
        ceiling = formant_ceiling(med)
        fo = M.formant_obj(seg, ceiling)
        ts = [x for x, v in zip(sp.xs(), f) if v > 0][::3]
        f0s = [sp.get_value_at_time(x) for x in ts]
        fms = [M.formants_at(fo, x, half_win=0.01, n=3) for x in ts]
        hm = M.harmonic_measures(seg.values[0], fs, ts, f0s, fms)
        mid = M.formants_at(fo, seg.duration / 2, half_win=0.2, n=4)
        pp = call(seg, "To PointProcess (periodic, cc)", 0.75 * med, 2 * med)
        jit = call(pp, "Get jitter (local)", 0, 0, 0.0001, 0.02, 1.3)
        shim = call([seg, pp], "Get shimmer (local)", 0, 0, 0.0001, 0.02, 1.3, 1.6)
        harm = call(seg, "To Harmonicity (cc)", 0.01, 0.75 * med, 0.1, 1.0)
        hnr = call(harm, "Get mean", 0, 0)
        out.append({"vowel": lab, "start": r(a, 2), "end": r(b, 2), "f0": st,
                    "formants": {k2: r(v, 0) for k2, v in mid.items()},
                    "cpps_db": M.cpps(seg), "harmonics": hm,
                    "jitter_local_pct": r(100 * jit, 2), "shimmer_local_pct": r(100 * shim, 2),
                    "hnr_db": r(hnr, 1)})
    summ = {}
    for key in ("cpps_db",):
        summ[key + "_median"] = r(np.median([o[key] for o in out]), 2)
    for key in ("H1H2_median_db", "H1H2c_median_db", "H1A3_median_db", "H1A3c_median_db"):
        vals = [o["harmonics"][key] for o in out if o["harmonics"]]
        summ[key] = r(np.median(vals), 2) if vals else None
    return {"vowels": out, "summary": summ}


def task_glide(snd):
    p = snd.to_pitch_ac(time_step=0.01, pitch_floor=60.0, pitch_ceiling=1100.0,
                        octave_jump_cost=0.5)
    f = p.selected_array["frequency"]
    xs = p.xs()
    glides = []
    for a, b in M.voiced_runs(p, min_len=1.0, merge_gap=0.3):
        idx = [i for i, t in enumerate(xs) if a <= t <= b]
        v = np.array([f[i] for i in idx])
        tv = np.array([xs[i] for i in idx])
        m = v > 0
        if m.sum() < 30:
            continue
        sv = M.st(v[m])
        jumps = []
        vi = np.where(m)[0]
        for k in range(1, len(vi)):
            if vi[k] - vi[k - 1] > 5:   # voicing gap > 50 ms inside the glide
                jumps.append({"type": "voicing_break", "t": r(tv[vi[k]], 2),
                              "from_hz": r(v[vi[k - 1]]), "to_hz": r(v[vi[k]])})
                continue
            d = sv[k] - sv[k - 1]
            if abs(d) >= 1.5:  # > 1.5 st in 10 ms is not a smooth glide
                jumps.append({"type": "jump", "t": r(tv[vi[k]], 2), "st": r(d, 2),
                              "from_hz": r(v[vi[k - 1]]), "to_hz": r(v[vi[k]])})
        steps = np.abs(np.diff(sv))
        glides.append({"start": r(a, 2), "end": r(b, 2),
                       "min_hz_p1": r(np.percentile(v[m], 1)), "max_hz_p99": r(np.percentile(v[m], 99)),
                       "min_hz": r(v[m].min()), "max_hz": r(v[m].max()),
                       "range_st_p1_p99": r(M.st(np.percentile(v[m], 99)) - M.st(np.percentile(v[m], 1)), 1),
                       "median_abs_step_st_per_10ms": r(np.median(steps), 3),
                       "p99_abs_step_st_per_10ms": r(np.percentile(steps, 99), 3),
                       "discontinuities": jumps})
    allv = f[f > 0]
    fo = M.formant_obj(snd, 5000.0)
    ts = [x for x, v in zip(xs, f) if v > 0][::2]
    rows = []
    for tt in ts:
        f0 = p.get_value_at_time(tt)
        hm = M.harmonic_measures(snd.values[0], snd.sampling_frequency, [tt], [f0],
                                 [M.formants_at(fo, tt, half_win=0.005, n=3)])
        if hm:
            rows.append((M.st(f0), hm["H1H2_median_db"], hm["H1H2c_median_db"]))
    bins = {}
    for s_, h, hc in rows:
        bins.setdefault(int(np.floor(s_ / 2) * 2), []).append((h, hc))
    # NB on "ooo" (F1 ~330 Hz) uncorrected H1-H2 dips where 2*F0 crosses F1 (F0 ~150-200 Hz);
    # the corrected value depends on formant tracking, which is poor at high F0. Low confidence.
    h1h2_by_f0 = [{"st_re100_lo": k, "hz_lo": r(100 * 2 ** (k / 12)), "n": len(v),
                   "H1H2_median_db": r(np.median([a for a, _ in v]), 1),
                   "H1H2c_median_db": r(np.median([b for _, b in v]), 1)}
                  for k, v in sorted(bins.items()) if len(v) >= 5]
    return {"glides": glides, "h1h2_by_f0_bin": h1h2_by_f0,
            "overall_min_hz_p1": r(np.percentile(allv, 1)), "overall_max_hz_p99": r(np.percentile(allv, 99)),
            "overall_range_st": r(M.st(np.percentile(allv, 99)) - M.st(np.percentile(allv, 1)), 1),
            "track": {"t": [r(x, 2) for x in xs[::2]], "f0": [r(x) for x in f[::2]]}}


def compare_attempt(res):
    """06_attempt (Stella read 'femme try') vs 04_stella (Stella read, normal voice)."""
    a, b = res.get("06_attempt"), res.get("04_stella")
    if not a or not b or "f0" not in a or "f0" not in b:
        return None
    out = {"f0_median_shift_st": r(a["f0"]["median_st_re100"] - b["f0"]["median_st_re100"], 2),
           "f0_p95_shift_st": r(a["f0"]["p95_st_re100"] - b["f0"]["p95_st_re100"], 2),
           "f0_p5_shift_st": r(a["f0"]["p5_st_re100"] - b["f0"]["p5_st_re100"], 2),
           "f0_sd_change_st": r(a["f0"]["sd_st"] - b["f0"]["sd_st"], 2)}
    la, lb = a.get("long_term_formants"), b.get("long_term_formants")
    if la and lb:
        for i in (1, 2, 3, 4):
            k = f"F{i}_median_hz"
            out[f"F{i}_change_pct"] = r(100 * (la[k] / lb[k] - 1), 1)
        out["vtl_change_cm"] = r(la["vtl_F1_F4"]["vtl_cm"] - lb["vtl_F1_F4"]["vtl_cm"], 2)
    for k in ("H1H2c_median_db", "H1A3c_median_db", "H1H2_median_db"):
        if a.get("harmonics") and b.get("harmonics"):
            out[k + "_change"] = r(a["harmonics"][k] - b["harmonics"][k], 2)
    for k in ("ltas_1to4k_minus_0to1k_db", "ltas_2to4k_minus_0to2k_db"):
        if a.get("ltas") and b.get("ltas"):
            out[k + "_change"] = r(a["ltas"][k] - b["ltas"][k], 2)
    out["cpps_voiced_change_db"] = r((a.get("cpps_voiced_db") or 0) - (b.get("cpps_voiced_db") or 0), 2)
    # bimodality / octave: share of attempt frames >= 9 st above baseline-read median
    hb = np.array(b["f0_histogram_st_re100"]["counts"])
    ha = np.array(a["f0_histogram_st_re100"]["counts"])
    lo = np.array(a["f0_histogram_st_re100"]["bin_lo_st"])
    base_med = b["f0"]["median_st_re100"]
    out["attempt_pct_frames_ge_9st_above_baseline_median"] = r(100 * ha[lo >= base_med + 9].sum() / ha.sum(), 1)
    out["baseline_pct_frames_ge_9st_above_baseline_median"] = r(100 * hb[lo >= base_med + 9].sum() / hb.sum(), 1)
    out["attempt_pct_frames_ge_11st_above_baseline_median"] = r(100 * ha[lo >= base_med + 11].sum() / ha.sum(), 1)
    return out


TASKS = {"01_hvd": task_hvd, "02_sustained": task_sustained, "03_glide": task_glide}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("indir")
    ap.add_argument("--generic", action="store_true", help="treat every file as connected speech")
    ap.add_argument("--ceiling", type=float,
                    help="force the formant ceiling (Hz), e.g. 5500 for all-female reference sets")
    ap.add_argument("--out")
    args = ap.parse_args()
    indir = os.path.abspath(args.indir)
    name = os.path.basename(indir.rstrip("\\/"))
    cache = os.path.join(HERE, "cache", name)
    files = sorted(f for f in os.listdir(indir) if f.lower().endswith(AUDIO_EXT))
    res = {"_meta": {"indir": os.path.relpath(indir, os.path.dirname(HERE)).replace("\\", "/"),
                     "run_at": dt.datetime.now().isoformat(timespec="seconds"),
                     "praat": pm.PRAAT_VERSION, "parselmouth": pm.__version__,
                     "numpy": np.__version__, "python": sys.version.split()[0],
                     "notes": "F0 st re 100 Hz. Formants Burg 5 formants/25 ms; ceiling 5000 Hz "
                              "(5500 if median F0 >= 165 Hz). Harmonic/tilt measures < 4 kHz "
                              "(HE-AAC SBR above ~3.75-4 kHz). Phone mic: CPPS/tilt/H1-H2 "
                              "are relative-only."}}
    for fn in files:
        stem = os.path.splitext(fn)[0]
        wav = decode(os.path.join(indir, fn), cache)
        snd = pm.Sound(wav)
        if snd.n_channels > 1:
            snd = snd.convert_to_mono()
        key = stem[:2] + "_" + stem.split("_", 1)[1] if "_" in stem else stem
        task = None if args.generic else next((f for k, f in TASKS.items() if stem.startswith(k)), None)
        print(f"[{name}] {fn} -> {'generic' if task is None else task.__name__}", flush=True)
        try:
            res[stem] = task(snd) if task else generic_speech(snd, stem, ceiling=args.ceiling)
        except Exception as e:  # keep going; record the failure
            res[stem] = {"error": repr(e)}
        if task is task_hvd or task is task_sustained:
            # also connected-speech style voice measures for these files
            res[stem]["generic"] = generic_speech(snd, stem)
    if not args.generic:
        res["attempt_vs_stella"] = compare_attempt(res)
    out = args.out or os.path.join(HERE, "results", name + ".json")
    os.makedirs(os.path.dirname(out), exist_ok=True)
    with open(out, "w", encoding="utf-8") as fh:
        json.dump(res, fh, indent=1, default=lambda o: o.tolist() if hasattr(o, "tolist") else str(o))
    print("wrote", out)
    summary(res)


def summary(res):
    for k, v in res.items():
        if k.startswith("_") or not isinstance(v, dict):
            continue
        f0 = v.get("f0") or (v.get("generic") or {}).get("f0")
        if f0:
            print(f"  {k:24s} F0 med {f0['median_hz']:6.1f} Hz  p5-p95 {f0['p5_hz']:.0f}-{f0['p95_hz']:.0f}"
                  f"  SD {f0['sd_st']:.2f} st")


if __name__ == "__main__":
    main()
