// Arenas: what the Spells page fights in. Practice = an AI enemy in the browser; online = a real
// opponent through the server (online.ts). Both give the page the same Snapshot to draw.
import { Combat, FIZZLE_LOCK_MS, MAX_HP, type CombatView } from './combat'
import { BEATS, canQuick, chargeInfo, COMBOS_ON, COMBO_MIX, COMBO_SHAPE, COUNTER, QUICK, SIGNATURE, mixCounter, signsFor, spellName } from './spells'
import { samplePath } from './shapePaths'
import { spiralPoints } from './shapes'

export type { Side } from './combat'

export interface Pt01 {
  x: number
  y: number
}

/** The opponent's spell in progress, as you see it. */
export interface OppCast {
  el: string
  name: string | null // known once their spell is ready
  color: string
  phase: 'charge' | 'draw' | 'ready'
  points: Pt01[] // their drawing so far, as fractions of `view`
  // The box the points are in: a player's visible camera view (width / height), shown filling your
  // panel the way their camera filled theirs ('cover'); the AI's square box, shown whole ('contain').
  view: { aspect: number; fit: 'cover' | 'contain' }
  progress: number | null // 0..1 through the cast (AI only: a real player has no fixed timing)
}

export interface Snapshot extends CombatView {
  enemyCast: OppCast | null
  running: boolean
  hint?: string | null // practice intro bots: the element that counters what it's charging
}

export interface Arena {
  update(now: number): Snapshot
  /** What your browser recognized. The fight's rules (combat.ts) decide what it does; online,
   *  that happens on the server only. */
  sign(el: string): void // a held letter that is an element
  stroke(points: Pt01[], aspect: number): void // points added since the last call: fractions of your visible (mirrored) view, which is `aspect` wide / tall
  drew(shape: string | null): void // a finished stroke, as recognized (null = not a spell shape)
  cleared(): void // a stroke too short to count
  push(): void // a push toward the camera
  parry(): void // both hands pushed at once
  uncharge(): void // an open hand held while charged, nothing drawn: drop the charge
  reset?(): void // training dummy: start over
  aim?(target: string | null): void // team fights: who your next throw goes to (null = your default target)
}

// ---- Practice: AI enemy --------------------------------------------------------------------
// It casts like a player, slowed down so you can read it: charge (element shown), draw (shape
// traces itself), ready, throw. Difficulty sets its speed, when it heals, and whether it
// reacts to your charge with a counter.
export type Difficulty = 'pebble' | 'ember' | 'frost' | 'cleric' | 'hexer' | 'tide' | 'zealot' | 'warden' | 'adept' | 'magus' | 'archmage' | 'lich' | 'ascendant'

