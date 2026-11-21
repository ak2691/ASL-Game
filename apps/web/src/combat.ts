// Combat rules shared by practice mode (in the browser) and online matches (on the server).
// No DOM, no timers: the caller passes `now` (ms). Design: MVP Plan.md ("Spell structure v2").
import { BEATS, COUNTER, ELEMENTS, FORMS, PUNCHES, QUICK, beats, isValidSpell, spellName } from './spells'

export { isValidSpell }

export const MAX_HP = 150
const TICK_MS = 500
export const COUNTER_SILENCE_MS = 2000 // a landed counterspell
export const QUICK_SILENCE_MS = 500 // a landed quick interrupt (charge + push, no drawing)
export const PRISON_SILENCE_MS = 1000 // Frozen Prison (works on any element, so shorter)
export const CHILL_MS = 4000
// Casting rules. The browser only reports what it recognized (a held letter, a finished shape, a
// push); these decide what that does. Online, only the server runs them.
/** A fizzle (failed drawing, or a readied spell that faded) locks all throws this long; the charge stays. */
export const FIZZLE_LOCK_MS = 500
export const CHARGE_LIFE_MS = 3000 // a charge fades after this long with no drawing (switching elements is instant)
export const READY_LIFE_MS = 3000 // a readied spell fades (and fizzles) if not thrown
// Simple anti-cheat: a drawing only counts if its stroke has been arriving for this long. Stops a
// lag switch from sending charge + drawing + push in one burst (a cast the opponent never saw).
const MIN_DRAW_MS = 100

// Attack damage per element: [light, heavy]. Numbers are a first guess, to tune in playtests.
export const PUNCH: Record<string, [number, number]> = {
  E: [10, 30], // hardest direct hits
  F: [7, 22], // + burn
  W: [6, 18], // + mend
  L: [5, 15], // + static
  I: [5, 15], // + chill
}
export const BURN: [number, number] = [4, 11] // Fire: extra damage over ~1.5 s
export const CHILL: [number, number] = [6, 15] // Ice: bonus on the next hit they take
export const STATIC_PULSES: [number, number] = [1, 3] // Lightning: pulses of 0.5 s, 0.5 s gaps

// Static pulse patterns: throws fizzle during "on".
const PUNCH_STATIC = { on: 500, off: 500 }
const THUNDERBOLT_STATIC = { on: 500, off: 300, count: 5 } // tighter rhythm

export type Side = 'player' | 'enemy'
export const other = (s: Side): Side => (s === 'player' ? 'enemy' : 'player')

/** A line for a fighter's cast log (what their casting did). */
export interface Note {
  id: number
  side: Side
  name: string
  detail: string
  color: string
  ok: boolean
  t: number
}

export interface Float {
  id: number
  side: Side
  text: string
  color: string
  t: number
}

/** How long a thrown spell flies before it lands (its effects apply on landing). */
export const FLY_MS = { light: 320, heavy: 480, signature: 650 }
/** Counters are already hard to land, so they fly faster: the counterspell 2×, the quick interrupt 3×. */
const flyMs = (shape: string, tier: keyof typeof FLY_MS) => (shape === COUNTER ? 240 : shape === QUICK ? 160 : FLY_MS[tier])

/** A thrown spell, for the cast animation (its name flies from the caster to the target). */
export interface Bolt {
  id: number
  from: Side
  name: string
  color: string
  kind: 'hit' | 'heal' | 'counter' | 'missed' | 'fizzle'
  el: string
  tier: 'light' | 'heavy' | 'signature' // how big the impact looks
  fly: number // ms in the air
  landed?: boolean // set when it arrives (a counter's result is only known then)
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
export type CastResult = 'ok' | 'invalid' | 'silenced' | 'static' | 'fizzled'

/** What a client needs to draw the fight, from one side's point of view. */
export interface CombatView {
  hp: Record<Side, number>
  maxHp: Record<Side, number> // Infinity = the training dummy
  silenced: Record<Side, number> // ms of silence left (0 = free)
  static: Record<Side, 'on' | 'gap' | null> // a Lightning static pattern on that side
  chill: Record<Side, number> // pending Ice bonus on their next hit taken
  burning: Record<Side, boolean> // Fire burn ticks still to come
  regen: Record<Side, boolean> // hourglass heal ticks still to come
  knocked: Record<Side, number> // counts Earthquake knock-offs (a change = drop your charge)
  charge: Record<Side, string | null> // charged element
  ready: Record<Side, { el: string; shape: string } | null> // readied spell, waiting for a push
  fizzled: Record<Side, number> // ms of fizzle lockout left (no throws)
  notes: Note[]
  dealt: Record<Side, number> // total damage dealt (the dummy shows this)
  floats: Float[]
  bolts: Bolt[]
  over: Side | null // the winner
}

export class Combat {
  hp: Record<Side, number>
  private maxHp: Record<Side, number>
  private silencedUntil: Record<Side, number> = { player: 0, enemy: 0 }
  private fizzledUntil: Record<Side, number> = { player: 0, enemy: 0 }
  // active = last drawing/charging activity (idle fade); since = when charged
  private charge: Record<Side, { el: string; since: number; active: number } | null> = { player: null, enemy: null }
  private ready: Record<Side, { el: string; shape: string; at: number } | null> = { player: null, enemy: null }
  private strokeStart: Record<Side, number | null> = { player: null, enemy: null } // when the current stroke began
  notes: Note[] = []
  private static: Record<Side, Static | null> = { player: null, enemy: null }
  private chill: Record<Side, { bonus: number; until: number } | null> = { player: null, enemy: null }
  private knocked: Record<Side, number> = { player: 0, enemy: 0 }
  private dealt: Record<Side, number> = { player: 0, enemy: 0 }
  private ticking: Ticking[] = []
  private flying: { caster: Side; el: string; shape: string; landAt: number; bolt: Bolt }[] = []
  floats: Float[] = []
  bolts: Bolt[] = []
  private nextId = 0
  winner: Side | null = null

