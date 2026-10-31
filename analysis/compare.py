"""Compare two result JSONs from run.py (e.g. baseline vs week 4).

    analysis/.venv/Scripts/python.exe analysis/compare.py analysis/results/baseline.json analysis/results/week4.json
"""
import json
import sys

ROWS = [
    ("04_stella", ["f0", "median_hz"]), ("04_stella", ["f0", "p5_hz"]), ("04_stella", ["f0", "p95_hz"]),
    ("04_stella", ["f0", "sd_st"]),
    ("05_free", ["f0", "median_hz"]), ("05_free", ["f0", "p5_hz"]), ("05_free", ["f0", "p95_hz"]),
    ("05_free", ["f0", "sd_st"]),
    ("04_stella", ["long_term_formants", "F1_median_hz"]), ("04_stella", ["long_term_formants", "F2_median_hz"]),
    ("04_stella", ["long_term_formants", "F3_median_hz"]),
    ("04_stella", ["long_term_formants", "vtl_F1_F4", "vtl_cm"]),
    ("04_stella", ["harmonics", "H1H2c_median_db"]), ("04_stella", ["harmonics", "H1A3c_median_db"]),
    ("04_stella", ["ltas", "ltas_1to4k_minus_0to1k_db"]), ("04_stella", ["cpps_voiced_db"]),
    ("02_sustained", ["summary", "cpps_db_median"]), ("02_sustained", ["summary", "H1H2c_median_db"]),
    ("02_sustained", ["summary", "H1A3c_median_db"]),
    ("03_glide", ["overall_min_hz_p1"]), ("03_glide", ["overall_max_hz_p99"]),
]


def get(d, path):
    for p in path:
        if not isinstance(d, dict) or p not in d:
            return None
        d = d[p]
    return d


def main(a, b):
    A, B = json.load(open(a, encoding="utf-8")), json.load(open(b, encoding="utf-8"))
    print(f"{'measure':55s} {'A':>9s} {'B':>9s} {'B-A':>8s}")
    for f, path in ROWS:
        x, y = get(A.get(f, {}), path), get(B.get(f, {}), path)
        d = (y - x) if isinstance(x, (int, float)) and isinstance(y, (int, float)) else None
        print(f"{f + ':' + '.'.join(path):55s} {str(x):>9s} {str(y):>9s} {('%.2f' % d) if d is not None else '':>8s}")
    hv_a = get(A, ["01_hvd", "by_ceiling", "5000", "per_word"]) or {}
    hv_b = get(B, ["01_hvd", "by_ceiling", "5000", "per_word"]) or {}
    for w in hv_a:
        if w in hv_b:
            print(f"hvd {w:8s} " + "  ".join(f"F{i} {hv_a[w]['F%d' % i]}->{hv_b[w]['F%d' % i]}" for i in (1, 2, 3)))


if __name__ == "__main__":
    main(*sys.argv[1:3])
