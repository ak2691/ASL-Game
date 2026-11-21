"""Synthetic finger-drawn spell shapes (one stroke each), plus near-misses labelled "none".

Shapes (y grows downward, like the screen). Orientation matters: no big rotations, and flipped
versions are near-misses where that changes the shape (W upside down = M = none).
  w           heavy attack: 4-line W
  circle      counterspell: one closed loop
  star        heal: upright five-point star
  hourglass   regen: top edge, diagonal, bottom edge, diagonal
  flame       Meteor: 4 sharp peaks on top, round bowl underneath (closed)
  cage        Frozen Prison: square + X (one stroke, so one edge is drawn twice)
  zigzag7     Thunderbolt: 7-line zigzag
  battlements Earthquake: 3 square humps
  spiral      Tidal Wave: spiral with ~3 turns
  none        near-misses (wrong counts, upside down, rounded instead of sharp...) and scribbles
The straight line (light attack) is caught by a rule before the network (see shapes.ts).

features() must match apps/web/src/shapes.ts.
"""

import numpy as np

CLASSES = ["none", "w", "circle", "star", "hourglass", "flame", "cage", "zigzag7", "battlements", "spiral"]
RES = 128  # resample for the raster / sequence
SEQ = 32  # points kept for the sequence part
GRID = 16
TURN_N = 64  # resample for turning measures
N_FEATURES = SEQ * 2 + GRID * GRID + 8
TIP_H = 0.12  # how far the stroke must turn back (fraction of size) for a tip to count
CORNER_K = 4


# ---------------------------------------------------------------- features (mirror in shapes.ts)
def resample(p: np.ndarray, n: int) -> np.ndarray:
    seg = np.hypot(*np.diff(p, axis=0).T)
    cum = np.concatenate([[0], np.cumsum(seg)])
    t = np.linspace(0, cum[-1], n)
    return np.stack([np.interp(t, cum, p[:, 0]), np.interp(t, cum, p[:, 1])], 1)


def features(points: np.ndarray) -> np.ndarray:
    p = resample(np.asarray(points, float), RES)
    lo, hi = p.min(0), p.max(0)
    wh = hi - lo
    s = max(wh.max(), 1e-6)
    q = (p - (lo + hi) / 2) / s  # centred, longest side = 1, aspect kept
    idx = np.rint(np.arange(SEQ) * (RES - 1) / (SEQ - 1)).astype(int)
    seq = q[idx].reshape(-1)
    grid = np.zeros((GRID, GRID), np.float32)
    c = np.clip(np.floor((q + 0.5) * GRID).astype(int), 0, GRID - 1)
    grid[c[:, 1], c[:, 0]] = 1
    t = resample(p, TURN_N)
    sm = (t[np.maximum(np.arange(TURN_N) - 1, 0)] + t + t[np.minimum(np.arange(TURN_N) + 1, TURN_N - 1)]) / 3
    d = np.diff(sm, axis=0)
    ang = np.arctan2(d[:, 1], d[:, 0])
    turn = np.angle(np.exp(1j * np.diff(ang)))
    two_pi = 2 * np.pi
    gap = np.hypot(*(p[-1] - p[0])) / s
    # sharp corners: direction change across CORNER_K points either side > 45 deg, separate peaks
    K = CORNER_K
    bend = np.zeros(TURN_N)
    for i in range(K, TURN_N - K):
        a1 = np.arctan2(sm[i, 1] - sm[i - K, 1], sm[i, 0] - sm[i - K, 0])
        a2 = np.arctan2(sm[i + K, 1] - sm[i, 1], sm[i + K, 0] - sm[i, 0])
        bend[i] = abs(np.angle(np.exp(1j * (a2 - a1))))
    corners, last = 0, -99
    for i in range(1, TURN_N - 1):
        if bend[i] > np.pi / 4 and bend[i] >= bend[i - 1] and bend[i] >= bend[i + 1] and i - last >= 3:
            corners += 1
            last = i
    # tips: points where the stroke turns back up (top tip) or down (bottom tip), with hysteresis
    ys = sm[:, 1] / s
    up = down = mode = 0
    ext = ys[0]
    for y in ys:
        if mode == 0:
            if y > ys[0] + TIP_H: mode, ext = 1, y
            elif y < ys[0] - TIP_H: mode, ext = -1, y
        elif mode == 1:
            if y > ext: ext = y
            elif ext - y > TIP_H: down, mode, ext = down + 1, -1, y
        else:
            if y < ext: ext = y
            elif y - ext > TIP_H: up, mode, ext = up + 1, 1, y
    scal = [abs(turn.sum()) / two_pi / 4, np.abs(turn).sum() / two_pi / 6, gap, wh[0] / s, wh[1] / s, corners / 10, up / 10, down / 10]
    return np.concatenate([seq, grid.reshape(-1), scal]).astype(np.float32)


