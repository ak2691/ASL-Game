// The "$1 Unistroke Recognizer" (Wobbrock, Wilson & Li, 2007): matches a drawn path against
// template paths. No training: resample to N points, rotate so the start faces the centroid,
// scale to a square, center, then find the template with the smallest average point distance.
// Straight lines are handled separately (scaling a line to a square blows up its thin side).

export interface Pt {
  x: number
  y: number
}

const N = 64
const SIZE = 250
const HALF_DIAG = 0.5 * Math.hypot(SIZE, SIZE)
const ANGLE_RANGE = (45 * Math.PI) / 180
const ANGLE_STEP = (2 * Math.PI) / 180
const PHI = 0.5 * (-1 + Math.sqrt(5))

const dist = (a: Pt, b: Pt) => Math.hypot(a.x - b.x, a.y - b.y)

export function pathLength(pts: Pt[]) {
  let d = 0
  for (let i = 1; i < pts.length; i++) d += dist(pts[i - 1], pts[i])
  return d
}

function resample(points: Pt[], n: number): Pt[] {
  const pts = points.map((p) => ({ ...p }))
  const interval = pathLength(pts) / (n - 1)
  let acc = 0
  const out: Pt[] = [{ ...pts[0] }]
  for (let i = 1; i < pts.length; i++) {
    const d = dist(pts[i - 1], pts[i])
    if (acc + d >= interval && d > 0) {
      const t = (interval - acc) / d
      const q = { x: pts[i - 1].x + t * (pts[i].x - pts[i - 1].x), y: pts[i - 1].y + t * (pts[i].y - pts[i - 1].y) }
      out.push(q)
      pts.splice(i, 0, q)
      acc = 0
    } else acc += d
  }
  while (out.length < n) out.push({ ...pts[pts.length - 1] })
  return out.slice(0, n)
}

const centroid = (pts: Pt[]) => ({
  x: pts.reduce((s, p) => s + p.x, 0) / pts.length,
  y: pts.reduce((s, p) => s + p.y, 0) / pts.length,
})

function rotateBy(pts: Pt[], a: number): Pt[] {
  const c = centroid(pts)
  const cos = Math.cos(a)
  const sin = Math.sin(a)
  return pts.map((p) => ({
    x: (p.x - c.x) * cos - (p.y - c.y) * sin + c.x,
    y: (p.x - c.x) * sin + (p.y - c.y) * cos + c.y,
  }))
}

function normalize(points: Pt[]): Pt[] {
  let pts = resample(points, N)
  const c = centroid(pts)
  pts = rotateBy(pts, -Math.atan2(c.y - pts[0].y, c.x - pts[0].x))
  const xs = pts.map((p) => p.x)
  const ys = pts.map((p) => p.y)
  const minX = Math.min(...xs)
  const minY = Math.min(...ys)
  const w = Math.max(...xs) - minX || 1
  const h = Math.max(...ys) - minY || 1
  pts = pts.map((p) => ({ x: ((p.x - minX) * SIZE) / w, y: ((p.y - minY) * SIZE) / h }))
  const c2 = centroid(pts)
  return pts.map((p) => ({ x: p.x - c2.x, y: p.y - c2.y }))
}

function pathDistance(a: Pt[], b: Pt[]) {
  let d = 0
  for (let i = 0; i < a.length; i++) d += dist(a[i], b[i])
  return d / a.length
}

// Golden-section search for the best rotation within ±45°.
function distanceAtBestAngle(pts: Pt[], tpl: Pt[]) {
  let a = -ANGLE_RANGE
  let b = ANGLE_RANGE
  let x1 = PHI * a + (1 - PHI) * b
  let f1 = pathDistance(rotateBy(pts, x1), tpl)
  let x2 = (1 - PHI) * a + PHI * b
  let f2 = pathDistance(rotateBy(pts, x2), tpl)
  while (Math.abs(b - a) > ANGLE_STEP) {
    if (f1 < f2) {
      b = x2
      x2 = x1
      f2 = f1
      x1 = PHI * a + (1 - PHI) * b
      f1 = pathDistance(rotateBy(pts, x1), tpl)
    } else {
      a = x1
      x1 = x2
      f1 = f2
      x2 = (1 - PHI) * a + PHI * b
      f2 = pathDistance(rotateBy(pts, x2), tpl)
    }
  }
  return Math.min(f1, f2)
}

