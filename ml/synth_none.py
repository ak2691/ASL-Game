"""Synthetic "none" hands for the static letter model (25th class).

Without a "none" class the model always picks its closest letter: an open 5 reads as C or H,
a relaxed hand as F or G. Kinds (all built from real poses, per signer, so hands stay realistic):
  open5     B pose with fingers spread and thumb out (the "5" hand; no letter uses it)
  curl      each finger independently somewhere between straight (B) and curled (S): relaxed,
            half-closed, loose fist
  blend     halfway between two different letters of the same signer (a transition)
  motion    a curl/blend with motion jitter (fingertips smeared, one finger lagging)
Any sample that sits as close to a real letter as genuine letters from new signers do is dropped
(it would be a letter, not "none"). Holdout signers (P3, P8) are only used for the test set.

Usage: .venv/Scripts/python synth_none.py   -> data/none/none.npz + preview/none.png
"""

import os
from pathlib import Path

import numpy as np
from scipy.spatial import cKDTree

import train_letters as tl

rng = np.random.default_rng(1)
FINGERS = [[1, 2, 3, 4], [5, 6, 7, 8], [9, 10, 11, 12], [13, 14, 15, 16], [17, 18, 19, 20]]
PALM = [0, 5, 9, 13, 17]
L = tl.LETTERS


def norm(p):
    """Wrist at origin, wrist -> middle knuckle = 1 (same frame as the features)."""
    q = p - p[0]
    return q / (np.linalg.norm(q[9, :2]) or 1.0)


def to_raw(q):
    return (q * rng.uniform(0.12, 0.2) + [rng.uniform(0.3, 0.7), rng.uniform(0.3, 0.7), 0]).astype(np.float32)


def align(src, dst):
    """Rotate src's palm onto dst's palm (Kabsch on the palm points)."""
    a, b = src[PALM], dst[PALM]
    u, _, vt = np.linalg.svd(a.T @ b)
    d = np.sign(np.linalg.det(u @ vt))
    r = u @ np.diag([1, 1, d]) @ vt
    return src @ r


def rot_z(p, a):
    c, s = np.cos(a), np.sin(a)
    return p @ np.array([[c, -s, 0], [s, c, 0], [0, 0, 1]]).T


def thumb_side(p):
    return np.sign(p[4, 0] - p[17, 0]) or 1.0


def open5(b, ls=None):
    """A "5": B with the fingers spread and the thumb out. The thumb comes from the same signer's L
    (aligned on the palm), because rotating B's thumb in the image plane left it folded across the palm
    (tip ~0.3 palms from the middle knuckle; a real outstretched thumb is ~1.1, like L's)."""
    p = b.copy()
    side = thumb_side(p)
    a = rng.uniform(0.15, 0.5)
    for mcp, k in ((5, 1.0), (9, 0.35), (13, -0.35), (17, -1.0)):
        p[mcp + 1:mcp + 4] = rot_z(p[mcp + 1:mcp + 4] - p[mcp], side * a * k) + p[mcp]
    if ls and rng.random() < 0.85:
        lp = align(ls[rng.integers(len(ls))], b)
        p[1:5] = lp[1:5] - lp[0] + p[0]
    else:  # a lazier 5: thumb only partly out
        p[2:5] = rot_z(p[2:5] - p[1], side * rng.uniform(0.3, 0.9)) + p[1]
    if rng.random() < 0.4:  # slightly bent fingers (a lazy 5)
        f = FINGERS[rng.integers(1, 5)]
        p[f[1:]] += (p[f[0]] - p[f[1:]]) * rng.uniform(0.1, 0.3)
    return p


def curl(b, s):
    s = align(s, b)
    p = b.copy()
    for f in FINGERS:
        t = rng.uniform(0, 1)
        p[f[1:]] = b[f[1:]] * (1 - t) + s[f[1:]] * t
    return p


def blend(p1, p2):
    p2 = align(p2, p1)
    t = rng.uniform(0.35, 0.65)
    return p1 * (1 - t) + p2 * t


def motion(p):
    p = p.copy()
    f = FINGERS[rng.integers(5)]
    p[f[1:]] += rng.normal(0, 0.12, 3)  # one finger lags behind
    p[[4, 8, 12, 16, 20]] += rng.normal(0, 0.06, (5, 3))  # smeared tips
    return p


