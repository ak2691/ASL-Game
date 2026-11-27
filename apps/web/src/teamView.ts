// Online team fights: the server runs one Combat with its own fighter ids. Each player is sent it from
// their own point of view: they're 'player', a teammate is 'ally', foes are 'enemy' and 'enemy2', and
// their team is 'player'. (1v1 is the same thing with two fighters.)
import { other, type CombatView, type Fid, type FighterSpec, type Side } from './combat'

/** Server fighter id -> the id `me` sees it as. */
export function idsFor(fighters: readonly FighterSpec[], me: Fid): Record<Fid, Fid> {
  const mine = fighters.find((f) => f.id === me)?.team ?? 'player'
  const map: Record<Fid, Fid> = { [me]: 'player' }
  fighters.filter((f) => f.team === mine && f.id !== me).forEach((f, i) => (map[f.id] = i ? `ally${i + 1}` : 'ally'))
  fighters.filter((f) => f.team !== mine).forEach((f, i) => (map[f.id] = i ? `enemy${i + 1}` : 'enemy'))
  return map
}

export function viewFor(v: CombatView, me: Fid): CombatView {
  return viewMapped(v, idsFor(v.fighters, me), (v.fighters.find((f) => f.id === me)?.team ?? 'player') !== 'player')
}

/** The fight with its fighter ids renamed by `map` (and the teams swapped if `flip`). */
export function viewMapped(v: CombatView, map: Record<Fid, Fid>, flip: boolean): CombatView {
  const id = (x: Fid) => map[x] ?? x
  const team = (t: Side): Side => (flip ? other(t) : t)
  const ids = new Set(Object.keys(map))
  const out: Record<string, unknown> = {}
  // Every per-fighter record (hp, charge, shroud, ...) gets its keys renamed, whatever fields the fight adds later.
  for (const [k, val] of Object.entries(v)) {
    const keys = val && typeof val === 'object' && !Array.isArray(val) ? Object.keys(val) : []
    out[k] = keys.length && keys.every((x) => ids.has(x)) ? Object.fromEntries(Object.entries(val as object).map(([x, y]) => [id(x), y])) : val
  }
  const order = ['player', 'ally', 'ally2', 'enemy', 'enemy2', 'enemy3']
  return {
    ...(out as unknown as CombatView),
    fighters: v.fighters.map((f) => ({ ...f, id: id(f.id), team: team(f.team) })).sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id)),
    aim: Object.fromEntries(Object.entries(v.aim).map(([x, y]) => [id(x), y && id(y)])),
    notes: v.notes.map((n) => ({ ...n, side: id(n.side) })),
    floats: v.floats.map((f) => ({ ...f, side: id(f.side) })),
    bolts: v.bolts.map((b) => ({ ...b, from: team(b.from), by: id(b.by), to: id(b.to) })),
    over: v.over && team(v.over),
  }
}

/** Shroud: a Shrouded foe's charge, mix and readied spell are never sent. */
export function hideShrouded(v: CombatView): CombatView {
  const hidden = v.fighters.filter((f) => f.team !== 'player' && v.shroud[f.id] > 0).map((f) => f.id)
  if (!hidden.length) return v
  const charge = { ...v.charge }
  const mix = { ...v.mix }
  const ready = { ...v.ready }
  for (const h of hidden) {
    charge[h] = null
    mix[h] = []
    ready[h] = null
  }
  return { ...v, charge, mix, ready }
}
