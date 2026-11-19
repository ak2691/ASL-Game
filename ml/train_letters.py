"""Train a small ASL letter classifier on MediaPipe hand points.

Features (must match apps/web/src/recognition.ts):
  - 21 points measured from the wrist, scaled so wrist -> middle knuckle = 1 (63 numbers)
  - extra distances that separate look-alike letters (14 numbers):
      * between all fingertip pairs (U vs V: index/middle tips together or apart)
      * thumb tip to each knuckle (A/S/T/M/N: where the thumb sits)
Training also mirrors samples so the model works for both hands.

Data:
  - data/aslnow   sid220/asl-now-fingerspelling  (MIT, several people)
  - data/siruyy   Siruyy/asl-static-landmarks-v1 (CC BY 4.0)
  - data/aslhg    ASL-HG, Pranto et al. 2026 (CC BY 4.0, 10 signers), points from extract_aslhg.py

Usage:  .venv/Scripts/python train_letters.py
Output: ../apps/web/public/models/letters.json
"""

import json
import os
import time
from pathlib import Path

import numpy as np
import torch
from sklearn.metrics import classification_report
from torch import nn

OUT = Path(os.environ.get("LETTERS_OUT", "../apps/web/public/models/letters.json"))
# 3 = x/y/z (shipped so far); 2 = no depth. Live-webcam depth is on a different scale from the photo
# datasets' (it broke the motion model, see skills.md). LETTER_DIMS=2 trains a no-depth model.
DIMS = int(os.environ.get("LETTER_DIMS", 3))
LETTERS = list("ABCDEFGHIKLMNOPQRSTUVWXY")  # static letters only (no J, Z yet)
TIPS = [4, 8, 12, 16, 20]
KNUCKLES = [5, 9, 13, 17]
PAIRS = [(a, b) for i, a in enumerate(TIPS) for b in TIPS[i + 1:]] + [(4, k) for k in KNUCKLES]
rng = np.random.default_rng(0)


def features(points: np.ndarray) -> np.ndarray:
    """points: (21, 3) raw MediaPipe coordinates -> 77 features."""
    p = points - points[0]
    p = (p / (np.linalg.norm(p[9, :2]) or 1.0))[:, :DIMS]
    dists = [np.linalg.norm(p[a] - p[b]) for a, b in PAIRS]
    return np.concatenate([p.reshape(-1), dists])


def augment(points: np.ndarray) -> np.ndarray:
    """Random mirror, small rotation, scale and noise on raw points (21, 3)."""
    p = points.copy()
    if rng.random() < 0.5:
        p[:, 0] = 1 - p[:, 0]
    angle = np.radians(rng.uniform(-15, 15))
    c, s = np.cos(angle), np.sin(angle)
    center = p[0, :2]
    p[:, :2] = (p[:, :2] - center) @ np.array([[c, -s], [s, c]]).T * rng.uniform(0.9, 1.1) + center
    p += rng.normal(0, 0.003, p.shape)
    if rng.random() < MESSY_SHARE:
        p = mess_up_finger(p)
    return p


# "Messy hands": imitate MediaPipe's guesses when a finger is hidden behind another,
# so one wrong finger doesn't flip the letter.
MESSY_SHARE = 0.3  # share of augmented copies that get one messed-up finger
FINGER_JOINTS = [[2, 3, 4], [6, 7, 8], [10, 11, 12], [14, 15, 16], [18, 19, 20]]
FINGER_BASE = [1, 5, 9, 13, 17]


def mess_up_finger(points: np.ndarray, strength: float = 1.0) -> np.ndarray:
    p = points.copy()
    palm = np.linalg.norm(p[9, :2] - p[0, :2]) or 1.0
    k = rng.integers(5)
    joints, base = FINGER_JOINTS[k], FINGER_BASE[k]
    kind = rng.integers(3)
    if kind == 0:  # nudge: the whole finger shifts a bit
        p[joints, :2] += rng.normal(0, 0.15 * strength, 2) * palm
    elif kind == 1:  # collapse: the hidden finger is guessed curled toward its knuckle
        t = rng.uniform(0.2, 0.6) * strength
        p[joints] = p[joints] + (p[base] - p[joints]) * t
    else:  # depth flip: in front vs behind gets confused
        p[joints, 2] = p[base, 2] - (p[joints, 2] - p[base, 2]) * strength
    return p


def load_aslnow():
    X, y = [], []
    for i, letter in enumerate(LETTERS):
        for f in Path("data/aslnow", letter).glob("*.json"):
            pts = json.loads(f.read_text())
            if len(pts) == 21:
                X.append([[q["x"], q["y"], q["z"]] for q in pts])
                y.append(i)
    return np.array(X, dtype=np.float32), np.array(y)


