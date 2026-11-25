"""Synthetic finger-drawn spell shapes (one stroke each), plus near-misses labelled "none".

Shapes (y grows downward, like the screen). Orientation matters: no big rotations, and flipped
versions are near-misses where that changes the shape (W upside down = M = none).
  w           heavy attack: 4-line W
  circle      counterspell: one closed loop
  star        heal: upright five-point star
  hourglass   regen: top edge, diagonal, bottom edge, diagonal
  flame       Meteor: a circle, then exactly 4 sharp spikes along its top (a crown); either order
  cage        Frozen Prison: square + X (one stroke, so one edge is drawn twice)
  zigzag7     Thunderbolt: 7-line zigzag
  battlements Earthquake: 3 square humps
  spiral      Tidal Wave: spiral with ~3 turns
  aegis       Holy Aegis: shield (flat top, curved sides to a bottom point) + a line up the middle
  mirror      Holy Mirror: sideways figure 8 (a vertical 8 is a near-miss)
  scythe      Unholy Doom: handle up, a big curved blade out and back, then a line down across the handle and a grip back across it
  veil        Unholy Shroud: three cursive loops in a row
  blade       Unholy Execute: guillotine: post on top, box, triangle blade hanging under the box
  volcano     Magma (F+E): volcano slopes with a smoke loop out of the crater, then the base line
  cloud       Storm (W+L): closed three-bump cloud with a lightning tail out of the bottom
  iceberg     Advancing Glacier (I+E): waterline, peaks above it, then the big hull below
  yinyang     Twilight (H+U): circle, an S through it, then both dots
  puff        Steam (F+W): closed puffy cloud, 3 humps on top, 1 each side, 3 below
  thermo      Thermal Shock (F+I): thermometer (tube + bulb), then a zigzag crack across it
  plasma      Plasma (L+F): three petals from the middle, then a ball around them
  sun         Sunfire (H+F): eight-point sun outline
  tomb        Grave (U+E): tombstone (flat bottom, round top), then a cross inside
  (combo design: plans/combos.md)
  none        near-misses (wrong counts, upside down, rounded instead of sharp...) and scribbles
The straight line (light attack) is caught by a rule before the network (see shapes.ts).

features() must match apps/web/src/shapes.ts.
"""

import numpy as np

