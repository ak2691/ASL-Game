// Spell-shape network (trained by ml/train_shapes.py on synthetic drawings from ml/synth_shapes.py).
// A straight line is caught by a rule first; everything else goes to the network, which also has a
// "none" class for near-misses (wrong peak count, upside down, rounded instead of sharp...).
// features() must match ml/synth_shapes.py.
import { runLayer, type Dense } from './recognition'

export interface Pt {
  x: number
  y: number
}
export interface ShapeMatch {
  name: string // a shape, or 'none'
  score: number // network probability (1 for the line rule)
}
export interface ShapeModel {
  labels: string[]
  layers: Dense[]
}

const RES = 128
const SEQ = 32
const GRID = 16
const TURN_N = 64
const CORNER_K = 4
const DOOM_CURVE = 90 // degrees the scythe blade must turn smoothly (see bladeCurve)
const TIP_H = 0.12 // how far the stroke must turn back (fraction of size) for a tip to count

export async function loadShapeModel(): Promise<ShapeModel> {
  const m = await fetch('/models/shapes.json').then((r) => r.json())
  const layers = m.layers.map((l: Dense & { w: number[]; b: number[] }) => ({ ...l, w: Float32Array.from(l.w), b: Float32Array.from(l.b) }))
  return { labels: m.labels, layers }
}

/** Evenly spaced along the path (linear interpolation on arc length). */
function resample(p: Pt[], n: number): Pt[] {
  const cum = [0]
  for (let i = 1; i < p.length; i++) cum.push(cum[i - 1] + Math.hypot(p[i].x - p[i - 1].x, p[i].y - p[i - 1].y))
  const L = cum[cum.length - 1]
  const out: Pt[] = []
  let j = 0
  for (let k = 0; k < n; k++) {
    const t = (L * k) / (n - 1)
    while (j < p.length - 2 && cum[j + 1] < t) j++
    const seg = cum[j + 1] - cum[j]
    const f = seg > 0 ? Math.min(1, Math.max(0, (t - cum[j]) / seg)) : 0
    out.push({ x: p[j].x + f * (p[j + 1].x - p[j].x), y: p[j].y + f * (p[j + 1].y - p[j].y) })
  }
  return out
}

export function pathLength(pts: Pt[]) {
  let d = 0
  for (let i = 1; i < pts.length; i++) d += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y)
  return d
}

const wrap = (d: number) => Math.atan2(Math.sin(d), Math.cos(d))

