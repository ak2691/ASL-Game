// Combat rules shared by practice mode (in the browser) and online matches (on the server).
// No DOM, no timers: the caller passes `now` (ms). Design: MVP Plan.md ("Spell structure v2").
import { COMBO, COMBOS_ON, COMBO_CHARGES, COMBO_MIX, COUNTER, ELEMENTS, FORMS, MIXABLE, PUNCHES, QUICK, beats, canQuick, chargeInfo, comboOf, isMixCounter, isValidSpell, mixBeats, mixCounter, spellName } from './spells'

export { isValidSpell }

export const MAX_HP = 350
const TICK_MS = 500
export const COUNTER_SILENCE_MS = 2500 // a landed counterspell
export const QUICK_SILENCE_MS = 500 // a landed quick interrupt (charge + push, no drawing)
export const PRISON_SILENCE_MS = 1000 // Frozen Prison (works on any element, so shorter)
export const CHILL_MS = 4000
export const PRISON_CHILL = 0.45 // Frozen Prison also chills: +45% on the next hit they take within CHILL_MS
// Holy buffs, Unholy curses, combos. First guesses, to tune in playtests.
export const AEGIS_HP = 45 // Aegis: armor that soaks direct-hit damage...
export const AEGIS_DRAIN = 4 // ...and drains this much per second. Can't be recast while any is left.
export const MIRROR_MS = 4000 // Mirror: the next direct-damage spell within this time flies back
export const DOOM_MS = 2500 // Doom: land a cast within this time...
export const DOOM_DMG = 30 // ...or take this
export const SHROUD_MS = 5000 // Shroud: they can't see your charge or your drawing
export const EXECUTE: [number, number, number] = [15, 0.3, 60] // Execute: base + share of their missing HP, capped
// (a readied Execute hit by a counterspell backfires: the caster takes half of what it would do to them)
// Combos (plans/combos.md). First guesses, to tune in playtests.
// Nov 23 buff: a combo (C + 2 letters + a hard drawing) takes ~2-3x a heavy, so each should be worth ~2x one.
export const MAGMA: [number, number] = [35, 35] // hit, then burn over 5 s
export const STORM = { hit: 18, pulse: 8, zap: 12, count: 5 } // 0.25 s on / 0.6 s off; a throw in a pulse fizzles and takes `zap`
export const GLACIER_MS = 5000 // Advancing Glacier: creeps this long, then crushes...
export const GLACIER_DMG = 70 // ...for this. Only a Fire + Ice combo counterspell stops it.
export const TWILIGHT_MS = 7000 // you take 50% less, they take 50% more (stacks with chill)
export const TWILIGHT_PCT = 0.5
export const STEAM_MS = 6000 // their screen fogs and their attacks may miss
export const STEAM_MISS = 0.5
export const STEAM_HIT = 22
export const THERMAL = { hit: 28, burn: 16, chill: 0.35 } // a hit, a burn and a chill
export const PLASMA = { hit: 35, burn: 15, stun: 1750 }
export const SUNFIRE: [number, number] = [15, 40] // hit, then a 6 s burn that heals you what it deals
export const GRAVE = { hit: 30, ms: 10000 } // no healing (Water's mend included) and no Holy spells at all
export const HEAL = 34 // Holy star: right away
export const REGEN = { amount: 9, ticks: 5 } // Holy hourglass: every 0.5 s
// Casting rules. The browser only reports what it recognized (a held letter, a finished shape, a
// push); these decide what that does. Online, only the server runs them.
/** A fizzle (failed drawing, or a readied spell that faded) locks all throws this long; the charge stays. */
export const FIZZLE_LOCK_MS = 500
export const READY_LIFE_MS = 3000 // a readied spell fades (and fizzles) if not thrown
// Simple anti-cheat: a drawing only counts if its stroke has been arriving for this long. Stops a
// lag switch from sending charge + drawing + push in one burst (a cast the opponent never saw).
const MIN_DRAW_MS = 100
// Parry (plans/parry.md): a two-hand push in the last PARRY_WINDOW_MS before a spell hits you sends it
// back: 100%, then 75%, then 50% of its power (REFLECT_POWER); parrying it after that just ends it.
// Too early, too late or with nothing coming: a stagger (no throws and no parries for PARRY_MISS_MS).
export const PARRY_WINDOW_MS = 100
export const PARRY_MISS_MS = 1000
const REFLECT_POWER = [1, 0.75, 0.5]

// Attack damage per element: [light, heavy]. Numbers are a first guess, to tune in playtests.
export const PUNCH: Record<string, [number, number]> = {
  E: [10, 22], // hardest direct hits
  F: [7, 17], // + burn
  W: [6, 15], // + mend
  L: [5, 13], // + static
  I: [5, 11], // + chill
}
export const BURN: [number, number] = [4, 8] // Fire: extra damage over ~1.5 s
export const CHILL: [number, number] = [0.25, 0.35] // Ice (light, heavy): the next hit they take does this much more
export const STATIC_PULSES: [number, number] = [1, 2] // Lightning: pulses of 0.25 s, 1 s gaps

// Static pulse patterns: throws fizzle during "on".
const PUNCH_STATIC = { on: 250, off: 1000 }
const THUNDERBOLT_STATIC = { on: 250, off: 800, count: 3 } // tighter rhythm, more pulses

/** A team. In 1v1 each team has one fighter, whose id is the team's name. */
export type Side = 'player' | 'enemy'
export const other = (s: Side): Side => (s === 'player' ? 'enemy' : 'player')
/** A fighter. 1v1: 'player' and 'enemy'. Team modes add more (e.g. 'ally', 'enemy2'). */
export type Fid = string
export interface FighterSpec {
  id: Fid
  team: Side
  maxHp: number // Infinity = can't be hurt (training dummy)
}

/** A line for a fighter's cast log (what their casting did). */
export interface Note {
  id: number
  side: Fid
  name: string
  detail: string
  color: string
  ok: boolean
  t: number
}