export interface Template {
  name: string
  points: Pt[]
}
export interface Match {
  name: string
  score: number // 0..1, higher = closer
  rejected?: string // the closest outline, turned down by a shape check (see GATES)
}

// ---- Shape checks: what outline matching can't see -----------------------------------------
// $1 compares outlines only, so it can't tell smooth from sharp (a circle vs. the cage) or how
// much a stroke curls. Two simple measurements cover that.

export interface StrokeFeatures {
  corners: number // sharp turns (> ~45°)
  turns: number // total signed turning, in full turns (a circle = 1)
  gap: number // distance from the end back to the start, as a fraction of the stroke's size
}

export function strokeFeatures(points: Pt[]): StrokeFeatures {
  const raw = resample(points, N)
  // Light smoothing so finger jitter doesn't count as corners.
  const p = raw.map((q, i) => {
    const a = raw[Math.max(0, i - 1)]
    const b = raw[Math.min(raw.length - 1, i + 1)]
    return { x: (a.x + q.x + b.x) / 3, y: (a.y + q.y + b.y) / 3 }
  })
  const wrap = (d: number) => Math.atan2(Math.sin(d), Math.cos(d))
  const dir = (a: Pt, b: Pt) => Math.atan2(b.y - a.y, b.x - a.x)
  let turn = 0
  for (let i = 1; i < p.length - 1; i++) turn += wrap(dir(p[i], p[i + 1]) - dir(p[i - 1], p[i]))
  // Corners: the direction change across a few points either side; count separate peaks.
  const K = 4
  const bend = p.map((_, i) => (i < K || i >= p.length - K ? 0 : Math.abs(wrap(dir(p[i], p[i + K]) - dir(p[i - K], p[i])))))
  let corners = 0
  let last = -99
  for (let i = 1; i < bend.length - 1; i++) {
    if (bend[i] > (45 * Math.PI) / 180 && bend[i] >= bend[i - 1] && bend[i] >= bend[i + 1] && i - last >= 4) {
      corners++
      last = i
    }
  }
  const xs = raw.map((q) => q.x)
  const ys = raw.map((q) => q.y)
  const size = Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)) || 1
  const gap = dist(raw[0], raw[raw.length - 1]) / size
  return { corners, turns: Math.abs(turn) / (2 * Math.PI), gap }
}

/**
 * How well the stroke fits exactly `k` straight segments: the worst gap between the stroke and the
 * segments, as a fraction of the stroke's size. Straight-sided shapes fit tightly; a curve doesn't.
 */
export function fitError(points: Pt[], k: number): number {
  const pts = resample(points, N)
  const xs = pts.map((p) => p.x)
  const ys = pts.map((p) => p.y)
  const size = Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)) || 1
  const segDist = (p: Pt, a: Pt, b: Pt) => {
    const dx = b.x - a.x
    const dy = b.y - a.y
    const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy || 1)))
    return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy))
  }
  const worst = (i: number, j: number): [number, number] => {
    let w = -1
    let at = -1
    for (let m = i + 1; m < j; m++) {
      const d = segDist(pts[m], pts[i], pts[j])
      if (d > w) [w, at] = [d, m]
    }
    return [w, at]
  }
  // Split at the worst point until there are k segments (Douglas–Peucker, stopped at k).
  const cuts = [0, pts.length - 1]
  while (cuts.length - 1 < k) {
    let best: [number, number, number] = [-1, -1, -1]
    for (let s = 0; s < cuts.length - 1; s++) {
      const [w, at] = worst(cuts[s], cuts[s + 1])
      if (w > best[0]) best = [w, at, s]
    }
    if (best[1] < 0) break
    cuts.splice(best[2] + 1, 0, best[1])
  }
  let e = 0
  for (let s = 0; s < cuts.length - 1; s++) e = Math.max(e, worst(cuts[s], cuts[s + 1])[0])
  return e / size
}

