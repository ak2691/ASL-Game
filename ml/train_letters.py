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

Usage:  .venv/Scripts/python train_letters.py
Output: ../apps/web/public/models/letters.json
"""

import json
from pathlib import Path

import numpy as np
from sklearn.metrics import classification_report
from sklearn.model_selection import train_test_split
from sklearn.neural_network import MLPClassifier

OUT = Path("../apps/web/public/models/letters.json")
LETTERS = list("ABCDEFGHIKLMNOPQRSTUVWXY")  # static letters only (no J, Z yet)
TIPS = [4, 8, 12, 16, 20]
KNUCKLES = [5, 9, 13, 17]
PAIRS = [(a, b) for i, a in enumerate(TIPS) for b in TIPS[i + 1:]] + [(4, k) for k in KNUCKLES]
rng = np.random.default_rng(0)


def features(points: np.ndarray) -> np.ndarray:
    """points: (21, 3) raw MediaPipe coordinates -> 77 features."""
    p = points - points[0]
    p = p / (np.linalg.norm(p[9, :2]) or 1.0)
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


def train(raw, y, copies=9):
    X = [features(p) for p in raw]
    Y = list(y)
    for _ in range(copies):
        X += [features(augment(p)) for p in raw]
        Y += list(y)
    model = MLPClassifier(hidden_layer_sizes=(128, 64), alpha=1e-3, max_iter=300,
                          early_stopping=True, random_state=0)
    return model.fit(np.array(X), np.array(Y))


def score(model, raw, y):
    return model.score(np.array([features(p) for p in raw]), y)


def predict_json(model_json: dict, X: np.ndarray) -> np.ndarray:
    """Run an exported letters.json model (same math as the web app)."""
    x = X
    for layer in model_json["layers"]:
        x = x @ np.array(layer["w"]).reshape(layer["inputs"], layer["outputs"]) + np.array(layer["b"])
        x = np.maximum(x, 0) if layer["activation"] == "relu" else x
    return x.argmax(1)


def compare_with_previous(model, X_te, X_te_messy, y_te, warn_drop=0.03):
    """Per-letter accuracy vs the currently shipped model, so one letter can't silently get worse.
    (Lesson: overall accuracy rose while tilted P got worse. See skills.md.)"""
    if not OUT.exists():
        return
    old = json.loads(OUT.read_text())
    if old.get("labels") != LETTERS or len(old["layers"][0]["w"]) != X_te.shape[1] * old["layers"][0]["outputs"]:
        print("previous model has a different format; skipping per-letter comparison")
        return
    print("\nper-letter accuracy vs previous model (clean / one finger messed up):")
    worse = []
    for name, X in [("clean", X_te), ("messy", X_te_messy)]:
        new_pred, old_pred = model.predict(X), predict_json(old, X)
        for i, letter in enumerate(LETTERS):
            m = y_te == i
            n, o = (new_pred[m] == i).mean(), (old_pred[m] == i).mean()
            if n < o - warn_drop:
                worse.append(f"  {letter} ({name}): {o:.0%} -> {n:.0%}")
    print("\n".join(worse) if worse else "  no letter got worse by more than 3 points")


def main():
    a_raw, a_y = load_aslnow()
    s_raw, s_y = load_siruyy()
    print(f"ASLNow: {len(a_raw)} samples   Siruyy: {len(s_raw)} samples")

    # How well does a model trained on one dataset handle the other (= new people)?
    print(f"trained on ASLNow -> tested on Siruyy: {score(train(a_raw, a_y), s_raw, s_y):.3f}")
    print(f"trained on Siruyy -> tested on ASLNow: {score(train(s_raw, s_y), a_raw, a_y):.3f}")

    raw = np.concatenate([a_raw, s_raw])
    y = np.concatenate([a_y, s_y])
    raw_tr, raw_te, y_tr, y_te = train_test_split(raw, y, test_size=0.2, stratify=y, random_state=0)
    model = train(raw_tr, y_tr)
    X_te = np.array([features(p) for p in raw_te])
    print(f"combined, held-out test accuracy: {model.score(X_te, y_te):.3f}")
    X_te_messy = np.array([features(mess_up_finger(p)) for p in raw_te])
    print(f"same test, one finger messed up:  {model.score(X_te_messy, y_te):.3f}")
    print(classification_report(y_te, model.predict(X_te), target_names=LETTERS, digits=2))

    compare_with_previous(model, X_te, X_te_messy, y_te)

    final = train(raw, y)  # ship a model trained on everything
    OUT.parent.mkdir(parents=True, exist_ok=True)
    layers = []
    for i, (w, b) in enumerate(zip(final.coefs_, final.intercepts_)):
        last = i == len(final.coefs_) - 1
        layers.append({"inputs": w.shape[0], "outputs": w.shape[1],
                       "activation": "softmax" if last else "relu",
                       "w": [round(float(v), 6) for v in w.reshape(-1)],
                       "b": [round(float(v), 6) for v in b]})
    OUT.write_text(json.dumps({"labels": LETTERS, "pairs": PAIRS, "layers": layers}))
    print(f"saved {OUT} ({OUT.stat().st_size // 1024} KB)")


if __name__ == "__main__":
    main()