export interface Float {
  id: number
  side: Fid
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
  from: Side // the caster's team (which half it flies from)
  by: Fid // who threw it
  to: Fid // who it's aimed at (the caster, for spells on yourself)
  name: string
  color: string
  kind: 'hit' | 'heal' | 'counter' | 'missed' | 'fizzle'
  el: string
  shape: string // what was drawn ('' for a static fizzle)
  tier: 'light' | 'heavy' | 'signature' // how big the impact looks
  fly: number // ms in the air
  landed?: boolean // set when it arrives (a counter's result is only known then)
  parryable?: boolean // a spell flying at someone that a parry can send back
  parried?: boolean // sent back (or ended) by a parry before it landed
  power?: number // share of its damage (1, or less once reflected)
  t: number
}

interface Ticking {
  leech?: boolean // Sunfire: the caster heals what each tick deals
  side: Fid // who it applies to
  by: Fid // who caused it
  amount: number // negative = damage, positive = heal
  left: number
  next: number
  color: string
}

interface Static {
  dmg?: number // Storm: damage each pulse
  zap?: number // Storm: damage when a throw fizzles in a pulse
  hits?: number // pulses that already did damage
  by?: Fid
  start: number
  on: number
  off: number
  count: number
}

/** Result of a throw. 'static' = it fizzled in a static pulse (spell and charge lost). */
export type CastResult = 'ok' | 'invalid' | 'silenced' | 'static' | 'fizzled'

/** What a client needs to draw the fight, from one side's point of view. */
export interface CombatView {
  fighters: FighterSpec[] // everyone in the fight, in order (1v1: player, enemy)
  aim: Record<Fid, Fid | null> // who each fighter is aiming at (null = their default target)
  hp: Record<Fid, number>
  maxHp: Record<Fid, number> // Infinity = the training dummy
  silenced: Record<Fid, number> // ms of silence left (0 = free)
  static: Record<Fid, 'on' | 'gap' | null> // a Lightning static pattern on that side
  chill: Record<Fid, number> // pending Ice chill on their next hit taken, in % (0 = none)
  burning: Record<Fid, boolean> // Fire burn ticks still to come
  regen: Record<Fid, boolean> // hourglass heal ticks still to come
  knocked: Record<Fid, number> // counts Earthquake knock-offs (a change = drop your charge)
  charge: Record<Fid, string | null> // charged element ('C' = mixing a combo, or a locked combo)
  mix: Record<Fid, string[]> // elements mixed into a 'C' combo so far
  ready: Record<Fid, { el: string; shape: string } | null> // readied spell, waiting for a push
  fizzled: Record<Fid, number> // ms of fizzle lockout left (no throws)
  staggered: Record<Fid, number> // ms left of a missed parry's stagger (no parrying)
  shield: Record<Fid, number> // Aegis armor left (0 = none)
  mirror: Record<Fid, number> // ms of Mirror left
  doom: Record<Fid, number> // ms until Doom hits (0 = none)
  shroud: Record<Fid, number> // ms of Shroud left (the other side can't see your charge or drawing)
  guard: Record<Fid, number> // ms of Twilight's guard left (takes less damage)
  exposed: Record<Fid, number> // ms of Twilight's curse left (takes more damage)
  fog: Record<Fid, number> // ms of Steam left (their attacks may miss)
  noHeal: Record<Fid, number> // ms of Grave left (can't heal)
  glacier: Record<Fid, number> // ms until an Advancing Glacier reaches them (0 = none)
  storm: Record<Fid, boolean> // a Storm (combo) is raining on them: its static pulses hurt
  notes: Note[]
  dealt: Record<Fid, number> // total damage dealt (the dummy shows this)
  floats: Float[]
  bolts: Bolt[]
  over: Side | null // the winning team
}

export class Combat {
  hp: Record<Fid, number> = {}
  private fighters: FighterSpec[]
  private ids: Fid[]
  private team: Record<Fid, Side> = {}
  private maxHp: Record<Fid, number> = {}
  private silencedUntil: Record<Fid, number> = {}
  private fizzledUntil: Record<Fid, number> = {}
  // active = last drawing/charging activity (idle fade); since = when charged
  private charge: Record<Fid, { el: string; since: number; active: number; mix?: string[] } | null> = {}
  private ready: Record<Fid, { el: string; shape: string; at: number } | null> = {}
  private strokeStart: Record<Fid, number | null> = {} // when the current stroke began
  notes: Note[] = []
  private static: Record<Fid, Static | null> = {}
  private chill: Record<Fid, { pct: number; until: number } | null> = {}
  private knocked: Record<Fid, number> = {}
  private dealt: Record<Fid, number> = {}
  private shield: Record<Fid, { hp: number; at: number } | null> = {} // armor as of `at` (it drains)
  private mirrorUntil: Record<Fid, number> = {}
  private doomAt: Record<Fid, number> = {}
  private doomBy: Record<Fid, Fid> = {}
  private shroudUntil: Record<Fid, number> = {}
  private guardUntil: Record<Fid, number> = {}
  private exposedUntil: Record<Fid, number> = {}
  private fogUntil: Record<Fid, number> = {}
  private noHealUntil: Record<Fid, number> = {}
  private aimAt: Record<Fid, Fid | null> = {} // who each fighter aims at (null = default target)
  private lastHitBy: Record<Fid, Fid | null> = {} // the last enemy that hit them (default target)
  private ticking: Ticking[] = []
  private flying: { caster: Fid; target: Fid; el: string; shape: string; landAt: number; bolt: Bolt; power?: number; reflects?: number; miss?: boolean }[] = []
  private staggeredUntil: Record<Fid, number> = {} // a missed parry: no parrying again until then
  private pendingMiss = false // the spell landing right now was thrown from Steam's fog: it misses
  private landScale = 1 // the power of the spell landing right now (a reflected one hits softer)
  private by: Fid | null = null // who caused the damage being dealt right now
  floats: Float[] = []
  bolts: Bolt[] = []
  private nextId = 0
  winner: Side | null = null