interface AiStyle {
  every: number // ms between casts
  speed: number // multiplies charge/draw times (lower = faster)
  ramp: boolean // gets a little faster as the fight goes on
  healBelow: number // heals when its HP is under this share
  react: number // chance it tries to counter a charge of yours
  reactMs: [number, number] // how long it takes to notice and start (min, max)
  circle: number // share of counters that are full counterspells (the rest are quick interrupts)
  miss: number // share of counters that are mistakes (wrong element; vs a heal, a quick interrupt that can't stop it)
  capitalize: boolean // punishes a silence at once (biggest spell that's out before it ends); fast spells when you're low
  reroll: number // ms between extra counter rolls while you keep charging (0 = one roll only); long heavies get rolled again
  spamCounter: number // chance it counters the same element charged spamAt times in a row (even easy punishes mashing)
  spamAt?: number // how many in a row (counting the one you're charging now) count as spam (default 3)
  stun: number // chance its next attack is a stopper (Frozen Prison, Earthquake, Lightning) once you've
  // landed 2+ throws in a row while repeating yourself
  read: number // how well it reads you (0 = not at all, 1 = fully): same element 3x in a row, and light/heavy
  // patterns in your last throws (repeats, alternating, a 3-step loop). Scales how hard it leans on a guess.
  heal: number // chance it counters a heal of yours (a heal is never a surprise, so higher than react)
  dodge: number // chance it abandons its unfinished spell when you're set to counter it (once per spell)
  healPunish: boolean // a second heal soon after the first: sometimes it ignores the heal and hits you hard instead
  drop: number // chance it abandons its own half-drawn spell to counter you (else it finishes, then counters)
  utility: number // chance a cast is a Holy buff, an Unholy curse or a combo (when one fits)
  smart: number // 0..1: how far it leans on Holy/Unholy tactics (Aegis vs your wind-ups, Shroud setups, armor play, blind guesses)
  // Intro bots (the ladder's first rungs) limit what it knows:
  els?: string[] // elements it attacks with (default all 5)
  moves?: Record<string, number> // attack weights over line / h / signature (default ENEMY_MOVES)
  order?: 'alternate' | 'fresh' // alternate: cycles its elements; fresh: random, never the same twice in a row
  magic?: string[] // Holy/Unholy spells it may cast (default all); heals come from healBelow
  hintMs?: number // shows the counter for its charge after this long (undefined = never)
  // Combos (plans/ai-combos.md):
  combos?: string[] // combos it casts
  comboRate?: number // chance a cast is one of them
  comboCounter?: number // chance it answers your locked combo (and your Glacier) with a combo counterspell
}
const ALL_COMBOS = Object.keys(COMBO_SHAPE)
const ALL_MAGIC = ['aegis', 'scythe', 'veil', 'blade']
const UNHOLY_MAGIC = ['scythe', 'veil', 'blade']
// Intro bots: slow, simple scripts that never read you. Each rung adds one new thing.
const BOT = { ramp: false, healBelow: 0, react: 0, reactMs: [1500, 2000] as [number, number], circle: 0, miss: 0, capitalize: false, reroll: 0, spamCounter: 0, stun: 0, read: 0, heal: 0, dodge: 0, healPunish: false, drop: 0, utility: 0, smart: 0, magic: [] as string[] }
const LIGHT_HEAVY = { line: 50, h: 50 }
// Adept and up: each level is faster and thinks quicker; Magus and up punish a silence, read your
// habits, and sometimes drop their own half-drawn spell to counter you.
export const AI: Record<Difficulty, AiStyle> = {
  pebble: { ...BOT, every: 4000, speed: 1.4, els: ['E', 'W'], moves: { h: 1 }, order: 'alternate' },
  ember: { ...BOT, every: 3500, speed: 1.3, els: ['F', 'L'], moves: LIGHT_HEAVY, order: 'fresh' },
  frost: { ...BOT, every: 3200, speed: 1.25, els: ['I', 'F'], moves: LIGHT_HEAVY, react: 0.15, combos: ['thermal'], comboRate: 0.12 },
  cleric: { ...BOT, every: 3200, speed: 1.25, els: ['W'], moves: LIGHT_HEAVY, healBelow: 0.7, magic: ['aegis'], utility: 0.15, smart: 0.3 },
  hexer: { ...BOT, every: 3000, speed: 1.2, els: ['E'], moves: LIGHT_HEAVY, magic: UNHOLY_MAGIC, utility: 0.35, smart: 0.3, react: 0.15, reactMs: [1400, 1900], combos: ['grave'], comboRate: 0.12 },
  tide: { ...BOT, every: 2800, speed: 1.15, els: ['W', 'I', 'L'], healBelow: 0.3, react: 0.25, reactMs: [1300, 1800], circle: 0.3, spamCounter: 0.3, combos: ['storm'], comboRate: 0.15 },
  zealot: { ...BOT, every: 2600, speed: 1.1, els: ['F'], moves: LIGHT_HEAVY, magic: ALL_MAGIC, utility: 0.4, smart: 0.4, healBelow: 0.35, react: 0.25, reactMs: [1300, 1800], circle: 0.3, combos: ['sunfire', 'twilight'], comboRate: 0.15 },
  warden: { ...BOT, every: 2600, speed: 1.1, healBelow: 0.25, spamCounter: 0.3, stun: 0.15, magic: ALL_MAGIC, utility: 0.03, smart: 0.15, combos: ['magma', 'glacier'], comboRate: 0.12 },
  adept: { spamAt: 4, every: 2354, speed: 1.049, ramp: false, healBelow: 0.25, react: 0, reactMs: [1295, 1766], circle: 0.2, miss: 0, capitalize: false, reroll: 0, spamCounter: 0.6, stun: 0.27, read: 0, heal: 0, dodge: 0, healPunish: false, drop: 0, utility: 0.05, smart: 0.15, combos: ['magma', 'steam'], comboRate: 0.1 },
  magus: { spamAt: 3, every: 1950, speed: 0.94, ramp: false, healBelow: 0.3, react: 0.2, reactMs: [1150, 1550], circle: 0.3, miss: 0.15, capitalize: true, reroll: 0, spamCounter: 0.6, stun: 0.32, read: 0.3, heal: 0.4, dodge: 0, healPunish: false, drop: 0.05, utility: 0.1, smart: 0.4, combos: ['magma', 'steam', 'storm', 'sunfire'], comboRate: 0.12, comboCounter: 0.2 },
  archmage: { spamAt: 3, every: 1600, speed: 0.84, ramp: true, healBelow: 0.35, react: 0.35, reactMs: [1000, 1350], circle: 0.4, miss: 0.12, capitalize: true, reroll: 2000, spamCounter: 0.72, stun: 0.4, read: 0.55, heal: 0.6, dodge: 0.12, healPunish: false, drop: 0.15, utility: 0.2, smart: 0.7, combos: ALL_COMBOS.filter((c) => c !== 'glacier'), comboRate: 0.15, comboCounter: 0.5 },
  lich: { spamAt: 3, every: 1300, speed: 0.74, ramp: true, healBelow: 0.4, react: 0.5, reactMs: [850, 1150], circle: 0.5, miss: 0.06, capitalize: true, reroll: 1600, spamCounter: 0.8, stun: 0.5, read: 0.85, heal: 0.78, dodge: 0.3, healPunish: true, drop: 0.3, utility: 0.26, smart: 1, combos: ALL_COMBOS, comboRate: 0.18, comboCounter: 0.8 },
  // The finale: the whole kit, used on purpose, no mistakes. A step above Lich in every number.
  ascendant: { spamAt: 3, every: 1100, speed: 0.65, ramp: true, healBelow: 0.4, react: 0.6, reactMs: [750, 950], circle: 0.6, miss: 0, capitalize: true, reroll: 1400, spamCounter: 0.85, stun: 0.55, read: 1, heal: 0.85, dodge: 0.36, healPunish: true, drop: 0.36, utility: 0.3, smart: 1, combos: ALL_COMBOS, comboRate: 0.24, comboCounter: 1 },
}
/** The practice ladder, in order. */
export const LADDER: { id: Difficulty; name: string }[] = [
  { id: 'pebble', name: 'Pebble' },
  { id: 'ember', name: 'Ember' },
  { id: 'frost', name: 'Frost' },
  { id: 'cleric', name: 'Cleric' },
  { id: 'hexer', name: 'Hexer' },
  { id: 'tide', name: 'Tide' },
  { id: 'zealot', name: 'Zealot' },
  { id: 'warden', name: 'Warden' },
  { id: 'adept', name: 'Adept' },
  { id: 'magus', name: 'Magus' },
  { id: 'archmage', name: 'Archmage' },
  { id: 'lich', name: 'Lich' },
  { id: 'ascendant', name: 'Ascendant' },
]
const ENEMY_JITTER = 0.2 // +/- share of the gap between casts
const CHARGE_MS = 700
const READY_MS = 500
const COUNTER_READY_MS = 80 // a counter is thrown the moment it's drawn (no waiting around)
const COUNTER_HOLD_MS = 350 // a counter's charge before it throws, at speed 1 (never under the letter hold)
// Punishing a silence: its spell must be out before you can react once the silence ends
// (sign a counter SIGN_HOLD_MS + push + the counter's flight).
const SIGN_HOLD_MS = 50 // holding a letter this long signs it (same as the player)
const LETTER_GAP_MS = 100 // the fastest it may sign one letter after another (a combo's C, then its two letters)
const PUNISH_SLACK_MS = 300
// How long the AI takes to draw each shape: longer shapes take longer, so they're easier to counter.
const DRAW_MS: Record<string, number> = {
  line: 600,
  h: 1800,
  star: 1800,
  hourglass: 1800,
  flame: 2500,
  cage: 2000,
  zigzag7: 2200,
  battlements: 2400,
  spiral: 2200,
  circle: 700,
  jab: 0,
  aegis: 2000,
  mirror: 1800,
  scythe: 1800,
  veil: 2000,
  blade: 2400,
  volcano: 2500,
  cloud: 2400,
  iceberg: 2600,
  yinyang: 2700,
  puff: 2500,
  thermo: 2600,
  plasma: 2600,
  sun: 2900,
  tomb: 2600,
}
const ENEMY_ELEMENTS = ['F', 'I', 'W', 'E', 'L']
// What it attacks with (weights). Same rules as the player, so reading the shape tells you what's coming.
const ENEMY_MOVES: { shape: string; w: number }[] = [
  { shape: 'line', w: 40 },
  { shape: 'h', w: 30 },
  { shape: 'signature', w: 14 },
]
/** The element that beats `el` (BEATS maps winner to loser). */
// What it throws to break up a stream of light attacks: things that stop or stall you.
const ANTI_LIGHT: [string, string][] = [['I', 'cage'], ['E', 'battlements'], ['L', 'zigzag7'], ['L', 'line'], ['L', 'h']]
const lerp = (a: number, b: number, t: number) => a + (b - a) * t
const kindOf = (shape: string) => (shape === 'line' || shape === QUICK ? 'L' : 'H') // light or heavy

/** Guess your next throw (light 'L' or heavy 'H') from the last few. Short patterns only:
 *  the same twice, alternating (LHLH), or a 3-step loop (LLH LLH). Anything longer is just noise. */
