"""Score exported motion models on the real recordings in FREE mode (no target letter),
the way the casting game will read signs (MotionTracker.updateFree in motion.ts).

For each recorded J/Z clip: which letter does the model fire (>= 0.8 for 2 windows in a row,
the winning class among J/Z), if any? Also counts J/Z fired in the wrong clip type.

Usage:  .venv/Scripts/python eval_motion.py model1.json [model2.json ...]
"""

import json
import sys
from pathlib import Path

import numpy as np

from synth_motion import CLASSES
from train_motion import ACCEPT_PROB, real_windows, run_json


def fired(probs, labels=CLASSES):
    """First sign (J, Z, wiggle, ...) the app would fire for this sequence of windows, or None."""
    run, last = 0, None
    for p in probs:
        best = None
        for L in labels[1:]:
            v = p[labels.index(L)]
            if v >= ACCEPT_PROB and (best is None or v > p[labels.index(best)]):
                best = L
        run = run + 1 if best is not None and best == last else (1 if best else 0)
        last = best
        if best and run >= 2:
            return best
    return None


def clips():
    seen = []
    for fp in sorted(Path("data/motion/real").glob("*.json")):
        for c in json.loads(fp.read_text())["clips"]:
            if c["label"] not in ("J", "Z"):
                continue
            end = c["frames"][-1]["t"]
            if any(abs(end - e) < 500 for e in seen):
                continue
            seen.append(end)
            yield fp.name, c


def evaluate(path):
    m = json.loads(Path(path).read_text())
    win, n = m.get("windowMs", 1000), m["frames"]
    table = {"J": {"J": 0, "Z": 0, "wiggle": 0, None: 0}, "Z": {"J": 0, "Z": 0, "wiggle": 0, None: 0}}
    per_clip = []
    for name, c in clips():
        X = real_windows(c["frames"], win, n, m.get("shapeDims", 3))
        got = fired(run_json(m, X), m["labels"]) if len(X) else None
        table[c["label"]][got] += 1
        per_clip.append(f"{c['label']}{'=' if got == c['label'] else '>' + (got or '-')}")
    print(f"\n{Path(path).name}")
    for L in ("J", "Z"):
        t = table[L]
        tot = sum(t.values())
        print(f"  real {L}: read as J {t['J']}, Z {t['Z']}, wiggle {t['wiggle']}, nothing {t[None]}  ({t[L]}/{tot} right)")
    print("  per clip:", " ".join(per_clip))
    return table


if __name__ == "__main__":
    for p in sys.argv[1:]:
        evaluate(p)
