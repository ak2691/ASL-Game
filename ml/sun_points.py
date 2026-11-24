"""Sunfire point counter (mirror of sunPoints in apps/web/src/shapes.ts).

Walks the outline around its centre: a point is a peak of the distance from the centre that rises
above its neighbouring dips by at least RISE (share of the biggest radius). Wobbles are smaller than that.
Usage: python sun_points.py   (prints how often 7/8/9-point synthetic suns count right)
"""
import numpy as np
from synth_shapes import resample

N, RISE = 160, 0.12


def sun_points(p, rise=RISE):
    q = resample(np.asarray(p, float), N)
    c = (q.min(0) + q.max(0)) / 2
    r = np.hypot(*(q - c).T)
    r = r / (r.max() or 1)
    # start in the deepest dip and go once round (a closed outline), counting peaks with hysteresis
    k = int(np.argmin(r))
    r = np.r_[r[k:], r[:k], r[k]]
    n, peak, ext = 0, False, r[0]
    for v in r:
        if not peak:
            if v < ext: ext = v
            elif v - ext > rise: peak, ext = True, v
        else:
            if v > ext: ext = v
            elif ext - v > rise: n, peak, ext = n + 1, False, v
    return n


if __name__ == "__main__":
    from synth_shapes import Gen
    g = Gen(7)
    for rise in (0.08, 0.1, 0.12, 0.15):
        row = []
        for n in (6, 7, 8, 9, 10):
            c = [sun_points(g.sun(n=n), rise) for _ in range(300)]
            row.append(f"{n}:{np.mean(np.array(c) == 8):.2f}")
        print(rise, " ".join(row))


def sun_tips(p, K=5, ANG=30):
    """Tips by turning: the outline turns sharply outward-convex at each point."""
    q = resample(np.asarray(p, float), N)
    q = np.r_[q[:-1]]
    m = len(q)
    d = lambda i, j: np.arctan2(*(q[j % m] - q[i % m])[::-1])
    turn = np.array([np.angle(np.exp(1j * (d(i, i + K) - d(i - K, i)))) for i in range(m)])
    sgn = np.sign(turn.sum()) or 1
    t = np.degrees(turn * sgn)
    n, last = 0, -99
    for i in range(m):
        if t[i] > ANG and t[i] >= t[(i - 1) % m] and t[i] >= t[(i + 1) % m] and i - last > K:
            n += 1
            last = i
    return n


if __name__ == "__main__":
    for K in (3, 4, 5):
        for ANG in (30, 40, 50):
            row = []
            for n in (7, 8, 9):
                c = [sun_tips(g.sun(n=n), K, ANG) for _ in range(300)]
                row.append(f"{n}:{np.mean(np.array(c) == 8):.2f}")
            print(K, ANG, " ".join(row))