export function shapeFeatures(points: Pt[]): Float32Array {
  const p = resample(points, RES)
  const xs = p.map((q) => q.x)
  const ys = p.map((q) => q.y)
  const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)]
  const s = Math.max(x1 - x0, y1 - y0, 1e-6)
  const [cx, cy] = [(x0 + x1) / 2, (y0 + y1) / 2]
  const q = p.map((v) => ({ x: (v.x - cx) / s, y: (v.y - cy) / s }))
  const f = new Float32Array(SEQ * 2 + GRID * GRID + 8)
  for (let i = 0; i < SEQ; i++) {
    const v = q[Math.round((i * (RES - 1)) / (SEQ - 1))]
    f[2 * i] = v.x
    f[2 * i + 1] = v.y
  }
  const clampCell = (v: number) => Math.min(GRID - 1, Math.max(0, Math.floor((v + 0.5) * GRID)))
  for (const v of q) f[SEQ * 2 + clampCell(v.y) * GRID + clampCell(v.x)] = 1
  // Turning (how much the stroke curls) and sharp corners.
  const t = resample(p, TURN_N)
  const sm = t.map((_, i) => {
    const a = t[Math.max(0, i - 1)]
    const b = t[Math.min(TURN_N - 1, i + 1)]
    return { x: (a.x + t[i].x + b.x) / 3, y: (a.y + t[i].y + b.y) / 3 }
  })
  const ang: number[] = []
  for (let i = 0; i < TURN_N - 1; i++) ang.push(Math.atan2(sm[i + 1].y - sm[i].y, sm[i + 1].x - sm[i].x))
  let signed = 0
  let abs = 0
  for (let i = 1; i < ang.length; i++) {
    const d = wrap(ang[i] - ang[i - 1])
    signed += d
    abs += Math.abs(d)
  }
  const bend = new Array(TURN_N).fill(0)
  for (let i = CORNER_K; i < TURN_N - CORNER_K; i++) {
    const a1 = Math.atan2(sm[i].y - sm[i - CORNER_K].y, sm[i].x - sm[i - CORNER_K].x)
    const a2 = Math.atan2(sm[i + CORNER_K].y - sm[i].y, sm[i + CORNER_K].x - sm[i].x)
    bend[i] = Math.abs(wrap(a2 - a1))
  }
  let corners = 0
  let last = -99
  for (let i = 1; i < TURN_N - 1; i++)
    if (bend[i] > Math.PI / 4 && bend[i] >= bend[i - 1] && bend[i] >= bend[i + 1] && i - last >= 3) {
      corners++
      last = i
    }
  // Tips: where the stroke turns back up (a top tip, like a flame peak) or down, with hysteresis.
  let up = 0
  let down = 0
  let mode = 0
  const yStart = sm[0].y / s
  let ext = yStart
  for (const v of sm) {
    const y = v.y / s
    if (mode === 0) {
      if (y > yStart + TIP_H) [mode, ext] = [1, y]
      else if (y < yStart - TIP_H) [mode, ext] = [-1, y]
    } else if (mode === 1) {
      if (y > ext) ext = y
      else if (ext - y > TIP_H) [down, mode, ext] = [down + 1, -1, y]
    } else {
      if (y < ext) ext = y
      else if (y - ext > TIP_H) [up, mode, ext] = [up + 1, 1, y]
    }
  }
  const o = SEQ * 2 + GRID * GRID
  const TWO_PI = 2 * Math.PI
  f[o] = Math.abs(signed) / TWO_PI / 4
  f[o + 1] = abs / TWO_PI / 6
  f[o + 2] = Math.hypot(p[p.length - 1].x - p[0].x, p[p.length - 1].y - p[0].y) / s
  f[o + 3] = (x1 - x0) / s
  f[o + 4] = (y1 - y0) / s
  f[o + 5] = corners / 10
  f[o + 6] = up / 10
  f[o + 7] = down / 10
  return f
}

/** A straight stroke: endpoints nearly as far apart as the path is long (ends ignored: finger hooks). */
function isLine(points: Pt[]) {
  const even = resample(points, 64)
  const core = even.slice(10, 54)
  let len = 0
  for (let i = 1; i < core.length; i++) len += Math.hypot(core[i].x - core[i - 1].x, core[i].y - core[i - 1].y)
  const a = core[0]
  const b = core[core.length - 1]
  return Math.hypot(b.x - a.x, b.y - a.y) / (len || 1) > 0.9
}

/** Meteor's spikes: sharp upward tips above the circle. The circle is fitted to the bottom half of the
 *  stroke (all circle); only tips higher than 0.8 radius above its center count, so the circle's own
 *  top and the corners where the crown joins it don't. Tuned on ml/synth data (see ml/eval_shapes.py). */
