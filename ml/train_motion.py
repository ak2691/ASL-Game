"""Train the motion model: the last WINDOW_MS (1.5 s) of hand points -> none / J / Z.

Data: data/motion/synth.npz from synth_motion.py (training), synth_test.npz (unseen signers' hands).
The test set compares the model with the old hand-written rules in motion.ts (ported below).

Features (must match apps/web/src/motion.ts), per FRAMES-long clip (45 frames = 1.5 s):
  s = palm size in frame 0 (wrist -> middle knuckle, x/y); o = wrist in frame 0
  - path:  wrist, index tip, pinky tip for every frame, (p - o) / s, x/y   -> 45 x 6 = 270
  - shape: every 3rd frame, 21 points minus that frame's wrist, / that frame's palm size, x/y/z -> 15 x 63 = 945
Model: ensemble of ENSEMBLE x (1215 -> 64 -> 32 -> 3) MLPs, probabilities averaged.
JSON: {"models": [{"layers": [...]}, ...]} (layers in the same format as letters.json).

Usage:  .venv/Scripts/python train_motion.py [out.json] [seed_base]
Output: ../apps/web/public/models/motion.json
"""

import json
import os
from pathlib import Path

import numpy as np
import torch
from torch import nn

from synth_motion import CLASSES, FRAMES, WINDOW_MS

import sys
_ARGS = sys.argv[1:] if __name__ == "__main__" else []  # only when run as a script (eval_motion imports this file)
OUT = Path(_ARGS[0]) if len(_ARGS) > 0 else Path("../apps/web/public/models/motion.json")
PATH_POINTS = [0, 8, 20]
SHAPE_STEP = 3
rng = np.random.default_rng(0)


# No depth (z): MediaPipe's z from a live webcam is on a different scale from the z in the photo
# datasets our synthetic hands come from. A classifier told real from synthetic Js 99% of the time
# from z alone, and the model called real Js "none" (Nov 2026). x/y only.
SHAPE_DIMS = 2


def features(clip: np.ndarray, dims: int = SHAPE_DIMS) -> np.ndarray:
    """clip: (FRAMES, 21, 3) image coords -> features (path x/y + hand shape x/y; no depth)."""
    s = np.linalg.norm(clip[0, 9, :2] - clip[0, 0, :2]) or 1.0
    path = (clip[:, PATH_POINTS, :2] - clip[0, 0, :2]) / s
    sh = (clip[::SHAPE_STEP] - clip[::SHAPE_STEP, :1])[:, :, :dims]
    sh = sh / (np.linalg.norm(sh[:, 9, :2], axis=1)[:, None, None] + 1e-6)
    return np.concatenate([path.reshape(-1), sh.reshape(-1)]).astype(np.float32)


def time_warp(clip: np.ndarray) -> np.ndarray:
    """Resample at a random speed and shift (different webcam frame rates / signing speeds)."""
    k = rng.uniform(0.75, 1.35)
    src = (np.arange(FRAMES) - FRAMES / 2) * k + FRAMES / 2 + rng.uniform(-3, 3)
    src = np.clip(src, 0, FRAMES - 1)
    lo = np.floor(src).astype(int)
    hi = np.minimum(lo + 1, FRAMES - 1)
    w = (src - lo)[:, None, None]
    return clip[lo] * (1 - w) + clip[hi] * w


# ---- old rules from apps/web/src/motion.ts, for comparison ----

def rule_J(c):
    t = c[:, 20, :2]
    s = np.linalg.norm(c[0, 9, :2] - c[0, 0, :2])
    low = max(i for i in range(len(t)) if t[i, 1] >= t[:, 1].max() - 1e-9)
    top = int(np.argmin(t[: low + 1, 1]))
    e = t[-1]
    down = (t[low, 1] - t[top, 1]) / s
    drift = abs(t[low, 0] - t[top, 0]) / s
    hook = abs(e[0] - t[top, 0]) / s
    lift = (t[low, 1] - e[1]) / s
    return down > 0.35 and drift < down * 0.8 and hook > 0.2 and lift > 0.07


def rule_Z(c):
    s = np.linalg.norm(c[0, 9, :2] - c[0, 0, :2])
    P = c[:, 8, :2] / s
    st, d, turn = [], 0, P[0]
    for p in P[1:]:
        if d and (p[0] - turn[0]) * d > 0:
            turn = p
            st[-1][1] = p
            continue
        if abs(p[0] - turn[0]) >= 0.25:
            d = np.sign(p[0] - turn[0])
            st.append([turn, p])
            turn = p
    if len(st) < 3:
        return False
    a, b, cc = st[-3:]
    w = lambda q: abs(q[1][0] - q[0][0])  # noqa: E731
    dr = lambda q: q[1][1] - q[0][1]  # noqa: E731
    W = max(w(a), w(b), w(cc))
    lv = lambda q: abs(dr(q)) < w(q) * 1.2  # noqa: E731
    ay = lambda q: (q[0][1] + q[1][1]) / 2  # noqa: E731
    return (all(w(q) >= 0.3 and w(q) >= W * 0.35 for q in (a, b, cc)) and lv(a) and lv(cc)
            and dr(b) >= 0.2 and ay(cc) - ay(a) >= 0.2)