function predict(m: string[]): string | null {
  const n = m.length
  const at = (k: number) => m[n - k]
  if (n >= 6 && at(6) === at(3) && at(5) === at(2) && at(4) === at(1) && !(at(1) === at(2) && at(2) === at(3))) return at(3)
  if (n >= 4 && at(1) !== at(2) && at(1) === at(3) && at(2) === at(4)) return at(2)
  if (n >= 2 && at(1) === at(2)) return at(1)
  return null
}
export const beaterOf = (el: string) => Object.keys(BEATS).find((k) => BEATS[k] === el)!

/** Corner points (any box; fitted to 0..1 later) for the straight-line shapes, in drawing order. */
const SHAPE_CORNERS: Record<string, [number, number][]> = {
  line: [[0.15, 0.85], [0.85, 0.15]],
  h: [[0.2, 0.12], [0.2, 0.88], [0.2, 0.5], [0.8, 0.5], [0.8, 0.12], [0.8, 0.88]],
  hourglass: [[0.2, 0.12], [0.8, 0.12], [0.2, 0.88], [0.8, 0.88], [0.2, 0.12]],
  star: Array.from({ length: 6 }, (_, k): [number, number] => {
    const a = -Math.PI / 2 + (k * 4 * Math.PI) / 5
    return [0.5 + 0.4 * Math.cos(a), 0.52 + 0.4 * Math.sin(a)]
  }),
  cage: [[0, 0], [1, 0], [1, 1], [0, 1], [0, 0], [1, 1], [1, 0], [0, 1]],
  zigzag7: [0, 1, 0.25, 1, 0.25, 1, 0.25, 1].map((y, i): [number, number] => [i / 7, y]),
  battlements: [[0, 1], [0, 0.45], [0.2, 0.45], [0.2, 1], [0.4, 1], [0.4, 0.45], [0.6, 0.45], [0.6, 1], [0.8, 1], [0.8, 0.45], [1, 0.45], [1, 1]],
}

/** The shape's path in drawing order, fitted into the 0..1 box (keeping its proportions). */
function rawShape(shape: string): Pt01[] {
  if (shape === 'spiral') return spiralPoints()
  if (shape === 'circle') {
    const pts: Pt01[] = []
    for (let i = 0; i <= 48; i++) pts.push({ x: Math.cos(-Math.PI / 2 + (2 * Math.PI * i) / 48), y: Math.sin(-Math.PI / 2 + (2 * Math.PI * i) / 48) })
    return pts
  }
  const c = SHAPE_CORNERS[shape]
  if (!c) return samplePath(shape) // Holy, Unholy and combo shapes: along their guide path
  const pts: Pt01[] = []
  for (let i = 1; i < c.length; i++)
    for (let k = 0; k < 16; k++) {
      const t = k / 16
      pts.push({ x: c[i - 1][0] + t * (c[i][0] - c[i - 1][0]), y: c[i - 1][1] + t * (c[i][1] - c[i - 1][1]) })
    }
  const [x, y] = c[c.length - 1]
  pts.push({ x, y })
  return pts
}

export function shapePoints(shape: string): Pt01[] {
  const raw = rawShape(shape)
  const xs = raw.map((p) => p.x)
  const ys = raw.map((p) => p.y)
  const [x0, y0] = [Math.min(...xs), Math.min(...ys)]
  const size = Math.max(Math.max(...xs) - x0, Math.max(...ys) - y0) || 1
  const [ox, oy] = [(1 - (Math.max(...xs) - x0) / size) / 2, (1 - (Math.max(...ys) - y0) / size) / 2]
  // A little hand wobble, so it looks drawn rather than printed.
  let dx = 0
  let dy = 0
  return raw.map((p) => {
    dx = 0.8 * dx + (Math.random() - 0.5) * 0.012
    dy = 0.8 * dy + (Math.random() - 0.5) * 0.012
    return { x: 0.1 + 0.8 * ((p.x - x0) / size + ox) + dx, y: 0.1 + 0.8 * ((p.y - y0) / size + oy) + dy }
  })
}

function pick<T>(items: { w: number; v: T }[]) {
  let r = Math.random() * items.reduce((t, m) => t + m.w, 0)
  return (items.find((m) => (r -= m.w) < 0) ?? items[0]).v
}

export function spellOf(el: string, shape: string, speed: number, chargeMs = CHARGE_MS * speed) {
  // Every letter takes at least LETTER_GAP_MS to sign, like a player's: a combo (C + two letters) can't be signed in an instant.
  chargeMs = Math.max(chargeMs, signsFor(el).length * LETTER_GAP_MS)
  const drawMs = DRAW_MS[shape] * speed
  // Placed like a player's drawing on a 16:9 camera frame: centered, kept square, 75% of the height.
  const points = shape === 'jab' ? [] : shapePoints(shape).map((p) => ({ x: 0.5 + (p.x - 0.5) * 0.75 * (9 / 16), y: 0.5 + (p.y - 0.5) * 0.75 }))
  return { el, shape, name: spellName(el, shape), color: chargeInfo(el).color, points, chargeMs, drawMs, readyMs: shape === 'jab' ? 0 : READY_MS * speed }
}

type EnemyCast = ReturnType<typeof spellOf> & {
  start: number
  ends: number
  counter?: boolean
  dodgeRolled?: boolean
  signs?: { at: number; el: string }[] // a combo's mix, signed one letter at a time while charging
}
/** Spells that hit directly (a Mirror would send them back). */
const isDirect = (el: string, shape: string) => el !== 'H' && shape !== 'scythe' && shape !== 'veil' && shape !== COUNTER && shape !== QUICK

export class PracticeArena implements Arena {
  private combat = new Combat()
  private running = false
  private enemy: EnemyCast | null = null
  private nextEnemyAt = 0
  private started = 0
  private style = AI.adept
  private els = ENEMY_ELEMENTS
  private own = [...ENEMY_ELEMENTS, 'H', 'U'] // elements it can counter with
  private magic = ALL_MAGIC
  private elIdx = 0
  private lastEl = ''
  private knockedSeen = 0
  private lastHeal = -Infinity
  private playerCharge: { el: string; since: number; rollAt: number; aegisRolled?: boolean; blindRolled?: boolean } | null = null
  private followBig = false // its Shroud just landed: the next spell leans big (you can't see it coming)
  private waitedArmor = 0 // when it last held back to let your armor drain (insane)
  private reactAt: number | null = null // when it will start a counter against your charge
  private reactTo = ''
  private spam = false // the planned counter is against a spammed element
  private guess: string | null = null // the throw it expects from you next ('L' light, 'H' heavy)
  private switchTo: { el: string; at: number } | null = null // a dodge: the element it's about to sign (after the letter hold)
  private playerStrokeAt: number | null = null // when your current stroke started
  private baits = 0 // times you threatened a counter, it dodged, and you never threw one (each halves its dodge)
  private baitCheck: number | null = null // after a dodge: if no counter from you by then, that was a bait
  private castTimes: number[] = [] // your last 3 charge-to-throw times (ms)
  private unanswered = 0 // your throws in a row since it last silenced you
  private lastPlayerHeal = -Infinity // when you last threw a heal
  private moves: string[] = [] // your recent throws as light/heavy, newest last
  private history: string[] = [] // your recent charges, newest last
  private lastPlayerSilence = 0 // your silence left, last update (a jump = you were just silenced)
  private lastCombo = '' // never the same combo twice in a row
  private glacierRolled = false // already decided whether to break the Glacier coming at it

