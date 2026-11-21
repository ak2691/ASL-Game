// Arenas: what the Spells page fights in. Practice = an AI enemy in the browser; online = a real
// opponent through the server (online.ts). Both give the page the same Snapshot to draw.
import { Combat, type CombatView } from './combat'
import { BEATS, ELEMENTS, QUICK, SIGNATURE, spellName } from './spells'
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
  points: Pt01[] // their drawing so far (0..1 box)
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
  stroke(points: Pt01[]): void // points added since the last call (0..1 of the camera frame)
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
}
// Speed steps shrink (1, 0.8, 0.7, 0.58): each level is a bit faster, never impossibly fast.
// Counter thinking time grows easier down the levels; hard and insane also punish a silence.
// Once it's drawing its own spell it commits: no dropping it to counter you.
export const AI: Record<Difficulty, AiStyle> = {
  easy: { every: 5000, speed: 1, ramp: false, healBelow: 0.25, react: 0, reactMs: [0, 0], circle: 0, miss: 0, capitalize: false },
  medium: { every: 3800, speed: 0.8, ramp: true, healBelow: 0.35, react: 0.35, reactMs: [900, 1400], circle: 0.3, miss: 0.2, capitalize: false },
  hard: { every: 3200, speed: 0.7, ramp: true, healBelow: 0.4, react: 0.5, reactMs: [1000, 1400], circle: 0.4, miss: 0.2, capitalize: true },
  insane: { every: 2600, speed: 0.58, ramp: true, healBelow: 0.4, react: 0.65, reactMs: [800, 1100], circle: 0.5, miss: 0.05, capitalize: true },
}
const ENEMY_JITTER = 0.2 // +/- share of the gap between casts
const CHARGE_MS = 700
const READY_MS = 500
const COUNTER_HOLD_MS = 350 // a counter's charge before it throws, at speed 1 (never under the 150 ms letter hold)
// Punishing a silence: its spell must be out before you can react once the silence ends
// (sign a counter 150 ms + push + the counter's flight).
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
  const points = shape === 'jab' ? [] : shapePoints(shape)
  return { el, shape, name: spellName(el, shape), color: ELEMENTS[el].color, points, chargeMs, drawMs, readyMs: shape === 'jab' ? 0 : READY_MS * speed }
}

type EnemyCast = ReturnType<typeof spellOf> & { start: number; ends: number; counter?: boolean }

export class PracticeArena implements Arena {
  private combat = new Combat()
  private running = false
  private enemy: EnemyCast | null = null
  private nextEnemyAt = 0
  private started = 0
  private style = AI.easy
  private lastHeal = -Infinity
  private playerCharge: { el: string; since: number; rolled: boolean } | null = null
  private reactAt: number | null = null // when it will start a counter against your charge
  private reactTo = '' // the element it's countering ('H' = your heal)
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
    this.combat.drawing('player', performance.now())
  }
  drew(shape: string | null) {
    this.combat.drew('player', shape, performance.now())
  }
  cleared() {
    this.combat.strokeCancelled('player')
  }
  push() {
    const now = performance.now()
    const r = this.combat.view(now).ready.player
    if (this.combat.push('player', now) !== 'ok') return
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
    if (pc && !pc.rolled) {
      pc.rolled = true
      const counterable = pc.el in BEATS || pc.el === 'H' // heals: any element's counterspell stops them
      if (counterable && Math.random() < s.react) {
        this.reactAt = now + s.reactMs[0] + Math.random() * (s.reactMs[1] - s.reactMs[0])
        this.reactTo = pc.el
      }
    }
    if (this.reactAt === null || now < this.reactAt) return
    // Committed: already drawing its own spell. It finishes that, then counters if you're still open.
    const e = this.enemy
    if (e && !e.counter && now - e.start >= e.chargeMs) {
      this.reactAt = e.ends + 100
      return
    }
    this.reactAt = null
    const healing = this.reactTo === 'H'
    // Only if there's still something to counter: your charge, or (for a heal) a regen ticking.
    if (!(pc?.el === this.reactTo || (healing && this.combat.view(now).regen.player))) return
    // A heal needs the full counterspell (any element); otherwise a quick interrupt or a circle.
    const mistake = Math.random() < s.miss
    let shape = healing || Math.random() < s.circle ? 'circle' : 'jab'
    let el = healing ? ENEMY_ELEMENTS[Math.floor(Math.random() * ENEMY_ELEMENTS.length)] : beaterOf(this.reactTo)
    if (mistake && healing) shape = 'jab' // a quick interrupt doesn't stop a heal
    else if (mistake) {
      const wrong = ENEMY_ELEMENTS.filter((x) => x !== el)
      el = wrong[Math.floor(Math.random() * wrong.length)] // wrong element: it misses
    }
    const sp = spellOf(el, shape, this.speed(now), Math.max(150, COUNTER_HOLD_MS * this.speed(now)))
    this.enemy = { ...sp, start: now, ends: now + sp.chargeMs + sp.drawMs + sp.readyMs, counter: true }
    this.combat.sign('enemy', sp.el, now)
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
      if (s.chargeMs + s.drawMs + s.readyMs > window) continue
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
      progress: t / (e.ends - e.start),
    }
  }

  update(now: number): Snapshot {
    if (this.running) {
      this.combat.update(now)
      // Your charge, as the fight sees it: the AI may react to a new one.
      const pel = this.combat.view(now).charge.player
      if (!pel) this.playerCharge = null
      else if (this.playerCharge?.el !== pel) this.playerCharge = { el: pel, since: now, rolled: false }
      // Silenced (your counter landed): whatever it was casting is gone.
      if (this.combat.isSilenced('enemy', now)) {
        if (this.enemy) this.nextEnemyAt = Math.max(this.nextEnemyAt, now + 2000)
        this.enemy = null
        this.reactAt = null
      } else {
        // Just silenced you (a jump in your silence): hard and insane go for the opening.
        const silenceLeft = this.combat.view(now).silenced.player
        if (this.style.capitalize && silenceLeft > this.lastPlayerSilence + 50) this.punish(now, silenceLeft)
        this.lastPlayerSilence = silenceLeft
        this.react(now)
        const v = this.combat.view(now)
        if (!this.enemy && now >= this.nextEnemyAt) {
          const sp = this.nextSpell(now, v)
          this.enemy = { ...sp, start: now, ends: now + sp.chargeMs + sp.drawMs + sp.readyMs }
          this.combat.sign('enemy', sp.el, now) // from now on it can be countered
        }
        if (this.enemy) this.combat.drawing('enemy', now) // casting keeps its charge alive
        if (this.enemy && now >= this.enemy.ends) {
          const e = this.enemy
          this.enemy = null
          const gap = this.style.every * (this.speed(now) / this.style.speed)
          this.nextEnemyAt = now + gap * (1 + (Math.random() * 2 - 1) * ENEMY_JITTER)
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