def rules_predict(c):
    # The app only checks the target letter's rule; here both run, J first.
    return 1 if rule_J(c) else 2 if rule_Z(c) else 0


# ---- training ----

ENSEMBLE = int(os.environ.get('ENSEMBLE', 5))  # models trained with different random starts; the app averages their answers
SEED_BASE = int(_ARGS[1]) if len(_ARGS) > 1 else 0  # pick another base to check run-to-run stability


INPUT_DROPOUT = 0.2  # share of inputs hidden at random during training
FEATURE_NOISE = 0.1  # input noise, as a share of each feature's spread


def make_net(n_in):
    # smaller than v4 (128/64) so 5 of them stay a reasonable download
    # Dropout (input + hidden) keeps the model from leaning on a few exact inputs: v11 called real
    # Js "none" although their nearest synthetic clips were Js (fragile boundaries, sim-to-real gap).
    return nn.Sequential(nn.Dropout(INPUT_DROPOUT), nn.Linear(n_in, 64), nn.ReLU(), nn.Dropout(0.3),
                         nn.Linear(64, 32), nn.ReLU(), nn.Dropout(0.3), nn.Linear(32, len(CLASSES)))


def fit(X, y, seed=0, epochs=200, patience=15, batch=512):
    dev = "cuda" if torch.cuda.is_available() else "cpu"
    torch.manual_seed(seed)
    idx = np.random.default_rng(seed).permutation(len(X))
    nv = len(X) // 10
    Xt, yt = torch.tensor(X, device=dev), torch.tensor(y, dtype=torch.long, device=dev)
    tr, va = torch.tensor(idx[nv:], device=dev), torch.tensor(idx[:nv], device=dev)
    net = make_net(X.shape[1]).to(dev)
    feat_sd = Xt.std(0, keepdim=True)
    opt = torch.optim.AdamW(net.parameters(), lr=1e-3, weight_decay=1e-4)
    best, state, bad = -1.0, None, 0
    for ep in range(epochs):
        net.train()
        for b in tr[torch.randperm(len(tr), device=dev)].split(batch):
            opt.zero_grad()
            xb = Xt[b] + torch.randn_like(Xt[b]) * feat_sd * FEATURE_NOISE  # small noise on every input
            nn.functional.cross_entropy(net(xb), yt[b]).backward()
            opt.step()
        net.eval()
        with torch.no_grad():
            acc = (net(Xt[va]).argmax(1) == yt[va]).float().mean().item()
        if acc > best:
            best, bad, state = acc, 0, {k: v.clone() for k, v in net.state_dict().items()}
        else:
            bad += 1
            if bad >= patience:
                break
    net.load_state_dict(state)
    net.eval().cpu()
    print(f"trained seed {seed} on {dev}: {ep + 1} epochs, validation {best:.3f}", flush=True)
    return net


ACCEPT_PROB = 0.8  # motion.ts ACCEPT_PROB
PREV = Path("data/motion/motion-v14-noz.json")  # model to compare against (currently in the app)


def run_json(m, X):
    """Run an exported motion.json (same math as the app; ensembles are averaged). Returns probabilities."""
    out = 0
    nets = [n["layers"] for n in m["models"]] if "models" in m else [m["layers"]]
    for layers in nets:
        x = X
        for layer in layers:
            x = x @ np.array(layer["w"]).reshape(layer["inputs"], layer["outputs"]) + np.array(layer["b"])
            if layer["activation"] == "relu":
                x = np.maximum(x, 0)
        e = np.exp(x - x.max(1, keepdims=True))
        out = out + e / e.sum(1, keepdims=True) / len(nets)
    return out


def report(name, pred, y, kinds):
    print(f"\n{name}: overall {np.mean(pred == y):.3f}")
    for c, L in enumerate(CLASSES):
        m = y == c
        print(f"  {L:5s} recognized {np.mean(pred[m] == c):.3f}")
    ex = np.char.endswith(kinds.astype(str), "+exit")
    print("  ending with the hand leaving: " + ", ".join(
        f"{L} {np.mean(pred[(y == c) & ex] == c):.3f}" for c, L in enumerate(CLASSES) if ((y == c) & ex).any()))
    m = y == 0
    print(f"  false triggers on none: {np.mean(pred[m] != 0):.3f}")
    for k in np.unique(kinds[m]):
        mk = m & (kinds == k)
        print(f"    {k:11s} {np.mean(pred[mk] != 0):.3f}")


SKIP_MS = 700  # a saved clip may start with the tail of an earlier, already-accepted sign