  /** `dummy`: the enemy can't be hurt (training dummy, infinite health). */
  constructor(opts: { dummy?: boolean } = {}) {
    this.maxHp = { player: MAX_HP, enemy: opts.dummy ? Infinity : MAX_HP }
    this.hp = { player: MAX_HP, enemy: opts.dummy ? Infinity : MAX_HP }
  }

  private bolt(from: Side, name: string, color: string, kind: Bolt['kind'], now: number, el = '', shape = '') {
    const p = PUNCHES.indexOf(shape)
    const tier: Bolt['tier'] = p === 0 || shape === QUICK ? 'light' : p === 1 || shape === COUNTER || el === 'H' || !shape ? 'heavy' : 'signature'
    const b: Bolt = { id: this.nextId++, from, name, color, kind, el, tier, fly: flyMs(shape, tier), t: now }
    this.bolts.push(b)
    return b
  }

  private note(side: Side, name: string, detail: string, color: string, ok: boolean, now: number) {
    this.notes.push({ id: this.nextId++, side, name, detail, color, ok, t: now })
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
    this.ready[side] = null
    this.strokeStart[side] = null
  }

  /** A fizzle: no throws for a moment. The charge is kept (and its idle clock restarts). */
  private fizzle(side: Side, now: number) {
    this.fizzledUntil[side] = now + FIZZLE_LOCK_MS
    const c = this.charge[side]
    if (c) c.active = now
  }

  // ---- Inputs: what a fighter's browser recognized -------------------------------------------

  /** A held letter was recognized as an element. Returns true if it (newly) charged. */
  sign(side: Side, el: string, now: number): boolean {
    if (this.winner || !ELEMENTS[el] || this.isSilenced(side, now) || this.ready[side]) return false
    const c = this.charge[side]
    if (c?.el === el) {
      c.active = now
      return false
    }
    this.charge[side] = { el, since: now, active: now }
    return true
  }

  /** A stroke is being drawn: keeps the charge alive. Drawing while a spell is readied abandons it
   *  (a fizzle). Returns true if a readied spell was dropped. */
  drawing(side: Side, now: number): boolean {
    const c = this.charge[side]
    if (c) c.active = now
    this.strokeStart[side] ??= now
    const r = this.ready[side]
    if (!r) return false
    // A readied spell is a commitment: drawing again abandons it, and that fizzles (lockout, charge kept).
    this.ready[side] = null
    this.note(side, 'Fizzle', `${spellName(r.el, r.shape)} abandoned (redraw)`, '#888', false, now)
    this.fizzle(side, now)
    return true
  }

  /** A finished stroke, as recognized (null = not a spell shape; the browser says why). A spell
   *  that fits the charge is readied; anything else fizzles. Returns the readied spell, or null. */
  drew(side: Side, shape: string | null, now: number): { el: string; shape: string } | null {
    if (this.winner || this.isSilenced(side, now)) return null
    const c = this.charge[side]
    if (c) c.active = now
    const start = this.strokeStart[side]
    this.strokeStart[side] = null
    if (shape && (start === null || now - start < MIN_DRAW_MS)) {
      this.note(side, 'Fizzle', 'Drawn too fast', '#888', false, now)
      this.fizzle(side, now)
      return null
    }
    if (shape && shape !== QUICK && c && isValidSpell(c.el, shape)) {
      this.ready[side] = { el: c.el, shape, at: now }
      return { el: c.el, shape }
    }
    if (shape && !c) this.note(side, 'Fizzle', 'No element charged', '#888', false, now)
    else if (shape && c) this.note(side, 'Fizzle', `${ELEMENTS[c.el].name} can't use ${FORMS[shape] ?? shape}`, '#888', false, now)
    this.fizzle(side, now)
    return null
  }

