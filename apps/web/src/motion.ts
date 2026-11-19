// J and Z are drawn in the air, so a single frame can't recognize them.
// A small trained model (ml/train_motion.py -> /models/motion.json) looks at the last 1.5 s
// of hand points and says none / J / Z. No hand-written path rules (see skills.md).
// Webcam frame rates vary, so the history is resampled to the model's fixed frame count.

import { runLayer, type Dense } from './recognition'

export interface Point {
  x: number
  y: number
  z?: number
}

const MOTION_MODEL_URL = '/models/motion.json'
const DEFAULT_WINDOW_MS = 1000 // models without windowMs were trained on 1 s clips
const GAP_MS = 400 // tolerate the hand dropping out this long (fast moves lose tracking)
const ACCEPT_PROB = 0.8 // model must be this sure...
const ACCEPT_FRAMES = 2 // ...for this many frames in a row
const MIN_HISTORY_MS = 600 // after a J/Z is accepted, the next needs this much fresh history

interface MotionModel {
  labels: string[]
  frames: number
  windowMs?: number // how much history one model input covers (1.5 s since v3)
  pathPoints: number[]
  shapeStep: number
  shapeDims?: number // 2 = hand shape x/y only (no depth; since v14), 3 = x/y/z (older models)
  nets: Dense[][] // one network, or several whose answers are averaged (an ensemble)
}

type LayerJson = Dense & { w: number[]; b: number[] }
const toDense = (layers: LayerJson[]) => layers.map((l) => ({ ...l, w: Float32Array.from(l.w), b: Float32Array.from(l.b) }))

let model: MotionModel | null = null
fetch(MOTION_MODEL_URL)
  .then((r) => r.json())
  .then((m) => {
    // Ensembles store "models": [{layers}, ...]; older single models store "layers".
    const nets = m.models ? m.models.map((n: { layers: LayerJson[] }) => toDense(n.layers)) : [toDense(m.layers)]
    model = { ...m, nets }
  })
  .catch((e) => console.error('motion model failed to load', e))

/** Average the ensemble's probabilities. */
function predict(m: MotionModel, x: Float32Array): Float32Array {
  const avg = new Float32Array(m.labels.length)
  for (const net of m.nets) {
    let y = x
    for (const layer of net) y = runLayer(layer, y)
    for (let i = 0; i < avg.length; i++) avg[i] += y[i] / m.nets.length
  }
  return avg
}

export type MotionLetter = 'J' | 'Z'
export const isMotionLetter = (l: string): l is MotionLetter => l === 'J' || l === 'Z'

interface Frame {
  t: number
  lm: Point[]
}

/** Linear interpolation of the hand at time t from the buffered frames. */
function sampleAt(f: Frame[], t: number): Point[] {
  if (t <= f[0].t) return f[0].lm
  for (let i = 1; i < f.length; i++) {
    if (f[i].t >= t) {
      const a = f[i - 1], b = f[i]
      const w = (t - a.t) / (b.t - a.t || 1)
      return a.lm.map((p, k) => ({
        x: p.x + (b.lm[k].x - p.x) * w,
        y: p.y + (b.lm[k].y - p.y) * w,
        z: (p.z ?? 0) + ((b.lm[k].z ?? 0) - (p.z ?? 0)) * w,
      }))
    }
  }
  return f[f.length - 1].lm
}

/** Same features as ml/train_motion.py: fingertip/wrist path + hand shape every few frames. */
function features(m: MotionModel, clip: Point[][]): Float32Array {
  const c0 = clip[0]
  const s = Math.hypot(c0[9].x - c0[0].x, c0[9].y - c0[0].y) || 1
  const nShape = Math.ceil(m.frames / m.shapeStep)
  const dims = m.shapeDims ?? 3
  const x = new Float32Array(m.frames * m.pathPoints.length * 2 + nShape * 21 * dims)
  let k = 0
  for (const fr of clip)
    for (const p of m.pathPoints) {
      x[k++] = (fr[p].x - c0[0].x) / s
      x[k++] = (fr[p].y - c0[0].y) / s
    }
  for (let i = 0; i < m.frames; i += m.shapeStep) {
    const fr = clip[i], w = fr[0]
    const ps = Math.hypot(fr[9].x - w.x, fr[9].y - w.y) + 1e-6
    for (const p of fr) {
      x[k++] = (p.x - w.x) / ps
      x[k++] = (p.y - w.y) / ps
      if (dims === 3) x[k++] = ((p.z ?? 0) - (w.z ?? 0)) / ps
    }
  }
  return x
}

