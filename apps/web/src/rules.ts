// Hand-written checks on top of the letter model. Thresholds come from real samples in the training
// data (see ml/), measured in palm units (wrist -> middle knuckle).

interface Point {
  x: number
  y: number
  z?: number
}

const d = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y)
const palm = (lm: Point[]) => d(lm[0], lm[9]) || 1

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

/** The model's guess with K/P and G/Q settled by finger direction (for display and errors). */
export function directionLetter(letter: string, lm: Point[] | null): string {
  const pair = PAIRS.find((p) => p.down === letter || p.other === letter)
  if (!pair || !lm) return letter
  const [knuckle, tip] = pair.finger
  return (lm[tip].y - lm[knuckle].y) / palm(lm) > DOWN_THRESHOLD ? pair.down : pair.other
}
