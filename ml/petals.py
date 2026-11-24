"""Plasma petal counter (mirror of plasmaPetals in apps/web/src/shapes.ts).

Distance from the ball's centre, as a share of the ball's radius (the biggest distance). A petal is a
trip out from the middle (under IN) that turns back before reaching the ball (its tip between TIP and
OUT) and comes back to the middle. The line out to the ball and the ball itself go past OUT: not petals.
"""
import numpy as np
from synth_shapes import resample

N, IN, TIP, OUT = 200, 0.15, 0.2, 0.88


def petals(p):
    q = resample(np.asarray(p, float), N)
    c = (q.min(0) + q.max(0)) / 2
    r = np.hypot(*(q - c).T)
    r = r / (r.max() or 1)
    n, out, top = 0, False, 0.0
    for v in r:
        if not out:
            if v > IN: out, top = True, v
        else:
            top = max(top, v)
            if v < IN:
                if TIP < top < OUT: n += 1
                out = False
    return n


if __name__ == "__main__":
    from synth_shapes import Gen
    g = Gen(3)
    for k in (2, 3, 4):
        c = [petals(g.plasma(petals=k)) for _ in range(300)]
        print(k, "petals: counted 3 in", np.mean(np.array(c) == 3), " counts", np.bincount(c)[:7])