def real_windows(frames, window=WINDOW_MS, n=FRAMES, dims=SHAPE_DIMS):
    """Replay a recorded clip like motion.ts: one model window per real frame (raw points,
    gap fill, history cleared after a > GAP_MS loss or an accepted letter)."""
    from synth_motion import GAP_MS, sample_at
    buf, out = [], []
    t0 = frames[0]["t"]
    for f in frames:
        if f["raw"] is None:
            if buf and f["t"] - buf[-1][0] > GAP_MS:
                buf = []
            continue
        buf.append((f["t"], np.array(f["raw"], dtype=np.float32)))
        while len(buf) > 1 and f["t"] - buf[1][0] > window:
            buf.pop(0)
        if len(buf) >= 4 and f["t"] - t0 >= SKIP_MS:
            T = np.array([b[0] for b in buf])
            F = np.array([b[1] for b in buf])
            out.append(features(np.array([sample_at(T, F, f["t"] - window + i * window / (n - 1)) for i in range(n)]), dims))
        if f["accepted"]:
            buf = []
    return np.array(out)


def real_report(name, prob_fn, window=WINDOW_MS, n=FRAMES, dims=SHAPE_DIMS):
    """Per recorded clip: would the app accept the target (>= ACCEPT_PROB for 2 frames in a row)?"""
    files = sorted(Path("data/motion/real").glob("*.json"))
    seen, hits, total, peaks = set(), {}, {}, []
    for fp in files:
        for c in json.loads(fp.read_text())["clips"]:
            end = c["frames"][-1]["t"]
            if any(abs(end - e) < 500 for e in seen):  # S pressed twice: (almost) the same clip
                continue
            seen.add(end)
            X = real_windows(c["frames"], window, n, dims)
            if not len(X):
                continue
            p = prob_fn(X)[:, CLASSES.index(c["label"])] if c["label"] in CLASSES else np.zeros(len(X))
            ok = bool(np.any((p[1:] >= ACCEPT_PROB) & (p[:-1] >= ACCEPT_PROB)))
            hits[c["label"]] = hits.get(c["label"], 0) + ok
            total[c["label"]] = total.get(c["label"], 0) + 1
            peaks.append(f"{p.max():.2f}")
    print(f"{name}: " + ", ".join(f"{L} {hits[L]}/{total[L]}" for L in total) + f"   peaks: {' '.join(peaks)}")


def main():
    d = np.load("data/motion/synth.npz")
    raw, y = d["points"], d["labels"]
    X = [features(c) for c in raw] + [features(time_warp(c)) for c in raw]
    Y = np.concatenate([y, y])
    X = np.array(X)
    nets = [fit(X, Y, seed=SEED_BASE + k) for k in range(ENSEMBLE)]

    def fires(probs):  # like the app: a J/Z only counts when the model is >= ACCEPT_PROB sure
        p = probs.argmax(1)
        return np.where(probs.max(1) >= ACCEPT_PROB, p, 0)

    def one(net):
        return lambda X: torch.softmax(net(torch.tensor(X)), 1).detach().numpy()

    def new(X):  # the ensemble: average of all members
        return sum(one(n)(X) for n in nets) / len(nets)
    old_json = json.loads(PREV.read_text()) if PREV.exists() else None
    for name, path in [("CLEAN camera", "data/motion/synth_test.npz"), ("BAD camera", "data/motion/synth_test_bad.npz")]:
        t = np.load(path)
        Xte = np.array([features(c) for c in t["points"]])
        print(f"\n===== {name}, unseen signers' hands =====")
        report("NEW model", fires(new(Xte)), t["labels"], t["kinds"])
        if old_json and old_json["frames"] == FRAMES and old_json.get("shapeDims", 3) == SHAPE_DIMS:
            report(f"PREVIOUS model ({PREV.name})", fires(run_json(old_json, Xte)), t["labels"], t["kinds"])

    print("\n===== REAL recordings (data/motion/real) =====")
    for k, n in enumerate(nets):
        real_report(f"  member {k} alone", one(n))
    real_report("NEW ENSEMBLE", new)
    if old_json:
        real_report(f"PREVIOUS model ({PREV.name})", lambda X: run_json(old_json, X),
                    old_json.get("windowMs", 1000), old_json["frames"], old_json.get("shapeDims", 3))

    def export(net):
        layers = []
        lin = [m for m in net if isinstance(m, nn.Linear)]
        for i, m in enumerate(lin):
            w = m.weight.detach().numpy().T
            layers.append({"inputs": w.shape[0], "outputs": w.shape[1],
                           "activation": "softmax" if i == len(lin) - 1 else "relu",
                           "w": [round(float(v), 4) for v in w.reshape(-1)],
                           "b": [round(float(v), 4) for v in m.bias.detach().numpy()]})
        return {"layers": layers}

    OUT.write_text(json.dumps({"labels": CLASSES, "frames": FRAMES, "windowMs": WINDOW_MS, "pathPoints": PATH_POINTS,
                               "shapeStep": SHAPE_STEP, "shapeDims": SHAPE_DIMS, "models": [export(n) for n in nets]}))
    print(f"\nsaved {OUT} ({OUT.stat().st_size // 1024} KB)")


if __name__ == "__main__":
    main()