  start(now: number, difficulty: Difficulty = 'pebble') {
    this.combat = new Combat()
    this.style = AI[difficulty]
    this.els = this.style.els ?? ENEMY_ELEMENTS
    this.magic = this.style.magic ?? ALL_MAGIC
    this.own = [...this.els, ...(this.magic.includes('aegis') || this.style.healBelow > 0 ? ['H'] : []), ...(this.magic.some((m) => UNHOLY_MAGIC.includes(m)) ? ['U'] : [])]
    this.elIdx = 0
    this.lastEl = ''
    this.knockedSeen = 0
    this.running = true
    this.enemy = null
    this.started = now
    this.nextEnemyAt = now + 3000
    this.lastHeal = -Infinity
    this.playerCharge = null
    this.reactAt = null
    this.lastPlayerSilence = 0
    this.history = []
    this.moves = []
    this.guess = null
    this.lastPlayerHeal = -Infinity
    this.switchTo = null
    this.playerStrokeAt = null
    this.baits = 0
    this.baitCheck = null
    this.unanswered = 0
    this.castTimes = []
    this.followBig = false
    this.waitedArmor = 0
    this.lastCombo = ''
    this.glacierRolled = false
  }

  /** End the match early (no winner). */
  stop() {
    this.running = false
    this.enemy = null
  }

  sign(el: string) {
    this.combat.sign('player', el, performance.now())
  }
  stroke() {
    const now = performance.now()
    this.playerStrokeAt ??= now
    this.combat.drawing('player', now)
  }
  drew(shape: string | null) {
    this.playerStrokeAt = null
    this.combat.drew('player', shape, performance.now())
  }
  cleared() {
    this.playerStrokeAt = null
    this.combat.strokeCancelled('player')
  }
  uncharge() {
    this.combat.uncharge('player')
  }
  parry() {
    if (this.running) this.combat.parry('player', performance.now())
  }
  push() {
    const now = performance.now()
    const v = this.combat.view(now)
    const r = v.ready.player
    if (this.combat.push('player', now) !== 'ok') return
    // Remember attacks as light/heavy (no ready spell = a quick interrupt). Heals and counters don't count.
    const shape = r ? r.shape : v.charge.player ? QUICK : null
    if (r?.el === 'H') this.lastPlayerHeal = now
    if (shape === COUNTER || shape === QUICK) {
      // A real counter: you weren't bluffing, so it trusts the threat a little more again.
      this.baitCheck = null
      this.baits = Math.max(0, this.baits - 1)
    }
    // How long you take from charge to throw (it learns your pace to time its counters).
    if (this.playerCharge && shape && shape !== QUICK) this.castTimes = [...this.castTimes.slice(-2), now - this.playerCharge.since]
    if (shape && shape !== COUNTER && r?.el !== 'H') this.unanswered++
    if (shape && shape !== COUNTER && r?.el !== 'H') this.moves = [...this.moves.slice(-5), kindOf(shape)]
    this.playerCharge = null
    // A regen keeps ticking after the throw, so a counter already planned against it still goes.
    if (!(r?.el === 'H' && r.shape === 'hourglass')) this.reactAt = null
  }

  /** Faster as the fight goes on, then levels off: about 6% faster after 30 s, 9% after a minute, 10% at most. */
  private speed(now: number) {
    const s = this.style
    if (!s.ramp) return s.speed
    return s.speed / (1 + 0.1 * (1 - Math.exp(-(now - this.started) / 30000)))
  }

  /** What to cast next: heal when low, otherwise attack (hard: press an advantage). */
  private nextSpell(now: number, v: CombatView) {
    const s = this.style
    const sp = this.speed(now)
    const hpShare = v.hp.enemy / v.maxHp.enemy
    if (hpShare < s.healBelow && now - this.lastHeal > 6000 && Math.random() < (s.capitalize ? 0.85 : 0.5)) {
      this.lastHeal = now
      return spellOf('H', hpShare < s.healBelow / 2 ? 'star' : 'hourglass', sp)
    }
    const combo = this.comboSpell(now, v, sp)
    if (combo) return combo
    const util = this.utilitySpell(v, sp)
    if (util) return util
    // Its Shroud is up: you can't see this one coming, so it goes big (not on easy).
    if (this.followBig) {
      this.followBig = false
      if (v.shroud.enemy > 0 && s.smart > 0.3 && Math.random() < lerp(0.3, 0.9, s.smart)) {
        const el = this.anyEl()
        return spellOf(el, SIGNATURE[el], sp)
      }
    }
    // Your armor is up: quick light hits wear it down faster than waiting on a big spell.
    if (v.shield.player > 0 && (!s.moves || s.moves.line) && Math.random() < lerp(0.1, 0.6, s.smart)) return spellOf(this.anyEl(), 'line', sp)
    // You're repeating yourself and getting away with it: throw something that stuns you or knocks
    // your charge off (more likely vs light attacks, which are too quick to counter).
    const repeating = predict(this.moves) !== null || predict(this.history) !== null
    const stun = s.stun * (predict(this.moves) === 'L' ? 1.3 : 1)
    if (repeating && this.unanswered >= 2 && Math.random() < stun && !(v.hp.player / v.maxHp.player < 0.2)) {
      const stoppers = ANTI_LIGHT.filter(([el]) => this.els.includes(el))
      if (stoppers.length) {
        const [el, shape] = stoppers[Math.floor(Math.random() * stoppers.length)]
        return spellOf(el, shape, sp)
      }
    }
    const el = this.nextEl()
    const moves = s.moves ? Object.entries(s.moves).map(([v, w]) => ({ w, v })) : ENEMY_MOVES.map((m) => ({ w: m.w, v: m.shape }))
    let shape = pick(moves)
    if (s.capitalize && v.silenced.player > 1200) shape = 'signature' // you can't counter it now
    else if (s.capitalize && v.hp.player / v.maxHp.player < 0.2) shape = 'line' // finish fast
    return spellOf(el, shape === 'signature' ? SIGNATURE[el] : shape, sp)
  }

  /** Any of its attack elements. */
  private anyEl() {
    return this.els[Math.floor(Math.random() * this.els.length)]
  }
  /** Its next attack element: in turn (alternate), never twice in a row (fresh), or any. */
  private nextEl() {
    const o = this.style.order
    let el: string
    if (o === 'alternate') el = this.els[this.elIdx++ % this.els.length]
    else if (o === 'fresh' && this.els.length > 1) {
      const rest = this.els.filter((x) => x !== this.lastEl)
      el = rest[Math.floor(Math.random() * rest.length)]
    } else el = this.anyEl()
    this.lastEl = el
    return el
  }