export function spikeCount(points: Pt[]) {
  const N = 128
  const K = 2
  const q = resample(points, N)
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity
  for (const v of q) [x0, x1, y0, y1] = [Math.min(x0, v.x), Math.max(x1, v.x), Math.min(y0, v.y), Math.max(y1, v.y)]
  const s = Math.max(x1 - x0, y1 - y0) || 1
  // Least-squares circle through the lower half: x² + y² = 2ax + 2by + c.
  const ys = q.map((v) => v.y).sort((m, n) => m - n)
  const med = ys[N >> 1]
  const M = [[0, 0, 0], [0, 0, 0], [0, 0, 0]]
  const R = [0, 0, 0]
  for (const v of q) {
    if (v.y <= med) continue
    const row = [2 * v.x, 2 * v.y, 1]
    const t = v.x * v.x + v.y * v.y
    for (let i = 0; i < 3; i++) {
      R[i] += row[i] * t
      for (let j = 0; j < 3; j++) M[i][j] += row[i] * row[j]
    }
  }
  const sol = solve3(M, R)
  if (!sol) return 0
  const [cx, cy, c] = sol
  const r = Math.sqrt(Math.max(1e-9, c + cx * cx + cy * cy))
  let n = 0
  let last = -99
  for (let i = K; i < N - K; i++) {
    const y = q[i].y
    if (y > cy - 0.8 * r) continue // only tips above the circle
    let top = true
    for (let j = i - K; j <= i + K; j++) if (q[j].y < y - 1e-9) top = false
    if (!top || (q[i - K].y - y) / s < 0.01 || (q[i + K].y - y) / s < 0.01) continue
    const ax = q[i - K].x - q[i].x, ay = q[i - K].y - y, bx = q[i + K].x - q[i].x, by = q[i + K].y - y
    const ang = (Math.acos(Math.max(-1, Math.min(1, (ax * bx + ay * by) / (Math.hypot(ax, ay) * Math.hypot(bx, by) || 1)))) * 180) / Math.PI
    if (ang < 135 && i - last > K) {
      n++
      last = i
    }
  }
  return n
}

/** Sunfire's points: corners where the outline turns sharply the way the whole loop turns (the dips turn
 *  the other way). Must be exactly 8. Mirror of sun_tips in ml/sun_points.py (K = 5, 30°): on messy
 *  synthetic suns, 97% of 8-point suns count 8; 7 or 9 point suns count 8 under 5% of the time. */
export function sunTips(points: Pt[]) {
  const N = 160
  const K = 5
  const q = resample(points, N).slice(0, -1)
  const m = q.length
  const dir = (i: number, j: number) => {
    const a = q[((i % m) + m) % m], b = q[((j % m) + m) % m]
    return Math.atan2(b.y - a.y, b.x - a.x)
  }
  const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a))
  const turn = q.map((_, i) => wrap(dir(i, i + K) - dir(i - K, i)))
  const sgn = Math.sign(turn.reduce((a, b) => a + b, 0)) || 1
  const t = turn.map((x) => (x * sgn * 180) / Math.PI)
  let n = 0
  let last = -99
  for (let i = 0; i < m; i++)
    if (t[i] > 30 && t[i] >= t[(i - 1 + m) % m] && t[i] >= t[(i + 1) % m] && i - last > K) {
      n++
      last = i
    }
  return n
}

/** Plasma's petals: trips out from the middle (under 0.15 of the ball's radius) that turn back before the
 *  ball (tip between 0.2 and 0.88) and return. Must be exactly 3. Mirror of ml/petals.py: 96% of messy
 *  3-petal drawings count 3; 2 never do, 4 about 7%. */
export function plasmaPetals(points: Pt[]) {
  const q = resample(points, 200)
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity
  for (const v of q) [x0, x1, y0, y1] = [Math.min(x0, v.x), Math.max(x1, v.x), Math.min(y0, v.y), Math.max(y1, v.y)]
  const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2
  const r = q.map((v) => Math.hypot(v.x - cx, v.y - cy))
  const max = Math.max(...r) || 1
  let n = 0
  let out = false
  let top = 0
  for (const d of r) {
    const v = d / max
    if (!out) {
      if (v > 0.15) [out, top] = [true, v]
    } else {
      top = Math.max(top, v)
      if (v < 0.15) {
        if (top > 0.2 && top < 0.88) n++
        out = false
      }
    }
  }
  return n
}

/** Doom's blade must really curve (a few straight lines with corners used to pass). Splits the stroke at
 *  sharp corners and returns the most net turning (degrees) any long-enough smooth run makes. The
 *  blade's curves turn 110°+ over a good share of the stroke; straight lines with corners turn ~0 between
 *  corners, and a rounded corner is too short to count. */
