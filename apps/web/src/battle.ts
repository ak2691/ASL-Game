// Arenas: what the Spells page fights in. Practice = an AI enemy in the browser; online = a real
// opponent through the server (online.ts). Both give the page the same Snapshot to draw.
import { Combat, type CombatView } from './combat'
import { ELEMENTS, SIGNATURE, spellName } from './spells'
import { archPoints, flamePoints } from './dollar'

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
  /** Your own actions, so an online opponent can see them. Practice ignores all but `cast`. */
  charge(el: string | null): void
  stroke(points: Pt01[]): void // points added since the last call (0..1 of the camera frame)
  readied(el: string, shape: string): void
  cleared(): void // stroke ended without a spell, redraw, or fizzle
  cast(el: string, shape: string, now: number): void
}

// ---- Practice: AI enemy --------------------------------------------------------------------
// Every ~5 s it casts like a player, slowed down so you can read it:
// charge (element shown) → draw (shape traces itself) → ready → throw.
const ENEMY_EVERY_MS = 5000
const ENEMY_JITTER_MS = 1000
const CHARGE_MS = 700
const READY_MS = 500
// How long the AI takes to draw each shape: longer shapes take longer, so they're easier to counter.
const DRAW_MS: Record<string, number> = {
  line: 600,
  v: 1000,
  w: 1700,
  star: 1800,
  hourglass: 1800,
  flame: 2200,
  cage: 2000,
  zigzag7: 2200,
  battlements: 2400,
  arches: 2200,
}
const ENEMY_ELEMENTS = ['F', 'I', 'W', 'E', 'L']
// What it casts (weights). Same rules as the player, so reading the shape tells you what's coming.
const ENEMY_MOVES: { shape: string | 'signature'; heal?: boolean; w: number }[] = [
  { shape: 'line', w: 35 },
  { shape: 'w', w: 25 },
  { shape: 'signature', w: 12 },
  { shape: 'star', heal: true, w: 10 },
  { shape: 'hourglass', heal: true, w: 5 },
]

/** Corner points (any box; fitted to 0..1 later) for the straight-line shapes, in drawing order. */
const SHAPE_CORNERS: Record<string, [number, number][]> = {
  line: [[0.15, 0.85], [0.85, 0.15]],
  v: [[0.1, 0.15], [0.5, 0.88], [0.9, 0.15]],
  w: [[0.08, 0.2], [0.29, 0.82], [0.5, 0.35], [0.71, 0.82], [0.92, 0.2]],
  hourglass: [[0.2, 0.12], [0.8, 0.12], [0.2, 0.88], [0.8, 0.88], [0.2, 0.12]],
  star: Array.from({ length: 6 }, (_, k): [number, number] => {
    const a = -Math.PI / 2 + (k * 4 * Math.PI) / 5
    return [0.5 + 0.4 * Math.cos(a), 0.52 + 0.4 * Math.sin(a)]
  }),
  cage: [[0, 0], [1, 0], [1, 1], [0, 1], [0, 0], [1, 1]],
  zigzag7: [0, 1, 0.25, 1, 0.25, 1, 0.25, 1].map((y, i): [number, number] => [i / 7, y]),
  battlements: [[0, 1], [0, 0.3], [0.3, 0.3], [0.3, 1], [0.7, 1], [0.7, 0.3], [1, 0.3], [1, 1]],
}

/** The shape's path in drawing order, fitted into the 0..1 box (keeping its proportions). */
function rawShape(shape: string): Pt01[] {
  if (shape === 'arches') return archPoints()
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

function enemySpell() {
  let r = Math.random() * ENEMY_MOVES.reduce((s, m) => s + m.w, 0)
  const move = ENEMY_MOVES.find((m) => (r -= m.w) < 0) ?? ENEMY_MOVES[0]
  const el = move.heal ? 'H' : ENEMY_ELEMENTS[Math.floor(Math.random() * ENEMY_ELEMENTS.length)]
  const shape = move.shape === 'signature' ? SIGNATURE[el] : move.shape
  return { el, shape, name: spellName(el, shape), color: ELEMENTS[el].color, points: shapePoints(shape), drawMs: DRAW_MS[shape] }
}

export class PracticeArena implements Arena {
  private combat = new Combat()
  private running = false
  private enemy: (ReturnType<typeof enemySpell> & { start: number; ends: number }) | null = null
  private nextEnemyAt = 0

  start(now: number) {
    this.combat = new Combat()
    this.running = true
    this.enemy = null
    this.nextEnemyAt = now + 3000
  }

  charge() {}
  stroke() {}
  readied() {}
  cleared() {}
  cast(el: string, shape: string, now: number) {
    if (!this.running) return
    this.combat.cast('player', el, shape, now)
    // A landed counterspell silences the AI: its cast in progress is gone.
    if (this.enemy && this.combat.isSilenced('enemy', now)) {
      this.enemy = null
      this.nextEnemyAt = now + 2000 + 1500
    }
  }

  private enemyView(now: number): OppCast | null {
    const e = this.enemy
    if (!e) return null
    const t = now - e.start
    const phase = t < CHARGE_MS ? 'charge' : t < CHARGE_MS + e.drawMs ? 'draw' : 'ready'
    const drawn = Math.max(0, Math.min(1, (t - CHARGE_MS) / e.drawMs))
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
      if (!this.enemy && now >= this.nextEnemyAt) {
        const sp = enemySpell()
        this.enemy = { ...sp, start: now, ends: now + CHARGE_MS + sp.drawMs + READY_MS }
        this.combat.setCharge('enemy', sp.el, now) // from now on it can be countered (after the flicker guard)
      }
      if (this.enemy && now >= this.enemy.ends) {
        const e = this.enemy
        this.enemy = null
        this.nextEnemyAt = now + ENEMY_EVERY_MS + (Math.random() * 2 - 1) * ENEMY_JITTER_MS
        this.combat.cast('enemy', e.el, e.shape, now)
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
  charge() {}
  stroke() {}
  readied() {}
  cleared() {}
  cast(el: string, shape: string, now: number) {
    this.combat.cast('player', el, shape, now)
  }
  update(now: number): Snapshot {
    this.combat.update(now)
    return { ...this.combat.view(now), enemyCast: null, running: true }
  }
}
