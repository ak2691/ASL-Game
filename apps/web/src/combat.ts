// Combat rules shared by practice mode (in the browser) and online matches (on the server).
// No DOM, no timers: the caller passes `now` (ms). Design: MVP Plan.md ("Spell structure v2").
import { COUNTER, ELEMENTS, PUNCHES, beats, isValidSpell } from './spells'

export { isValidSpell }

export const MAX_HP = 150
const TICK_MS = 500
const COUNTER_SILENCE_MS = 2000 // a landed counterspell
const PRISON_SILENCE_MS = 1000 // Frozen Prison (works on any element, so shorter)
const MIN_CHARGE_MS = 400 // charges held shorter than this can't be countered (accidental flickers)
const CHILL_MS = 4000

// Attack damage per element: [light, heavy]. Numbers are a first guess, to tune in playtests.
const PUNCH: Record<string, [number, number]> = {
  E: [10, 30], // hardest direct hits
  F: [7, 22], // + burn
  W: [6, 18], // + mend
  L: [5, 15], // + static
  I: [5, 15], // + chill
}
const BURN: [number, number] = [4, 11] // Fire: extra damage over ~1.5 s
const CHILL: [number, number] = [6, 15] // Ice: bonus on the next hit they take
const STATIC_PULSES: [number, number] = [1, 3] // Lightning: pulses of 0.5 s, 0.5 s gaps

// Static pulse patterns: throws fizzle during "on".
const PUNCH_STATIC = { on: 500, off: 500 }
const THUNDERBOLT_STATIC = { on: 500, off: 300, count: 5 } // tighter rhythm

export type Side = 'player' | 'enemy'
export const other = (s: Side): Side => (s === 'player' ? 'enemy' : 'player')

export interface Float {
  id: number
  side: Side
  text: string
  color: string
  t: number
}

interface Ticking {
  side: Side // who it applies to
  amount: number // negative = damage, positive = heal
  left: number
  next: number
  color: string
}

interface Static {
  start: number
  on: number
  off: number
  count: number
}

/** Result of a throw. 'static' = it fizzled in a static pulse (spell lost, charge kept). */
export type CastResult = 'ok' | 'invalid' | 'silenced' | 'static'

/** What a client needs to draw the fight, from one side's point of view. */
export interface CombatView {
  hp: Record<Side, number>
  maxHp: Record<Side, number> // Infinity = the training dummy
  silenced: Record<Side, number> // ms of silence left (0 = free)
  static: Record<Side, 'on' | 'gap' | null> // a Lightning static pattern on that side
  chill: Record<Side, number> // pending Ice bonus on their next hit taken
  knocked: Record<Side, number> // counts Earthquake knock-offs (a change = drop your charge)
  dealt: Record<Side, number> // total damage dealt (the dummy shows this)
  floats: Float[]
  over: Side | null // the winner
}

export class Combat {
  hp: Record<Side, number>
  private maxHp: Record<Side, number>
  private silencedUntil: Record<Side, number> = { player: 0, enemy: 0 }
  private charge: Record<Side, { el: string; since: number } | null> = { player: null, enemy: null }
  private static: Record<Side, Static | null> = { player: null, enemy: null }
  private chill: Record<Side, { bonus: number; until: number } | null> = { player: null, enemy: null }
  private knocked: Record<Side, number> = { player: 0, enemy: 0 }
  private dealt: Record<Side, number> = { player: 0, enemy: 0 }
  private ticking: Ticking[] = []
  floats: Float[] = []
  private nextId = 0
  winner: Side | null = null

  /** `dummy`: the enemy can't be hurt (training dummy, infinite health). */
  constructor(opts: { dummy?: boolean } = {}) {
    this.maxHp = { player: MAX_HP, enemy: opts.dummy ? Infinity : MAX_HP }
    this.hp = { player: MAX_HP, enemy: opts.dummy ? Infinity : MAX_HP }
  }

