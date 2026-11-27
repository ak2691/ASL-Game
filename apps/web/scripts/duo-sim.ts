// Duo sim (Nov 26): the Duo Tower's pairs fight each other, like the ladder sim does for the 1v1 tower.
// Run: npm run duo-sim -- [games per pairing, default 10]
//
// Two tables:
//  - Ladder: each floor's pair against the next floor's. The higher floor should win most of the time.
//  - Reference: each floor's pair against two plain 1v1 tower bots of the floor it's meant to match (no pair
//    brain). Duos are harder for people than 1v1 (twice the information), so a floor should sit a little
//    under its reference pair, not above it.
// Bots only (the same limits as the ladder sim: no "read your habits" memory). Proof of order, not of feel.
// The bots' drawings measure SVG paths in a browser; here any points will do (shapePaths.ts falls back).
import { Combat, MAX_HP, type Fid } from '../src/combat'
import { DuoBots, DUO_FLOORS, type DuoFloor } from '../src/duo'
import { AI, type Difficulty } from '../src/battle'

// FEINTS=off: the feint package switched off (plans/feints.md), with the old dodge numbers, to compare against.
if (process.env.FEINTS === 'off') {
  const oldDodge: Record<string, number> = { magus: 0.05, archmage: 0.15, lich: 0.32, ascendant: 0.38 }
  for (const [k, st] of Object.entries(AI)) Object.assign(st, { bail: 0, feintRead: 0, fizzlePunish: 0, feint: 0, dodge: oldDodge[k] ?? 0 })
}

const TICK = 33
const CAP = 5 * 60_000

type Team = 'A' | 'B'
/** One fight. `aFirst`: A plays the players' side (sides swap each game so neither side's quirks count). */
function fight(a: DuoFloor, b: DuoFloor, aFirst: boolean): { winner: Team | null; ms: number } {
  const pa = aFirst ? 'player' : 'enemy'
  const pb = aFirst ? 'enemy' : 'player'
  const combat = new Combat({
    fighters: [
      { id: 'a0', team: pa, maxHp: MAX_HP },
      { id: 'a1', team: pa, maxHp: MAX_HP },
      { id: 'b0', team: pb, maxHp: MAX_HP },
      { id: 'b1', team: pb, maxHp: MAX_HP },
    ],
  })
  const A = new DuoBots(combat, a, ['a0', 'a1'], ['b0', 'b1'] as Fid[])
  const B = new DuoBots(combat, b, ['b0', 'b1'], ['a0', 'a1'] as Fid[])
  let now = 0
  A.start(now)
  B.start(now)
  while (!combat.winner && now < CAP) {
    now += TICK
    combat.update(now)
    A.update(now)
    B.update(now)
  }
  const w = combat.winner
  return { winner: !w ? null : w === pa ? 'A' : 'B', ms: now }
}

function series(hi: DuoFloor, lo: DuoFloor, n: number) {
  let wins = 0
  let draws = 0
  let ms = 0
  for (let i = 0; i < n; i++) {
    const r = fight(hi, lo, i % 2 === 0)
    if (r.winner === 'A') wins++
    else if (!r.winner) draws++
    ms += r.ms
  }
  return { rate: wins / n, draws, avgS: ms / n / 1000 }
}

/** Two plain tower bots of one 1v1 floor, no pair brain (each keeps to its own opponent). */
const reference = (d: Difficulty): DuoFloor => ({ pair: [{ who: 'bram', skill: d, kit: d }, { who: 'pip', skill: d, kit: d }], plan: 'split', strength: 0, slow: 1, habit: '' })
/** The 1v1 floor each duo floor is meant to match (plans/duo-tower.md, Skill column). */
const REF: Difficulty[] = ['pebble', 'ember', 'frost', 'cleric', 'hexer', 'zealot', 'warden', 'adept', 'magus', 'lich']

const n = Number(process.argv[2]) || 10
const only = process.argv[3] // 'ladder' or 'ref' for one table, or floors like '5,8' (their rows only)
const floors = only && /^[\d,]+$/.test(only) ? only.split(',').map(Number) : null
const want = (...fs: number[]) => !floors || fs.some((f) => floors.includes(f))
const pct = (x: number) => `${Math.round(x * 100)}%`.padStart(4)
const pad = (f: number) => `${f}`.padStart(2)
const t0 = Date.now()
console.log(`\nDuo sim: ${n} games per pairing\n`)
if (only !== 'ref') {
  console.log('Ladder (higher floor vs the one below)')
  for (let f = 2; f <= DUO_FLOORS.length; f++) {
    if (!want(f, f - 1)) continue
    const r = series(DUO_FLOORS[f - 1], DUO_FLOORS[f - 2], n)
    console.log(`  ${pad(f)} beats ${pad(f - 1)}: ${pct(r.rate)}   draws ${r.draws}   avg ${r.avgS.toFixed(0)} s`)
  }
}
if (only !== 'ladder') {
  console.log('\nReference (floor vs two 1v1 tower bots of its matching floor)')
  for (let f = 1; f <= DUO_FLOORS.length; f++) {
    if (!want(f)) continue
    const r = series(DUO_FLOORS[f - 1], reference(REF[f - 1]), n)
    console.log(`  ${pad(f)} vs 2x ${REF[f - 1].padEnd(9)}: ${pct(r.rate)}   draws ${r.draws}   avg ${r.avgS.toFixed(0)} s`)
  }
}
console.log(`\n${((Date.now() - t0) / 1000).toFixed(0)} s`)