/** Extra requirements a shape must meet besides its outline. Shapes not listed have none. */
const GATES: Record<string, { ok: (f: StrokeFeatures, pts: Pt[]) => boolean; why: string }> = {
  cage: { ok: (f) => f.corners >= 3 && f.turns > 0.6, why: 'needs square corners (a circle isn’t a cage)' },
  star: { ok: (f) => f.corners >= 4, why: 'needs sharp points' },
  hourglass: { ok: (f) => f.corners >= 3, why: 'needs sharp corners' },
  zigzag7: { ok: (f) => f.corners >= 5, why: 'needs sharp, straight zigzags' },
  battlements: { ok: (f) => f.corners >= 5, why: 'needs square corners' },
  circle: { ok: (f) => f.corners <= 2 && f.turns >= 0.8 && f.gap < 0.25, why: 'needs to close: finish back where you started' },
  flame: { ok: (f) => f.gap < 0.35 && f.corners >= 5, why: 'needs three separate bumps along the bottom, and to close back at the start' },
}

export class DollarRecognizer {
  private templates: Template[] = []

  add(name: string, points: Pt[]) {
    this.templates.push({ name, points: normalize(points) })
  }

  recognize(points: Pt[]): Match {
    // A straight stroke: endpoints nearly as far apart as the whole path is long. The ends are
    // ignored for this check: lifting the finger to start (or another to stop) adds a little hook.
    const even = resample(points, N)
    const core = even.slice(Math.round(N * 0.15), Math.round(N * 0.85))
    if (dist(core[0], core[core.length - 1]) / (pathLength(core) || 1) > 0.9) return { name: 'line', score: 1 }
    const pts = normalize(points)
    // Best outline score per shape, best first; the first one that passes its shape check wins.
    const best = new Map<string, number>()
    for (const t of this.templates) {
      const score = 1 - distanceAtBestAngle(pts, t.points) / HALF_DIAG
      if (score > (best.get(t.name) ?? 0)) best.set(t.name, score)
    }
    const ranked = [...best].sort((a, b) => b[1] - a[1])
    const f = strokeFeatures(points)
    let rejected: string | undefined
    for (const [name, score] of ranked) {
      const gate = GATES[name]
      if (!gate || gate.ok(f, points)) return { name, score, rejected }
      rejected ??= `${name}, but ${gate.why}`
    }
    return { name: ranked[0]?.[0] ?? 'none', score: 0, rejected }
  }
}

// ---- Built-in shapes (y grows downward, like screen coordinates) ---------------------

function poly(corners: Pt[]): Pt[] {
  const out: Pt[] = []
  for (let i = 1; i < corners.length; i++)
    for (let k = 0; k < 10; k++) {
      const t = k / 10
      out.push({ x: corners[i - 1].x + t * (corners[i].x - corners[i - 1].x), y: corners[i - 1].y + t * (corners[i].y - corners[i - 1].y) })
    }
  out.push(corners[corners.length - 1])
  return out
}

const P = (x: number, y: number): Pt => ({ x, y })

/** Every start point and both directions of a closed shape given by its corners in order. */
function closedVariants(corners: Pt[]): Pt[][] {
  const out: Pt[][] = []
  for (let s = 0; s < corners.length; s++) {
    const order = [...corners.slice(s), ...corners.slice(0, s)]
    out.push(poly([...order, order[0]]))
    out.push(poly([...order, order[0]].reverse()))
  }
  return out
}

/** The Tidal Wave path: a lowercase "m" with three humps. Optionally starts with the up-stroke. */
export function archPoints(stem = true): Pt[] {
  const pts: Pt[] = []
  if (stem) for (let k = 0; k <= 8; k++) pts.push(P(0, 1 - (k / 8) * 0.5))
  const n = 3
  const w = 1 / n
  for (let a = 0; a < n; a++) {
    for (let k = 0; k <= 16; k++) {
      const t = Math.PI - (k / 16) * Math.PI // over the top of the hump (y grows downward)
      pts.push(P(a * w + w / 2 + (w / 2) * Math.cos(t), 0.5 - 0.5 * Math.sin(t)))
    }
    for (let k = 1; k <= 8; k++) pts.push(P((a + 1) * w, 0.5 + (k / 8) * 0.5)) // down to the baseline
    if (a < n - 1) for (let k = 1; k <= 8; k++) pts.push(P((a + 1) * w, 1 - (k / 8) * 0.5)) // and back up
  }
  return pts
}

