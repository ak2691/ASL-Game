// J and Z are drawn in the air, so a single frame can't recognize them.
// We keep a short history of the hand and check two things:
//   1. the starting handshape (J: pinky up like I; Z: index finger up)
//   2. the path the fingertip draws (J: down then hook; Z: across, back, across)
// All distances are in "palm units" (wrist -> middle knuckle), so they don't depend
// on how far the player sits from the camera. Directions are left/right agnostic,
// so this works for both hands and mirrored video.

export interface Point {
  x: number
  y: number
  z?: number
}

interface Frame {
  t: number
  tip: { x: number; y: number } // the drawing fingertip, in image coordinates
  scale: number // palm size this frame
  shapeOk: boolean // start handshape held this frame
}

const WINDOW_MS = 2500 // look at the last 2.5 s of movement (long enough for a slow Z)
const MIN_MS = 200 // anything faster is noise
const SHAPE_SHARE = 0.5 // start shape must be seen in this share of the frames (fast moves blur the fingers)
const GAP_MS = 400 // tolerate the hand dropping out for this long mid-motion (fast moves can lose tracking)

const dist = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y)

/** Finger is extended if its tip is clearly farther from the wrist than its base knuckle. */
function extended(lm: Point[], tip: number, mcp: number) {
  return dist(lm[tip], lm[0]) > dist(lm[mcp], lm[0]) * 1.5
}
function curled(lm: Point[], tip: number, mcp: number) {
  return dist(lm[tip], lm[0]) < dist(lm[mcp], lm[0]) * 1.3
}

const SHAPES = {
  // J starts like I: pinky up, other fingers curled.
  J: { tip: 20, ok: (lm: Point[]) => extended(lm, 20, 17) && curled(lm, 8, 5) && curled(lm, 12, 9) && curled(lm, 16, 13) },
  // Z starts with the index finger up, other fingers curled.
  Z: { tip: 8, ok: (lm: Point[]) => extended(lm, 8, 5) && curled(lm, 12, 9) && curled(lm, 16, 13) && curled(lm, 20, 17) },
}
export type MotionLetter = keyof typeof SHAPES
export const isMotionLetter = (l: string): l is MotionLetter => l === 'J' || l === 'Z'

export class MotionTracker {
  private frames: Frame[] = []
  private lastProgress = 0

  private letter: MotionLetter
  constructor(letter: MotionLetter) {
    this.letter = letter
  }

  /** Add this frame's hand (or null if no hand). Returns progress 0..1 (1 = letter done). */
  update(lm: Point[] | null, t: number): number {
    if (!lm) {
      // Brief dropouts are common during fast moves: keep the path unless the hand is gone a while.
      const last = this.frames[this.frames.length - 1]
      if (!last || t - last.t > GAP_MS) {
        this.frames = []
        this.lastProgress = 0
      }
      return this.lastProgress
    }
    this.lastProgress = this.track(lm, t)
    return this.lastProgress
  }

  private track(lm: Point[], t: number): number {
    const shape = SHAPES[this.letter]
    this.frames.push({ t, tip: { x: lm[shape.tip].x, y: lm[shape.tip].y }, scale: dist(lm[0], lm[9]) || 1, shapeOk: shape.ok(lm) })
    while (this.frames.length && t - this.frames[0].t > WINDOW_MS) this.frames.shift()

    const f = this.frames
    if (f.length < 4 || t - f[0].t < MIN_MS) return f[f.length - 1].shapeOk ? 0.3 : 0
    if (f.filter((x) => x.shapeOk).length / f.length < SHAPE_SHARE) return 0

    const done = this.letter === 'J' ? isJPath(f) : isZPath(f)
    if (done) this.frames = []
    return done ? 1 : 0.3 + 0.6 * pathProgress(f)
  }

  reset() {
    this.frames = []
    this.lastProgress = 0
  }
}

/** How far the fingertip has moved from where it started (palm units), as a rough
 *  "how far into the motion" indicator for the ring. Ignores small jitter. */
function pathProgress(f: Frame[]) {
  const scale = f[0].scale
  let reach = 0
  for (const x of f) reach = Math.max(reach, dist(x.tip, f[0].tip) / scale)
  return Math.min(1, Math.max(0, reach - 0.1) / 0.4)
}

/**
 * J: the pinky tip goes mostly straight down, then hooks sideways AND curves back up.
 * Requiring the upward curl stops "just tip the pinky down" from counting as J.
 */
function isJPath(f: Frame[]) {
  const scale = f[0].scale
  // The lowest point of the path = the bottom of the J. Use the latest such point.
  let low = 0
  for (let i = 1; i < f.length; i++) if (f[i].tip.y >= f[low].tip.y) low = i
  // The descent starts from the highest point before the bottom (ignores lead-in wobble).
  let top = 0
  for (let i = 1; i <= low; i++) if (f[i].tip.y < f[top].tip.y) top = i
  const end = f[f.length - 1].tip
  const down = (f[low].tip.y - f[top].tip.y) / scale
  const drift = Math.abs(f[low].tip.x - f[top].tip.x) / scale // sideways movement on the way down
  const hook = Math.abs(end.x - f[top].tip.x) / scale // total sideways reach of the hook
  const lift = (f[low].tip.y - end.y) / scale // curling back up after the bottom
  return down > 0.35 && drift < down * 0.8 && hook > 0.2 && lift > 0.07
}

interface Stroke {
  start: { x: number; y: number }
  end: { x: number; y: number }
}

/** Splits the fingertip path into left/right strokes (in palm units). */
function horizontalStrokes(f: Frame[]): Stroke[] {
  const scale = f[0].scale
  const P = (i: number) => ({ x: f[i].tip.x / scale, y: f[i].tip.y / scale })
  const MIN_SEG = 0.25 // a turn must go back at least this far (palm units) to start a new stroke
  const strokes: Stroke[] = []
  let dir = 0
  let turn = P(0) // furthest point of the current stroke = where the next stroke starts
  for (let i = 1; i < f.length; i++) {
    const p = P(i)
    if (dir !== 0 && (p.x - turn.x) * dir > 0) {
      // still moving the same way: extend the current stroke
      turn = p
      strokes[strokes.length - 1].end = p
      continue
    }
    if (Math.abs(p.x - turn.x) >= MIN_SEG) {
      // moved far enough the other way: a new stroke starts at the turning point
      dir = Math.sign(p.x - turn.x)
      strokes.push({ start: turn, end: p })
      turn = p
    }
  }
  return strokes
}

/**
 * Z: three strokes - across the top, diagonally back down, across the bottom.
 * All three must be clearly drawn: similar widths, the middle one going down,
 * and the bottom bar below the top bar.
 */
function isZPath(f: Frame[]) {
  const s = horizontalStrokes(f)
  if (s.length < 3) return false
  const [top, diag, bottom] = s.slice(-3)
  const width = (k: Stroke) => Math.abs(k.end.x - k.start.x)
  const drop = (k: Stroke) => k.end.y - k.start.y
  const widest = Math.max(width(top), width(diag), width(bottom))
  // Forgiving on neatness (hand-drawn Zs are sloppy), strict on the three-part structure.
  const level = (k: Stroke) => Math.abs(drop(k)) < width(k) * 1.2 // bars can slope up to ~50°
  const avgY = (k: Stroke) => (k.start.y + k.end.y) / 2
  return (
    [top, diag, bottom].every((k) => width(k) >= 0.3 && width(k) >= widest * 0.35) &&
    level(top) &&
    level(bottom) &&
    drop(diag) >= 0.2 &&
    avgY(bottom) - avgY(top) >= 0.2
  )
}
