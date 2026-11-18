"""Pick one typical example of each letter (from the MIT-licensed ASLNow data) for the guide picture.

For each letter, picks the sample closest to the letter's average shape, and saves its
21 points (wrist at origin, palm-scaled, x/y only) to ../apps/web/public/models/guide-poses.json.
"""

import json
from pathlib import Path

import numpy as np

import train_letters
from train_letters import load_aslnow

# J and Z aren't in the letter model, but ASLNow has still frames of them: use those as pictures.
LETTERS = train_letters.LETTERS + ["J", "Z"]
train_letters.LETTERS = LETTERS

OUT = Path("../apps/web/public/models/guide-poses.json")


def norm2d(points):
    p = points[:, :2] - points[0, :2]
    return p / (np.linalg.norm(p[9]) or 1.0)


def main():
    raw, y = load_aslnow()
    poses = {}
    for i, letter in enumerate(LETTERS):
        shapes = np.array([norm2d(p) for p in raw[y == i]])
        center = np.median(shapes, axis=0)
        best = shapes[np.argmin(((shapes - center) ** 2).sum(axis=(1, 2)))]
        poses[letter] = [[round(float(a), 4), round(float(b), 4)] for a, b in best]
    OUT.write_text(json.dumps(poses))
    print(f"saved {OUT}")


if __name__ == "__main__":
    main()