export function bladeCurve(points: Pt[]) {
  const N = 64
  const raw = resample(points, N)
  // Light smoothing so hand jitter doesn't read as corners.
  const q = raw.map((v, i) => {
    const a = raw[Math.max(0, i - 1)], b = raw[Math.min(N - 1, i + 1)]
    return { x: (a.x + 2 * v.x + b.x) / 4, y: (a.y + 2 * v.y + b.y) / 4 }
  })
  const turns: number[] = []
  for (let i = 1; i < N - 1; i++) {
    const a1 = Math.atan2(q[i].y - q[i - 1].y, q[i].x - q[i - 1].x)
    const a2 = Math.atan2(q[i + 1].y - q[i].y, q[i + 1].x - q[i].x)
    let d = ((a2 - a1) * 180) / Math.PI
    while (d > 180) d -= 360
    while (d < -180) d += 360
    turns.push(d)
  }
  let best = 0
  let run = 0
  let len = 0
  const minLen = N * 0.15
  for (const t of turns) {
    if (Math.abs(t) >= 28) {
      run = 0
      len = 0
      continue
    }
    run += t
    len++
    if (len >= minLen) best = Math.max(best, Math.abs(run))
  }
  return best
}

/** 3x3 linear solve (Cramer's rule); null if singular. */
function solve3(m: number[][], r: number[]): [number, number, number] | null {
  const det = (a: number[][]) =>
    a[0][0] * (a[1][1] * a[2][2] - a[1][2] * a[2][1]) - a[0][1] * (a[1][0] * a[2][2] - a[1][2] * a[2][0]) + a[0][2] * (a[1][0] * a[2][1] - a[1][1] * a[2][0])
  const d = det(m)
  if (Math.abs(d) < 1e-12) return null
  const col = (k: number) => m.map((row, i) => row.map((v, j) => (j === k ? r[i] : v)))
  return [det(col(0)) / d, det(col(1)) / d, det(col(2)) / d]
}

export function recognizeShape(model: ShapeModel, points: Pt[]): ShapeMatch & { top: { name: string; prob: number }[] } {
  if (isLine(points)) return { name: 'line', score: 1, top: [{ name: 'line', prob: 1 }] }
  let x = shapeFeatures(points)
  for (const l of model.layers) x = runLayer(l, x)
  const top = Array.from(x, (prob, i) => ({ name: model.labels[i], prob })).sort((a, b) => b.prob - a.prob)
  // Meteor: the network can't count spikes reliably, so a rule does. Exactly 4 spikes (and a network that
  // at least leans Meteor) is a Meteor even if the drawing is wobbly; any other count never is.
  const flame = top.find((t) => t.name === 'flame')!.prob
  if (top[0].name === 'flame' || flame >= 0.3) {
    if (spikeCount(points) === 4) return { name: 'flame', score: Math.max(0.7, flame), top }
    if (top[0].name === 'flame') return { name: 'none', score: top[0].prob, top }
  }
  // Sunfire: exactly 8 points, counted by a rule (the network can't count 7 vs 8 vs 9 reliably).
  const sun = top.find((t) => t.name === 'sun')?.prob ?? 0
  if (top[0].name === 'sun' || sun >= 0.3) {
    if (sunTips(points) === 8) return { name: 'sun', score: Math.max(0.7, sun), top }
    if (top[0].name === 'sun') return { name: 'none', score: top[0].prob, top }
  }
  // Plasma: exactly 3 petals, also counted by a rule.
  if (top[0].name === 'plasma' && plasmaPetals(points) !== 3) return { name: 'none', score: top[0].prob, top }
  // Doom: the blade has to curve. Straight lines with corners are never a scythe.
  if (top[0].name === 'scythe' && bladeCurve(points) < DOOM_CURVE) return { name: 'none', score: top[0].prob, top }
  return { name: top[0].name, score: top[0].prob, top }
}

// ---- Example paths (guide drawing + the AI's drawing), y down, any box ---------------------

/** Tidal Wave: a 3-turn spiral, from the middle out. */
export function spiralPoints(): Pt[] {
  const pts: Pt[] = []
  const n = 150
  for (let i = 0; i <= n; i++) {
    const th = (i / n) * 3 * 2 * Math.PI
    const r = 0.08 + 0.92 * (i / n)
    pts.push({ x: r * Math.cos(th), y: r * Math.sin(th) })
  }
  return pts
}
