"""Python reference for the spectral-tilt / "vocal weight" measures (run after praat_truth.py).

    ../analysis/.venv/Scripts/python.exe tilt_ref.py

For every file in data/truth.json:
  * frame selection: Praat-voiced frames with intensity >= (99th pct - 25 dB)   [same rule the JS uses]
  * H1-H2 (uncorrected, dB) per selected frame at the Praat F0: numpy Hann window of
    max(3 periods, 20 ms), rfft nfft=16384, max dB bin within +/-10 % of F0 and 2*F0
    (definition of analysis/measures.py:harmonic_measures, reimplemented independently here)
  * LTAS ratio L(1-4 kHz) - L(50-1000 Hz):
      - praat: Praat "To Ltas" (50 Hz bands) of the selected 10 ms pieces concatenated
               (method of analysis/measures.py:ltas_tilt / voiced_concat)
      - welch: mean Hann(2048, periodic) power spectrum centred on the selected frames
               (the method the JS implements, so JS-vs-welch is an implementation check)
Writes data/tilt_ref.json.
"""
import json
import os

import numpy as np
import parselmouth
import soundfile as sf
from parselmouth.praat import call

HERE = os.path.dirname(os.path.abspath(__file__))
NFFT = 16384


def select_frames(f):
    inten = np.array(f["intensity"], float)
    f0 = np.array(f["f0_praat"], float)
    thr = np.percentile(inten[inten > 0], 99) - 25 if (inten > 0).any() else -1e9
    return [i for i in range(len(f0)) if f0[i] > 0 and inten[i] >= thr]


def h1h2(x, fs, t, f0, freqs):
    n = max(int(round(3.0 / f0 * fs)), int(0.02 * fs))
    i0 = int(round(t * fs)) - n // 2
    if i0 < 0 or i0 + n > len(x):
        return None
    mag = 20 * np.log10(np.abs(np.fft.rfft(x[i0:i0 + n] * np.hanning(n), NFFT)) + 1e-12)

    def peak(fc):
        m = (freqs >= fc * 0.9) & (freqs <= fc * 1.1)
        return float(mag[m].max())

    return peak(f0) - peak(2 * f0)


def band_db_ltas(ltas, lo, hi):
    fr = np.arange(lo + 25, hi, 50.0)
    v = np.array([call(ltas, "Get value at frequency", float(fi), "Nearest") for fi in fr])
    return 10 * np.log10(np.mean(10 ** (v / 10)))


def main():
    truth = json.load(open(os.path.join(HERE, "data", "truth.json")))
    out = []
    for f in truth["files"]:
        x, fs = sf.read(os.path.join(HERE, f["path"]), dtype="float64")
        if x.ndim > 1:
            x = x[:, 0]
        x = x.astype(np.float32).astype(np.float64)  # same precision path as the JS (Float32 samples)
        sel = select_frames(f)
        freqs = np.fft.rfftfreq(NFFT, 1 / fs)
        hh = []
        for i in sel:
            v = h1h2(x, fs, f["times"][i], f["f0_praat"][i], freqs)
            hh.append(None if v is None else round(v, 3))
        # Praat LTAS of concatenated 10 ms voiced pieces
        pieces = []
        for i in sel:
            a, b = int(round((f["times"][i] - 0.005) * fs)), int(round((f["times"][i] + 0.005) * fs))
            if a >= 0 and b <= len(x):
                pieces.append(x[a:b])
        ltas_praat = welch = None
        if pieces:
            snd = parselmouth.Sound(np.concatenate(pieces), sampling_frequency=fs)
            ltas = call(snd, "To Ltas", 50.0)
            ltas_praat = band_db_ltas(ltas, 1000, 4000) - band_db_ltas(ltas, 50, 1000)
            n = 2048
            w = 0.5 - 0.5 * np.cos(2 * np.pi * np.arange(n) / n)
            acc = np.zeros(n // 2 + 1)
            cnt = 0
            for i in sel:
                i0 = int(round(f["times"][i] * fs)) - n // 2
                if i0 < 0 or i0 + n > len(x):
                    continue
                acc += np.abs(np.fft.rfft(x[i0:i0 + n] * w)) ** 2
                cnt += 1
            fr = np.arange(n // 2 + 1) * fs / n
            lo = acc[(fr >= 50) & (fr < 1000)].mean()
            hi = acc[(fr >= 1000) & (fr < 4000)].mean()
            welch = 10 * np.log10(hi / lo)
        v = [h for h in hh if h is not None]
        out.append(dict(name=f["name"], kind=f["kind"], group=f.get("group", "real"), frames=sel, h1h2=hh,
                        h1h2_median=None if not v else round(float(np.median(v)), 3),
                        ltas_ratio_praat=None if ltas_praat is None else round(float(ltas_praat), 3),
                        ltas_ratio_welch=None if welch is None else round(float(welch), 3),
                        tilt_db=f.get("tilt_db"), open_phase=f.get("open_phase")))
        print(f["name"], "n", len(sel), "H1-H2 med", out[-1]["h1h2_median"], "LTAS praat", out[-1]["ltas_ratio_praat"],
              "welch", out[-1]["ltas_ratio_welch"])
    json.dump(dict(files=out), open(os.path.join(HERE, "data", "tilt_ref.json"), "w"))


if __name__ == "__main__":
    main()