def build(pools, n_per_kind):
    """pools: list of {letter: [normalized poses]} per signer. Returns raw points + kind names."""
    out, kinds = [], []
    usable = [g for g in pools if len(g.get("B", [])) and len(g.get("S", []) + g.get("A", []))]
    for _ in range(n_per_kind):
        g = usable[rng.integers(len(usable))]
        b = g["B"][rng.integers(len(g["B"]))]
        fists = g.get("S", []) + g.get("A", []) + g.get("E", [])
        s = fists[rng.integers(len(fists))]
        letters = [k for k in g if len(g[k])]
        l1, l2 = rng.choice(letters, 2, replace=False)
        p1, p2 = g[l1][rng.integers(len(g[l1]))], g[l2][rng.integers(len(g[l2]))]
        for kind, p in [("open5", open5(b, g.get("L"))), ("curl", curl(b, s)), ("blend", blend(p1, p2)),
                        ("motion", motion(curl(b, s) if rng.random() < 0.5 else blend(p1, p2)))]:
            out.append(to_raw(p))
            kinds.append(kind)
    return np.array(out), np.array(kinds)


def pools_by_signer(raw, y, signers):
    pools = {}
    for p, yi, sg in zip(raw, y, signers):
        pools.setdefault(sg, {}).setdefault(L[yi], []).append(norm(p))
    return list(pools.values())


def main():
    a_raw, a_y = tl.load_aslnow()
    s_raw, s_y = tl.load_siruyy()
    h_raw, h_y, h_sg = tl.load_aslhg()
    held = np.isin(h_sg, list(tl.HOLDOUT_SIGNERS))
    # ASLNow has no signer ids; treat it as one pool (mixed hands blend less naturally, so small share).
    train_pools = pools_by_signer(h_raw[~held], h_y[~held], h_sg[~held]) + \
        pools_by_signer(s_raw, s_y, ["siruyy"] * len(s_raw))
    test_pools = pools_by_signer(h_raw[held], h_y[held], h_sg[held])

    tr, tr_k = build(train_pools, 6000)
    te, te_k = build(test_pools, 1000)

    # Drop "none" samples that look like a real letter: closer to the nearest training letter than the
    # 75% of genuine new-signer letters are (= would be read as that letter by any honest model).
    real_tr = np.concatenate([a_raw, s_raw, h_raw[~held]])
    feat = lambda P: np.array([tl.features(p) for p in P])
    F_real = feat(real_tr)
    mu, sd = F_real.mean(0), F_real.std(0) + 1e-6
    tree = cKDTree((F_real - mu) / sd)
    ref = np.percentile(tree.query((feat(h_raw[held]) - mu) / sd)[0], float(os.environ.get("NONE_PCT", 75)))
    res = {}
    for name, P, K in [("train", tr, tr_k), ("test", te, te_k)]:
        d = tree.query((feat(P) - mu) / sd)[0]
        keep = (d > ref) | (K == "open5")  # a spread 5 with the thumb out is never a letter
        for k in ["open5", "curl", "blend", "motion"]:
            m = K == k
            print(f"{name:5} {k:6}: kept {keep[m].sum()}/{m.sum()}")
        res[name] = (P[keep], K[keep], P[~keep], K[~keep])
    out = Path("data/none")
    out.mkdir(parents=True, exist_ok=True)
    np.savez(out / "none.npz", train=res["train"][0], train_kind=res["train"][1],
             test=res["test"][0], test_kind=res["test"][1])
    preview(res["train"])


def preview(r, n=10):
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    kept, kk, dropped, dk = r
    rows = [(f"{k} (kept)", kept[kk == k]) for k in ["open5", "curl", "blend", "motion"]] + \
           [("dropped: too letter-like", dropped)]
    fig, axes = plt.subplots(len(rows), n, figsize=(n * 1.4, len(rows) * 1.6))
    for (title, P), ax_row in zip(rows, axes):
        idx = rng.choice(len(P), min(n, len(P)), replace=False) if len(P) else []
        for j, ax in enumerate(ax_row):
            ax.axis("off")
            if j < len(idx):
                q = norm(P[idx[j]])
                for f in FINGERS:
                    ch = [0] + f
                    ax.plot(q[ch, 0], -q[ch, 1], "-o", ms=1.5, lw=1)
                ax.plot(q[PALM[1:], 0], -q[PALM[1:], 1], "k-", lw=0.6)
                ax.set_aspect("equal")
        ax_row[0].set_title(title, loc="left", fontsize=9)
    plt.tight_layout()
    plt.savefig("preview/none.png", dpi=90)
    print("saved preview/none.png")


if __name__ == "__main__":
    main()