/**
 * The Meteor path, a flame (like 🔥): from the left side go down, across three small humps along
 * the bottom, up the right side, and over a big dome back to the start. A closed outline.
 */
export function flamePoints(): Pt[] {
  const pts: Pt[] = []
  for (let k = 0; k <= 6; k++) pts.push(P(0, 0.6 + (k / 6) * 0.4)) // down the left side
  const w = 1 / 3
  for (let a = 0; a < 3; a++)
    for (let k = 1; k <= 14; k++) {
      const t = Math.PI - (k / 14) * Math.PI // a small hump up from the bottom (y grows downward)
      pts.push(P(a * w + w / 2 + (w / 2) * Math.cos(t), 1 - 0.3 * Math.sin(t)))
    }
  for (let k = 1; k <= 6; k++) pts.push(P(1, 1 - (k / 6) * 0.4)) // up the right side
  for (let k = 1; k <= 30; k++) {
    const t = (k / 30) * Math.PI // over the dome, back to the start
    pts.push(P(0.5 + 0.5 * Math.cos(t), 0.6 - 0.6 * Math.sin(t)))
  }
  return pts
}

/** Real finger-drawn flames (from a ?debug stroke log, Nov 2026): x, y pairs in a 0..100 box. */
const REAL_FLAMES: number[][] = [
  [98, 67, 95, 57, 98, 68, 97, 79, 92, 89, 83, 96, 74, 89, 69, 78, 67, 67, 65, 62, 62, 73, 57, 84, 51, 93, 41, 94, 36, 84, 37, 73, 36, 71, 35, 83, 30, 93, 22, 100, 11, 98, 2, 91, 0, 80, 0, 68, 2, 57, 4, 46, 8, 35, 14, 25, 21, 17, 31, 10, 40, 4, 52, 3, 63, 0, 74, 1, 84, 6, 91, 14, 94, 25, 96, 37, 99, 48, 92, 53],
  [56, 64, 55, 68, 53, 77, 50, 87, 42, 86, 38, 77, 36, 67, 33, 69, 32, 79, 31, 89, 26, 92, 23, 82, 22, 73, 21, 63, 19, 70, 17, 80, 15, 90, 12, 99, 7, 100, 3, 91, 1, 81, 1, 71, 0, 61, 1, 51, 3, 42, 7, 33, 10, 23, 14, 14, 20, 6, 27, 0, 37, 2, 46, 5, 55, 8, 61, 16, 62, 26, 61, 36, 59, 45, 58, 55, 56, 65, 47, 66],
  [99, 56, 97, 57, 95, 69, 93, 81, 88, 92, 79, 97, 71, 98, 67, 87, 64, 75, 62, 63, 55, 67, 52, 79, 49, 90, 39, 92, 37, 80, 36, 68, 37, 56, 36, 65, 32, 76, 27, 87, 21, 98, 10, 99, 2, 92, 0, 79, 0, 67, 3, 55, 8, 44, 13, 33, 20, 23, 28, 14, 38, 7, 50, 2, 62, 0, 74, 0, 86, 3, 94, 11, 98, 22, 100, 35, 100, 47, 91, 50],
  [81, 62, 79, 51, 79, 63, 79, 74, 78, 85, 72, 93, 62, 89, 57, 79, 54, 68, 52, 57, 50, 68, 47, 79, 44, 89, 40, 100, 32, 93, 31, 82, 29, 71, 30, 61, 26, 72, 20, 81, 14, 91, 8, 100, 3, 94, 1, 83, 0, 72, 1, 61, 4, 50, 8, 39, 13, 29, 19, 19, 27, 11, 36, 5, 47, 1, 58, 0, 67, 6, 73, 15, 77, 26, 79, 37, 79, 48, 74, 55],
  [63, 43, 62, 33, 61, 24, 59, 14, 54, 6, 48, 11, 48, 21, 47, 31, 42, 25, 41, 15, 39, 6, 33, 4, 31, 13, 29, 23, 28, 32, 23, 31, 22, 22, 21, 12, 20, 2, 14, 0, 9, 9, 6, 18, 4, 27, 2, 37, 1, 47, 0, 56, 0, 66, 1, 76, 2, 85, 7, 94, 15, 99, 24, 100, 33, 97, 40, 89, 44, 81, 47, 71, 50, 62, 51, 53, 54, 43, 55, 37],
]