  private float(side: Side, text: string, color: string, now: number) {
    this.floats.push({ id: this.nextId++, side, text, color, t: now })
  }

  /** Change HP; returns the damage actually dealt (for Water's mend). */
  private changeHp(side: Side, delta: number, color: string, now: number): number {
    if (this.winner || delta === 0) return 0
    this.float(side, delta < 0 ? `${delta}` : `+${delta}`, color, now)
    if (delta < 0) this.dealt[other(side)] += -delta
    if (this.maxHp[side] === Infinity) return -delta // the dummy takes no damage
    const before = this.hp[side]
    this.hp[side] = Math.max(0, Math.min(this.maxHp[side], before + delta))
    if (this.hp[side] <= 0) this.winner = other(side)
    return before - this.hp[side]
  }

  /** A direct hit on `target`: Ice's chill mark adds its bonus and is used up. */
  private hit(target: Side, amount: number, color: string, now: number): number {
    const c = this.chill[target]
    if (c && c.until > now) {
      amount += c.bonus
      this.chill[target] = null
    }
    return Math.max(0, this.changeHp(target, -amount, color, now))
  }

  isSilenced(side: Side, now: number) {
    return this.silencedUntil[side] > now
  }

  /** Where a side is in a static pattern right now. */
  staticAt(side: Side, now: number): 'on' | 'gap' | null {
    const s = this.static[side]
    if (!s) return null
    const t = now - s.start
    const period = s.on + s.off
    if (t < 0 || t >= s.count * period - s.off) return null
    return t % period < s.on ? 'on' : 'gap'
  }

  private silence(side: Side, ms: number, now: number) {
    this.silencedUntil[side] = Math.max(this.silencedUntil[side], now + ms)
    this.charge[side] = null
  }

  /** A side's current element charge (null = none). Counterspells check this. */
  setCharge(side: Side, el: string | null, now: number) {
    if (el && this.isSilenced(side, now)) return
    if (!el) this.charge[side] = null
    else if (this.charge[side]?.el !== el) this.charge[side] = { el, since: now }
  }

  /** `caster` throws a spell (or a counterspell). */
  cast(caster: Side, el: string, shape: string, now: number): CastResult {
    if (this.winner || !isValidSpell(el, shape)) return 'invalid'
    if (this.isSilenced(caster, now)) return 'silenced'
    if (this.staticAt(caster, now) === 'on') {
      // Lightning static: the throw fizzles. The spell is lost; the charge is kept.
      this.float(caster, 'Fizzled (static)', ELEMENTS.L.color, now)
      return 'static'
    }
    const target = other(caster)
    const color = ELEMENTS[el].color
    this.charge[caster] = null // throwing uses up your charge

    if (shape === COUNTER) {
      // Lands if the target is charged (for a moment, not a flicker) with the element ours beats.
      const c = this.charge[target]
      if (c && beats(el, c.el) && now - c.since >= MIN_CHARGE_MS) {
        this.silence(target, COUNTER_SILENCE_MS, now)
        this.float(target, 'Interrupted!', color, now)
      } else this.float(caster, 'Counter missed', '#999', now)
      return 'ok'
    }

    if (el === 'H') {
      if (shape === 'star') this.changeHp(caster, 20, color, now)
      else this.ticking.push({ side: caster, amount: 6, left: 5, next: now, color }) // hourglass
      return 'ok'
    }

    const p = PUNCHES.indexOf(shape)
    if (p === 0 || p === 1) {
      // An attack (light or heavy): element damage, plus the element's on-hit effect.
      const dealt = this.hit(target, PUNCH[el][p], color, now)
      if (el === 'F') this.burn(target, BURN[p], 3, color, now)
      if (el === 'W') this.changeHp(caster, Math.floor(dealt / 2), color, now)
      if (el === 'I') this.chill[target] = { bonus: CHILL[p], until: now + CHILL_MS }
      if (el === 'L') this.static[target] = { start: now, ...PUNCH_STATIC, count: STATIC_PULSES[p] }
      return 'ok'
    }

    // Signatures.
    switch (shape) {
      case 'flame': // Meteor: the biggest total damage
        this.hit(target, 30, color, now)
        this.burn(target, 15, 5, color, now)
        break
      case 'cage': // Frozen Prison: a short silence on any element
        this.hit(target, 10, color, now)
        this.silence(target, PRISON_SILENCE_MS, now)
        this.float(target, 'Frozen!', color, now)
        break
      case 'zigzag7': // Thunderbolt: a long, tight static rhythm
        this.hit(target, 18, color, now)
        this.static[target] = { start: now, ...THUNDERBOLT_STATIC }
        break
      case 'battlements': // Earthquake: huge hit, knocks their charge off
        this.hit(target, 35, color, now)
        this.charge[target] = null
        this.knocked[target]++
        this.float(target, 'Knocked off!', color, now)
        break
      case 'arches': // Tidal Wave: big hit, big heal
        this.hit(target, 22, color, now)
        this.changeHp(caster, 20, color, now)
        break
    }
    return 'ok'
  }