# ---------------------------------------------------------------- drawing helpers
def dense(vs, step=0.01):
    vs = np.asarray(vs, float)
    out = [vs[0]]
    for a, b in zip(vs[:-1], vs[1:]):
        k = max(2, int(np.hypot(*(b - a)) / step))
        out.append(a + (b - a) * np.linspace(0, 1, k)[1:, None])
    return np.vstack(out)


def chaikin(vs, cut, iters=1):
    vs = np.asarray(vs, float)
    for _ in range(iters):
        a, b = vs[:-1], vs[1:]
        mid = np.empty((2 * len(a), 2))
        mid[0::2] = a + (b - a) * cut
        mid[1::2] = a + (b - a) * (1 - cut)
        vs = np.vstack([vs[:1], mid, vs[-1:]])
    return vs


class Gen:
    def __init__(self, seed):
        self.r = np.random.default_rng(seed)

    def u(self, a, b):
        return self.r.uniform(a, b)

    def jv(self, vs, amt=0.03):
        return np.asarray(vs, float) + self.r.normal(0, amt, (len(vs), 2))

    def sharp(self, vs, amt=0.03):
        """Polyline with jittered corners, sometimes very slightly rounded (still sharp-ish)."""
        vs = self.jv(vs, amt)
        if self.r.random() < 0.4:
            vs = chaikin(vs, self.u(0.03, 0.12))
        return dense(vs)

    raw = False

    def finish(self, p, rot=12, flip_ok_x=True):
        r = self.r
        p = np.asarray(p, float)
        if self.raw:
            return p
        if flip_ok_x and r.random() < 0.5:
            p = p * [-1, 1]
        if r.random() < 0.5:
            p = p[::-1]
        p = p - p.mean(0)
        a = np.radians(self.u(-rot, rot))
        sx, sy = np.exp(self.u(-0.22, 0.22)), np.exp(self.u(-0.22, 0.22))
        sh = self.u(-0.12, 0.12)
        m = np.array([[np.cos(a), -np.sin(a)], [np.sin(a), np.cos(a)]]) @ np.array([[sx, sh], [0, sy]])
        p = p @ m.T
        p = resample(p, 200)
        # hand wobble: smooth random walk
        amp = self.u(0.001, 0.005)
        w = np.cumsum(r.normal(0, amp, p.shape), 0)
        w -= np.linspace(w[0], w[-1], len(w))
        k = np.ones(9) / 9
        w = np.stack([np.convolve(w[:, 0], k, "same"), np.convolve(w[:, 1], k, "same")], 1)
        p = p + w + r.normal(0, 0.003, p.shape)
        # little hooks where the finger lands/lifts
        for end in (0, -1):
            if r.random() < 0.3:
                ang = self.u(0, 2 * np.pi)
                L = self.u(0.01, 0.06)
                hook = p[end] + np.outer(np.linspace(L, 0, 5), [np.cos(ang), np.sin(ang)])
                p = np.vstack([hook, p]) if end == 0 else np.vstack([p, hook[::-1]])
        # random size / place, then sample like a camera (uneven spacing)
        p = p * self.u(150, 450) + self.u(100, 600, )
        n = int(self.u(50, 170))  # real strokes: ~50-170 camera points
        keep = np.sort(r.choice(len(p), size=min(n, len(p)), replace=False))
        keep[0], keep[-1] = 0, len(p) - 1
        return p[np.unique(keep)]

    def cyc(self, loop):
        """Closed loop: start anywhere (it's closed, so the start point is arbitrary)."""
        loop = loop[:-1]
        k = self.r.integers(len(loop))
        out = np.vstack([loop[k:], loop[:k]])
        return np.vstack([out, out[:1]])

    # ---------------------------------------------------------- shapes
    def zig(self, n_seg, start_top=True, amp=1.0):
        ys = [(0 if (i % 2 == 0) == start_top else amp) for i in range(n_seg + 1)]
        vs = [[i / n_seg * self.u(0.9, 1.1) * (n_seg / 4) ** 0.5, y + self.u(-0.08, 0.08)] for i, y in enumerate(ys)]
        vs = np.array(vs)
        vs[:, 0] = np.cumsum(np.r_[0, np.diff(vs[:, 0]).clip(0.02)])
        return vs

    def w(self, flip=False):
        mid = self.u(0.15, 0.65)
        vs = np.array([[0, 0], [0.25, 1], [0.5, mid], [0.75, 1], [1, 0]]) * [self.u(0.8, 1.4), 1]
        vs = self.jv(vs, 0.04)
        if self.r.random() < 0.3:
            vs = chaikin(vs, self.u(0.1, 0.25), 2)  # rounded W is fine (not a signature)
        p = dense(vs)
        if flip:
            p = p * [1, -1]
        return self.finish(p)

    def loop(self, turns, r0=None, aspect=None):
        T = turns
        th = np.linspace(0, 2 * np.pi * T, int(80 * T) + 20)
        r0 = self.u(0.05, 0.18) if r0 is None else r0
        rr = r0 + (1 - r0) * (th / th[-1]) ** self.u(0.6, 1.7)  # loops spaced evenly, or tight in the middle
        a0 = self.u(0, 2 * np.pi)
        asp = self.u(0.8, 1.25) if aspect is None else aspect
        p = np.stack([rr * np.cos(th + a0) * asp, rr * np.sin(th + a0)], 1)
        return self.finish(p, rot=180)

    def circle(self):
        T = self.u(0.93, 1.15)
        th = np.linspace(0, 2 * np.pi * T, 100)
        rr = 1 + self.u(-0.15, 0.15) * th / th[-1]
        a0 = self.u(0, 2 * np.pi)
        p = np.stack([rr * np.cos(th + a0) * self.u(0.8, 1.25), rr * np.sin(th + a0)], 1)
        return self.finish(p, rot=180)

    def spiral(self):
        return self.loop(self.u(2.3, 3.6), r0=self.u(0.05, 0.3))

    def star(self, flip=False):
        ang = -np.pi / 2 + np.arange(6) * 4 * np.pi / 5
        vs = np.stack([np.cos(ang), np.sin(ang)], 1)
        vs = self.jv(vs, 0.05)
        vs[-1] = vs[0] + self.r.normal(0, 0.04, 2)
        p = dense(vs)
        p = self.cyc(p) if self.r.random() < 0.7 else p
        if flip:
            p = p * [1, -1]
        return self.finish(p, rot=10)

    def hourglass(self, sideways=False):
        h = self.u(1.0, 1.5)
        vs = np.array([[0, 0], [1, 0], [0, h], [1, h], [0, 0]])
        vs = self.jv(vs, 0.04)
        p = self.cyc(dense(vs))
        if sideways:
            p = p[:, ::-1]
        return self.finish(p, rot=10)

    def flame(self, n=4, round_tips=False, flip=False, bowl=True):
        tall = self.r.random() < 0.6
        tip_y = [self.u(-0.05, 0.08) for _ in range(n)]
        vlo, vhi = (0.5, 0.85) if tall else (0.35, 0.55)
        xs = np.sort(self.r.uniform(0.08, 0.92, n)) * 0.3 + (np.arange(n) + 0.5) / n * 0.7
        top = [[0, self.u(0.4, 0.6) + (0.2 if tall else 0)]]
        for i in range(n):
            top.append([xs[i], tip_y[i]])
            if i < n - 1:
                top.append([(xs[i] + xs[i + 1]) / 2 + self.u(-0.03, 0.03), self.u(vlo, vhi)])
        top.append([1, self.u(0.4, 0.6) + (0.2 if tall else 0)])
        top = self.jv(top, 0.025)
        if round_tips:
            top = chaikin(top, 0.3, 3)
        elif self.r.random() < 0.4:
            top = chaikin(top, self.u(0.03, 0.1))
        top = dense(top)
        if not bowl:
            p = top
        else:
            yl, yr = top[0, 1], top[-1, 1]
            depth = self.u(0.5, 0.9) if tall else self.u(0.4, 0.75)
            th = np.linspace(0, np.pi, 60)
            bx = 0.5 + 0.5 * np.cos(th)
            by = (yr + (yl - yr) * th / np.pi) + depth * np.sin(th) * self.u(0.9, 1.3)
            bowl_p = np.stack([bx, by], 1)
            p = np.vstack([top, bowl_p[1:]])
            p = self.cyc(p) if self.r.random() < 0.35 else p
        if tall:
            p = p * [self.u(0.65, 0.9), 1]
        if flip:
            p = p * [1, -1]
        return self.finish(p)

    CAGE_V = [(0, 0), (1, 0), (1, 1), (0, 1)]

    def _walks(self, edges, length):
        out = []

        def dfs(path, used):
            if len(path) - 1 == length:
                if len(used) == len(edges):
                    out.append(list(path))
                return
            for e in edges:
                if path[-1] in e:
                    nxt = e[0] if e[1] == path[-1] else e[1]
                    key = e
                    dfs(path + [nxt], used | {key})

        for s in range(4):
            dfs([s], frozenset())
        return out

    def _setup(self):
        sq = [(0, 1), (1, 2), (2, 3), (0, 3)]
        self.cage_walks = [w for w in self._walks(sq + [(0, 2), (1, 3)], 7)]
        self.half_walks = [w for w in self._walks(sq + [(0, 2)], 5)]
        self.sq_walks = [w for w in self._walks(sq, 4) if w[0] == w[-1]]

    def walk(self, walks):
        if not hasattr(self, "cage_walks"):
            self._setup()
        wk = getattr(self, walks)[self.r.integers(len(getattr(self, walks)))]
        cs = self.jv(self.CAGE_V, 0.05) * [self.u(0.8, 1.25), 1]
        return dense([cs[i] for i in wk] if True else None)

    def cage(self):
        return self.finish(self.walk("cage_walks"), rot=10)

    def battlements(self, n=3, flip=False, slant=0.0, round_tops=False):
        widths = self.r.uniform(0.7, 1.3, 2 * n - 1)
        xs = np.concatenate([[0], np.cumsum(widths)])
        xs = xs / xs[-1] * self.u(1.5, 4.5)  # wide, like a castle wall
        top, bot = self.u(0.1, 0.55), 1.0
        vs = [[xs[0], bot]]
        for i in range(n):
            a, b = xs[2 * i], xs[2 * i + 1]
            ins = slant * (b - a)
            if round_tops:
                th = np.linspace(np.pi, 0, 16)
                c, rad = (a + b) / 2, (b - a) / 2
                ry = min(rad, (bot - top) * 0.6)
                vs.append([a, top + ry])
                vs += [[c + rad * np.cos(t), top + ry - ry * np.sin(t)] for t in th[1:-1]]
                vs.append([b, top + ry])
            else:
                vs += [[a + ins, top], [b - ins, top]]
            vs.append([b, bot])
            if i < n - 1:
                vs.append([xs[2 * i + 2], bot])
        vs = np.array(vs)
        vs[:, 1] += self.r.normal(0, 0.035, len(vs))
        vs[:, 0] += self.r.normal(0, 0.012, len(vs))
        p = dense(vs) if round_tops else self.sharp(vs, 0.0)
        if flip:
            p = p * [1, -1]
        return self.finish(p, rot=10)

    def zigzag(self, n=7, flip=False):
        p = self.sharp(self.zig(n, start_top=self.r.random() < 0.7, amp=self.u(0.6, 1.0)), 0.02)
        if flip or self.r.random() < 0.3:
            p = p * [1, -1]
        return self.finish(p, rot=10)

    def scribble(self):
        k = self.r.integers(3, 9)
        if self.r.random() < 0.5:
            vs = self.r.uniform(0, 1, (k, 2))
            p = self.sharp(vs, 0)
        else:
            v = np.cumsum(self.r.normal(0, 0.04, (200, 2)), 0)
            p = np.cumsum(v, 0)
        return self.finish(p, rot=180)

    # ---------------------------------------------------------- near-misses
    def none(self):
        r = self.r
        c = r.integers(31)
        if c >= 29: return self.almost()
        if c >= 22: return [lambda: self.flame(n=3), lambda: self.flame(n=3), lambda: self.flame(n=5), lambda: self.flame(n=5),
                            lambda: self.flame(round_tips=True), lambda: self.battlements(round_tops=True),
                            lambda: self.battlements(round_tops=True)][c - 22]()
        if c >= 17: return [self.unfinished, self.almost, self.almost, self.circle_x, self.sideways][c - 17]()
        if c == 0: return self.scribble()
        if c == 1: return self.w(flip=True)  # M
        if c == 2: return self.loop(self.u(1.25, 1.8))  # spiral with too few turns
        if c == 3: return self.loop(self.u(4.6, 6))  # too many turns
        if c == 4: return self.flame(n=int(r.choice([2, 3, 3, 3, 5, 6])))
        if c == 5: return self.flame(round_tips=True, n=int(r.choice([3, 4, 5])))
        if c == 6: return self.flame(flip=True)
        if c == 7: return self.flame(bowl=False, n=int(r.choice([3, 4, 5])))
        if c == 8: return self.finish(self.walk("half_walks"), rot=10)  # square + one diagonal
        if c == 9: return self.finish(self.walk("sq_walks"), rot=10)  # square only
        if c == 10: return self.battlements(n=int(r.choice([2, 4])))
        if c == 11: return self.battlements(flip=True)
        if c == 12: return self.battlements(slant=self.u(0.3, 0.45)) if r.random() < 0.5 else self.battlements(round_tops=True)
        if c == 13: return self.zigzag(n=int(r.choice([3, 5, 6, 8, 9])))
        if c == 14: return self.hourglass(sideways=True)
        if c == 15:  # open arc / figure-8
            if r.random() < 0.5:
                return self.loop(self.u(0.45, 0.75), r0=1.0)
            th = np.linspace(0, 2 * np.pi, 120)
            return self.finish(np.stack([np.sin(th), np.sin(2 * th) / 2], 1), rot=180)
        return self.star(flip=True)

    def unfinished(self):
        """A signature/heal shape stopped early (or started late)."""
        c = self.r.choice(["star", "hourglass", "battlements", "flame", "cage"])
        self.raw = True
        try:
            p = getattr(self, c)()
        finally:
            self.raw = False
        k = int(len(p) * self.u(0.5, 0.85))
        return self.finish(p[:k] if self.r.random() < 0.6 else p[-k:], rot=10, flip_ok_x=False)

    def almost(self):
        """Nearly finished: the last (or first) 1-2 straight strokes left off."""
        c = self.r.choice(["battlements", "battlements", "star", "hourglass"])  # not cage (one edge is drawn twice) or flame (a missing shoulder still looks done)
        self.raw = True
        try:
            p = getattr(self, c)()
        finally:
            self.raw = False
        # corners of the clean path: direction change across 3 points either side
        d1 = p[3:-3] - p[:-6]
        d2 = p[6:] - p[3:-3]
        ang = np.abs(np.angle(np.exp(1j * (np.arctan2(d2[:, 1], d2[:, 0]) - np.arctan2(d1[:, 1], d1[:, 0])))))
        idx = np.where(ang > 0.6)[0] + 3
        corners = [i for k, i in enumerate(idx) if k == 0 or i - idx[k - 1] > 4]
        if len(corners) < 3:
            return self.unfinished()
        k = int(self.r.choice([1, 1, 2]))
        if self.r.random() < 0.7:
            cut = corners[-k] + int(self.r.integers(-2, 4))
            p = p[:max(cut, 10)]
        else:
            cut = corners[k - 1] + int(self.r.integers(-3, 3))
            p = p[max(cut, 0):]
        return self.finish(p, rot=10, flip_ok_x=False)

    def circle_x(self):
        th = np.linspace(0, 2 * np.pi, 80) + self.u(0, 2 * np.pi)
        c = np.stack([np.cos(th), np.sin(th)], 1)
        a, b = c[0], -c[0]
        d = np.array([-c[0, 1], c[0, 0]])
        c = c * [self.u(0.7, 1.4), 1]
        a, b, d = c[0], -c[0], np.array([-c[0, 1], c[0, 0]])
        parts = [c, dense([a, b]), dense([b, d]), dense([d, -d])]
        p = np.vstack(parts if self.r.random() < 0.5 else parts[1:] + [dense([-d, c[0]]), c])
        return self.finish(p, rot=10)

    def sideways(self):
        self.raw = True
        try:
            p = self.r.choice([self.zigzag, self.w, self.battlements, self.flame])()
        finally:
            self.raw = False
        return self.finish(p[:, ::-1] * [1, self.r.choice([-1, 1])], rot=10)

    def make(self, cls):
        return {"w": self.w, "circle": self.circle, "star": self.star, "hourglass": self.hourglass,
                "flame": self.flame, "cage": self.cage, "zigzag7": self.zigzag, "battlements": self.battlements,
                "spiral": self.spiral, "none": self.none}[cls]()


def dataset(per_class, seed, none_mult=3):
    g = Gen(seed)
    X, Y = [], []
    for ci, c in enumerate(CLASSES):
        n = per_class * (none_mult if c == "none" else 1)
        for _ in range(n):
            X.append(features(g.make(c)))
            Y.append(ci)
    return np.array(X), np.array(Y)


if __name__ == "__main__":
    # quick preview: save a sheet of examples
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    g = Gen(1)
    fig, ax = plt.subplots(len(CLASSES), 8, figsize=(16, 2 * len(CLASSES)))
    for i, c in enumerate(CLASSES):
        for j in range(8):
            p = g.make(c)
            ax[i, j].plot(p[:, 0], -p[:, 1], lw=1)
            ax[i, j].plot(p[0, 0], -p[0, 1], "go", ms=3)
            ax[i, j].set_aspect("equal"); ax[i, j].axis("off")
        ax[i, 0].set_title(c, loc="left", fontsize=9)
    fig.savefig("preview/shapes.png", dpi=70, bbox_inches="tight")
    print("saved preview/shapes.png")
