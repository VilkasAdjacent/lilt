"""Ground truth generator for the voice library benchmark.

NOTE: noise-free KlattGrid vowels have almost no energy in 4-5 kHz, so a 10-pole Burg (Praat)
or autocorrelation LPC puts a spare pole between F1 and F2 (e.g. male /i/ "F2" = 1250 Hz). A
40 dB SNR white-noise floor removes that; synth conditions are therefore noise-free, SNR40 and
SNR20 (SNR = full-band RMS ratio).

Run with the analysis venv:
    ../analysis/.venv/Scripts/python.exe praat_truth.py   (or: npm run truth)

Produces
  data/synth/*.wav      KlattGrid-synthesised vowels with known F0 and formants (48 kHz, 16-bit)
  data/truth.json       per-file frame times + Praat pitch/formant tracks (+ known truth for synth)

Praat settings (documented in research/library_comparison.md):
  Pitch:   To Pitch (ac): time step 0.01, floor 60, max candidates 15, very accurate off,
           silence 0.03, voicing 0.45, octave cost 0.01, octave-jump 0.35, V/UV 0.14, ceiling 600
  Formant: To Formant (burg): time step 0.01, max 5 formants, max formant 5000 Hz (speaker; male
           synth) / 5500 Hz (female synth), window 0.025 s, pre-emphasis from 50 Hz
  CPPS (only if env BENCH_CPPS=1): To PowerCepstrogram 60 Hz, 0.002 s, 5000 Hz, pre-emph 50; Get CPPS (Praat defaults)
"""
import json
import os
import glob

import numpy as np
import parselmouth
from parselmouth.praat import call

HERE = os.path.dirname(os.path.abspath(__file__))
DATA = os.path.join(HERE, "data")
SYNTH = os.path.join(DATA, "synth")
REAL_DIR = os.path.normpath(os.path.join(HERE, "..", "analysis", "cache", "baseline"))
FS = 48000
rng = np.random.default_rng(12345)

# Hillenbrand et al. (1995) average adult male / female formants (F1, F2, F3) + fixed F4/F5
VOWELS = {
    "male": {"i": (342, 2322, 3000), "a": (768, 1333, 2522), "u": (378, 997, 2343)},
    "female": {"i": (437, 2761, 3372), "a": (936, 1551, 2815), "u": (459, 1105, 2735)},
}
HIGHER = {"male": (3500, 4500), "female": (4200, 5000)}
BW = (60, 90, 150, 200, 250)
F0S = (90, 120, 150, 180, 220, 300)


def klatt(name, dur, f0_points, formants, tilt_db=None, open_phase=None):
    kg = call("Create KlattGrid", name, 0, dur, 5, 0, 0, 0, 0, 0, 0)
    for t, f in f0_points:
        call(kg, "Add pitch point", t, f)
    call(kg, "Add voicing amplitude point", 0.0, 90)
    call(kg, "Add voicing amplitude point", dur, 90)
    if tilt_db is not None:  # extra attenuation (dB) of the source at 3 kHz
        call(kg, "Add spectral tilt point", dur / 2, tilt_db)
    if open_phase is not None:  # glottal open quotient (KlattGrid default 0.7)
        call(kg, "Add open phase point", dur / 2, open_phase)
    for n, f in enumerate(formants, start=1):
        call(kg, "Add oral formant frequency point", n, dur / 2, f)
        call(kg, "Add oral formant bandwidth point", n, dur / 2, BW[n - 1])
    snd = call(kg, "To Sound")
    snd = call(snd, "Resample", FS, 50)
    return snd


def save(snd, path, snr_db=None):
    x = snd.values[0].astype(np.float64)
    if snr_db is not None:
        rms = np.sqrt(np.mean(x ** 2))
        x = x + rng.standard_normal(len(x)) * rms / (10 ** (snr_db / 20))
    x = 0.5 * x / np.max(np.abs(x))
    import soundfile as sf
    sf.write(path, x, FS, subtype="PCM_16")


def praat_tracks(path, max_formant):
    snd = parselmouth.Sound(path)
    pitch = call(snd, "To Pitch (ac)", 0.01, 60, 15, "no", 0.03, 0.45, 0.01, 0.35, 0.14, 600)
    times = [pitch.get_time_from_frame_number(i + 1) for i in range(pitch.get_number_of_frames())]
    f0 = []
    for i in range(pitch.get_number_of_frames()):
        v = call(pitch, "Get value in frame", i + 1, "Hertz")
        f0.append(0.0 if (v is None or np.isnan(v)) else float(v))
    fmt = call(snd, "To Formant (burg)", 0.01, 5, max_formant, 0.025, 50)
    fm = []
    for t in times:
        row = []
        for n in (1, 2, 3):
            v = fmt.get_value_at_time(n, t)
            row.append(0.0 if np.isnan(v) else round(float(v), 1))
        fm.append(row)
    intensity = call(snd, "To Intensity", 60, 0.01, "yes")
    inten = []
    for t in times:
        v = intensity.get_value(t)
        inten.append(0.0 if (v is None or np.isnan(v)) else round(float(v), 2))
    cpps = None
    if not os.environ.get("BENCH_CPPS"):  # CPPS is not used by the JS benchmark; opt-in (slow)
        return times, f0, fm, inten, cpps
    # Praat-default trend fit ("Straight"/"Robust") as used by analysis/measures.py: the
    # "Exponential decay"/"Robust slow" variant takes ~17 s per 2 s of audio in Praat 6.1.38.
    pcg = call(snd, "To PowerCepstrogram", 60, 0.002, 5000, 50)
    try:
        cpps = call(pcg, "Get CPPS", "yes", 0.02, 0.0005, 60, 330, 0.05, "Parabolic",
                    0.001, 0.0, "Straight", "Robust")
    except Exception as e:  # argument list differs between Praat versions
        print("CPPS failed", e)
    return times, f0, fm, inten, cpps