  /** Intro bots: once it's been charging a while, the element that counters it. */
  private hint(now: number) {
    const e = this.enemy
    const ms = this.style.hintMs
    if (ms === undefined || !e || e.counter || !(e.el in BEATS) || now - e.start < ms) return null
    return beaterOf(e.el)
  }

  /** One of its combos (plans/ai-combos.md). Smart ones pick the one that fits the moment; the intro
   *  bots just throw theirs now and then. Never the same combo twice in a row. */
  private comboSpell(now: number, v: CombatView, sp: number) {
    const s = this.style
    if (!COMBOS_ON || !s.combos?.length || Math.random() >= (s.comboRate ?? 0)) return null
    const youHealed = v.regen.player || now - this.lastPlayerHeal < 3000
    const drawing = this.playerStrokeAt !== null && now - this.playerStrokeAt > 300
    const lights = this.moves.slice(-4).filter((m) => m === 'L').length
    const mine = v.hp.enemy / v.maxHp.enemy
    const fit: Record<string, number> = {
      magma: v.silenced.player > 1200 ? 4 : 1,
      storm: lights >= 3 ? 4 : 1,
      glacier: v.silenced.player > 1000 || drawing ? 3 : 0.6,
      twilight: mine < 0.4 ? 3 : 1,
      steam: this.unanswered >= 3 ? 4 : 1,
      thermal: v.burning.player || v.chill.player > 0 ? 4 : 0.6,
      plasma: drawing ? 4 : 0.8,
      sunfire: mine < 0.7 && mine > s.healBelow ? 3 : 1,
      grave: youHealed ? 5 : 0.3,
    }
    const smart = s.smart >= 0.5
    const opts = s.combos.filter((c) => c !== this.lastCombo || s.combos!.length === 1).map((c) => ({ w: smart ? fit[c] ?? 1 : 1, v: c }))
    if (!opts.length) return null
    const c = pick(opts)
    this.lastCombo = c
    return spellOf(c, COMBO_SHAPE[c], sp)
  }

  /** Holy buffs and Unholy curses, when one fits the moment. */
  private utilitySpell(v: CombatView, sp: number) {
    const s = this.style
    if (v.doom.enemy > 0) return spellOf(this.anyEl(), 'line', sp) // doomed: throw anything, fast
    if (Math.random() >= s.utility) return null
    const low = v.hp.player / v.maxHp.player < 0.4
    const armored = v.shield.player > 0
    const opts: { w: number; v: [string, string] }[] = [
      // Execute: saved for when you're low and your armor is gone (armor would soak it).
      { w: armored ? lerp(0.5, 0, s.smart) : low ? 4 : 0.5, v: ['U', 'blade'] },
      // Doom: its 30 lands as a direct hit, which armor can't stop from being a threat: better vs armor.
      { w: armored ? lerp(1, 4, s.smart) : 1, v: ['U', 'scythe'] },
      { w: v.shroud.enemy > 0 ? 0 : 1, v: ['U', 'veil'] },
      { w: v.shield.enemy > 0 ? 0 : 1, v: ['H', 'aegis'] },
    ]
    const allowed = opts.filter((o) => this.magic.includes(o.v[1]))
    if (!allowed.some((o) => o.w > 0)) return null
    const [el, shape] = pick(allowed)
    return spellOf(el, shape, sp)
  }