/**
 * Always-on motion history: fed every frame whatever the target letter, so a J or Z that
 * starts while the previous letter is still being confirmed is seen in full.
 * History is cleared only when a J/Z is accepted (so it can't count twice) or the hand
 * is lost for longer than GAP_MS.
 */
export class MotionTracker {
  private frames: Frame[] = []
  private lastProgress = 0
  private sureFrames = 0
  private letter: MotionLetter | null = null
  private acceptedAt: number | null = null
  private sureLetter: MotionLetter | null = null // free mode: which letter the sure-frame count is for
  prob = 0 // latest model probability for the target letter (for the debug recorder)

  /**
   * Add this frame's hand (or null if no hand). `letter` is the target if it's J or Z, else null
   * (the history is still kept). Returns progress 0..1 for the target (1 = letter done).
   */
  update(lm: Point[] | null, t: number, letter: MotionLetter | null): number {
    if (letter !== this.letter) {
      this.letter = letter
      this.sureFrames = 0
      this.lastProgress = 0
      this.prob = 0
    }
    const probs = this.run(lm, t)
    if (!probs || !letter || !model) return (this.lastProgress = lm ? 0 : this.lastProgress)
    const prob = (this.prob = probs[model.labels.indexOf(letter)])

    // Right after an accept the history is short and padded with its first frame, so the
    // tail of the last J/Z can look like a new one (user saw J counted twice). Only then,
    // wait for MIN_HISTORY_MS of fresh history. A J/Z after any other letter has no wait.
    const fresh = this.acceptedAt === null || t - this.acceptedAt >= MIN_HISTORY_MS
    this.sureFrames = prob >= ACCEPT_PROB && fresh ? this.sureFrames + 1 : 0
    if (this.sureFrames >= ACCEPT_FRAMES) {
      this.frames = []
      this.sureFrames = 0
      this.lastProgress = 0
      this.acceptedAt = t
      return 1
    }
    return (this.lastProgress = 0.9 * prob)
  }

  /**
   * Free signing (no target letter): returns 'J' or 'Z' on the frame one is recognized, else null.
   * The winning class must beat "none" and the other letter, at >= ACCEPT_PROB for ACCEPT_FRAMES.
   */
  updateFree(lm: Point[] | null, t: number): MotionLetter | null {
    const probs = this.run(lm, t)
    if (!probs || !model) return null
    let best: MotionLetter | null = null
    for (const L of ['J', 'Z'] as const) {
      const p = probs[model.labels.indexOf(L)]
      if (p >= ACCEPT_PROB && (!best || p > probs[model.labels.indexOf(best)])) best = L
    }
    this.prob = best ? probs[model.labels.indexOf(best)] : Math.max(probs[model.labels.indexOf('J')], probs[model.labels.indexOf('Z')])
    const fresh = this.acceptedAt === null || t - this.acceptedAt >= MIN_HISTORY_MS
    if (best && fresh && best === this.sureLetter) this.sureFrames++
    else this.sureFrames = best && fresh ? 1 : 0
    this.sureLetter = best
    if (best && this.sureFrames >= ACCEPT_FRAMES) {
      this.frames = []
      this.sureFrames = 0
      this.sureLetter = null
      this.acceptedAt = t
      return best
    }
    return null
  }

  /** Buffer this frame and run the model on the window. Returns class probabilities, or null. */
  private run(lm: Point[] | null, t: number): Float32Array | null {
    if (!lm) {
      const last = this.frames[this.frames.length - 1]
      if (last && t - last.t > GAP_MS) this.frames = []
      return null
    }
    this.frames.push({ t, lm: lm.map((p) => ({ x: p.x, y: p.y, z: p.z ?? 0 })) })
    const win = model?.windowMs ?? DEFAULT_WINDOW_MS
    while (this.frames.length > 1 && t - this.frames[1].t > win) this.frames.shift()
    if (!model || this.frames.length < 4) return null
    // Resample the window to the model's frame count (holding the first frame if shorter).
    const clip: Point[][] = []
    for (let i = 0; i < model.frames; i++) clip.push(sampleAt(this.frames, t - win + (i * win) / (model.frames - 1)))
    return predict(model, features(model, clip))
  }

  reset() {
    this.frames = []
    this.lastProgress = 0
    this.sureFrames = 0
    this.sureLetter = null
    this.acceptedAt = null
  }
}
