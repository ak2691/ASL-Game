"""Meteor spike counter (mirror of spikeCount in apps/web/src/shapes.ts)."""
import sys, itertools, numpy as np
sys.path.insert(0, r'C:\dev\ASLSpeedGame\ml')
from synth_shapes import resample

def fit_circle(pts):
    x, y = pts[:, 0], pts[:, 1]
    A = np.c_[2 * x, 2 * y, np.ones(len(x))]
    c, *_ = np.linalg.lstsq(A, x * x + y * y, rcond=None)
    return c[0], c[1], np.sqrt(max(1e-9, c[2] + c[0] ** 2 + c[1] ** 2))

def spikes(p, N=128, K=2, ANG=135, RISE=0.01, ABOVE=0.8):
    q = resample(np.asarray(p, float), N)
    s = max(np.ptp(q[:, 0]), np.ptp(q[:, 1])) or 1
    cx, cy, r = fit_circle(q[q[:, 1] > np.median(q[:, 1])])
    n, last = 0, -99
    for i in range(K, N - K):
        y = q[i, 1]
        if y > cy - ABOVE * r: continue  # tips only above the circle
        if y > q[i - K:i + K + 1, 1].min() + 1e-9: continue
        if (q[i - K, 1] - y) / s < RISE or (q[i + K, 1] - y) / s < RISE: continue
        a, b = q[i - K] - q[i], q[i + K] - q[i]
        ang = np.degrees(np.arccos(np.clip(a @ b / (np.linalg.norm(a) * np.linalg.norm(b) + 1e-9), -1, 1)))
        if ang < ANG and i - last > K: n += 1; last = i
    return n