  /** Medium/hard: sometimes it notices your charge and counters it (if you're still charged). */
  private react(now: number) {
    const s = this.style
    const pc = this.playerCharge
    if (this.combat.view(now).shroud.player > 0) {
      // Shrouded: it can't see what you're charging. Once per charge it guesses: a counterspell of a
      // random element, or rushing its own spell out first.
      if (pc && !pc.blindRolled && (s.react > 0 || s.capitalize)) {
        pc.blindRolled = true
        const r = Math.random()
        const e = this.enemy
        const busy = !!e && (e.counter || now - e.start >= e.chargeMs)
        if (!busy && r < lerp(0.05, 0.3, s.smart)) {
          const el = this.anyEl()
          const base = spellOf(el, 'circle', this.speed(now))
          this.enemy = { ...base, readyMs: COUNTER_READY_MS, start: now, ends: now + base.chargeMs + base.drawMs + COUNTER_READY_MS, counter: true }
          this.combat.sign('enemy', el, now)
        } else if (!e && r < lerp(0.2, 0.6, s.smart)) this.nextEnemyAt = Math.min(this.nextEnemyAt, now)
      }
      return
    }
    if (pc && this.reactAt === null && now >= pc.rollAt) {
      pc.rollAt = s.reroll ? now + s.reroll : Infinity // still charging later (a long heavy): roll again
      const combo = pc.el in COMBO_MIX
      // heals: any element's counterspell stops them; combos: only a combo counterspell
      const counterable = combo ? !!s.comboCounter : pc.el === 'H' || (pc.el in BEATS && this.own.includes(beaterOf(pc.el)))
      // Spamming: the same element spamAt+ times in a row (counting this one) and it's ready for it.
      const h = this.history
      const n = s.spamAt ?? 3
      const spam = s.spamCounter > 0 && h.length >= n && h.slice(-n).every((x) => x === pc.el)
      // Its guess at what you're about to throw: light means interrupt fast, heavy means circle.
      const healing = pc.el === 'H'
      const guess = s.read && !healing ? predict(this.moves) : null
      // It saw this element coming (your charges follow a pattern): it's already set to counter it.
      const expected = s.read > 0 && !healing && predict(this.history.slice(0, -1)) === pc.el
      // Heals: always worth stopping, and more so when you're low (it expects one then).
      const low = this.combat.view(now).hp.player / MAX_HP < 0.4
      // Healing again soon after the last one: it's waiting for that.
      const again = healing && s.read > 0 && now - this.lastPlayerHeal < 12000
      if (again && s.healPunish && Math.random() < 0.5 && this.punishHeal(now)) return
      const chance = combo
        ? s.comboCounter ?? 0
        : healing
        ? Math.min(1, again ? 0.95 : s.heal + (low ? 0.05 : 0))
        : Math.max(s.react, spam ? s.spamCounter : 0, guess ? lerp(s.react, 0.9, s.read) : 0, expected ? lerp(s.react, 0.8, s.read) : 0)
      if (counterable && Math.random() < chance) {
        const ms = s.reactMs[0] + Math.random() * (s.reactMs[1] - s.reactMs[0])
        const quick = guess === 'L' ? lerp(1, 0.45, s.read) : guess === 'H' ? lerp(1, 0.5, s.read) : 1
        const ready = expected ? lerp(1, 0.6, s.read) : again ? 0.5 : healing && low && s.read ? 0.7 : 1
        this.reactAt = now + ms * Math.min(quick, ready, spam ? lerp(0.8, 0.5, Math.min(1, s.read * 2)) : 1)
        // Expecting it (spam or a pattern) and it knows your pace: react in time to land an interrupt
        // before you throw, but never quicker than 250 ms (no mind-reading).
        if (s.read > 0 && (spam || guess || expected) && this.castTimes.length) {
          const hold = Math.max(SIGN_HOLD_MS, COUNTER_HOLD_MS * this.speed(now))
          const latest = pc.since + Math.min(...this.castTimes) - hold - 160 - 60
          this.reactAt = Math.max(now + 250, Math.min(this.reactAt, latest))
        }
        this.spam = spam
        this.guess = guess
        this.reactTo = pc.el
      }
    }
    if (this.reactAt === null || now < this.reactAt) return
    // Committed: already drawing its own spell. It finishes that, then counters if you're still open.
    const e = this.enemy
    const drop = Math.max(s.drop, this.spam ? 0.75 * Math.min(1, s.read * 2) : 0, this.guess ? 0.7 * s.read : 0)
    if (e && !e.counter && now - e.start >= e.chargeMs && !(now < e.start + e.chargeMs + e.drawMs && Math.random() < drop)) {
      this.reactAt = e.ends + 100
      return
    }
    this.reactAt = null
    // Dropping its own half-drawn spell works like yours: the stroke fizzles (throws locked for a moment).
    const abandoned = !!e && !e.counter && now - e.start >= e.chargeMs
    const healing = this.reactTo === 'H'
    // Only if there's still something to counter: your charge, or (for a heal) a regen ticking.
    if (!(pc?.el === this.reactTo || (healing && this.combat.view(now).regen.player))) return
    // A heal needs the full counterspell (any element); otherwise a quick interrupt or a circle.
    const mistake = Math.random() < s.miss
    const circle = this.guess === 'H' ? lerp(s.circle, 0.95, s.read) : this.guess === 'L' ? 0.1 : this.spam && s.read ? 0.85 : s.circle
    let shape = healing || Math.random() < circle ? 'circle' : 'jab'
    const vsCombo = this.reactTo in COMBO_MIX
    let el = healing ? this.anyEl() : vsCombo ? mixCounter(COMBO_MIX[this.reactTo].map(beaterOf)) : beaterOf(this.reactTo)
    if (vsCombo) shape = 'circle' // a combo counterspell is always a circle
    if (mistake && healing) shape = 'jab' // a quick interrupt doesn't stop a heal
    else if (mistake && vsCombo) el = mixCounter(['W', 'L']) === el ? mixCounter(['F', 'I']) : mixCounter(['W', 'L']) // wrong pair: it misses
    else if (mistake) {
      const wrong = ENEMY_ELEMENTS.filter((x) => x !== el)
      el = wrong[Math.floor(Math.random() * wrong.length)] // wrong element: it misses
    }
    // Too slow to circle before you throw (it knows your pace)? Then a quick interrupt instead.
    const hold = Math.max(SIGN_HOLD_MS, COUNTER_HOLD_MS * this.speed(now))
    // Vs heavies it wants the circle (a 2.5 s silence leaves room for a big punish), and each heavy you
    // throw in a row makes it draw the circle faster: 12% per heavy, down to 55% of normal.
    let streak = 0
    for (let i = this.moves.length - 1; i >= 0 && this.moves[i] === 'H'; i--) streak++
    const circleSpeed = s.read > 0 ? Math.max(0.55, 1 - 0.12 * streak) : 1
    if (this.guess === 'H' && !healing && !mistake && Math.random() < 0.85) shape = 'circle'
    if (shape === 'circle' && !healing && pc && this.castTimes.length) {
      const pace = Math.min(...this.castTimes)
      const circleLands = hold + DRAW_MS.circle * this.speed(now) * circleSpeed + COUNTER_READY_MS + 240
      if (now + circleLands > pc.since + pace) shape = 'jab'
    }
    if (!canQuick(el)) shape = 'circle' // Holy and Unholy have no quick interrupt
    const base = spellOf(el, shape, this.speed(now), hold)
    const sp = { ...base, drawMs: shape === 'circle' && !healing ? base.drawMs * circleSpeed : base.drawMs, readyMs: shape === 'jab' ? 0 : COUNTER_READY_MS }
    if (abandoned) this.combat.drew('enemy', null, now)
    const ends = Math.max(now + sp.chargeMs + sp.drawMs + sp.readyMs, abandoned ? now + FIZZLE_LOCK_MS + 30 : 0)
    this.startCounter(sp, now, ends)
  }

  /** Start a counter: signs its letter (a combo counterspell: C, then its two letters, spread over the charge). */
  private startCounter(sp: ReturnType<typeof spellOf>, now: number, ends: number) {
    const signs = signsFor(sp.el)
    this.enemy = { ...sp, start: now, ends, counter: true, signs: signs.slice(1).map((el, i) => ({ at: now + (sp.chargeMs * (i + 1)) / signs.length, el })) }
    this.combat.sign('enemy', signs[0], now)
  }

  /** Your Advancing Glacier is coming at it: once per Glacier, it may answer with C, F, I and a circle. */
  private breakGlacier(now: number, v: CombatView) {
    if (!v.glacier.enemy) {
      this.glacierRolled = false
      return
    }
    const e = this.enemy
    if (this.glacierRolled || (e && (e.counter || now - e.start >= e.chargeMs))) return
    this.glacierRolled = true
    if (Math.random() >= (this.style.comboCounter ?? 0)) return
    const hold = Math.max(SIGN_HOLD_MS, COUNTER_HOLD_MS * this.speed(now))
    const base = spellOf(mixCounter(['F', 'I']), 'circle', this.speed(now), hold * 2)
    const sp = { ...base, readyMs: COUNTER_READY_MS }
    this.reactAt = null
    this.startCounter(sp, now, now + sp.chargeMs + sp.drawMs + sp.readyMs)
  }

  /** Insane, vs a repeat heal: while you draw it, cast something big instead of countering.
   *  Usually a Thunderbolt (its static makes your throws fizzle). False if it's busy drawing. */
  private punishHeal(now: number) {
    const e = this.enemy
    if (e && (e.counter || now - e.start >= e.chargeMs)) return false
    const [el, shape] = Math.random() < 0.6 ? ['L', 'zigzag7'] : (() => {
      const el = this.anyEl()
      return [el, Math.random() < 0.5 ? SIGNATURE[el] : 'h']
    })()
    const sp = spellOf(el, shape, this.speed(now))
    this.enemy = { ...sp, start: now, ends: now + sp.chargeMs + sp.drawMs + sp.readyMs }
    this.reactAt = null
    this.combat.sign('enemy', el, now)
    return true
  }

