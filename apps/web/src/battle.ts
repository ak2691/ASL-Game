// Arenas: what the Spells page fights in. Practice = an AI enemy in the browser; online = a real
// opponent through the server (online.ts). Both give the page the same Snapshot to draw.
import { Combat, FIZZLE_LOCK_MS, MAX_HP, type CombatView } from './combat'
import { BEATS, COUNTER, ELEMENTS, QUICK, SIGNATURE, spellName } from './spells'
import { flamePoints, spiralPoints } from './shapes'

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
}

// ---- Practice: AI enemy --------------------------------------------------------------------
// It casts like a player, slowed down so you can read it: charge (element shown), draw (shape
// traces itself), ready, throw. Difficulty sets its speed, when it heals, and whether it
// reacts to your charge with a counter.
export type Difficulty = 'easy' | 'medium' | 'hard' | 'insane'

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
  spamCounter: number // chance it counters the same element charged 3x in a row (even easy punishes mashing)
  stun: number // chance its next attack is a stopper (Frozen Prison, Earthquake, Lightning) once you've
  // landed 2+ throws in a row while repeating yourself
  read: number // how well it reads you (0 = not at all, 1 = fully): same element 3x in a row, and light/heavy
  // patterns in your last throws (repeats, alternating, a 3-step loop). Scales how hard it leans on a guess.
  heal: number // chance it counters a heal of yours (a heal is never a surprise, so higher than react)
  dodge: number // chance it abandons its unfinished spell when you're set to counter it (once per spell)
  healPunish: boolean // a second heal soon after the first: sometimes it ignores the heal and hits you hard instead
  drop: number // chance it abandons its own half-drawn spell to counter you (else it finishes, then counters)
}
// Each level is faster and thinks quicker; hard and insane punish a silence, read your habits,
// and sometimes drop their own half-drawn spell to counter you.
export const AI: Record<Difficulty, AiStyle> = {
  easy: { every: 2000, speed: 0.9, ramp: false, healBelow: 0.25, react: 0, reactMs: [1100, 1500], circle: 0, miss: 0, capitalize: false, reroll: 0, spamCounter: 0.5, stun: 0.3, read: 0, heal: 0, dodge: 0, healPunish: false, drop: 0 },
  medium: { every: 1200, speed: 0.7, ramp: true, healBelow: 0.35, react: 0.35, reactMs: [750, 1050], circle: 0.45, miss: 0.12, capitalize: true, reroll: 1800, spamCounter: 0.85, stun: 0.4, read: 0.5, heal: 0.65, dodge: 0, healPunish: false, drop: 0.1 },
  hard: { every: 800, speed: 0.6, ramp: true, healBelow: 0.4, react: 0.58, reactMs: [550, 850], circle: 0.5, miss: 0.12, capitalize: true, reroll: 1800, spamCounter: 0.9, stun: 0.5, read: 0.6, heal: 0.8, dodge: 0.2, healPunish: false, drop: 0.2 },
  insane: { every: 600, speed: 0.45, ramp: true, healBelow: 0.4, react: 0.6, reactMs: [450, 700], circle: 0.6, miss: 0, capitalize: true, reroll: 1400, spamCounter: 0.9, stun: 0.6, read: 1, heal: 0.9, dodge: 0.4, healPunish: true, drop: 0.4 },
}
const ENEMY_JITTER = 0.2 // +/- share of the gap between casts
const CHARGE_MS = 700
const READY_MS = 500
const COUNTER_READY_MS = 80 // a counter is thrown the moment it's drawn (no waiting around)
const COUNTER_HOLD_MS = 350 // a counter's charge before it throws, at speed 1 (never under the 150 ms letter hold)
// Punishing a silence: its spell must be out before you can react once the silence ends
// (sign a counter 150 ms + push + the counter's flight).
const SIGN_HOLD_MS = 150 // holding a letter this long signs it (same as the player)
const PUNISH_SLACK_MS = 300
// How long the AI takes to draw each shape: longer shapes take longer, so they're easier to counter.
const DRAW_MS: Record<string, number> = {
  line: 600,
  w: 1700,
  star: 1800,
  hourglass: 1800,
  flame: 2200,
  cage: 2000,
  zigzag7: 2200,
  battlements: 2400,
  spiral: 2200,
  circle: 700,
  jab: 0,
}
const ENEMY_ELEMENTS = ['F', 'I', 'W', 'E', 'L']
// What it attacks with (weights). Same rules as the player, so reading the shape tells you what's coming.
const ENEMY_MOVES: { shape: string; w: number }[] = [
  { shape: 'line', w: 40 },
  { shape: 'w', w: 30 },
  { shape: 'signature', w: 14 },
]
/** The element that beats `el` (BEATS maps winner to loser). */
// What it throws to break up a stream of light attacks: things that stop or stall you.
const ANTI_LIGHT: [string, string][] = [['I', 'cage'], ['E', 'battlements'], ['L', 'zigzag7'], ['L', 'line'], ['L', 'w']]
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
const beaterOf = (el: string) => Object.keys(BEATS).find((k) => BEATS[k] === el)!