  /** 1v1: `dummy`: the enemy can't be hurt (training dummy, infinite health). `trainee`: nor can you.
   *  Team modes: pass `fighters` (each with its own team and max HP). */
  constructor(opts: { dummy?: boolean; trainee?: boolean; fighters?: FighterSpec[] } = {}) {
    this.fighters = opts.fighters ?? [
      { id: 'player', team: 'player', maxHp: opts.trainee ? Infinity : MAX_HP },
      { id: 'enemy', team: 'enemy', maxHp: opts.dummy ? Infinity : MAX_HP },
    ]
    this.ids = this.fighters.map((f) => f.id)
    for (const f of this.fighters) {
      this.team[f.id] = f.team
      this.maxHp[f.id] = f.maxHp
      this.hp[f.id] = f.maxHp
      this.silencedUntil[f.id] = 0
      this.fizzledUntil[f.id] = 0
      this.charge[f.id] = null
      this.ready[f.id] = null
      this.strokeStart[f.id] = null
      this.static[f.id] = null
      this.chill[f.id] = null
      this.knocked[f.id] = 0
      this.dealt[f.id] = 0
      this.shield[f.id] = null
      this.mirrorUntil[f.id] = 0
      this.doomAt[f.id] = 0
      this.shroudUntil[f.id] = 0
      this.guardUntil[f.id] = 0
      this.exposedUntil[f.id] = 0
      this.fogUntil[f.id] = 0
      this.noHealUntil[f.id] = 0
      this.aimAt[f.id] = null
      this.lastHitBy[f.id] = null
      this.staggeredUntil[f.id] = 0
    }
  }

  /** Out of the fight (no HP left). Out fighters can't act or be targeted. */
  isOut(id: Fid) {
    return this.hp[id] <= 0
  }
  teamOf(id: Fid): Side {
    return this.team[id]
  }
  private foes(id: Fid) {
    return this.ids.filter((x) => this.team[x] !== this.team[id] && !this.isOut(x))
  }
  private friends(id: Fid) {
    return this.ids.filter((x) => this.team[x] === this.team[id] && !this.isOut(x))
  }
  /** Who `id`'s spell goes to. A set aim (still valid) wins; else heals and buffs go to the most hurt
   *  ally (you on a tie), attacks to whoever last hit you, else the enemy with the least HP. */
  targetOf(id: Fid, el: string, shape: string): Fid | null {
    if (shape === 'veil') return id // Shroud is always on yourself
    const a = this.aimAt[id]
    if (el === 'H' && shape !== COUNTER) {
      if (a && this.team[a] === this.team[id] && !this.isOut(a)) return a
      const share = (x: Fid) => (this.maxHp[x] === Infinity ? 1 : this.hp[x] / this.maxHp[x])
      return this.friends(id).sort((p, q) => share(p) - share(q) || (p === id ? -1 : q === id ? 1 : 0))[0] ?? id
    }
    const foes = this.foes(id)
    if (a && foes.includes(a)) return a
    const last = this.lastHitBy[id]
    if (last && foes.includes(last)) return last
    return foes.sort((p, q) => this.hp[p] - this.hp[q])[0] ?? null
  }
  /** Set who `id` aims at (null = their default target). */
  aim(id: Fid, target: Fid | null) {
    this.aimAt[id] = target
  }

  private bolt(by: Fid, to: Fid, name: string, color: string, kind: Bolt['kind'], now: number, el = '', shape = '') {
    const p = PUNCHES.indexOf(shape)
    const tier: Bolt['tier'] = p === 0 || shape === QUICK ? 'light' : p === 1 || shape === COUNTER || el === 'H' || !shape ? 'heavy' : 'signature'
    const b: Bolt = { id: this.nextId++, from: this.team[by], by, to, name, color, kind, el, shape, tier, fly: flyMs(shape, tier), t: now }
    this.bolts.push(b)
    return b
  }

  private note(side: Fid, name: string, detail: string, color: string, ok: boolean, now: number) {
    this.notes.push({ id: this.nextId++, side, name, detail, color, ok, t: now })
  }

  private float(side: Fid, text: string, color: string, now: number) {
    this.floats.push({ id: this.nextId++, side, text, color, t: now })
  }

  /** Change HP; returns the damage actually dealt (for Water's mend). */
  private changeHp(side: Fid, delta: number, color: string, now: number): number {
    if (this.winner || delta === 0 || this.isOut(side)) return 0
    if (delta > 0 && this.noHealUntil[side] > now) {
      this.float(side, 'No healing', COMBO_CHARGES.grave.color, now)
      return 0
    }
    this.float(side, delta < 0 ? `${delta}` : `+${delta}`, color, now)
    const by = this.by ?? this.foes(side)[0] ?? null
    if (delta < 0 && by) {
      this.dealt[by] += -delta
      if (this.team[by] !== this.team[side]) this.lastHitBy[side] = by
    }
    if (this.maxHp[side] === Infinity) return -delta // the dummy takes no damage
    const before = this.hp[side]
    this.hp[side] = Math.max(0, Math.min(this.maxHp[side], before + delta))
    if (this.hp[side] <= 0) this.knockOut(side, now)
    return before - this.hp[side]
  }

  /** `side` is out: everything they had going stops. A team with nobody left loses. */
  private knockOut(side: Fid, now: number) {
    this.charge[side] = null
    this.ready[side] = null
    this.strokeStart[side] = null
    this.ticking = this.ticking.filter((t) => t.side !== side)
    if (this.ids.length > 2) this.float(side, 'Out!', '#999', now)
    const t = this.team[side]
    if (this.ids.every((x) => this.team[x] !== t || this.isOut(x))) this.winner = other(t)
  }

  /** A direct hit on `target`: Ice's chill mark adds its bonus and is used up. */
  private hit(target: Fid, amount: number, color: string, now: number): number {
    amount = Math.round(amount * this.landScale)
    const c = this.chill[target]
    if (c && c.until > now && amount > 0) {
      amount = Math.round(amount * (1 + c.pct))
      this.chill[target] = null
    }
    if (amount > 0 && this.exposedUntil[target] > now) amount = Math.round(amount * (1 + TWILIGHT_PCT))
    if (amount > 0 && this.guardUntil[target] > now) amount = Math.round(amount * (1 - TWILIGHT_PCT))
    const armor = this.armor(target, now)
    if (armor > 0 && amount > 0) {
      const soak = Math.min(Math.floor(armor), amount)
      amount -= soak
      this.shield[target] = armor - soak >= 1 ? { hp: armor - soak, at: now } : null
      this.float(target, `Blocked ${soak}`, ELEMENTS.H.color, now)
    }
    return Math.max(0, this.changeHp(target, -amount, color, now))
  }