  /** Hard/insane: you're set to counter its unfinished spell (charged with the element that beats
   *  it, or a counterspell readied). Once per spell it may dodge the way you would: let the stroke
   *  fizzle and switch to another element, so your counter finds nothing to hit. */
  private dodge(now: number, v: CombatView) {
    const e = this.enemy
    if (!e || e.counter || e.dodgeRolled || !this.style.dodge || now >= e.start + e.chargeMs + e.drawMs) return
    if (v.shroud.player > 0) return // Shrouded: it can't see your threat
    const beater = beaterOf(e.el)
    const r = v.ready.player
    // Only a committed threat counts: a counterspell readied, or charged with the beater AND drawing
    // (a sign alone could be a bluff). A quick interrupt is too fast to dodge; that's its strength.
    const drawing = this.playerStrokeAt !== null && now - this.playerStrokeAt > 150
    const threat = (r?.shape === COUNTER && r.el === beater) || (!r && v.charge.player === beater && drawing)
    if (!threat) return
    // Nearly done: race it out instead of bailing.
    if (e.ends - now < 500) return
    e.dodgeRolled = true
    if (Math.random() >= this.style.dodge * 0.5 ** this.baits) return
    this.baitCheck = now + 2500
    this.enemy = null
    if (now - e.start >= e.chargeMs) this.combat.drew('enemy', null, now) // mid-stroke: it fizzles
    const others = this.els.filter((x) => x !== e.el)
    if (!others.length) return
    // Signing takes the same letter hold as yours.
    this.switchTo = { el: others[Math.floor(Math.random() * others.length)], at: now + SIGN_HOLD_MS }
    this.nextEnemyAt = now + FIZZLE_LOCK_MS + Math.random() * 400 // re-cast once the fizzle lock is over
  }

  /** Hard/insane: you were just silenced. Unless it's already drawing, it casts the biggest spell
   *  that's thrown before you could counter it (silence left + reaction slack). */
  private punish(now: number, silenceLeft: number) {
    const e = this.enemy
    if (e && (e.counter || now - e.start >= e.chargeMs)) return // a counter, or already drawing: let it finish
    const el = this.anyEl()
    const window = silenceLeft + PUNISH_SLACK_MS
    const sp = this.speed(now)
    // Lower tiers don't always go for the biggest spell; it's drawn at its normal pace.
    const shapes = Math.random() < lerp(0.3, 1, this.style.smart) ? [SIGNATURE[el], 'h', 'line'] : ['h', 'line']
    for (const shape of shapes) {
      const s = spellOf(el, shape, sp)
      // Nothing fits (a short interrupt silence): still hit back at once with a light attack.
      if (s.chargeMs + s.drawMs + s.readyMs > window && shape !== 'line') continue
      this.enemy = { ...s, start: now, ends: now + s.chargeMs + s.drawMs + s.readyMs }
      this.reactAt = null
      this.combat.sign('enemy', el, now)
      return
    }
  }

  private enemyView(now: number): OppCast | null {
    const e = this.enemy
    if (!e) return null
    const t = now - e.start
    const phase = t < e.chargeMs ? 'charge' : t < e.chargeMs + e.drawMs ? 'draw' : 'ready'
    const drawn = e.drawMs ? Math.max(0, Math.min(1, (t - e.chargeMs) / e.drawMs)) : 1
    return {
      el: e.el,
      name: phase === 'ready' ? e.name : null,
      color: e.color,
      phase,
      points: e.points.slice(0, Math.max(0, Math.ceil(drawn * e.points.length))),
      view: { aspect: 1, fit: 'contain' },
      progress: t / (e.ends - e.start),
    }
  }

  /** You're winding up something big (drawing a while, or a heavy/signature readied): once per charge it
   *  may answer with Aegis, if it can finish before you'd throw (smarter levels judge that timing). */
  private aegisCheck(now: number, v: CombatView) {
    const s = this.style
    const pc = this.playerCharge
    if (!this.magic.includes('aegis') || !pc || pc.aegisRolled || v.shroud.player > 0 || v.shield.enemy > 0 || pc.el === 'H') return
    const r = v.ready.player
    const big = r ? r.shape !== 'line' && r.shape !== COUNTER : this.playerStrokeAt !== null && now - this.playerStrokeAt > 500
    if (!big) return
    pc.aegisRolled = true
    const e = this.enemy
    if (e && (e.counter || now - e.start >= e.chargeMs)) return // busy drawing its own spell
    if (Math.random() >= lerp(0.1, 0.5, s.smart)) return
    const sp = spellOf('H', 'aegis', this.speed(now))
    const castMs = sp.chargeMs + sp.drawMs + sp.readyMs
    // Smart: only if it lands before you'd throw (your pace, or about 1.2 s once readied).
    const left = r ? 1200 : this.castTimes.length ? pc.since + Math.min(...this.castTimes) - now : 2500
    if (Math.random() < s.smart && castMs > left) return
    this.enemy = { ...sp, start: now, ends: now + castMs }
    this.combat.sign('enemy', 'H', now)
  }

  /** The fight as the AI may read it. */
  private seen(now: number) {
    return this.combat.view(now)
  }