def load_siruyy():
    """Standardized engineered features; the first 63 columns are the raw points. Labels 0-25 = A-Z."""
    d = Path("data/siruyy")
    mean, std = np.load(d / "mean.npy"), np.load(d / "std.npy")
    X = np.concatenate([np.load(d / "X_train.npy"), np.load(d / "X_test.npy")]) * std + mean
    labels = np.concatenate([np.load(d / "y_train.npy"), np.load(d / "y_test.npy")])
    letters = np.array([chr(ord("A") + k) for k in labels])
    # This signer's P points forward/level, which overlaps with K (same shape, pointing up).
    # P should point down, as in ASLNow, so we take P only from ASLNow.
    keep = np.isin(letters, LETTERS) & (letters != "P")
    y = np.array([LETTERS.index(c) for c in letters[keep]])
    return X[keep, :63].reshape(-1, 21, 3).astype(np.float32), y


ASLHG_SKIP: set[str] = set()  # letters to leave out of ASL-HG if they're signed differently (see skills.md)
HOLDOUT_SIGNERS = {"P3", "P8"}  # ASL-HG signers kept out of training to measure "new player" accuracy


def load_aslhg():
    """ASL-HG hand points from extract_aslhg.py. Returns points, labels, signer ids."""
    d = np.load("data/aslhg/points.npz")
    letters, signers = d["letters"], d["signers"]
    keep = np.isin(letters, LETTERS) & ~np.isin(letters, list(ASLHG_SKIP))
    y = np.array([LETTERS.index(c) for c in letters[keep]])
    return d["points"][keep], y, signers[keep]


class LetterMLP:
    """77 -> 128 -> 64 -> 24 network (same shape as before), trained with PyTorch on the GPU
    when available. Keeps a scikit-learn-like interface (fit / predict / score / coefs_)."""

    # 60 epochs was too few: it was still improving at the limit (see skills.md).
    def __init__(self, epochs=200, batch=1024, lr=1e-3, weight_decay=1e-4, patience=15, seed=0):
        self.epochs, self.batch, self.lr, self.wd, self.patience, self.seed = epochs, batch, lr, weight_decay, patience, seed
        self.device = "cuda" if torch.cuda.is_available() else "cpu"

    def fit(self, X, y):
        torch.manual_seed(self.seed)
        g = np.random.default_rng(self.seed)
        idx = g.permutation(len(X))
        n_val = len(X) // 10  # 10% held back for early stopping
        Xt = torch.tensor(X, dtype=torch.float32, device=self.device)
        yt = torch.tensor(y, dtype=torch.long, device=self.device)
        tr, va = torch.tensor(idx[n_val:], device=self.device), torch.tensor(idx[:n_val], device=self.device)
        self.net = nn.Sequential(nn.Linear(X.shape[1], 128), nn.ReLU(), nn.Linear(128, 64), nn.ReLU(),
                                 nn.Linear(64, len(LETTERS))).to(self.device)
        opt = torch.optim.AdamW(self.net.parameters(), lr=self.lr, weight_decay=self.wd)
        best, best_state, bad = -1.0, None, 0
        for epoch in range(self.epochs):
            self.net.train()
            for b in tr[torch.randperm(len(tr), device=self.device)].split(self.batch):
                opt.zero_grad()
                nn.functional.cross_entropy(self.net(Xt[b]), yt[b]).backward()
                opt.step()
            self.net.eval()
            with torch.no_grad():
                acc = (self.net(Xt[va]).argmax(1) == yt[va]).float().mean().item()
            if acc > best:
                best, bad = acc, 0
                best_state = {k: v.clone() for k, v in self.net.state_dict().items()}
            else:
                bad += 1
                if bad >= self.patience:
                    break
        self.net.load_state_dict(best_state)
        self.net.eval()
        print(f"  trained on {self.device}: {epoch + 1} epochs, validation {best:.3f}", flush=True)
        return self

    def predict(self, X):
        with torch.no_grad():
            return self.net(torch.tensor(X, dtype=torch.float32, device=self.device)).argmax(1).cpu().numpy()

    def score(self, X, y):
        return float((self.predict(X) == np.asarray(y)).mean())

    @property
    def coefs_(self):  # [inputs x outputs] per layer, like scikit-learn (the web app's format)
        return [m.weight.detach().cpu().numpy().T for m in self.net if isinstance(m, nn.Linear)]

    @property
    def intercepts_(self):
        return [m.bias.detach().cpu().numpy() for m in self.net if isinstance(m, nn.Linear)]


def train(raw, y, copies=4):
    t0 = time.time()
    X = [features(p) for p in raw]
    Y = list(y)
    for _ in range(copies):
        X += [features(augment(p)) for p in raw]
        Y += list(y)
    X, Y = np.array(X, dtype=np.float32), np.array(Y)
    print(f"  prepared {len(X)} training rows in {time.time() - t0:.0f}s", flush=True)
    t0 = time.time()
    model = LetterMLP().fit(X, Y)
    print(f"  training took {time.time() - t0:.0f}s", flush=True)
    return model