  /** A stroke too short to count ended (the next stroke starts its own clock). */
  strokeCancelled(side: Side) {
    this.strokeStart[side] = null
  }

  /** A push toward the camera: throws the readied spell, or, charged with a counter element, a quick
   *  interrupt (no wait: the browser only counts a push that starts after the charge). Returns null
   *  if there was nothing to throw. */
  push(side: Side, now: number): CastResult | null {
    if (this.winner) return null
    if (this.fizzledUntil[side] > now) return 'fizzled'
    const r = this.ready[side]
    const c = this.charge[side]
    let el: string, shape: string
    if (r) [el, shape] = [r.el, r.shape]
    else if (c && c.el in BEATS) [el, shape] = [c.el, QUICK]
    else return null
    return this.cast(side, el, shape, now)
  }

  /** `caster` throws a spell (or a counterspell). */
  private cast(caster: Side, el: string, shape: string, now: number): CastResult {
    if (this.winner || !isValidSpell(el, shape)) return 'invalid'
    if (this.isSilenced(caster, now)) return 'silenced'
    if (this.fizzledUntil[caster] > now) return 'fizzled'
    if (this.staticAt(caster, now) === 'on') {
      // Lightning static: the throw fizzles. The spell is lost; the charge is kept.
      this.float(caster, 'Fizzled (static)', ELEMENTS.L.color, now)
      this.bolt(caster, 'Fizzled', ELEMENTS.L.color, 'fizzle', now, 'L')
      this.note(caster, 'Fizzled (static)', 'Wait for the gap', ELEMENTS.L.color, false, now)
      this.ready[caster] = null
      const c = this.charge[caster]
      if (c) c.active = now
      return 'static'
    }
    const color = ELEMENTS[el].color
    this.charge[caster] = null // throwing uses up your charge
    this.ready[caster] = null
    this.note(caster, spellName(el, shape), FORMS[shape] ?? '', color, true, now)
    const kind = shape === COUNTER || shape === QUICK ? 'counter' : el === 'H' ? 'heal' : 'hit'
    const bolt = this.bolt(caster, spellName(el, shape), color, kind, now, el, shape)
    // Heals take effect at once; everything else flies across and acts when it lands.
    const landAt = el === 'H' ? now : now + bolt.fly
    this.flying.push({ caster, el, shape, landAt, bolt })
    this.update(now)
    return 'ok'
  }

  /** A thrown spell arrives: damage and effects happen now, in time with its impact animation. */
  private land(caster: Side, el: string, shape: string, now: number, bolt: Bolt) {
    bolt.landed = true
    const target = other(caster)
    const color = ELEMENTS[el].color

    if (shape === COUNTER || shape === QUICK) {
      // Lands if the target is (still) charged with the element ours beats, however fresh the charge.
      // A counterspell of any element also stops healing: a Heal charge, or an hourglass still ticking.
      const c = this.charge[target]
      const healing = shape === COUNTER && (c?.el === 'H' || this.ticking.some((t) => t.side === target && t.amount > 0))
      if ((c && beats(el, c.el)) || healing) {
        this.ticking = this.ticking.filter((t) => !(t.side === target && t.amount > 0))
        this.silence(target, shape === COUNTER ? COUNTER_SILENCE_MS : QUICK_SILENCE_MS, now)
        this.float(target, 'Interrupted!', color, now)
        this.note(target, 'Interrupted!', `silenced for ${(shape === COUNTER ? COUNTER_SILENCE_MS : QUICK_SILENCE_MS) / 1000} s`, color, false, now)
      } else {
        bolt.kind = 'missed'
        this.float(caster, 'Counter missed', '#999', now)
      }
      return
    }

    if (el === 'H') {
      if (shape === 'star') this.changeHp(caster, 20, color, now)
      else this.ticking.push({ side: caster, amount: 6, left: 5, next: now, color }) // hourglass
      return
    }

    const p = PUNCHES.indexOf(shape)
    if (p === 0 || p === 1) {
      // An attack (light or heavy): element damage, plus the element's on-hit effect.
      const dealt = this.hit(target, PUNCH[el][p], color, now)
      if (el === 'F') this.burn(target, BURN[p], 3, color, now)
      if (el === 'W') this.changeHp(caster, Math.floor(dealt / 2), color, now)
      if (el === 'I') this.chill[target] = { bonus: CHILL[p], until: now + CHILL_MS }
      if (el === 'L') this.static[target] = { start: now, ...PUNCH_STATIC, count: STATIC_PULSES[p] }
      return
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
        this.ready[target] = null
        this.knocked[target]++
        this.note(target, 'Knocked off!', 'Earthquake: re-sign your element', color, false, now)
        this.float(target, 'Knocked off!', color, now)
        break
      case 'spiral': // Tidal Wave: big hit, big heal
        this.hit(target, 22, color, now)
        this.changeHp(caster, 20, color, now)
        break
    }
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
      this.fizzledUntil[s] += ms
      const c = this.charge[s]
      if (c) {
        c.since += ms
        c.active += ms
      }
      const r = this.ready[s]
      if (r) r.at += ms
      const ss = this.strokeStart[s]
      if (ss !== null) this.strokeStart[s] = ss + ms
      const st = this.static[s]
      if (st) st.start += ms
      const ch = this.chill[s]
      if (ch) ch.until += ms
    }
    for (const t of this.ticking) t.next += ms
    for (const f of this.flying) f.landAt += ms
  }