CLASSES = ["none", "h", "circle", "star", "hourglass", "flame", "cage", "zigzag7", "battlements", "spiral",
           "aegis", "mirror", "scythe", "veil", "blade", "volcano", "cloud", "yinyang",
           "iceberg", "puff", "thermo", "plasma", "sun", "tomb"]
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

    def h(self, legs=2, half=False):
        """One-stroke H (the heavy attack): one leg, back up/down to the bar, across, the other leg.
        The retrace is drawn a little off the first pass, like a real hand. legs=1 / half=True = near-misses."""
        r = self.r
        wd, bar = self.u(0.55, 1.1), self.u(0.35, 0.65)
        off = lambda: self.u(-0.06, 0.06)  # noqa: E731  retrace drift
        TL, BL, TR, BR = [0, 0], [0, 1], [wd, 0], [wd, 1]
        left = [TL, BL, [off(), bar]] if r.random() < 0.5 else [BL, TL, [off(), bar]]
        right = [[wd + off(), bar], TR, BR] if r.random() < 0.5 else [[wd + off(), bar], BR, TR]
        if half:
            right = right[:2]  # the second leg only goes one way
        vs = left + (right if legs == 2 else [[wd, bar]])
        return self.finish(self.sharp(vs, 0.03), rot=10, flip_ok_x=True)

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

    def flame(self, n=None, round_tips=False, flip=False, bowl=True):
        """Circle (any direction), then a crown of n spikes from its upper-left to its upper-right."""
        n = n if n is not None else 4  # exactly 4 spikes (3 or 5 are near-misses)
        rx = self.u(0.85, 1.15)
        al, ar = np.pi + self.u(0.05, 0.45), 2 * np.pi - self.u(0.05, 0.45)  # attach points (y down: sin < 0 is up)
        L, R = np.array([rx * np.cos(al), np.sin(al)]), np.array([rx * np.cos(ar), np.sin(ar)])
        sgn = 1 if self.r.random() < 0.5 else -1
        th = al + sgn * np.linspace(0, 2 * np.pi * self.u(0.95, 1.08), 90)
        circ = np.stack([rx * np.cos(th), np.sin(th)], 1)
        xs = L[0] + (R[0] - L[0]) * ((np.arange(n) + 0.5) / n + self.r.uniform(-0.08, 0.08, n))
        tall = self.r.random() < 0.6  # how real players draw it: tall finger-like spikes (recorded Nov 22)
        tip = self.u(0.9, 1.7) if tall else self.u(0.45, 1.0)
        crown = [L]
        for k in range(n):
            crown.append([xs[k], -1 - tip * self.u(0.6, 1.3)])  # uneven, small or big spikes are all fine
            if k < n - 1:
                xm = (xs[k] + xs[k + 1]) / 2
                crown.append([xm, -np.sqrt(max(0.0, 1 - (xm / rx) ** 2)) - self.u(0.0, 0.05 if tall else 0.15)])
        crown.append(R)
        crown = self.jv(crown, 0.03)
        if round_tips:  # bumps, no tips at all (a near-miss)
            crown = chaikin(crown, 0.3, 3)
        elif self.r.random() < 0.5:  # rounded tips, still clearly peaked (common in real drawings)
            crown = chaikin(crown, self.u(0.15, 0.25), 2)
        elif self.r.random() < 0.4:
            crown = chaikin(crown, self.u(0.03, 0.1))
        crown = dense(crown)
        p = np.vstack([circ, crown]) if bowl else crown
        if flip:
            p = p * [1, -1]
        return self.finish(p, rot=10)

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

    COMBOS = ["volcano", "cloud", "yinyang", "iceberg", "puff", "thermo", "plasma", "sun", "tomb"]

    def bad_combo(self, c=None, strength=None):
        """A combo with every feature present but drawn badly (Nov 23, 2026): a big, uneven warp of the
        whole drawing, or one part shoved well out of place. Far past the hand wobble that good ones get."""
        c = c or self.r.choice(self.COMBOS)
        self.raw = True
        try:
            p = np.asarray(getattr(self, c)(), float)
        finally:
            self.raw = False
        size = np.ptp(p, 0).max() or 1
        n = len(p)
        if self.r.random() < 0.6:
            amt = strength if strength is not None else self.u(0.14, 0.20)
            w = np.cumsum(self.r.normal(0, 1, (n, 2)), 0)
            k = np.ones(max(5, n // 8)) / max(5, n // 8)
            w = np.stack([np.convolve(w[:, 0], k, "same"), np.convolve(w[:, 1], k, "same")], 1)
            w -= w.mean(0)
            w *= amt * size / (np.abs(w).max() or 1)
            p = p + w
        else:
            a = int(self.r.integers(0, n // 2)); b = min(n, a + int(n * self.u(0.2, 0.4)))
            shift = self.r.normal(0, 1, 2); shift *= (strength or self.u(0.30, 0.40)) * size / np.linalg.norm(shift)
            ramp = np.ones(b - a); e = max(1, (b - a) // 6)
            ramp[:e] = np.linspace(0, 1, e); ramp[-e:] = np.linspace(1, 0, e)
            p[a:b] += np.outer(ramp, shift)
        return self.finish(p, rot=12)

    def bad_cage(self):
        """A mangled cage: corners far off (not a box any more) or one corner caved in toward the middle."""
        if not hasattr(self, "cage_walks"):
            self._setup()
        wk = self.cage_walks[self.r.integers(len(self.cage_walks))]
        cs = np.array(self.CAGE_V, float) * [self.u(0.8, 1.25), 1]
        if self.r.random() < 0.5:
            cs = cs + self.r.normal(0, self.u(0.17, 0.24), cs.shape)
        else:
            k = self.r.integers(4)
            cs[k] = cs[k] + (cs.mean(0) - cs[k]) * self.u(0.4, 0.65)
            cs = self.jv(cs, 0.04)
        return self.finish(dense([cs[i] for i in wk]), rot=10)

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

    # ---------------------------------------------------------- Holy / Unholy / combos
    def arc(self, cx, cy, rx, ry, a0, a1, n=40):
        th = np.linspace(a0, a1, n)
        return np.stack([cx + rx * np.cos(th), cy + ry * np.sin(th)], 1)

    def shield_outline(self, h):
        """Top-left -> top-right, right side curving to the bottom point, left side back up."""
        bulge = self.u(0.05, 0.25)
        t = np.linspace(0, 1, 30)
        right = np.stack([1 - 0.5 * t ** self.u(1.6, 2.6) + bulge * np.sin(np.pi * t) * 0.5, h * t], 1)
        left = right[::-1] * [-1, 1] + [1, 0]
        return right, left

    def aegis(self, line=True):
        h = self.u(1.0, 1.4)
        right, left = self.shield_outline(h)
        vs = [dense([[0.5, h], [0.5, 0], [1, 0]])] if line else [dense([[0, 0], [1, 0]])]
        vs += [right, left]
        if line:
            vs.append(dense([[0, 0], [0.5, 0]]))
        p = np.vstack(self.jv(np.vstack(vs), 0.01))
        return self.finish(p, rot=10)

    def mirror(self, vertical=False, loops=1.0):
        th = np.linspace(0, 2 * np.pi * loops, 140) + self.u(-0.3, 0.3)
        a = self.u(0.35, 0.6)
        p = np.stack([np.cos(th), a * np.sin(2 * th) / 1.0 * self.u(0.8, 1.2)], 1)
        p[:, 0] *= np.where(p[:, 0] > 0, self.u(0.85, 1.15), self.u(0.85, 1.15))
        if vertical:
            p = p[:, ::-1]
        return self.finish(p, rot=12 if not vertical else 15)

    def scythe(self, stage=4):
        """Doom: handle (slightly slanted) up, the blade's outer curve out and down to its tip, the inner curve
        back toward the handle, a line down-left across the handle, then a grip line right across it again.
        stage < 4 stops early (near-misses)."""
        def bez(p0, p1, p2, p3, n=40):
            t = np.linspace(0, 1, n)[:, None]
            return (1 - t) ** 3 * p0 + 3 * (1 - t) ** 2 * t * p1 + 3 * (1 - t) * t ** 2 * p2 + t ** 3 * p3
        s, W, h = self.u(0.0, 0.25), self.u(0.5, 0.8), self.u(0.35, 0.6)
        top, tip = np.array([s, 0.0]), np.array([s + W, h])
        back = np.array([s + self.u(0.03, 0.12), self.u(0.2, 0.32)])
        parts = [dense([[0, 1], top])]
        parts.append(bez(top, top + [W * 0.4, -0.12], tip + [0.08, -h * 0.7], tip)[1:])
        if stage >= 2:
            parts.append(bez(tip, tip + [-0.05, -h * 0.4], back + [W * 0.4, -0.06], back)[1:])
        if stage >= 3:
            low = np.array([s - self.u(0.25, 0.4), self.u(0.5, 0.65)])
            parts.append(dense([back, low])[1:])
        if stage >= 4:
            parts.append(dense([low, [s + self.u(0.25, 0.45), low[1] + self.u(-0.02, 0.1)]])[1:])
        p = self.jv(np.vstack(parts), 0.006)
        return self.finish(p, rot=10)

    def hook(self, blade=None, upside=False, hairpin=False, grip=True):
        """Handle straight up, then the blade hooks over to one side and down (a big upside-down U end)."""
        L = blade if blade is not None else self.u(0.5, 0.85)  # blade width vs handle
        handle = dense([[0, 1], [0, 0]])
        ry = L * self.u(0.35, 0.6)
        th = np.linspace(0, -np.pi - self.u(0.3, 0.9), 50)  # from the handle top, over, and down the far side
        hook = np.stack([-L / 2 + (L / 2) * np.cos(th), ry * np.sin(th)], 1)
        p = np.vstack([handle, hook[1:]])
        if hairpin:  # the far side runs a long way back down: an upside-down U / hairpin, not a blade
            p = np.vstack([p, dense([p[-1], [p[-1][0] + self.u(-0.08, 0.08), self.u(0.45, 0.95)]])[1:]])
        if grip and not hairpin:  # a grip line from the blade tip back across the handle
            p = np.vstack([p, dense([p[-1], [self.u(0.25, 0.55), self.u(0.25, 0.6)]])[1:]])
        p = self.jv(p, 0.006)
        if upside:
            p = p * [1, -1]
        return self.finish(p, rot=12)

    def veil(self, loops=3, flat=False):
        """Cursive loops in a row (a prolate cycloid): flat=True is a plain wave, no loops."""
        b = self.u(0.35, 0.75) if flat else self.u(1.5, 2.6)
        t = np.linspace(-self.u(0.3, 1.2), 2 * np.pi * (loops - 0.5) + self.u(0.6, 1.8), 50 * loops + 40)
        p = np.stack([t - b * np.sin(t), b * np.cos(t) * self.u(0.8, 1.4)], 1)
        return self.finish(p, rot=10)

    def blade(self, post=True, tri=True, old=False):
        """Guillotine: post above a box, triangle blade under it (one stroke; the post is drawn up and back)."""
        if old:  # the old Execute: triangle on a short post
            h, w = self.u(0.8, 1.2), self.u(0.8, 1.2)
            return self.finish(self.sharp([[0.5 * w, h + 0.4], [0.5 * w, h], [w, h], [0.5 * w, 0], [0, h], [0.5 * w, h]], 0.025), rot=10)
        bh, px, ph, tp = self.u(0.4, 0.7), self.u(0.3, 0.7), self.u(0.3, 0.6), self.u(0.5, 0.95)
        if post and tri:
            vs = [[0, bh], [1, bh + tp], [1, bh], [0, bh], [0, 0], [px, 0], [px, -ph], [px, 0], [1, 0], [1, bh]]
        elif post:
            vs = [[px, -ph], [px, 0], [0, 0], [0, bh], [1, bh], [1, 0], [px, 0]]
        else:
            vs = [[0, bh], [1, bh + tp], [1, bh], [0, bh], [0, 0], [1, 0], [1, bh]]
        return self.finish(self.sharp(vs, 0.02) * [self.u(0.8, 1.3), 1], rot=10)

    def volcano(self, smoke=True, base=True):
        cw = self.u(0.25, 0.4)  # crater width
        top = self.u(0.25, 0.4)
        l, r = 0.5 - cw / 2, 0.5 + cw / 2
        left = dense(self.jv([[0, 1], [l, top]], 0.02))
        right = dense(self.jv([[r, top], [1, 1]], 0.02))
        if smoke:
            rad = self.u(0.1, 0.18)
            cy = top - rad - self.u(0.1, 0.25)
            up = dense([[l + cw * 0.3, top], [0.5 - rad * 0.3, cy + rad]])
            loop = self.arc(0.5, cy, rad, rad, np.pi / 2, np.pi / 2 + 2 * np.pi * self.u(0.9, 1.1), 40)
            down = dense([loop[-1], [r - cw * 0.3, top]])
            mid = [dense([[l, top], [l + cw * 0.3, top]]), up, loop, down, dense([[r - cw * 0.3, top], [r, top]])]
        else:
            mid = [dense([[l, top], [r, top]])]
        tail = [dense(self.jv([[1, 1], [0, 1]], 0.02))[1:]] if base else []
        p = np.vstack([left] + mid + [right] + tail)
        return self.finish(p, rot=8, flip_ok_x=True)

    def cloud(self, bolt=True, bumps=3):
        y0 = 0.6
        xs = np.linspace(1, 0, bumps + 1)
        parts = [dense([[0.45, y0], [1, y0]])]
        for i in range(bumps):
            a, b = xs[i], xs[i + 1]
            c, rad = (a + b) / 2, (a - b) / 2
            hgt = self.u(1.1, 1.7) * rad * (1.25 if i == bumps // 2 else 1)
            parts.append(self.arc(c, y0, rad, hgt, 0, -np.pi, 20)[::1] if False else np.stack([c + rad * np.cos(np.linspace(0, np.pi, 20)), y0 - hgt * np.sin(np.linspace(0, np.pi, 20))], 1))
        parts.append(dense([[0, y0], [0.45, y0]]))
        if bolt:
            z = self.u(0.12, 0.2)
            parts.append(self.sharp([[0.45, y0], [0.45 - z, y0 + 0.25], [0.45 + z * 0.6, y0 + 0.28], [0.45 - z * 0.2, y0 + 0.6]], 0.015))
        return self.finish(self.jv(np.vstack(parts), 0.006), rot=8)

    def trefoil(self, k=3):
        th = np.linspace(0, np.pi if k % 2 else 2 * np.pi, 160)
        r = np.cos(k * th) * self.u(0.9, 1.1)
        a0 = -np.pi / 2 + self.u(-0.2, 0.2)
        p = np.stack([r * np.cos(th + a0), r * np.sin(th + a0)], 1)
        p = self.cyc(p) if self.r.random() < 0.5 else p
        return self.finish(p, rot=15)

    def yinyang(self, inner="s", dots=2):
        T = self.u(0.97, 1.08)
        th = np.linspace(-np.pi / 2, -np.pi / 2 + 2 * np.pi * T, 90)
        circ = np.stack([np.cos(th), np.sin(th)], 1)
        start = circ[-1]
        if inner == "s":
            s1 = self.arc(0, -0.5, 0.5, 0.5, -np.pi / 2, np.pi / 2, 30)
            s2 = self.arc(0, 0.5, 0.5, 0.5, -np.pi / 2, -3 * np.pi / 2, 30)
            if self.r.random() < 0.5:
                s1, s2 = s1 * [-1, 1], s2 * [-1, 1]
            ins = np.vstack([s1, s2[1:]])
        else:  # straight line through: a near-miss
            ins = dense([[0, -1], [0, 1]])
        parts = [circ, dense([start, ins[0]]), ins]
        # the dots: small loops in each half, joined by a line (lower one first, then up)
        at = ins[-1]
        for k, cy in enumerate([0.5, -0.5][:dots]):
            rr = self.u(0.1, 0.2)
            top = np.array([self.u(-0.05, 0.05), cy - rr])
            parts.append(dense([at, top]))
            th = np.linspace(-np.pi / 2, -np.pi / 2 + 2 * np.pi * self.u(0.95, 1.1), 24)
            loop = np.stack([top[0] + rr * np.cos(th), cy + rr * np.sin(th)], 1)
            parts.append(loop)
            at = loop[-1]
        p = np.vstack(parts)
        return self.finish(p, rot=12)

    # ---------------------------------------------------------- new combos (Nov 23, 2026)
    def iceberg(self, water=True, hull=True, peaks=None):
        """Waterline left to right, back a bit, the peaks right to left, then the hull below (down, across, up)."""
        yw = self.u(0.28, 0.45)
        l, r = self.u(0.12, 0.28), 1 - self.u(0.12, 0.28)
        n = peaks if peaks is not None else int(self.r.choice([2, 2, 3]))
        vs = []
        if water:
            vs += [[self.u(-0.1, 0.05), yw], [self.u(0.95, 1.1), yw]]
        vs.append([r, yw])
        xs = np.linspace(r, l, 2 * n + 1)[1:-1]
        for i, x in enumerate(xs):
            vs.append([x + self.u(-0.03, 0.03), self.u(0.0, 0.1) if i % 2 == 0 else yw * self.u(0.35, 0.7)])
        vs.append([l, yw])
        if hull:
            bot = self.u(0.85, 1.0)
            vs += [[l + self.u(0.0, 0.12), bot], [r - self.u(0.0, 0.12), bot], [r, yw]]
        return self.finish(self.sharp(vs, 0.02), rot=8)

    def puff(self, top=3, bottom=3, sides=1):
        """Closed puffy cloud: humps along the top (left to right), the right side, the bottom (right to left), the left side."""
        w, h = self.u(1.0, 1.6), self.u(0.45, 0.75)
        parts = []

        def humps(a, b, n, out):
            pts = np.linspace(0, 1, n + 1)
            for i in range(n):
                p0, p1 = a + (b - a) * pts[i], a + (b - a) * pts[i + 1]
                c, d = (p0 + p1) / 2, (p1 - p0)
                L = np.hypot(*d)
                nrm = np.array([d[1], -d[0]]) / L * out  # left of travel = outward for a clockwise loop
                th = np.linspace(np.pi, 0, 18)
                bulge = self.u(0.35, 0.7) * L
                seg = c + np.outer(np.cos(th), d / 2) + np.outer(np.sin(th), nrm * bulge)
                parts.append(seg)

        TL, TR, BR, BL = np.array([0, 0]), np.array([w, 0]), np.array([w, h]), np.array([0, h])
        humps(TL, TR, top, 1)
        humps(TR, BR, sides, 1)
        humps(BR, BL, bottom, 1)
        humps(BL, TL, sides, 1)
        p = self.cyc(np.vstack(parts)) if self.r.random() < 0.3 else np.vstack(parts)
        return self.finish(self.jv(p, 0.004), rot=10)

    def thermo(self, crack=True, zig=None):
        """Tube up from the bulb, round top, down the other side, round the bulb, then a zigzag crack across."""
        tw, th_ = self.u(0.12, 0.22), self.u(0.6, 0.9)
        br = self.u(0.18, 0.28)
        x0, x1 = -tw / 2, tw / 2
        yb = th_  # tube bottom = bulb top
        parts = [dense([[x0, yb], [x0, 0]])]
        a = np.linspace(np.pi, 2 * np.pi, 12)
        parts.append(np.stack([tw / 2 * np.cos(a), tw / 2 * np.sin(a) * 0.8], 1))
        parts.append(dense([[x1, 0], [x1, yb]]))
        cy = yb + np.sqrt(max(br ** 2 - (tw / 2) ** 2, 1e-4))
        a0 = np.arctan2(yb - cy, x1)
        a1 = np.arctan2(yb - cy, x0) + 2 * np.pi
        aa = np.linspace(a0, a1, 40)
        parts.append(np.stack([br * np.cos(aa), cy + br * np.sin(aa)], 1))
        if crack:
            n = zig if zig is not None else int(self.r.choice([3, 4, 4]))
            wd = self.u(0.35, 0.55)
            ys = np.linspace(yb * self.u(0.75, 0.95), yb * self.u(0.05, 0.25), n + 1)
            vs = [[x0, yb]] + [[(-wd if i % 2 == 0 else wd) + self.u(-0.05, 0.05), y] for i, y in enumerate(ys)]
            parts.append(self.sharp(vs, 0.01)[1:])
        p = np.vstack(parts)
        return self.finish(self.jv(p, 0.004), rot=8)

    def plasma(self, petals=None, ball=True, messy=None):
        """Petals (loops out and back) from the middle, then a line out to a ball drawn around them.
        messy (Nov 24, 35% of the time): how hands really draw it. Petals up to the ball (as in the guide), an
        off-centre middle, uneven angles and widths, an egg-shaped wobbly ball, and slow hand drift."""
        petals = 3 if petals is None else petals  # exactly 3 (2 or 4 are near-misses); messy is fine
        messy = self.r.random() < 0.35 if messy is None else messy
        parts = []
        a0 = self.u(-np.pi, np.pi)
        hub = np.array([self.u(-0.12, 0.12), self.u(-0.12, 0.12)]) if messy else np.zeros(2)
        for k in range(petals):
            a = a0 + 2 * np.pi * k / petals + self.u(-0.45, 0.45) * (1 if messy else 0.67)
            L, wdt = (self.u(0.45, 1.0), self.u(0.15, 0.8)) if messy else (self.u(0.4, 0.75), self.u(0.2, 0.6))
            t = np.linspace(0, np.pi, 24)
            rr = L * np.sin(t) ** (self.u(0.7, 1.3) if messy else 1)
            ang = a + wdt * np.cos(t) + (self.u(-0.15, 0.15) * np.sin(t) if messy else 0)
            parts.append(hub + np.stack([rr * np.cos(ang), rr * np.sin(ang)], 1))
        if ball:
            R = self.u(0.95, 1.15)
            b = -np.pi / 2 + self.u(-0.4, 0.4)
            parts.append(dense([hub, [R * np.cos(b), R * np.sin(b)]]))
            sgn = 1 if self.r.random() < 0.5 else -1
            th = b + sgn * np.linspace(0, 2 * np.pi * (self.u(0.88, 1.12) if messy else self.u(0.95, 1.08)), 70)
            rad = R * (1 + (self.u(0.02, 0.07) * np.sin(self.r.integers(2, 5) * th + self.u(0, 6.3)) if messy else 0))
            ex, ey = (self.u(0.85, 1.15), self.u(0.85, 1.15)) if messy else (self.u(0.9, 1.1), 1)
            parts.append(np.stack([rad * np.cos(th) * ex, rad * np.sin(th) * ey], 1))
            if self.r.random() < 0.5:  # circle first (how most people draw it), then in to the middle, then the petals
                circ = parts[-1]
                inward = dense([circ[-1], hub])
                parts = [circ, inward] + parts[:-2]
        p = np.vstack(parts)
        if messy:  # slow hand drift along the stroke
            n = len(p)
            for _ in range(2):
                f, ph, amp = self.u(1, 4), self.u(0, 6.3), self.u(0.01, 0.04)
                p = p + amp * np.stack([np.sin(np.linspace(0, f * 6.3, n) + ph), np.cos(np.linspace(0, f * 6.3, n) + ph * 1.3)], 1)
        return self.finish(self.jv(p, 0.006 if messy else 0.004), rot=20 if messy else 15)

    def sun(self, n=None):
        """Outline of an n-point sun (points alternate with inner corners), point up."""
        n = 8 if n is None else n  # exactly 8 points (7 or 9 are near-misses); messy is fine
        ri = self.u(0.35, 0.65)
        k = np.arange(2 * n + 1)
        ang = -np.pi / 2 + self.u(-0.4, 0.4) + np.pi * k / n + self.r.normal(0, 0.06, 2 * n + 1)
        rad = np.where(k % 2 == 0, self.r.uniform(0.85, 1.1, 2 * n + 1), ri * self.r.uniform(0.85, 1.15, 2 * n + 1))
        vs = np.stack([rad * np.cos(ang), rad * np.sin(ang)], 1)
        vs[-1] = vs[0]
        p = dense(chaikin(self.jv(vs, 0.03), self.u(0.1, 0.25), 2)) if self.r.random() < 0.35 else self.sharp(vs, 0.03)
        p = self.cyc(p) if self.r.random() < 0.4 else p
        if self.r.random() < 0.5:
            p = p[::-1]
        return self.finish(p, rot=20)

    def tomb(self, cross=True, bar=True):
        """Bottom edge, up the right side, round top, down the left, back along the bottom to the middle,
        up the cross, back down to the bar, then across."""
        w, h = self.u(0.6, 0.9), self.u(0.9, 1.3)
        R = w / 2
        ys = h - R  # where the round top starts
        parts = [dense(self.jv([[0, h], [w, h], [w, h - ys]], 0.02))]
        a = np.linspace(0, -np.pi, 30)
        parts.append(np.stack([R + R * np.cos(a), (h - ys) + R * np.sin(a) * self.u(0.8, 1.1)], 1))
        parts.append(dense(self.jv([[0, h - ys], [0, h], [R, h]], 0.02)))
        if cross:
            top = self.u(0.1, 0.3) * h + (h - ys - R) * 0
            yb = top + self.u(0.15, 0.3) * h
            arm = self.u(0.15, 0.3)
            vs = [[R, h], [R + self.u(-0.03, 0.03), top], [R + self.u(-0.03, 0.03), yb]]
            if bar:
                vs += [[R - arm, yb], [R + arm, yb]] if self.r.random() < 0.6 else [[R + arm, yb], [R - arm, yb]]
            parts.append(self.sharp(vs, 0.01)[1:])
        return self.finish(np.vstack(parts), rot=8)

    def none_new(self):
        """Near-misses for the Holy/Unholy/combo shapes."""
        opts = [
            lambda: self.aegis(line=False),                      # shield, no middle line
            lambda: self.mirror(vertical=True),                  # a vertical 8
            lambda: self.mirror(loops=0.55),                     # half an 8
            lambda: self.hook(blade=self.u(0.08, 0.2)),          # tiny hook: a cane, not a scythe
            lambda: self.hook(upside=True, grip=False),          # a J
            lambda: self.hook(hairpin=True),                     # hairpin: long leg back down
            lambda: self.hook(),                                 # the easy scythe (hook + grip)
            lambda: self.scythe(stage=int(self.r.choice([2, 3]))),  # Doom stopped early
            lambda: self.veil(loops=int(self.r.choice([1, 2]))), # too few loops
            lambda: self.veil(flat=True),                        # a wave, no loops
            lambda: self.blade(tri=False),                       # box + post, no blade
            lambda: self.blade(post=False),                      # box + blade, no post
            lambda: self.blade(old=True),                        # old Execute: triangle on a post
            lambda: self.volcano(smoke=False),                   # volcano, no smoke
            lambda: self.volcano(base=False),                    # volcano, no base
            lambda: self.volcano(smoke=False, base=False),       # just slopes
            lambda: self.iceberg(water=False),                   # iceberg, no waterline
            lambda: self.iceberg(hull=False),                    # iceberg, no hull
            lambda: self.yinyang(dots=0),                        # yin-yang, no dots
            lambda: self.yinyang(dots=1),                        # one dot
            lambda: self.puff(top=2, bottom=2),                  # too few humps
            lambda: self.puff(top=int(self.r.choice([1, 5])), bottom=int(self.r.choice([1, 5]))),
            lambda: self.thermo(crack=False),                    # thermometer, no crack
            lambda: self.thermo(zig=1),                          # one line, not a crack
            lambda: self.plasma(ball=False),                     # petals, no ball
            lambda: self.plasma(petals=int(self.r.choice([2, 2, 4, 4, 5]))),  # wrong petal count
            lambda: self.sun(n=int(self.r.choice([5, 6, 7, 7, 7]))),  # too few points
            lambda: self.sun(n=int(self.r.choice([9, 9, 9, 10, 12]))),  # too many
            lambda: self.tomb(cross=False),                      # tombstone, no cross
            lambda: self.tomb(bar=False),                        # no crossbar
            lambda: self.trefoil(k=3),                           # old trefoil (Plasma without the ball)
            lambda: self.circle_x(),
            lambda: self.cloud(bolt=False),                      # cloud, no bolt
            lambda: self.cloud(bolt=True, bumps=int(self.r.choice([2, 5]))),  # wrong bump count
            lambda: self.yinyang(inner="line"),                  # circle + straight line
            lambda: self.loop(self.u(1.6, 2.0)),                 # double circle
            lambda: self.h(half=True),                           # H with the last leg half done
            lambda: self.h(legs=1),                              # one leg + bar: no second leg
        ]
        return opts[int(self.r.integers(len(opts)))]()

    # ---------------------------------------------------------- near-misses
    def none(self):
        r = self.r
        if r.random() < 0.05:
            return self.bad_cage()
        if r.random() < 0.08:
            return self.bad_combo()
        if r.random() < 0.35:
            return self.none_new()
        c = r.integers(31)
        if c >= 29: return self.almost()
        if c >= 22: return [lambda: self.flame(n=3), lambda: self.flame(n=5), lambda: self.flame(n=3), lambda: self.flame(bowl=False),
                            lambda: self.flame(round_tips=True), lambda: self.battlements(round_tops=True),
                            lambda: self.battlements(round_tops=True)][c - 22]()
        if c >= 17: return [self.unfinished, self.almost, self.almost, self.circle_x, self.sideways][c - 17]()
        if c == 0: return self.scribble()
        if c == 1: return self.w(flip=self.r.random() < 0.5)  # old W heavy / M: not a spell now
        if c == 2: return self.loop(self.u(1.25, 1.8))  # spiral with too few turns
        if c == 3: return self.loop(self.u(4.6, 6))  # too many turns
        if c == 4: return self.flame(n=int(r.choice([1, 2, 3, 3, 5, 5, 6])))
        if c == 5: return self.flame(round_tips=True)
        if c == 6: return self.flame(flip=True)
        if c == 7: return self.flame(bowl=False)
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
            return self.mirror(vertical=True)
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
            p = self.r.choice([self.zigzag, self.w, self.battlements, self.flame, self.h])()
        finally:
            self.raw = False
        return self.finish(p[:, ::-1] * [1, self.r.choice([-1, 1])], rot=10)

    def make(self, cls):
        return {"h": self.h, "circle": self.circle, "star": self.star, "hourglass": self.hourglass,
                "flame": self.flame, "cage": self.cage, "zigzag7": self.zigzag, "battlements": self.battlements,
                "spiral": self.spiral, "none": self.none, "aegis": self.aegis, "mirror": self.mirror,
                "scythe": self.scythe, "veil": self.veil, "blade": self.blade, "volcano": self.volcano,
                "cloud": self.cloud, "yinyang": self.yinyang, "iceberg": self.iceberg, "puff": self.puff,
                "thermo": self.thermo, "plasma": self.plasma, "sun": self.sun, "tomb": self.tomb}[cls]()


def real_flames(g, copies=40):
    """Recorded Fire strokes (ml/data/strokes/*.json), labelled by spike count: 4 = flame, 3 or 5 = none."""
    import glob, json, sys, os
    sys.path.insert(0, os.path.dirname(__file__))
    from spike_count import spikes
    X, Y = [], []
    seen = set()
    for f in glob.glob(os.path.join(os.path.dirname(__file__), "data", "strokes", "strokes-2026-11-22*.json")):
        for s in json.load(open(f)):
            if s.get("charge") != "F":
                continue
            p = np.array([[q["x"], q["y"]] if isinstance(q, dict) else q[:2] for q in s["points"]], float)
            key = (len(p), round(float(p[0, 0]), 2))
            if key in seen:
                continue
            seen.add(key)
            c = spikes(p)
            if c not in (3, 4, 5):
                continue
            q = (p - p.mean(0)) / (np.ptp(p, 0).max() or 1)
            for _ in range(copies):
                X.append(features(g.finish(q, rot=8)))
                Y.append(CLASSES.index("flame") if c == 4 else 0)
    return X, Y


def real_spirals(g, copies=40):
    """Recorded Tidal Wave strokes (Water, read as spiral by the game) so messy Plasmas don't pull real spirals
    away (Nov 24: without these, 4 of 7 real spirals dropped under the signature threshold)."""
    import glob, json, os
    X, Y = [], []
    seen = set()
    for f in glob.glob(os.path.join(os.path.dirname(__file__), "data", "strokes", "*.json")):
        for s in json.load(open(f)):
            if s.get("charge") != "W" or s.get("read") != "spiral":
                continue
            p = np.array([[q["x"], q["y"]] if isinstance(q, dict) else q[:2] for q in s["points"]], float)
            key = (len(p), round(float(p[0, 0]), 2))
            if key in seen:
                continue
            seen.add(key)
            q = (p - p.mean(0)) / (np.ptp(p, 0).max() or 1)
            for _ in range(copies):
                X.append(features(g.finish(q, rot=8)))
                Y.append(CLASSES.index("spiral"))
    return X, Y


def dataset(per_class, seed, none_mult=3, real=False):
    g = Gen(seed)
    X, Y = [], []
    if real:
        X, Y = real_flames(g)
        Xs, Ys = real_spirals(g)
        X, Y = X + Xs, Y + Ys
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