def score(model, raw, y):
    return model.score(np.array([features(p) for p in raw]), y)


def predict_json(model_json: dict, X: np.ndarray) -> np.ndarray:
    """Run an exported letters.json model (same math as the web app)."""
    x = X
    for layer in model_json["layers"]:
        x = x @ np.array(layer["w"]).reshape(layer["inputs"], layer["outputs"]) + np.array(layer["b"])
        x = np.maximum(x, 0) if layer["activation"] == "relu" else x
    return x.argmax(1)


REPORT = Path(os.environ.get("LETTERS_REPORT", "data/holdout-report.json"))  # unseen-signer results of the last run


def compare_with_previous(model, X_te, X_te_messy, y_te, warn_drop=0.03):
    """Per-letter accuracy on the unseen signers vs the LAST RUN's unseen-signer accuracy, so one
    letter can't silently get worse. (Lesson: overall accuracy rose while tilted P got worse.)
    Compares saved reports, not the shipped model: the shipped model was trained on every signer,
    including the held-out ones, so testing it on them would be unfair (it scores ~100%)."""
    report = {"holdout": sorted(HOLDOUT_SIGNERS), "letters": {}}
    for name, X in [("clean", X_te), ("messy", X_te_messy)]:
        pred = model.predict(X)
        report["letters"][name] = {l: float((pred[y_te == i] == i).mean()) for i, l in enumerate(LETTERS)}
        report[f"overall_{name}"] = float((pred == y_te).mean())
    old = json.loads(REPORT.read_text()) if REPORT.exists() else None
    if old and old.get("holdout") == report["holdout"]:
        print(f"\nvs last run on the same unseen signers: overall {old['overall_clean']:.1%} -> "
              f"{report['overall_clean']:.1%}")
        changes = []
        for name in ["clean", "messy"]:
            for l in LETTERS:
                o, n = old["letters"][name][l], report["letters"][name][l]
                if abs(n - o) > warn_drop:
                    changes.append(f"  {l} ({name}): {o:.0%} -> {n:.0%}  {'WORSE' if n < o else 'better'}")
        print("\n".join(changes) if changes else "  no letter changed by more than 3 points")
    else:
        print("\nno earlier report for these unseen signers; saving this run as the baseline")
    REPORT.write_text(json.dumps(report, indent=1))


def main():
    a_raw, a_y = load_aslnow()
    s_raw, s_y = load_siruyy()
    h_raw, h_y, h_signer = load_aslhg()
    print(f"ASLNow: {len(a_raw)}  Siruyy: {len(s_raw)}  ASL-HG: {len(h_raw)} samples "
          f"({len(set(h_signer))} signers)")

    # The honest test: ASL-HG signers the model never saw (= a brand-new player).
    held = np.isin(h_signer, list(HOLDOUT_SIGNERS))
    raw_tr = np.concatenate([a_raw, s_raw, h_raw[~held]])
    y_tr = np.concatenate([a_y, s_y, h_y[~held]])
    raw_te, y_te = h_raw[held], h_y[held]
    model = train(raw_tr, y_tr)
    X_te = np.array([features(p) for p in raw_te])
    X_te_messy = np.array([features(mess_up_finger(p)) for p in raw_te])
    print(f"unseen signers {sorted(HOLDOUT_SIGNERS)}: {model.score(X_te, y_te):.3f}"
          f"   (one finger messed up: {model.score(X_te_messy, y_te):.3f})")
    print(classification_report(y_te, model.predict(X_te), target_names=LETTERS, digits=2))

    # Per-letter changes vs the last run's results on the same unseen signers.
    compare_with_previous(model, X_te, X_te_messy, y_te)

    raw = np.concatenate([a_raw, s_raw, h_raw])
    y = np.concatenate([a_y, s_y, h_y])
    final = train(raw, y)  # ship a model trained on everything
    OUT.parent.mkdir(parents=True, exist_ok=True)
    layers = []
    for i, (w, b) in enumerate(zip(final.coefs_, final.intercepts_)):
        last = i == len(final.coefs_) - 1
        layers.append({"inputs": w.shape[0], "outputs": w.shape[1],
                       "activation": "softmax" if last else "relu",
                       "w": [round(float(v), 6) for v in w.reshape(-1)],
                       "b": [round(float(v), 6) for v in b]})
    OUT.write_text(json.dumps({"labels": LETTERS, "pairs": PAIRS, "dims": DIMS, "layers": layers}))
    print(f"saved {OUT} ({OUT.stat().st_size // 1024} KB)")


if __name__ == "__main__":
    main()
