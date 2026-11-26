// Ladder sim (Nov 26): the tower's bots fight each other, to check the floors get harder in order.
// Run: npm run sim -- [games per pair, default 40] [quick: only the floor-below table]
//
// Two PracticeArenas share one Combat. The first plays its usual 'enemy' side; the second plays 'player'
// through a mirror of the same fight (player and enemy swapped everywhere), so the bot code runs unchanged.
// Time is virtual (performance.now is stubbed), so fights run as fast as the CPU allows.
//
// Limits: bots only see what the fight shows (charges, drawings via combat, bolts, wear). The page's player
// hooks (arena.push/stroke) aren't called, so the bots' "read your habits" memory stays empty on both sides.
// It measures bot vs bot, not how a person feels a floor: proof of order, not of difficulty.
import { Combat } from '../src/combat'
import { LADDER, PracticeArena, type Difficulty } from '../src/battle'

let clock = 0
Object.defineProperty(globalThis, 'performance', { value: { now: () => clock }, configurable: true })
// The bots' drawings (for the page to show) measure SVG paths; the sim doesn't draw, so any points will do.
Object.defineProperty(globalThis, 'document', {
  value: { createElementNS: () => ({ setAttribute() {}, getTotalLength: () => 1, getPointAtLength: () => ({ x: 0, y: 0 }) }) },
  configurable: true,
})

const swap = (v: unknown): unknown => {
  if (v === 'player') return 'enemy'
  if (v === 'enemy') return 'player'
  if (Array.isArray(v)) return v.map(swap)
  if (v && typeof v === 'object' && Object.getPrototypeOf(v) === Object.prototype) {
    const out: Record<string, unknown> = {}
    for (const [k, x] of Object.entries(v)) out[(swap(k) as string) ?? k] = swap(x)
    return out
  }
  return v
}
/** The same fight seen from the other side: every 'player' is 'enemy' and back, in and out. */
const mirror = (c: Combat): Combat =>
  new Proxy(c, {
    get(t, prop) {
      const v = Reflect.get(t, prop, t)
      if (typeof v === 'function') return (...args: unknown[]) => swap(v.apply(t, args.map(swap)))
      return swap(v)
    },
  })

const TICK = 33 // ms per step (about 30 fps)
const CAP = 6 * 60_000 // a fight longer than this is a draw

/** One fight: `a` plays 'enemy', `b` plays 'player'. Returns the winner's floor, or null on a draw. */
function fight(a: Difficulty, b: Difficulty): { winner: Difficulty | null; ms: number } {
  clock = 0
  const combat = new Combat()
  const A = new PracticeArena()
  const B = new PracticeArena()
  A.start(clock, a, combat)
  B.start(clock, b, mirror(combat))
  while (!combat.winner && clock < CAP) {
    clock += TICK
    A.update(clock)
    B.update(clock)
  }
  const w = combat.winner as string | null
  return { winner: w === 'enemy' ? a : w === 'player' ? b : null, ms: clock }
}

function series(hi: Difficulty, lo: Difficulty, n: number) {
  let wins = 0, draws = 0, ms = 0
  for (let i = 0; i < n; i++) {
    // Swap sides each game so neither side's quirks favor one bot.
    const r = i % 2 ? fight(hi, lo) : fight(lo, hi)
    if (r.winner === hi) wins++
    else if (!r.winner) draws++
    ms += r.ms
  }
  return { rate: wins / n, draws, avgS: ms / n / 1000 }
}

const n = Number(process.argv[2]) || 40
const pct = (x: number) => `${Math.round(x * 100)}%`.padStart(4)
const name = (d: Difficulty) => LADDER.find((b) => b.id === d)!.name.padEnd(16)
const t0 = Date.now()

console.log(`\nLadder sim: ${n} games per pairing\n`)
console.log('Each floor vs the floor below it (win rate of the higher floor; over 50% = it is harder):')
for (let i = 1; i < LADDER.length; i++) {
  const hi = LADDER[i].id, lo = LADDER[i - 1].id
  const r = series(hi, lo, n)
  console.log(`  ${name(hi)} vs ${name(lo)} ${pct(r.rate)}   avg ${r.avgS.toFixed(0)} s${r.draws ? `, ${r.draws} draws` : ''}`)
}

if (process.argv[3] === 'quick') {
  console.log(`
Done in ${((Date.now() - t0) / 1000).toFixed(0)} s (quick: floor-below table only).
`)
  process.exit(0)
}
// Two yardsticks (a third and two thirds up), so both halves of the tower get a column that isn't stuck at 0% or 100%.
const refs = [LADDER[Math.round((LADDER.length - 1) / 3)].id, LADDER[Math.round(((LADDER.length - 1) * 2) / 3)].id]
const refName = (d: Difficulty) => LADDER.find((b) => b.id === d)!.name
console.log(`\nEach floor vs two fixed yardsticks (${refs.map(refName).join(', ')}); each column should rise floor by floor:`)
for (const b of LADDER) {
  const cols = refs.map((ref) => (b.id === ref ? '  --' : pct(series(b.id, ref, n).rate)))
  console.log(`  ${name(b.id)} ${cols.join('   ')}`)
}
console.log(`\nDone in ${((Date.now() - t0) / 1000).toFixed(0)} s.\n`)
