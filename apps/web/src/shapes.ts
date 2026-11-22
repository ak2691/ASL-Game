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

export function recognizeShape(model: ShapeModel, points: Pt[]): ShapeMatch & { top: { name: string; prob: number }[] } {
  if (isLine(points)) return { name: 'line', score: 1, top: [{ name: 'line', prob: 1 }] }
  let x = shapeFeatures(points)
  for (const l of model.layers) x = runLayer(l, x)
  const top = Array.from(x, (prob, i) => ({ name: model.labels[i], prob })).sort((a, b) => b.prob - a.prob)
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