  update(now: number): Snapshot {
    if (this.running) {
      this.combat.update(now)
      // Your charge, as the fight sees it: the AI may react to a new one.
      // A combo still being mixed isn't a target yet; once it locks in, it reads as the combo itself
      // (only a combo counterspell stops it).
      const sv = this.seen(now)
      const pel = sv.charge.player === 'C' ? null : sv.charge.player
      if (!pel) this.playerCharge = null
      else if (this.playerCharge?.el !== pel) {
        this.playerCharge = { el: pel, since: now, rollAt: now }
        this.history = [...this.history.slice(-4), pel]
      }
      // Knocked down by your Earthquake: its cast stops at once, like yours would.
      const knocked = this.combat.view(now).knocked.enemy
      if (knocked !== this.knockedSeen) {
        this.knockedSeen = knocked
        if (this.enemy) this.nextEnemyAt = Math.max(this.nextEnemyAt, now + 1000)
        this.enemy = null
        this.reactAt = null
        this.switchTo = null
      }
      // Silenced (your counter landed): whatever it was casting is gone.
      if (this.combat.isSilenced('enemy', now)) {
        if (this.enemy) this.nextEnemyAt = Math.max(this.nextEnemyAt, now + 2000)
        this.enemy = null
        this.reactAt = null
      } else {
        // Just silenced you (a jump in your silence): hard and insane go for the opening.
        const silenceLeft = this.combat.view(now).silenced.player
        if (silenceLeft > this.lastPlayerSilence + 50) this.unanswered = 0
        if (this.style.capitalize && silenceLeft > this.lastPlayerSilence + 50) this.punish(now, silenceLeft)
        this.lastPlayerSilence = silenceLeft
        this.react(now)
        this.dodge(now, this.seen(now))
        if (this.baitCheck !== null && now >= this.baitCheck) {
          this.baits++ // it dodged and you never threw a counter: you were baiting
          this.baitCheck = null
        }
        if (this.switchTo && now >= this.switchTo.at) {
          if (!this.enemy) this.combat.sign('enemy', this.switchTo.el, now)
          this.switchTo = null
        }
        const v = this.combat.view(now)
        this.aegisCheck(now, v)
        this.breakGlacier(now, v)
        // Insane: your armor is up and draining; sometimes it holds its next cast a moment to let it run down.
        if (!this.enemy && now >= this.nextEnemyAt && v.shield.player > 15 && this.style.smart >= 1 && now - this.waitedArmor > 4000 && Math.random() < 0.3) {
          this.waitedArmor = now
          this.nextEnemyAt = now + 1000
        }
        if (!this.enemy && v.doom.enemy > 0) this.nextEnemyAt = Math.min(this.nextEnemyAt, now) // doomed: hurry
        if (!this.enemy && now >= this.nextEnemyAt) {
          const sp = this.nextSpell(now, v)
          const drawMs = sp.drawMs
          const signs = signsFor(sp.el)
          this.enemy = {
            ...sp,
            drawMs,
            start: now,
            ends: now + sp.chargeMs + drawMs + sp.readyMs,
            signs: signs.slice(1).map((el, i) => ({ at: now + (sp.chargeMs * (i + 1)) / signs.length, el })),
          }
          this.combat.sign('enemy', signs[0], now) // from now on it can be countered
        }
        const e0 = this.enemy
        while (e0?.signs?.length && now >= e0.signs[0].at) this.combat.sign('enemy', e0.signs.shift()!.el, now)
        // Casting keeps its charge alive (a combo only starts drawing once its mix is in and locked).
        if (e0 && !e0.signs?.length) this.combat.drawing('enemy', now)
        // A Mirror is up on you: it holds a direct hit until the Mirror is gone (if it reads you at all).
        if (e0 && now >= e0.ends && this.style.read > 0 && v.mirror.player > 0 && isDirect(e0.el, e0.shape)) e0.ends = now + 30
        // In a static pulse a throw would fizzle: hold the spell and throw in the next gap, like you'd have to.
        if (this.enemy && now >= this.enemy.ends && this.style.read > 0 && this.combat.staticAt('enemy', now) === 'on') this.enemy.ends = now + 30
        if (this.enemy && now >= this.enemy.ends) {
          const e = this.enemy
          this.enemy = null
          const gap = this.style.every * (this.speed(now) / this.style.speed)
          this.nextEnemyAt = now + gap * (1 + (Math.random() * 2 - 1) * ENEMY_JITTER)
          // A counter doesn't use up its turn: it follows up sooner than usual (not instantly).
          if (e.counter) this.nextEnemyAt = Math.min(this.nextEnemyAt, now + gap * (0.4 + Math.random() * 0.2))
          // The same rules as yours: draw (unless it's a quick interrupt), then push.
          if (e.shape !== QUICK) this.combat.drew('enemy', e.shape, now)
          if (this.combat.push('enemy', now) === 'ok' && e.shape === 'veil') {
            this.followBig = true
            this.nextEnemyAt = Math.min(this.nextEnemyAt, now + 300) // use the Shroud while it lasts
          }
        }
      }
      if (this.combat.winner) {
        this.running = false
        this.enemy = null
      }
    }
    return { ...this.combat.view(now), enemyCast: this.enemyView(now), running: this.running, hint: this.running ? this.hint(now) : null }
  }
}

// ---- Training dummy: infinite health. Attacks on: it throws random spells at you (you can't be hurt
// either), so you can practice parries and counters without a real fight. ------------------------
export const DUMMY_EVERY_MS = 2600 // default time between its casts
/** A dummy's next spell from its pool. While Shrouded it attacks (no second Shroud), if it has anything else. */
export function dummyPick(pool: string[], shrouded: boolean): [string, string] {
  const attacks = shrouded ? pool.filter((k) => !k.endsWith(':veil')) : pool
  const from = attacks.length ? attacks : pool
  return from[Math.floor(Math.random() * from.length)].split(':') as [string, string]
}
export class DummyArena implements Arena {
  private combat = new Combat({ dummy: true, trainee: true })
  attacking = false
  castPct = 100 // cast time, as a share of the default (charge + draw + ready); 50 = twice as fast
  gapMs = DUMMY_EVERY_MS // time between casts
  pool: string[] = [] // spells it may throw, as "element:shape" (set by the page)
  private enemy: EnemyCast | null = null
  private nextEnemyAt = 0

  reset() {
    this.combat = new Combat({ dummy: true, trainee: true })
    this.enemy = null
    this.nextEnemyAt = performance.now() + 1000
  }
  setAttacking(on: boolean) {
    this.attacking = on
    this.enemy = null
    this.nextEnemyAt = performance.now() + 1000
  }
  sign(el: string) {
    this.combat.sign('player', el, performance.now())
  }
  stroke() {
    this.combat.drawing('player', performance.now())
  }
  drew(shape: string | null) {
    this.combat.drew('player', shape, performance.now())
  }
  cleared() {
    this.combat.strokeCancelled('player')
  }
  uncharge() {
    this.combat.uncharge('player')
  }
  push() {
    this.combat.push('player', performance.now())
  }
  parry() {
    this.combat.parry('player', performance.now())
  }
  update(now: number): Snapshot {
    this.combat.update(now)
    if (this.attacking) {
      // Interrupted (or knocked down): its spell is gone; it starts over after the silence.
      if (this.enemy && (this.combat.isSilenced('enemy', now) || !this.combat.chargeOf('enemy'))) {
        this.enemy = null
        this.nextEnemyAt = now + this.gapMs / 2
      }
      if (!this.enemy && this.pool.length && now >= this.nextEnemyAt && !this.combat.isSilenced('enemy', now)) {
        const [el, shape] = dummyPick(this.pool, this.combat.view(now).shroud.enemy > 0)
        const sp = spellOf(el, shape, this.castPct / 100)
        const signs = signsFor(el) // a combo: C, then its two letters, spread over the charge
        this.enemy = { ...sp, start: now, ends: now + sp.chargeMs + sp.drawMs + sp.readyMs, signs: signs.slice(1).map((l, i) => ({ at: now + (sp.chargeMs * (i + 1)) / signs.length, el: l })) }
        this.combat.sign('enemy', signs[0], now)
      }
      const e = this.enemy
      while (e?.signs?.length && now >= e.signs[0].at) this.combat.sign('enemy', e.signs.shift()!.el, now)
      if (e) this.combat.drawing('enemy', now)
      if (e && now >= e.ends) {
        this.enemy = null
        this.nextEnemyAt = now + this.gapMs * (1 + (Math.random() * 2 - 1) * ENEMY_JITTER)
        this.combat.drew('enemy', e.shape, now)
        this.combat.push('enemy', now)
      }
    }
    return { ...this.combat.view(now), enemyCast: this.enemyView(now), running: true }
  }
  private enemyView(now: number): OppCast | null {
    const e = this.enemy
    if (!e) return null
    const t = now - e.start
    const phase = t < e.chargeMs ? 'charge' : t < e.chargeMs + e.drawMs ? 'draw' : 'ready'
    const drawn = e.drawMs ? Math.max(0, Math.min(1, (t - e.chargeMs) / e.drawMs)) : 1
    return {
      el: e.el,
      name: phase === 'ready' ? e.name : null,
      color: e.color,
      phase,
      points: e.points.slice(0, Math.max(0, Math.ceil(drawn * e.points.length))),
      view: { aspect: 1, fit: 'contain' },
      progress: t / (e.ends - e.start),
    }
  }
}