  /** What an Execute does to `side`: base + a share of their missing HP, capped. */
  private executeDmg(side: Fid) {
    const missing = this.maxHp[side] === Infinity ? 0 : this.maxHp[side] - this.hp[side]
    return Math.min(EXECUTE[2], Math.round(EXECUTE[0] + EXECUTE[1] * missing))
  }

  /** Aegis armor left on `side` (it drains over time). */
  private armor(side: Fid, now: number) {
    const sh = this.shield[side]
    return sh ? Math.max(0, sh.hp - (AEGIS_DRAIN * (now - sh.at)) / 1000) : 0
  }

  /** Chill doesn't stack: one at a time. A stronger (or equal) chill replaces it and restarts the clock;
   *  a weaker one changes nothing. */
  private chillOn(side: Fid, pct: number, now: number) {
    const c = this.chill[side]
    if (c && c.until > now && c.pct > pct) return
    this.chill[side] = { pct, until: now + CHILL_MS }
  }

  isSilenced(side: Fid, now: number) {
    return this.silencedUntil[side] > now
  }

  /** Where a side is in a static pattern right now. */
  staticAt(side: Fid, now: number): 'on' | 'gap' | null {
    const s = this.static[side]
    if (!s) return null
    const t = now - s.start
    const period = s.on + s.off
    if (t < 0 || t >= s.count * period - s.off) return null
    return t % period < s.on ? 'on' : 'gap'
  }

  private silence(side: Fid, ms: number, now: number) {
    this.silencedUntil[side] = Math.max(this.silencedUntil[side], now + ms)
    this.charge[side] = null
    this.ready[side] = null
    this.strokeStart[side] = null
  }

  /** A fizzle: no throws for a moment, and the charge is lost (sign again, any element). */
  private fizzle(side: Fid, now: number) {
    this.fizzledUntil[side] = now + FIZZLE_LOCK_MS
    this.charge[side] = null
  }

  // ---- Inputs: what a fighter's browser recognized -------------------------------------------

  /** A held letter was recognized as an element. Returns true if it (newly) charged. */
  sign(side: Fid, el: string, now: number): boolean {
    if (this.winner || this.isOut(side) || !(ELEMENTS[el] || (el === COMBO && COMBOS_ON)) || this.isSilenced(side, now) || this.ready[side]) return false
    const c = this.charge[side]
    // Mixing a combo: element letters go into the mix instead of replacing the charge.
    if (c?.el === COMBO && MIXABLE.includes(el)) {
      c.active = now
      if (c.mix!.includes(el) || c.mix!.length >= 2) return false
      c.mix!.push(el)
      // The second element locks the mix into its combo charge (no combo: it stays C, for a combo counterspell).
      if (c.mix!.length === 2) this.charge[side] = { el: comboOf(c.mix!) ?? COMBO, since: now, active: now, mix: c.mix }
      return true
    }
    // Still holding a letter of a locked combo's mix (e.g. E after C, U, E), or C again: the combo stays.
    if (c?.el === el || c?.mix?.includes(el) || (el === COMBO && c?.mix?.length === 2)) {
      c.active = now
      return false
    }
    this.charge[side] = el === COMBO ? { el, since: now, active: now, mix: [] } : { el, since: now, active: now }
    return true
  }

  /** An open hand held while charged (nothing drawn or readied): drop the charge. Returns true if it did. */
  uncharge(side: Fid): boolean {
    if (!this.charge[side] || this.ready[side] || this.strokeStart[side] !== null) return false
    this.charge[side] = null
    return true
  }

  /** The charged element (or combo) right now. */
  chargeOf(side: Fid) {
    return this.charge[side]?.el ?? null
  }

  /** A stroke is being drawn: keeps the charge alive. Drawing while a spell is readied abandons it
   *  (a fizzle). Returns true if a readied spell was dropped. */
  drawing(side: Fid, now: number): boolean {
    if (this.isOut(side)) return false
    const c = this.charge[side]
    if (c) c.active = now
    // A combo still being mixed (fewer than 2 elements) ignores drawing: the hand passing through a
    // pointing shape between two letters (W to L) must not drop it. Open your hand to drop it.
    if (c?.el === COMBO && c.mix!.length < 2) return false
    this.strokeStart[side] ??= now
    const r = this.ready[side]
    if (!r) return false
    // A readied spell is a commitment: drawing again abandons it, and that fizzles (lockout, charge lost).
    this.ready[side] = null
    this.note(side, 'Fizzle', `${spellName(r.el, r.shape)} abandoned (redraw)`, '#888', false, now)
    this.fizzle(side, now)
    return true
  }

  /** A finished stroke, as recognized (null = not a spell shape; the browser says why). A spell
   *  that fits the charge is readied; anything else fizzles. Returns the readied spell, or null. */
  drew(side: Fid, shape: string | null, now: number): { el: string; shape: string } | null {
    if (this.winner || this.isOut(side) || this.isSilenced(side, now)) return null
    const c = this.charge[side]
    if (c) c.active = now
    const start = this.strokeStart[side]
    this.strokeStart[side] = null
    if (shape && (start === null || now - start < MIN_DRAW_MS)) {
      this.note(side, 'Fizzle', 'Drawn too fast', '#888', false, now)
      this.fizzle(side, now)
      return null
    }
    // C + two elements + a circle: a combo counterspell (its two elements must beat the combo's two).
    if (shape === COUNTER && c?.mix?.length === 2) {
      const el = mixCounter(c.mix)
      this.ready[side] = { el, shape, at: now }
      return { el, shape }
    }
    if (shape && shape !== QUICK && c && isValidSpell(c.el, shape)) {
      this.ready[side] = { el: c.el, shape, at: now }
      return { el: c.el, shape }
    }
    if (shape && !c) this.note(side, 'Fizzle', 'No element charged', '#888', false, now)
    else if (shape && c?.el === COMBO) this.note(side, 'Fizzle', 'Not a combo', '#888', false, now)
    else if (shape && c) this.note(side, 'Fizzle', `${chargeInfo(c.el).name} can't use ${FORMS[shape] ?? shape}`, '#888', false, now)
    this.fizzle(side, now)
    return null
  }

