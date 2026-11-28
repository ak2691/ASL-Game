// Glicko-2 (Mark Glickman, glicko.net/glicko/glicko2.pdf), one match at a time: a rating, how sure it is (RD),
// and how steady the player is (volatility). New players (high RD) move fast; settled ones move little.

export interface Glicko {
  rating: number // shown rating scale (starts at 1500)
  rd: number // rating deviation: 350 = unknown, ~50 = well known
  vol: number // volatility
}
export const NEW_PLAYER: Glicko = { rating: 1500, rd: 350, vol: 0.06 }
const SCALE = 173.7178
const TAU = 0.5 // how much volatility may change per match (0.3-1.2; lower = steadier)
const EPS = 1e-6
const MIN_RD = 45 // never fully certain, so a player can always climb

/** `p`'s rating after a match against `opp`. score: 1 = won, 0 = lost. */
export function rate(p: Glicko, opp: Glicko, score: 0 | 1): Glicko {
  const mu = (p.rating - 1500) / SCALE
  const phi = p.rd / SCALE
  const muJ = (opp.rating - 1500) / SCALE
  const phiJ = opp.rd / SCALE
  const g = 1 / Math.sqrt(1 + (3 * phiJ * phiJ) / (Math.PI * Math.PI))
  const E = 1 / (1 + Math.exp(-g * (mu - muJ)))
  const v = 1 / (g * g * E * (1 - E))
  const delta = v * g * (score - E)
  // New volatility (step 5: the Illinois algorithm)
  const a = Math.log(p.vol * p.vol)
  const f = (x: number) => (Math.exp(x) * (delta * delta - phi * phi - v - Math.exp(x))) / (2 * (phi * phi + v + Math.exp(x)) ** 2) - (x - a) / (TAU * TAU)
  let A = a
  let B: number
  if (delta * delta > phi * phi + v) B = Math.log(delta * delta - phi * phi - v)
  else {
    let k = 1
    while (f(a - k * TAU) < 0) k++
    B = a - k * TAU
  }
  let fA = f(A)
  let fB = f(B)
  for (let i = 0; i < 100 && Math.abs(B - A) > EPS; i++) {
    const C = A + ((A - B) * fA) / (fB - fA)
    const fC = f(C)
    if (fC * fB <= 0) {
      A = B
      fA = fB
    } else fA /= 2
    B = C
    fB = fC
  }
  const vol = Math.exp(A / 2)
  const phiStar = Math.sqrt(phi * phi + vol * vol)
  const phiNew = 1 / Math.sqrt(1 / (phiStar * phiStar) + 1 / v)
  const muNew = mu + phiNew * phiNew * g * (score - E)
  return { rating: 1500 + SCALE * muNew, rd: Math.max(MIN_RD, SCALE * phiNew), vol }
}
