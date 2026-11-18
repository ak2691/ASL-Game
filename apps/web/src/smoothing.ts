// Skeleton smoothing with the "One Euro" filter (Casiez et al., 2012), a standard choice
// for hand tracking: it smooths a lot when the hand is still (removes jitter) and very
// little when it moves fast (so quick movements aren't delayed).

import type { NormalizedLandmark } from '@mediapipe/tasks-vision'

const MIN_CUTOFF = 1.5 // Hz: smoothing strength when still (lower = smoother)
const BETA = 5 // how quickly smoothing backs off as speed rises (coordinates are 0..1 of the image)
const D_CUTOFF = 1 // Hz: smoothing of the speed estimate itself

const alpha = (cutoff: number, dt: number) => 1 / (1 + 1 / (2 * Math.PI * cutoff * dt))

class OneEuro {
  private x: number | null = null
  private dx = 0
  filter(value: number, dt: number) {
    if (this.x === null) return (this.x = value)
    const speed = (value - this.x) / dt
    this.dx += alpha(D_CUTOFF, dt) * (speed - this.dx)
    const cutoff = MIN_CUTOFF + BETA * Math.abs(this.dx)
    this.x += alpha(cutoff, dt) * (value - this.x)
    return this.x
  }
}

// ---- Finger jump filter -----------------------------------------------------------------
// When one finger hides another, MediaPipe guesses where the hidden finger is, and the
// guess can jump. Real fingers can't teleport: if ONE finger jumps far (relative to the
// hand) in a single frame while the others barely move, keep its previous position
// briefly. If the new position persists, it was a real move and we accept it.

const FINGERS = [
  [2, 3, 4], // thumb
  [6, 7, 8], // index
  [10, 11, 12], // middle
  [14, 15, 16], // ring
  [18, 19, 20], // pinky
]
const JUMP = 0.5 // palm units in one frame = a suspicious jump
const CALM = 0.15 // ...while every other finger moved less than this
const MAX_HOLD_MS = 150 // never hold a finger longer than this

type Rel = { x: number; y: number; z: number }[]

export class JumpFilter {
  private prevRel: Rel | null = null
  private heldSince: (number | null)[] = FINGERS.map(() => null)

  filter(lm: NormalizedLandmark[], t: number): NormalizedLandmark[] {
    const w = lm[0]
    const scale = Math.hypot(lm[9].x - w.x, lm[9].y - w.y) || 1
    const rel: Rel = lm.map((p) => ({ x: (p.x - w.x) / scale, y: (p.y - w.y) / scale, z: (p.z - w.z) / scale }))
    const prev = this.prevRel
    if (!prev) {
      this.prevRel = rel
      return lm
    }
    const moved = FINGERS.map((f) => Math.max(...f.map((i) => Math.hypot(rel[i].x - prev[i].x, rel[i].y - prev[i].y))))
    const out = rel.map((p) => ({ ...p }))
    FINGERS.forEach((f, k) => {
      const othersCalm = moved.every((m, j) => j === k || m < CALM)
      const held = this.heldSince[k]
      if (moved[k] > JUMP && othersCalm && (held === null || t - held < MAX_HOLD_MS)) {
        this.heldSince[k] ??= t
        for (const i of f) out[i] = { ...prev[i] } // keep the finger where it was
      } else {
        this.heldSince[k] = null
      }
    })
    this.prevRel = out
    return out.map((p, i) => ({ ...lm[i], x: w.x + p.x * scale, y: w.y + p.y * scale, z: w.z + p.z * scale }))
  }

  reset() {
    this.prevRel = null
    this.heldSince = FINGERS.map(() => null)
  }
}

// ---- Smoothing ------------------------------------------------------------------------------

export class LandmarkSmoother {
  private filters: OneEuro[] = []
  private lastT = 0

  smooth(lm: NormalizedLandmark[], t: number): NormalizedLandmark[] {
    const dt = this.lastT ? Math.max(1e-3, (t - this.lastT) / 1000) : 1 / 30
    this.lastT = t
    if (this.filters.length === 0) this.filters = Array.from({ length: lm.length * 3 }, () => new OneEuro())
    return lm.map((p, i) => ({
      ...p,
      x: this.filters[i * 3].filter(p.x, dt),
      y: this.filters[i * 3 + 1].filter(p.y, dt),
      z: this.filters[i * 3 + 2].filter(p.z, dt),
    }))
  }

  reset() {
    this.filters = []
    this.lastT = 0
  }
}