  /** A stroke too short to count ended (the next stroke starts its own clock). */
  strokeCancelled(side: Fid) {
    this.strokeStart[side] = null
  }

  /** A push toward the camera: throws the readied spell, or, charged with a counter element, a quick
   *  interrupt (no wait: the browser only counts a push that starts after the charge). Returns null
   *  if there was nothing to throw. */
  push(side: Fid, now: number): CastResult | null {
    if (this.winner || this.isOut(side)) return null
    if (this.fizzledUntil[side] > now) {
      this.charge[side] = null // any throw uses up your charge, even one that can't go yet
      return 'fizzled'
    }
    const r = this.ready[side]
    const c = this.charge[side]
    let el: string, shape: string
    if (r) [el, shape] = [r.el, r.shape]
    else if (c && canQuick(c.el)) [el, shape] = [c.el, QUICK]
    else return null
    return this.cast(side, el, shape, now)
  }

  /** `caster` throws a spell (or a counterspell). */
  private cast(caster: Fid, el: string, shape: string, now: number): CastResult {
    if (this.winner || !isValidSpell(el, shape)) return 'invalid'
    if (this.isSilenced(caster, now)) return 'silenced'
    if (this.fizzledUntil[caster] > now) return 'fizzled'
    if (this.staticAt(caster, now) === 'on') {
      // Lightning static: the throw fizzles. The spell and the charge are lost.
      this.float(caster, 'Fizzled (static)', ELEMENTS.L.color, now)
      this.bolt(caster, caster, 'Fizzled', ELEMENTS.L.color, 'fizzle', now, 'L')
      this.note(caster, 'Fizzled (static)', 'Wait for the gap', ELEMENTS.L.color, false, now)
      const st = this.static[caster]
      if (st?.zap) {
        this.by = st.by ?? null
        this.changeHp(caster, -st.zap, COMBO_CHARGES.storm.color, now)
        this.by = null
      }
      this.ready[caster] = null
      this.charge[caster] = null // any throw uses up your charge
      return 'static'
    }
    const target = this.targetOf(caster, el, shape)
    if (!target) return 'invalid' // nobody left to hit
    const color = chargeInfo(el).color
    this.charge[caster] = null // throwing uses up your charge
    this.ready[caster] = null
    this.note(caster, spellName(el, shape), FORMS[shape] ?? '', color, true, now)
    const self = (el === 'H' && shape !== COUNTER) || shape === 'veil' // spells on yourself (Holy, and Shroud); a Holy counterspell flies
    if (this.doomAt[caster]) {
      this.doomAt[caster] = 0
      this.float(caster, 'Doom lifted', ELEMENTS.U.color, now)
    }
    const kind = shape === COUNTER || shape === QUICK ? 'counter' : self ? 'heal' : 'hit'
    const bolt = this.bolt(caster, target, spellName(el, shape), color, kind, now, el, shape)
    // Heals take effect at once; everything else flies across and acts when it lands.
    if (el === 'glacier') bolt.fly = GLACIER_MS // it creeps across, and no parry stops it
    const landAt = self ? now : now + bolt.fly
    if (kind === 'hit' && el !== 'glacier') bolt.parryable = true
    // Steam: an attack thrown from the fog may miss.
    const miss = kind === 'hit' && this.fogUntil[caster] > now && Math.random() < STEAM_MISS
    this.flying.push({ caster, target, el, shape, landAt, bolt, miss })
    this.update(now)
    return 'ok'
  }

  /** A two-hand push: parry the spell about to hit `side`. Returns what happened (null = match over). */
  parry(side: Fid, now: number): 'reflected' | 'ended' | 'missed' | null {
    if (this.winner || this.isOut(side)) return null
    if (this.staggeredUntil[side] > now) return null // still staggered from a missed parry: no spamming
    this.update(now) // anything already due lands first
    // Committing to a parry gives up your own cast: the readied spell and the charge are gone, hit or miss.
    if (this.ready[side] || this.charge[side]) {
      const r = this.ready[side]
      if (r) this.note(side, 'Spell dropped', `${spellName(r.el, r.shape)} lost to the parry`, '#888', false, now)
      this.ready[side] = null
      this.charge[side] = null
      this.strokeStart[side] = null
    }
    // The soonest parryable spell flying at `side`, inside the window.
    const f = this.flying
      .filter((x) => x.target === side && x.caster !== side && x.bolt.parryable && x.landAt - now <= PARRY_WINDOW_MS)
      .sort((a, b) => a.landAt - b.landAt)[0]
    if (!f) {
      this.fizzledUntil[side] = Math.max(this.fizzledUntil[side], now + PARRY_MISS_MS)
      this.staggeredUntil[side] = now + PARRY_MISS_MS
      this.float(side, 'Parry missed', '#999', now)
      this.note(side, 'Parry missed', `staggered ${PARRY_MISS_MS / 1000} s`, '#999', false, now)
      return 'missed'
    }
    this.flying = this.flying.filter((x) => x !== f)
    f.bolt.kind = 'missed'
    f.bolt.parried = true
    const reflects = f.reflects ?? 0
    if (reflects >= REFLECT_POWER.length) {
      this.float(side, 'Parried!', '#7fd8ff', now)
      this.note(side, 'Parried!', `${f.bolt.name} fizzled out`, '#7fd8ff', true, now)
      return 'ended'
    }
    const power = REFLECT_POWER[reflects]
    const back = this.bolt(side, f.caster, f.bolt.name, f.bolt.color, 'hit', now, f.el, f.shape)
    back.parryable = true
    back.power = power
    this.flying.push({ caster: side, target: f.caster, el: f.el, shape: f.shape, landAt: now + back.fly, bolt: back, power, reflects: reflects + 1 })
    this.float(side, 'Reflected!', '#7fd8ff', now)
    this.note(side, 'Reflected!', `${f.bolt.name} sent back at ${Math.round(power * 100)}%`, '#7fd8ff', true, now)
    return 'reflected'
  }

