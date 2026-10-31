"""Per-vowel formant targets: the speaker's own vowels, scaled like an Australian woman's.

    analysis/.venv/Scripts/python.exe analysis/targets.py [analysis/results/baseline.json]

Method: one scale factor per formant (F1, F2, F3) = mean over the 11 monophthongs of
female/male in Elvin et al. 2016 (AusE). Applying the SAME factor to every vowel keeps her
relative vowel positions (= her accent) and only changes overall vocal-tract scaling.
The "aim" target uses that factor; the "land" (androgynous) target uses half the shift in log
terms (sqrt of the factor). Per-vowel female means are listed for reference only - they mix
sex-linked accent differences in with tract size, so they are NOT the target.
"""
import json
import math
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
V = ["heed", "hid", "head", "had", "hard", "hud", "hod", "hoard", "hood", "who'd", "heard"]


def main(path):
    N = json.load(open(os.path.join(HERE, "norms.json"), encoding="utf-8"))
    R = json.load(open(path, encoding="utf-8"))
    pw = R["01_hvd"]["by_ceiling"]["5000"]["per_word"]
    el = N["elvin2016"]
    k = []
    for i in range(3):
        rs = [el["female"][v][i] / el["male"][v][i] for v in V]
        k.append(math.exp(sum(math.log(x) for x in rs) / len(rs)))
    # The speaker relative to the AusE male mean (geometric mean over vowels)
    rel = []
    for i in range(3):
        rs = [pw[v][f"F{i+1}"] / el["male"][v][i] for v in V if pw.get(v)]
        rel.append(math.exp(sum(math.log(x) for x in rs) / len(rs)))
    rows = []
    for v in V:
        c = [pw[v][f"F{i+1}"] for i in range(3)]
        rows.append({"vowel": v, "own": c,
                     "aim": [round(c[i] * k[i]) for i in range(3)],
                     "land": [round(c[i] * math.sqrt(k[i])) for i in range(3)],
                     "elvin_f": el["female"][v], "elvin_m": el["male"][v],
                     "butcher_f": N["butcher2006"]["female"][v]})
    out = {"scale_elvin_f_over_m": [round(x, 3) for x in k],
           "own_over_elvin_male": [round(x, 3) for x in rel],
           "rows": rows}
    dst = os.path.join(os.path.dirname(path), os.path.splitext(os.path.basename(path))[0] + "_targets.json")
    json.dump(out, open(dst, "w", encoding="utf-8"), indent=1)
    print("scale F/M (Elvin):", out["scale_elvin_f_over_m"], " own/Elvin-male:", out["own_over_elvin_male"])
    for r in rows:
        print(f"{r['vowel']:6s} own {r['own']}  land {r['land']}  aim {r['aim']}  elvinF {r['elvin_f']}  elvinM {r['elvin_m']}  butcherF {r['butcher_f']}")
    print("wrote", dst)


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else os.path.join(HERE, "results", "baseline.json"))