  /** Split `total` damage over `ticks` ticks (every TICK_MS, starting on the next tick). */
  private burn(target: Side, total: number, ticks: number, color: string, now: number) {
    // Whole numbers that add up exactly (e.g. 4 over 3 ticks = 2, 1, 1).
    for (let k = 0; k < ticks; k++) {
      const amount = Math.floor(total / ticks) + (k < total % ticks ? 1 : 0)
      this.ticking.push({ side: target, amount: -amount, left: 1, next: now + TICK_MS * (k + 1), color })
    }
  }

  /** `side` gives up: the other side wins. */
  forfeit(side: Side) {
    if (!this.winner) this.winner = other(side)
  }

  /** Pause support: push every running timer `ms` into the future. */
  shift(ms: number) {
    for (const s of ['player', 'enemy'] as Side[]) {
      if (this.silencedUntil[s]) this.silencedUntil[s] += ms
      const c = this.charge[s]
      if (c) c.since += ms
      const st = this.static[s]
      if (st) st.start += ms
      const ch = this.chill[s]
      if (ch) ch.until += ms
    }
    for (const t of this.ticking) t.next += ms
  }

  /** Advance damage/heal over time. */
  update(now: number) {
    for (const t of this.ticking) {
      while (t.left > 0 && now >= t.next && !this.winner) {
        this.changeHp(t.side, Math.round(t.amount), t.color, now)
        t.left--
        t.next += TICK_MS
      }
    }
    this.ticking = this.ticking.filter((t) => t.left > 0 && !this.winner)
    this.floats = this.floats.filter((f) => now - f.t < 1200)
  }

  view(now: number): CombatView {
    const chill = (s: Side) => {
      const c = this.chill[s]
      return c && c.until > now ? c.bonus : 0
    }
    return {
      hp: { ...this.hp },
      maxHp: { ...this.maxHp },
      silenced: {
        player: Math.max(0, this.silencedUntil.player - now),
        enemy: Math.max(0, this.silencedUntil.enemy - now),
      },
      static: { player: this.staticAt('player', now), enemy: this.staticAt('enemy', now) },
      chill: { player: chill('player'), enemy: chill('enemy') },
      knocked: { ...this.knocked },
      dealt: { ...this.dealt },
      floats: [...this.floats],
      over: this.winner,
    }
  }
}

/** The same view seen from the other side (online: the server runs one Combat; player B sees it flipped). */
export function flipView(v: CombatView): CombatView {
  const f = <T,>(r: Record<Side, T>) => ({ player: r.enemy, enemy: r.player })
  return {
    hp: f(v.hp),
    maxHp: f(v.maxHp),
    silenced: f(v.silenced),
    static: f(v.static),
    chill: f(v.chill),
    knocked: f(v.knocked),
    dealt: f(v.dealt),
    floats: v.floats.map((x) => ({ ...x, side: other(x.side) })),
    over: v.over && other(v.over),
  }
}