  /** A thrown spell arrives: damage and effects happen now, in time with its impact animation. */
  private land(caster: Fid, target: Fid, el: string, shape: string, now: number, bolt: Bolt) {
    bolt.landed = true
    // Team modes: its target went out while it flew. It goes on to one of their teammates, if any.
    if (this.isOut(target)) {
      const next = this.ids.find((x) => this.team[x] === this.team[target] && !this.isOut(x))
      if (!next) {
        bolt.kind = 'missed'
        return
      }
      target = next
      bolt.to = next
    }
    const color = chargeInfo(el).color


    if (shape === COUNTER || shape === QUICK) {
      // Lands if the target is (still) charged with the element ours beats, however fresh the charge.
      // A counterspell of any element also stops healing: a Heal charge, or an hourglass still ticking.
      // A combo (mixing or locked) needs a combo counterspell whose two elements beat both of its own.
      const c = this.charge[target]
      const mixed = isMixCounter(el)
      const healing = shape === COUNTER && !mixed && (c?.el === 'H' || this.ticking.some((t) => t.side === target && t.amount > 0))
      const caught = mixed ? !!c?.mix && mixBeats(el, c.mix) : !!c && !c.mix && beats(el, c.el)
      // Fire + Ice also shatters any Advancing Glacier the target has on its way.
      let shattered = false
      if (mixed && mixBeats(el, COMBO_MIX.glacier)) {
        const gs = this.flying.filter((f) => f.caster === target && f.el === 'glacier')
        for (const g of gs) {
          g.bolt.kind = 'missed'
          g.bolt.parried = true
        }
        if (gs.length) {
          shattered = true
          this.flying = this.flying.filter((f) => !gs.includes(f))
          this.float(target, 'Glacier shattered!', color, now)
          this.note(target, 'Glacier shattered!', 'Fire + Ice', color, false, now)
        }
      }
      if (caught || healing) {
        // A readied Execute caught by a counterspell (not a quick interrupt) backfires on its caster.
        if (shape === COUNTER && this.ready[target]?.shape === 'blade') {
          const back = Math.round(this.executeDmg(target) / 2)
          this.hit(target, back, ELEMENTS.U.color, now)
          this.note(target, 'Execute backfired!', `took ${back}`, ELEMENTS.U.color, false, now)
        }
        this.ticking = this.ticking.filter((t) => !(t.side === target && t.amount > 0))
        this.silence(target, shape === COUNTER ? COUNTER_SILENCE_MS : QUICK_SILENCE_MS, now)
        this.float(target, 'Interrupted!', color, now)
        this.note(target, 'Interrupted!', `silenced for ${(shape === COUNTER ? COUNTER_SILENCE_MS : QUICK_SILENCE_MS) / 1000} s`, color, false, now)
      } else if (!shattered) {
        bolt.kind = 'missed'
        this.float(caster, 'Counter missed', '#999', now)
      }
      return
    }

    if (this.pendingMiss) {
      bolt.kind = 'missed'
      this.float(target, 'Missed (steam)', COMBO_CHARGES.steam.color, now)
      return
    }

    if (el === 'H') {
      // Grave: no Holy spell works on them (heals, Aegis, Mirror).
      if (this.noHealUntil[target] > now) {
        this.float(target, 'Holy blocked (Grave)', COMBO_CHARGES.grave.color, now)
        return
      }
      // On yourself, or (team modes) on a teammate.
      if (shape === 'star') this.changeHp(target, HEAL, color, now)
      else if (shape === 'hourglass') this.ticking.push({ side: target, by: caster, amount: REGEN.amount, left: REGEN.ticks, next: now, color })
      else if (shape === 'aegis') {
        // Armor doesn't stack or refresh: a new Aegis only takes once the old armor is gone.
        if (this.armor(target, now) > 0) this.float(target, 'Armor still up', color, now)
        else {
          this.shield[target] = { hp: AEGIS_HP, at: now }
          this.float(target, 'Aegis', color, now)
        }
      } else if (shape === 'mirror') {
        this.mirrorUntil[target] = now + MIRROR_MS
        this.float(target, 'Mirror', color, now)
      }
      return
    }

    if (shape === 'veil') {
      this.shroudUntil[caster] = now + SHROUD_MS
      this.float(caster, 'Shrouded', color, now)
      return
    }

    // Mirror: a spell that hits directly turns around and flies back at its caster.
    const direct = !(el === 'U' && shape === 'scythe')
    if (direct && this.mirrorUntil[target] > now) {
      this.mirrorUntil[target] = 0
      this.float(target, 'Reflected!', ELEMENTS.H.color, now)
      this.note(target, 'Reflected!', `${spellName(el, shape)} sent back`, ELEMENTS.H.color, true, now)
      const back = this.bolt(target, caster, spellName(el, shape), color, 'hit', now, el, shape)
      this.flying.push({ caster: target, target: caster, el, shape, landAt: now + back.fly, bolt: back })
      bolt.kind = 'missed'
      return
    }

    if (el === 'U') {
      if (shape === 'scythe') {
        this.doomAt[target] = now + DOOM_MS
        this.doomBy[target] = caster
        this.float(target, 'Doomed!', color, now)
        this.note(target, 'Doomed!', `throw a spell within ${DOOM_MS / 1000} s`, color, false, now)
      } else if (shape === 'blade') {
        this.hit(target, this.executeDmg(target), color, now)
      }
      return
    }

    if (el in COMBO_CHARGES) {
      this.combo(caster, target, el, color, now)
      return
    }

    const p = PUNCHES.indexOf(shape)
    if (p === 0 || p === 1) {
      // An attack (light or heavy): element damage, plus the element's on-hit effect.
      const dealt = this.hit(target, PUNCH[el][p], color, now)
      if (el === 'F') this.burn(target, BURN[p], 3, color, now)
      if (el === 'W') this.changeHp(caster, Math.floor(dealt / 2), color, now)
      if (el === 'I') this.chillOn(target, CHILL[p], now)
      // Static doesn't chain: a hit while it's still running does damage but doesn't restart it.
      if (el === 'L' && !this.staticAt(target, now)) this.static[target] = { start: now, ...PUNCH_STATIC, count: STATIC_PULSES[p] }
      return
    }

    // Signatures.
    switch (shape) {
      case 'flame': // Meteor: the biggest total damage
        this.hit(target, 32, color, now)
        this.burn(target, 18, 5, color, now)
        break
      case 'cage': // Frozen Prison: a short silence on any element
        this.hit(target, 20, color, now)
        this.silence(target, PRISON_SILENCE_MS, now)
        this.chillOn(target, PRISON_CHILL, now) // and chilled
        this.float(target, 'Frozen!', color, now)
        break
      case 'zigzag7': // Thunderbolt: a long, tight static rhythm
        this.hit(target, 22, color, now)
        if (!this.staticAt(target, now)) this.static[target] = { start: now, ...THUNDERBOLT_STATIC }
        break
      case 'battlements': // Earthquake: huge hit, knocks their charge off
        this.hit(target, 38, color, now)
        this.charge[target] = null
        this.ready[target] = null
        this.knocked[target]++
        this.note(target, 'Knocked down!', 'Earthquake: re-sign your element', color, false, now)
        this.float(target, 'Knocked down!', color, now)
        break
      case 'spiral': // Tidal Wave: big hit, big heal
        this.hit(target, 25, color, now)
        this.changeHp(caster, 22, color, now)
        break
    }
  }