/** Corner points (any box; fitted to 0..1 later) for the straight-line shapes, in drawing order. */
const SHAPE_CORNERS: Record<string, [number, number][]> = {
  line: [[0.15, 0.85], [0.85, 0.15]],
  w: [[0.08, 0.2], [0.29, 0.82], [0.5, 0.35], [0.71, 0.82], [0.92, 0.2]],
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
  if (shape === 'flame') return flamePoints()
  if (shape === 'circle') {
    const pts: Pt01[] = []
    for (let i = 0; i <= 48; i++) pts.push({ x: Math.cos(-Math.PI / 2 + (2 * Math.PI * i) / 48), y: Math.sin(-Math.PI / 2 + (2 * Math.PI * i) / 48) })
    return pts
  }
  const c = SHAPE_CORNERS[shape]
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

function spellOf(el: string, shape: string, speed: number, chargeMs = CHARGE_MS * speed) {
  const drawMs = DRAW_MS[shape] * speed
  // Placed like a player's drawing on a 16:9 camera frame: centered, kept square, 75% of the height.
  const points = shape === 'jab' ? [] : shapePoints(shape).map((p) => ({ x: 0.5 + (p.x - 0.5) * 0.75 * (9 / 16), y: 0.5 + (p.y - 0.5) * 0.75 }))
  return { el, shape, name: spellName(el, shape), color: ELEMENTS[el].color, points, chargeMs, drawMs, readyMs: shape === 'jab' ? 0 : READY_MS * speed }
}

type EnemyCast = ReturnType<typeof spellOf> & { start: number; ends: number; counter?: boolean; dodgeRolled?: boolean }

export class PracticeArena implements Arena {
  private combat = new Combat()
  private running = false
  private enemy: EnemyCast | null = null
  private nextEnemyAt = 0
  private started = 0
  private style = AI.easy
  private lastHeal = -Infinity
  private playerCharge: { el: string; since: number; rollAt: number } | null = null
  private reactAt: number | null = null // when it will start a counter against your charge
  private reactTo = ''
  private spam = false // the planned counter is against a spammed element
  private guess: string | null = null // the throw it expects from you next ('L' light, 'H' heavy)
  private switchTo: { el: string; at: number } | null = null // a dodge: the element it's about to sign (after the 150 ms hold)
  private playerStrokeAt: number | null = null // when your current stroke started
  private baits = 0 // times you threatened a counter, it dodged, and you never threw one (each halves its dodge)
  private baitCheck: number | null = null // after a dodge: if no counter from you by then, that was a bait
  private castTimes: number[] = [] // your last 3 charge-to-throw times (ms)
  private unanswered = 0 // your throws in a row since it last silenced you
  private lastPlayerHeal = -Infinity // when you last threw a heal
  private moves: string[] = [] // your recent throws as light/heavy, newest last
  private history: string[] = [] // your recent charges, newest last
  private lastPlayerSilence = 0 // your silence left, last update (a jump = you were just silenced)

  start(now: number, difficulty: Difficulty = 'easy') {
    this.combat = new Combat()
    this.style = AI[difficulty]
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
    if (hpShare < s.healBelow && now - this.lastHeal > 6000 && Math.random() < (s === AI.easy ? 0.5 : 0.85)) {
      this.lastHeal = now
      return spellOf('H', hpShare < s.healBelow / 2 ? 'star' : 'hourglass', sp)
    }
    // You're repeating yourself and getting away with it: throw something that stuns you or knocks
    // your charge off (more likely vs light attacks, which are too quick to counter).
    const repeating = predict(this.moves) !== null || predict(this.history) !== null
    const stun = s.stun * (predict(this.moves) === 'L' ? 1.3 : 1)
    if (repeating && this.unanswered >= 2 && Math.random() < stun && !(v.hp.player / v.maxHp.player < 0.2)) {
      const [el, shape] = ANTI_LIGHT[Math.floor(Math.random() * ANTI_LIGHT.length)]
      return spellOf(el, shape, sp)
    }
    const el = ENEMY_ELEMENTS[Math.floor(Math.random() * ENEMY_ELEMENTS.length)]
    let shape = pick(ENEMY_MOVES.map((m) => ({ w: m.w, v: m.shape })))
    if (s.capitalize && v.silenced.player > 1200) shape = 'signature' // you can't counter it now
    else if (s.capitalize && v.hp.player / v.maxHp.player < 0.2) shape = 'line' // finish fast
    return spellOf(el, shape === 'signature' ? SIGNATURE[el] : shape, sp)
  }

  /** Medium/hard: sometimes it notices your charge and counters it (if you're still charged). */
  private react(now: number) {
    const s = this.style
    const pc = this.playerCharge
    if (pc && this.reactAt === null && now >= pc.rollAt) {
      pc.rollAt = s.reroll ? now + s.reroll : Infinity // still charging later (a long heavy): roll again
      const counterable = pc.el in BEATS || pc.el === 'H' // heals: any element's counterspell stops them
      // Spamming: the same element 3+ times in a row (counting this one) and it's ready for it.
      const h = this.history
      const spam = s.spamCounter > 0 && h.length >= 3 && h.slice(-3).every((x) => x === pc.el)
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
      const chance = healing
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
          const hold = Math.max(150, COUNTER_HOLD_MS * this.speed(now))
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
    let el = healing ? ENEMY_ELEMENTS[Math.floor(Math.random() * ENEMY_ELEMENTS.length)] : beaterOf(this.reactTo)
    if (mistake && healing) shape = 'jab' // a quick interrupt doesn't stop a heal
    else if (mistake) {
      const wrong = ENEMY_ELEMENTS.filter((x) => x !== el)
      el = wrong[Math.floor(Math.random() * wrong.length)] // wrong element: it misses
    }
    // Too slow to circle before you throw (it knows your pace)? Then a quick interrupt instead.
    const hold = Math.max(150, COUNTER_HOLD_MS * this.speed(now))
    // Vs heavies it wants the circle (a 2 s silence leaves room for a big punish), and each heavy you
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
    const base = spellOf(el, shape, this.speed(now), hold)
    const sp = { ...base, drawMs: shape === 'circle' && !healing ? base.drawMs * circleSpeed : base.drawMs, readyMs: shape === 'jab' ? 0 : COUNTER_READY_MS }
    if (abandoned) this.combat.drew('enemy', null, now)
    const ends = Math.max(now + sp.chargeMs + sp.drawMs + sp.readyMs, abandoned ? now + FIZZLE_LOCK_MS + 30 : 0)
    this.enemy = { ...sp, start: now, ends, counter: true }
    this.combat.sign('enemy', sp.el, now)
  }

  /** Insane, vs a repeat heal: while you draw it, cast something big instead of countering.
   *  Usually a Thunderbolt (its static makes your throws fizzle). False if it's busy drawing. */
  private punishHeal(now: number) {
    const e = this.enemy
    if (e && (e.counter || now - e.start >= e.chargeMs)) return false
    const [el, shape] = Math.random() < 0.6 ? ['L', 'zigzag7'] : (() => {
      const el = ENEMY_ELEMENTS[Math.floor(Math.random() * ENEMY_ELEMENTS.length)]
      return [el, Math.random() < 0.5 ? SIGNATURE[el] : 'w']
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
    const others = ENEMY_ELEMENTS.filter((x) => x !== e.el)
    // Signing takes the same 150 ms hold as yours.
    this.switchTo = { el: others[Math.floor(Math.random() * others.length)], at: now + SIGN_HOLD_MS }
    this.nextEnemyAt = now + FIZZLE_LOCK_MS + Math.random() * 400 // re-cast once the fizzle lock is over
  }

  /** Hard/insane: you were just silenced. Unless it's already drawing, it casts the biggest spell
   *  that's thrown before you could counter it (silence left + reaction slack). */
  private punish(now: number, silenceLeft: number) {
    const e = this.enemy
    if (e && (e.counter || now - e.start >= e.chargeMs)) return // a counter, or already drawing: let it finish
    const el = ENEMY_ELEMENTS[Math.floor(Math.random() * ENEMY_ELEMENTS.length)]
    const window = silenceLeft + PUNISH_SLACK_MS
    const sp = this.speed(now)
    for (const shape of [SIGNATURE[el], 'w', 'line']) {
      const s = { ...spellOf(el, shape, sp), readyMs: 100 } // no waiting around: throw as soon as it's drawn
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

  update(now: number): Snapshot {
    if (this.running) {
      this.combat.update(now)
      // Your charge, as the fight sees it: the AI may react to a new one.
      const pel = this.combat.view(now).charge.player
      if (!pel) this.playerCharge = null
      else if (this.playerCharge?.el !== pel) {
        this.playerCharge = { el: pel, since: now, rollAt: now }
        this.history = [...this.history.slice(-4), pel]
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
        this.dodge(now, this.combat.view(now))
        if (this.baitCheck !== null && now >= this.baitCheck) {
          this.baits++ // it dodged and you never threw a counter: you were baiting
          this.baitCheck = null
        }
        if (this.switchTo && now >= this.switchTo.at) {
          if (!this.enemy) this.combat.sign('enemy', this.switchTo.el, now)
          this.switchTo = null
        }
        const v = this.combat.view(now)
        if (!this.enemy && now >= this.nextEnemyAt) {
          const sp = this.nextSpell(now, v)
          this.enemy = { ...sp, start: now, ends: now + sp.chargeMs + sp.drawMs + sp.readyMs }
          this.combat.sign('enemy', sp.el, now) // from now on it can be countered
        }
        if (this.enemy) this.combat.drawing('enemy', now) // casting keeps its charge alive
        // In a static pulse a throw would fizzle: hold the spell and throw in the next gap, like you'd have to.
        if (this.enemy && now >= this.enemy.ends && this.style.read > 0 && this.combat.staticAt('enemy', now) === 'on') this.enemy.ends = now + 30
        if (this.enemy && now >= this.enemy.ends) {
          const e = this.enemy
          this.enemy = null
          const gap = this.style.every * (this.speed(now) / this.style.speed)
          this.nextEnemyAt = now + gap * (1 + (Math.random() * 2 - 1) * ENEMY_JITTER)
          // A counter doesn't use up its turn: it follows up with an attack right away.
          if (e.counter) this.nextEnemyAt = Math.min(this.nextEnemyAt, now + 250 + Math.random() * 250)
          // The same rules as yours: draw (unless it's a quick interrupt), then push.
          if (e.shape !== QUICK) this.combat.drew('enemy', e.shape, now)
          this.combat.push('enemy', now)
        }
      }
      if (this.combat.winner) {
        this.running = false
        this.enemy = null
      }
    }
    return { ...this.combat.view(now), enemyCast: this.enemyView(now), running: this.running }
  }
}

// ---- Training dummy: infinite health, never attacks -----------------------------------------
export class DummyArena implements Arena {
  private combat = new Combat({ dummy: true })

  reset() {
    this.combat = new Combat({ dummy: true })
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
  push() {
    this.combat.push('player', performance.now())
  }
  update(now: number): Snapshot {
    this.combat.update(now)
    return { ...this.combat.view(now), enemyCast: null, running: true }
  }
}
