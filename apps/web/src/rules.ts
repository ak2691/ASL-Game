// Form rules: hand-written checks that the letter model must also pass.
// The model sometimes accepts a "close enough" shape; these rules catch specific
// mistakes and explain them as a hint. Thresholds come from real samples in the
// training data (see ml/), measured in palm units (wrist -> middle knuckle).

import type { Point } from './motion'

const d = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y)
const palm = (lm: Point[]) => d(lm[0], lm[9]) || 1

/** Thumb tip distance to the middle of the index and middle fingers (between them). */
function thumbToFingers(lm: Point[]) {
  const mid = { x: (lm[6].x + lm[10].x) / 2, y: (lm[6].y + lm[10].y) / 2 }
  return d(lm[4], mid) / palm(lm)
}

interface Rule {
  ok: (lm: Point[]) => boolean
  hint: string
}

export const RULES: Record<string, Rule> = {
  // In real P samples the thumb sits between index and middle fingers (88% are under 0.7).
  P: { ok: (lm) => thumbToFingers(lm) < 0.7, hint: 'Put your thumb between your index and middle fingers.' },
}

// ---- Shape gates -------------------------------------------------------------------------
// The letter model has no "not a letter" class, so a hand that isn't a letter (an open palm) still
// gets its closest letter. A gate rejects a letter the hand plainly can't be.

/** F: the index fingertip touches the thumb. Measured in true proportions (trueShape()): real F
 *  samples have a thumb-index gap of 0.16 palm units (95%) / 0.22 (99%) in ASL-HG; open hands (B, W)
 *  never go below 0.73. */
const F_TOUCH_MAX = 0.45

/** False if the hand plainly can't be `letter` (e.g. F with the index away from the thumb). */
export function passesGate(letter: string, lm: Point[] | null): boolean {
  if (!lm) return true
  if (letter === 'F') return d(lm[4], lm[8]) / palm(lm) <= F_TOUCH_MAX
  return true
}

// ---- Same shape, different direction ------------------------------------------------------
// K/P and G/Q are the same handshape; P and Q just point down. The model can mix them up
// (especially for a diagonal P), so when it sees the shape, the finger direction decides.

interface Pair {
  down: string // letter that points down
  other: string // same shape, not pointing down
  finger: [number, number] // knuckle -> fingertip that shows the direction
}
const PAIRS: Pair[] = [
  { down: 'P', other: 'K', finger: [9, 12] }, // middle finger
  { down: 'Q', other: 'G', finger: [5, 8] }, // index finger
]
const DOWN_THRESHOLD = 0.2 // fingertip at least this far (palm units) below its knuckle = "pointing down"

/**
 * Probability that the hand is `target`, after letting finger direction settle K/P and G/Q.
 * Returns null if `target` isn't one of these letters (use the model's probability as is).
 */
export function directionAdjusted(
  target: string,
  prob: (letter: string) => number,
  lm: Point[] | null,
): number | null {
  const pair = PAIRS.find((p) => p.down === target || p.other === target)
  if (!pair || !lm) return null
  const [knuckle, tip] = pair.finger
  const pointsDown = (lm[tip].y - lm[knuckle].y) / palm(lm) > DOWN_THRESHOLD // image y grows downward
  const shape = prob(pair.down) + prob(pair.other) // "it's this handshape", whichever direction
  const wantsDown = target === pair.down
  return pointsDown === wantsDown ? shape : 0
}

/** The model's guess with K/P and G/Q settled by finger direction (for display and errors). */
export function directionLetter(letter: string, lm: Point[] | null): string {
  const pair = PAIRS.find((p) => p.down === letter || p.other === letter)
  if (!pair || !lm) return letter
  const [knuckle, tip] = pair.finger
  return (lm[tip].y - lm[knuckle].y) / palm(lm) > DOWN_THRESHOLD ? pair.down : pair.other
}

/** Returns a hint if the hand breaks a form rule for this letter, otherwise null. */
export function checkForm(letter: string, lm: Point[] | null): string | null {
  const rule = RULES[letter]
  if (!rule || !lm) return null
  return rule.ok(lm) ? null : rule.hint
}