  /** A combo lands (plans/combos.md). */
  private combo(caster: Fid, target: Fid, el: string, color: string, now: number) {
    switch (el) {
      case 'magma': // a big hit and a long burn
        this.hit(target, MAGMA[0], color, now)
        this.burn(target, MAGMA[1], 10, color, now)
        break
      case 'storm': // 5 s of damaging static; a throw in a pulse fizzles and gets zapped
        this.hit(target, STORM.hit, color, now)
        this.static[target] = { start: now, on: 250, off: 600, count: STORM.count, dmg: STORM.pulse, zap: STORM.zap, hits: 0, by: caster }
        this.float(target, 'Storm!', color, now)
        break
      case 'glacier': // it took GLACIER_MS to get here
        this.hit(target, GLACIER_DMG, color, now)
        this.float(target, 'Crushed!', color, now)
        break
      case 'twilight': // you take less, they take more
        this.guardUntil[caster] = now + TWILIGHT_MS
        this.exposedUntil[target] = now + TWILIGHT_MS
        this.float(target, 'Exposed!', color, now)
        this.float(caster, 'Guarded', color, now)
        break
      case 'steam': // fog: their attacks may miss
        this.hit(target, STEAM_HIT, color, now)
        this.fogUntil[target] = now + STEAM_MS
        this.float(target, 'Fogged!', color, now)
        break
      case 'thermal': {
        // Hot and cold at once: a hit, then a burn and a chill.
        this.hit(target, THERMAL.hit, color, now)
        this.burn(target, THERMAL.burn, 4, color, now)
        this.chillOn(target, THERMAL.chill, now)
        break
      }
      case 'plasma': // a burning stun
        this.hit(target, PLASMA.hit, color, now)
        this.burn(target, PLASMA.burn, 4, color, now)
        this.silence(target, PLASMA.stun, now)
        this.float(target, 'Stunned!', color, now)
        break
      case 'sunfire': // a long burn that heals you
        this.hit(target, SUNFIRE[0], color, now)
        this.burn(target, SUNFIRE[1], 12, color, now, true)
        break
      case 'grave': // no healing for a while
        this.hit(target, GRAVE.hit, color, now)
        this.noHealUntil[target] = now + GRAVE.ms
        this.float(target, 'No healing!', color, now)
        break
    }
  }

  /** Split `total` damage over `ticks` ticks (every TICK_MS, starting on the next tick). */
  private burn(target: Fid, total: number, ticks: number, color: string, now: number, leech = false) {
    total = Math.round(total * this.landScale)
    // Whole numbers that add up exactly (e.g. 4 over 3 ticks = 2, 1, 1).
    for (let k = 0; k < ticks; k++) {
      const amount = Math.floor(total / ticks) + (k < total % ticks ? 1 : 0)
      this.ticking.push({ side: target, by: this.by ?? target, amount: -amount, left: 1, next: now + TICK_MS * (k + 1), color, leech })
    }
  }

  /** `side` gives up: the other side wins. */
  forfeit(side: Fid) {
    if (!this.winner) this.winner = other(this.team[side])
  }

  /** Team modes: `id` left the match for good. They're out; their team fights on (and loses if nobody's left). */
  leave(id: Fid, now: number) {
    if (this.winner || this.isOut(id) || !(id in this.hp)) return
    this.hp[id] = 0
    this.knockOut(id, now)
  }

  /** Pause support: push every running timer `ms` into the future. */
  shift(ms: number) {
    for (const s of this.ids) {
      if (this.silencedUntil[s]) this.silencedUntil[s] += ms
      this.fizzledUntil[s] += ms
      this.staggeredUntil[s] += ms
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
      const sh = this.shield[s]
      if (sh) sh.at += ms
      if (this.mirrorUntil[s]) this.mirrorUntil[s] += ms
      if (this.doomAt[s]) this.doomAt[s] += ms
      if (this.shroudUntil[s]) this.shroudUntil[s] += ms
      for (const t of [this.guardUntil, this.exposedUntil, this.fogUntil, this.noHealUntil]) if (t[s]) t[s] += ms
    }
    for (const t of this.ticking) t.next += ms
    for (const f of this.flying) f.landAt += ms
  }