  /** Advance damage/heal over time. */
  update(now: number) {
    for (const s of ['player', 'enemy'] as Side[]) {
      const r = this.ready[s]
      if (r && now - r.at > READY_LIFE_MS) {
        this.ready[s] = null
        this.note(s, 'Fizzle', `${spellName(r.el, r.shape)} faded (no push)`, '#888', false, now)
        this.fizzle(s, now)
      }
      const c = this.charge[s]
      if (c && !this.ready[s] && now - c.active > CHARGE_LIFE_MS) this.charge[s] = null
    }
    // Spells land in arrival order (a fast punch can beat a slow signature thrown earlier);
    // a finished match drops whatever is still in the air.
    this.flying.sort((x, y) => x.landAt - y.landAt)
    while (this.flying.length && this.flying[0].landAt <= now && !this.winner) {
      const f = this.flying.shift()!
      this.land(f.caster, f.el, f.shape, f.landAt, f.bolt)
    }
    if (this.winner) this.flying = []
    for (const t of this.ticking) {
      while (t.left > 0 && now >= t.next && !this.winner) {
        this.changeHp(t.side, Math.round(t.amount), t.color, now)
        t.left--
        t.next += TICK_MS
      }
    }
    this.ticking = this.ticking.filter((t) => t.left > 0 && !this.winner)
    this.floats = this.floats.filter((f) => now - f.t < 1200)
    this.notes = this.notes.filter((n) => now - n.t < 2000)
    this.bolts = this.bolts.filter((b) => now - b.t < 2600) // long enough for a signature's impact
  }

  view(now: number): CombatView {
    const chill = (s: Side) => {
      const c = this.chill[s]
      return c && c.until > now ? c.bonus : 0
    }
    const tick = (s: Side, sign: number) => this.ticking.some((t) => t.side === s && t.left > 0 && Math.sign(t.amount) === sign)
    return {
      hp: { ...this.hp },
      maxHp: { ...this.maxHp },
      silenced: {
        player: Math.max(0, this.silencedUntil.player - now),
        enemy: Math.max(0, this.silencedUntil.enemy - now),
      },
      static: { player: this.staticAt('player', now), enemy: this.staticAt('enemy', now) },
      chill: { player: chill('player'), enemy: chill('enemy') },
      burning: { player: tick('player', -1), enemy: tick('enemy', -1) },
      regen: { player: tick('player', 1), enemy: tick('enemy', 1) },
      knocked: { ...this.knocked },
      charge: { player: this.charge.player?.el ?? null, enemy: this.charge.enemy?.el ?? null },
      ready: {
        player: this.ready.player && { el: this.ready.player.el, shape: this.ready.player.shape },
        enemy: this.ready.enemy && { el: this.ready.enemy.el, shape: this.ready.enemy.shape },
      },
      fizzled: { player: Math.max(0, this.fizzledUntil.player - now), enemy: Math.max(0, this.fizzledUntil.enemy - now) },
      notes: [...this.notes],
      dealt: { ...this.dealt },
      floats: [...this.floats],
      bolts: [...this.bolts],
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
    burning: f(v.burning),
    regen: f(v.regen),
    knocked: f(v.knocked),
    charge: f(v.charge),
    ready: f(v.ready),
    fizzled: f(v.fizzled),
    notes: v.notes.map((n) => ({ ...n, side: other(n.side) })),
    dealt: f(v.dealt),
    floats: v.floats.map((x) => ({ ...x, side: other(x.side) })),
    bolts: v.bolts.map((b) => ({ ...b, from: other(b.from) })),
    over: v.over && other(v.over),
  }
}
