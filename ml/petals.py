"""Plasma petal counter (mirror of plasmaPetals in apps/web/src/shapes.ts).

Distance from the ball's centre, as a share of the ball's radius (the biggest distance). A petal is a
trip out from the middle (under IN) that reaches past TIP and comes back, shorter than LEN radii. The
line out plus the ball is far longer, so petals may touch the ball. (Nov 24: was a reach cap of 0.88.)
"""
import numpy as np
from synth_shapes import resample

N, IN, TIP, LEN = 200, 0.2, 0.25, 3.5


def petals(p):
    q = resample(np.asarray(p, float), N)
    c = (q.min(0) + q.max(0)) / 2
    r = np.hypot(*(q - c).T)
    R = r.max() or 1
    r = r / R
    seg = np.r_[0, np.hypot(*np.diff(q, axis=0).T)] / R
    n, out, top, ln = 0, False, 0.0, 0.0
    for v, s in zip(r, seg):
        if not out:
            if v > IN: out, top, ln = True, v, s
        else:
            top = max(top, v); ln += s
            if v < IN:
                if top > TIP and ln < LEN: n += 1
                out = False
    return n


if __name__ == "__main__":
    from synth_shapes import Gen
    g = Gen(3)
    for k in (2, 3, 4):
        c = [petals(g.plasma(petals=k)) for _ in range(300)]
        print(k, "petals: counted 3 in", np.mean(np.array(c) == 3), " counts", np.bincount(c)[:7])