def main():
    os.makedirs(SYNTH, exist_ok=True)
    files = []
    # ---- synthetic steady vowels
    dur = 0.8
    for sex, table in VOWELS.items():
        for v, (f1, f2, f3) in table.items():
            for f0 in F0S:
                forms = (f1, f2, f3) + HIGHER[sex]
                snd = klatt("s", dur, [(0, f0), (dur, f0)], forms)
                for snr in (None, 40, 20):
                    name = f"{sex}_{v}_{f0}{f'_snr{snr}' if snr else ''}.wav"
                    save(snd, os.path.join(SYNTH, name), snr)
                    files.append(dict(name=name, kind="synth", sex=sex, vowel=v, f0=f0, snr=snr,
                                      dur=dur, f0_points=[[0, f0], [dur, f0]], formants=[f1, f2, f3]))
    # ---- glides (linear-in-Hz PitchTier interpolation)
    for sex, (a, b) in (("male", (85, 330)), ("female", (330, 140))):
        f1, f2, f3 = VOWELS[sex]["a"]
        gdur = 2.0
        snd = klatt("g", gdur, [(0, a), (gdur, b)], (f1, f2, f3) + HIGHER[sex])
        for snr in (None, 40, 20):
            name = f"glide_{sex}_a_{a}_{b}{f'_snr{snr}' if snr else ''}.wav"
            save(snd, os.path.join(SYNTH, name), snr)
            files.append(dict(name=name, kind="synth", sex=sex, vowel="a", f0=None, snr=snr, dur=gdur,
                              f0_points=[[0, a], [gdur, b]], formants=[f1, f2, f3]))

    # ---- "vocal weight" series: female /a/ at 200 Hz with varying source tilt and open quotient.
    #      Known ordering: more tilt dB / larger open phase -> larger H1-H2 and lower 1-4k/0-1k ratio.
    f1, f2, f3 = VOWELS["female"]["a"]
    for tilt in (0, 10, 20, 30):
        for oq in (0.4, 0.7, 0.9):
            snd = klatt("w", dur, [(0, 200), (dur, 200)], (f1, f2, f3) + HIGHER["female"], tilt, oq)
            name = f"weight_female_a_200_tilt{tilt}_oq{int(oq * 100)}.wav"
            save(snd, os.path.join(SYNTH, name), None)
            files.append(dict(name=name, kind="synth", group="weight", sex="female", vowel="a", f0=200,
                              snr=None, dur=dur, f0_points=[[0, 200], [dur, 200]], formants=[f1, f2, f3],
                              tilt_db=tilt, open_phase=oq))

    out = []
    for f in files:
        f.setdefault("group", "glide" if f["f0"] is None else "steady")
        path = os.path.join(SYNTH, f["name"])
        mf = 5000 if f["sex"] == "male" else 5500
        times, f0p, fm, inten, cpps = praat_tracks(path, mf)
        (t0, a), (t1, b) = f["f0_points"]
        f0_true = [a + (b - a) * (t - t0) / (t1 - t0) if 0.04 <= t <= f["dur"] - 0.04 else -1 for t in times]
        f.update(path=os.path.relpath(path, HERE).replace("\\", "/"), times=times, f0_praat=f0p,
                 f0_true=f0_true, formants_praat=fm, intensity=inten, cpps_praat=cpps,
                 praat_max_formant=mf)
        out.append(f)
        print("synth", f["name"], "cpps", cpps)

    for path in sorted(glob.glob(os.path.join(REAL_DIR, "*.wav"))):
        name = os.path.basename(path)
        times, f0p, fm, inten, cpps = praat_tracks(path, 5000)
        out.append(dict(name=name, kind="real", path=os.path.relpath(path, HERE).replace("\\", "/"),
                        times=times, f0_praat=f0p, formants_praat=fm, intensity=inten, cpps_praat=cpps,
                        praat_max_formant=5000))
        v = [x for x in f0p if x > 0]
        print("real", name, len(times), "frames, voiced", len(v), "median F0", np.median(v) if v else None,
              "cpps", cpps)

    with open(os.path.join(DATA, "truth.json"), "w") as fh:
        json.dump(dict(praat_version=parselmouth.PRAAT_VERSION, parselmouth=parselmouth.__version__,
                       files=out), fh)


if __name__ == "__main__":
    main()