  /** Advance damage/heal over time. */
  update(now: number) {
    for (const s of this.ids) {
      const r = this.ready[s]
      if (r && now - r.at > READY_LIFE_MS) {
        this.ready[s] = null
        this.note(s, 'Fizzle', `${spellName(r.el, r.shape)} faded (no push)`, '#888', false, now)
        this.fizzle(s, now)
      }
      if (this.doomAt[s] && now >= this.doomAt[s] && !this.winner) {
        this.doomAt[s] = 0
        this.note(s, 'Doom!', `no spell thrown in ${DOOM_MS / 1000} s`, ELEMENTS.U.color, false, now)
        this.by = this.doomBy[s] ?? null
        this.hit(s, DOOM_DMG, ELEMENTS.U.color, now)
        this.by = null
      }
      if (this.shield[s] && this.armor(s, now) < 1) this.shield[s] = null
      // Storm: each pulse hurts as it starts.
      const st = this.static[s]
      if (st?.dmg && now >= st.start) {
        const due = Math.min(st.count, Math.floor((now - st.start) / (st.on + st.off)) + 1)
        while ((st.hits ?? 0) < due && !this.winner) {
          st.hits = (st.hits ?? 0) + 1
          this.by = st.by ?? null
          this.changeHp(s, -st.dmg, COMBO_CHARGES.storm.color, now)
          this.by = null
        }
      }
    }
    // Spells land in arrival order (a fast punch can beat a slow signature thrown earlier);
    // a finished match drops whatever is still in the air.
    this.flying.sort((x, y) => x.landAt - y.landAt)
    while (this.flying.length && this.flying[0].landAt <= now && !this.winner) {
      const f = this.flying.shift()!
      this.landScale = f.power ?? 1
      this.by = f.caster
      this.pendingMiss = !!f.miss
      this.land(f.caster, f.target, f.el, f.shape, f.landAt, f.bolt)
      this.pendingMiss = false
      this.by = null
      this.landScale = 1
    }
    if (this.winner) this.flying = []
    for (const t of this.ticking) {
      while (t.left > 0 && now >= t.next && !this.winner) {
        this.by = t.by
        const dealt = this.changeHp(t.side, Math.round(t.amount), t.color, now)
        this.by = null
        if (t.leech && dealt > 0) this.changeHp(t.by, dealt, t.color, now)
        t.left--
        t.next += TICK_MS
      }
    }
    this.ticking = this.ticking.filter((t) => t.left > 0 && !this.winner)
    this.floats = this.floats.filter((f) => now - f.t < 1200)
    this.notes = this.notes.filter((n) => now - n.t < 2000)
    this.bolts = this.bolts.filter((b) => now - b.t < b.fly + 2000) // its flight (5 s for a Glacier), then the impact
  }

  view(now: number): CombatView {
    const chill = (s: Fid) => {
      const c = this.chill[s]
      return c && c.until > now ? Math.round(c.pct * 100) : 0
    }
    const tick = (s: Fid, sign: number) => this.ticking.some((t) => t.side === s && t.left > 0 && Math.sign(t.amount) === sign)
    const per = <T,>(fn: (s: Fid) => T): Record<Fid, T> => Object.fromEntries(this.ids.map((s) => [s, fn(s)]))
    return {
      fighters: this.fighters.map((f) => ({ ...f })),
      aim: { ...this.aimAt },
      hp: { ...this.hp },
      maxHp: { ...this.maxHp },
      silenced: per((s) => Math.max(0, this.silencedUntil[s] - now)),
      static: per((s) => this.staticAt(s, now)),
      chill: per(chill),
      burning: per((s) => tick(s, -1)),
      regen: per((s) => tick(s, 1)),
      knocked: { ...this.knocked },
      charge: per((s) => this.charge[s]?.el ?? null),
      mix: per((s) => [...(this.charge[s]?.mix ?? [])]),
      ready: per((s) => {
        const r = this.ready[s]
        return r && { el: r.el, shape: r.shape }
      }),
      fizzled: per((s) => Math.max(0, this.fizzledUntil[s] - now)),
      staggered: per((s) => Math.max(0, (this.staggeredUntil[s] ?? 0) - now)),
      shield: per((s) => Math.round(this.armor(s, now))),
      mirror: per((s) => Math.max(0, this.mirrorUntil[s] - now)),
      doom: per((s) => (this.doomAt[s] ? Math.max(0, this.doomAt[s] - now) : 0)),
      shroud: per((s) => Math.max(0, this.shroudUntil[s] - now)),
      guard: per((s) => Math.max(0, this.guardUntil[s] - now)),
      exposed: per((s) => Math.max(0, this.exposedUntil[s] - now)),
      fog: per((s) => Math.max(0, this.fogUntil[s] - now)),
      noHeal: per((s) => Math.max(0, this.noHealUntil[s] - now)),
      storm: per((s) => !!this.static[s]?.dmg && this.staticAt(s, now) !== null),
      glacier: per((s) => {
        const g = this.flying.filter((f) => f.target === s && f.el === 'glacier').map((f) => f.landAt - now)
        return g.length ? Math.max(0, Math.min(...g)) : 0
      }),
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
  const f = <T,>(r: Record<Fid, T>) => ({ player: r.enemy, enemy: r.player })
  const o = (id: Fid) => (id === 'player' ? 'enemy' : id === 'enemy' ? 'player' : id)
  return {
    fighters: [...v.fighters].reverse().map((x) => ({ ...x, id: o(x.id), team: other(x.team) })),
    aim: { player: v.aim.enemy && o(v.aim.enemy), enemy: v.aim.player && o(v.aim.player) },
    hp: f(v.hp),
    maxHp: f(v.maxHp),
    silenced: f(v.silenced),
    static: f(v.static),
    chill: f(v.chill),
    burning: f(v.burning),
    regen: f(v.regen),
    knocked: f(v.knocked),
    charge: f(v.charge),
    mix: f(v.mix),
    ready: f(v.ready),
    fizzled: f(v.fizzled),
    staggered: f(v.staggered),
    shield: f(v.shield),
    mirror: f(v.mirror),
    doom: f(v.doom),
    shroud: f(v.shroud),
    guard: f(v.guard),
    exposed: f(v.exposed),
    fog: f(v.fog),
    noHeal: f(v.noHeal),
    glacier: f(v.glacier),
    storm: f(v.storm),
    notes: v.notes.map((n) => ({ ...n, side: o(n.side) })),
    dealt: f(v.dealt),
    floats: v.floats.map((x) => ({ ...x, side: o(x.side) })),
    bolts: v.bolts.map((b) => ({ ...b, from: other(b.from), by: o(b.by), to: o(b.to) })),
    over: v.over && other(v.over),
  }
}

