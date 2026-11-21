"""Estimate the camera shape (width / height) behind datasets that only kept MediaPipe's 0..1 points.

MediaPipe's x is a fraction of the image width and y of the height, so a hand's shape depends on the
image's shape. ASL-HG keeps its photo sizes (extract_aslhg.py), so it can be put in true proportions
exactly. ASLNow and Siruyy can't: this finds the stretch k (x and z times k) that makes each letter's
hands line up best with ASL-HG's true-proportion hands of the same letter (training signers only).

Per dataset: one k (best median nearest-neighbour distance over all letters).
Per sample: each hand's own best k, to see if a dataset mixes camera shapes.

Usage: .venv/Scripts/python estimate_aspect.py   -> prints results, writes data/aspect-estimates.json
"""

import json
from pathlib import Path

import numpy as np
from scipy.spatial import cKDTree

import train_letters as tl

GRID = np.round(np.exp(np.linspace(np.log(0.4), np.log(2.5), 61)), 4)  # 0.4 .. 2.5, even steps in log
OUT = Path("data/aspect-estimates.json")


def stretch(raw: np.ndarray, k) -> np.ndarray:
    p = raw.copy()
    k = np.asarray(k, dtype=np.float32).reshape(-1, 1)
    p[..., 0] = 0.5 + (p[..., 0] - 0.5) * k
    p[..., 2] = p[..., 2] * k
    return p


def shape_feats(raw: np.ndarray) -> np.ndarray:
    """Wrist-relative, palm-scaled 2D points: the hand's shape (depth is too noisy to judge by)."""
    p = raw[..., :2] - raw[:, :1, :2]
    s = np.linalg.norm(p[:, 9], axis=1, keepdims=True)
    p = p / np.where(s > 0, s, 1)[..., None]
    return p.reshape(len(p), -1)


def mirror_both(raw):
    m = raw.copy()
    m[..., 0] = 1 - m[..., 0]
    return np.concatenate([raw, m])


def main():
    h_raw, h_y, h_sg = tl.load_aslhg()  # true proportions already (uses the photo sizes)
    train = ~np.isin(h_sg, list(tl.HOLDOUT_SIGNERS))
    ref = {}
    for i in range(len(tl.LETTERS)):
        r = mirror_both(h_raw[train & (h_y == i)])  # either hand
        ref[i] = cKDTree(shape_feats(r))

    out = {}
    for name, loader in [("aslnow", tl.load_aslnow_raw), ("siruyy", tl.load_siruyy_raw)]:
        raw, y = loader()
        # dist[s, g] = distance from sample s, stretched by GRID[g], to the nearest same-letter ASL-HG hand
        dist = np.zeros((len(raw), len(GRID)), dtype=np.float32)
        for g, k in enumerate(GRID):
            f = shape_feats(stretch(raw, k))
            for i in np.unique(y):
                m = y == i
                dist[m, g] = ref[i].query(f[m], k=3)[0].mean(1)
        med = np.median(dist, axis=0)
        k_set = float(GRID[med.argmin()])
        per = GRID[dist.argmin(1)]
        none_k = float(np.median(dist[:, np.abs(GRID - 1).argmin()]))
        print(f"\n{name}: {len(raw)} hands")
        print(f"  one k for the dataset: {k_set:.2f}  (median distance {med.min():.3f}; unstretched k=1: {none_k:.3f})")
        qs = np.percentile(per, [10, 25, 50, 75, 90])
        print("  per-hand best k, 10/25/50/75/90%: " + "  ".join(f"{q:.2f}" for q in qs))
        hist, edges = np.histogram(np.log(per), bins=12)
        for c, a, b in zip(hist, edges[:-1], edges[1:]):
            print(f"    {np.exp(a):4.2f}-{np.exp(b):4.2f} {'#' * int(60 * c / max(hist.max(), 1))} {c}")
        out[name] = {"k": k_set, "per_sample": [float(v) for v in per]}
    OUT.write_text(json.dumps({k: {"k": v["k"]} for k, v in out.items()}, indent=1))
    np.savez_compressed("data/aspect-per-sample.npz", **{k: np.array(v["per_sample"], dtype=np.float32) for k, v in out.items()})
    print(f"\nsaved {OUT}")


if __name__ == "__main__":
    main()