/** Drawing the same shape clockwise vs. counter-clockwise, or from another corner, counts the same. */
export function defaultRecognizer() {
  const r = new DollarRecognizer()
  /** Add a shape drawn either direction, and its mirror image (spirals and curls can turn either way). */
  const both = (name: string, pts: Pt[], mirror = false) => {
    const forms = mirror ? [pts, pts.map((p) => P(-p.x, p.y))] : [pts]
    for (const f of forms) {
      r.add(name, f)
      r.add(name, [...f].reverse())
    }
  }
  // Heavy attack: W (4 lines), either direction. (The light attack, a line, is checked first.)
  const w = [P(0, 0), P(0.25, 1), P(0.5, 0.3), P(0.75, 1), P(1, 0)]
  r.add('w', poly(w))
  r.add('w', poly([...w].reverse()))
  // Hourglass ⧗ in one stroke: top edge, diagonal, bottom edge, diagonal back (from any corner).
  for (const t of closedVariants([P(0, 0), P(1, 0), P(0, 1.3), P(1, 1.3)])) r.add('hourglass', t)
  // Five-point star in one stroke (from any point, either way).
  const star = Array.from({ length: 5 }, (_, k) => {
    const a = -Math.PI / 2 + (k * 4 * Math.PI) / 5
    return P(Math.cos(a), Math.sin(a))
  })
  for (const t of closedVariants(star)) r.add('star', t)

  // Counterspell: a circle (any start point, either direction).
  for (let s0 = 0; s0 < 4; s0++)
    for (const d of [1, -1]) {
      const c: Pt[] = []
      for (let i = 0; i <= 40; i++) {
        const a = (s0 * Math.PI) / 2 + (d * 2 * Math.PI * i) / 40
        c.push(P(Math.cos(a), Math.sin(a)))
      }
      r.add('circle', c)
    }

  // ---- Signatures ----
  // Fire, Meteor: a flame outline (humps along the bottom, dome over the top, closed).
  both('flame', flamePoints(), true)
  for (const r of REAL_FLAMES) both('flame', Array.from({ length: r.length / 2 }, (_, i) => P(r[2 * i], r[2 * i + 1])), true)
  // Ice, Frozen Prison: a cage. A square (from any corner, either way), then a diagonal across it.
  const sq = [P(0, 0), P(1, 0), P(1, 1), P(0, 1)]
  for (let s0 = 0; s0 < 4; s0++)
    for (const d of [1, -1]) {
      const order = Array.from({ length: 4 }, (_, k) => sq[(s0 + d * k + 8) % 4])
      both('cage', poly([...order, order[0], order[2]])) // around the square, back to the start, then across
    }
  // Lightning, Thunderbolt: a 7-line zigzag.
  both('zigzag7', poly([0, 1, 0.25, 1, 0.25, 1, 0.25, 1].map((y, i) => P(i / 7, y))), true)
  // Earth, Earthquake: two-hump battlements (up, across, down, across, up, across, down).
  both('battlements', poly([P(0, 1), P(0, 0.3), P(0.3, 0.3), P(0.3, 1), P(0.7, 1), P(0.7, 0.3), P(1, 0.3), P(1, 1)]), true)
  // Water, Tidal Wave: a lowercase "m" with three humps, with or without the first up-stroke.
  both('arches', archPoints(true), true)
  both('arches', archPoints(false), true)
  return r
}
