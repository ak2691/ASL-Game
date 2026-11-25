// Arenas: what the Spells page fights in. Practice = an AI enemy in the browser; online = a real
// opponent through the server (online.ts). Both give the page the same Snapshot to draw.
import { CHILL_HEAVY_MS, CHILL_MS, Combat, FIZZLE_LOCK_MS, FLY_MS, TWILIGHT_MS, MAX_HP, PARRY_WINDOW_MS, STATIC_CUTOFF, type CombatView, type Fid } from './combat'
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
  say?: { key: Bark; n: number } | null // practice: something it says (the text lives in Ladder.tsx); n counts up per line
}
/** When a practice opponent talks: at the start, now and then when its habit kicks in, once when it's low, at the end. */
export type Bark = 'start' | 'habit' | 'low' | 'win' | 'lose'
const BARK_GAP_MS = 15000 // at most one mid-match line this often

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
  setupDelay?: number // Nov 25: Adept and up always cash in their own setup (chill, Exposed); this is the ms they take to react first
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
  utility: number // chance a cast is a Angelic buff, an Unholy curse or a combo (when one fits)
  smart: number // 0..1: how far it leans on Angelic/Unholy tactics (Aegis vs your wind-ups, Shroud setups, armor play, blind guesses)
  // Intro bots (the ladder's first rungs) limit what it knows:
  els?: string[] // elements it attacks with (default all 5)
  moves?: Record<string, number> // attack weights over line / h / signature (default ENEMY_MOVES)
  order?: 'alternate' | 'fresh' // alternate: cycles its elements; fresh: random, never the same twice in a row
  magic?: string[] // Angelic/Unholy spells it may cast (default all); heals come from healBelow
  hintMs?: number // shows the counter for its charge after this long (undefined = never)
  comboHintMs?: number // ...and for its combos (default: hintMs)
  // Combos (plans/ai-combos.md):
  combos?: string[] // combos it casts
  comboRate?: number // chance a cast is one of them
  comboCounter?: number // chance it answers your locked combo (and your Glacier) with a combo counterspell
  // Parry (plans/parry.md, "AI parry"):
  parry?: number // chance it tries to parry your heavy (a quarter of that vs lights, 60% vs combos)
  parrySig?: number // ...and your signatures (default: parry)
  parryAim?: number // chance a try vs a light lands in the window; bigger windows are easier (x sqrt(window / 100 ms))
  reparry?: number // chance it tries to parry a spell you parried back at it
  // Personality (plans/ai-personalities.md): what it likes to do. Skill above sets how hard it is; the habit
  // is the lesson. habitStrength = share of its choices that follow the habit (fades up the ladder).
  habit?: Habit | 'exam' | 'shapeshift' // exam: a mix of examOf, re-picked each cast; shapeshift: changes every SHIFT_MS
  habitStrength?: number
  examOf?: Habit[]
}
/** wall: slow heavies. spammer: Lightning lights. setup: chill, then a big hit. curser: Doom, then Execute while
 *  you're cursed. counter: waits and counters your charges. shadow: Shrouds its casts. interrupter: interrupts
 *  your long drawings. combo: combos often. punisher: goes big the moment you're stunned, locked or fizzled.
 *  mirror: learns your favourite element and counters it. */
export type Habit = 'wall' | 'spammer' | 'setup' | 'curser' | 'counter' | 'shadow' | 'interrupter' | 'combo' | 'punisher' | 'mirror'
const SHIFT_MS = 20000
const SHIFT_HABITS: Habit[] = ['spammer', 'setup', 'curser', 'counter', 'shadow', 'interrupter', 'combo', 'punisher']
const ALL_COMBOS = Object.keys(COMBO_SHAPE)
const ALL_MAGIC = ['aegis', 'scythe', 'veil', 'blade']
const UNHOLY_MAGIC = ['scythe', 'veil', 'blade']
// Intro bots: slow, simple scripts that never read you. Each rung adds one new thing.
const BOT = { ramp: false, healBelow: 0, react: 0, reactMs: [1500, 2000] as [number, number], circle: 0, miss: 0, capitalize: false, reroll: 0, spamCounter: 0, stun: 0, read: 0, heal: 0, dodge: 0, healPunish: false, drop: 0, utility: 0, smart: 0, magic: [] as string[] }
const LHS = { line: 35, h: 45, signature: 20 } // intro bots: lights, heavies and some signatures
// Adept and up: each level is faster and thinks quicker; Magus and up punish a silence, read your
// habits, and sometimes drop their own half-drawn spell to counter you.
export const AI: Record<Difficulty, AiStyle> = {
  // Nov 24 (later): waiting between casts shorter, 25% at the bottom tapering to 5% at the top (the top was
  // already near human limits; halving made it inhuman), drawing slower (DRAW_MS): time goes into drawing you can see.
  // Nov 24 balance pass (plans/balance.md): every rung faster, signatures from the start, parrying from Cleric,
  // spam punished everywhere. Single-element bots got a second element, and (10 s wear recovery) Frost, Cleric, Hexer and Zealot a third: two sink to the floor.
  pebble: { ...BOT, miss: 0.3, every: 1600, speed: 1.0, els: ['E', 'W', 'F'], moves: { line: 10, h: 70, signature: 20 }, order: 'alternate', react: 0.05, spamCounter: 0.25, hintMs: 0, habit: 'wall', habitStrength: 0.8 },
  ember: { ...BOT, miss: 0.28, every: 1460, speed: 0.95, els: ['F', 'L', 'I'], moves: LHS, order: 'fresh', react: 0.1, spamCounter: 0.35, hintMs: 0, habit: 'spammer', habitStrength: 0.8 },
  frost: { ...BOT, miss: 0.26, order: 'fresh', every: 1400, speed: 0.9, els: ['I', 'E', 'F'], moves: LHS, react: 0.2, spamCounter: 0.5, combos: ['thermal'], comboRate: 0.15, hintMs: 0, habit: 'setup', habitStrength: 0.8 },
  cleric: { ...BOT, miss: 0.24, order: 'fresh', every: 1330, speed: 0.9, els: ['W', 'I', 'E'], moves: LHS, healBelow: 0.6, magic: ['aegis'], utility: 0.15, smart: 0.3, react: 0.2, spamCounter: 0.5, parry: 0.1, parrySig: 0.15, parryAim: 0.32, hintMs: 0, combos: ['glacier'], comboRate: 0.1, habit: 'exam', examOf: ['wall', 'spammer', 'setup'], habitStrength: 0.5 },
  hexer: { setupDelay: 600, ...BOT, miss: 0.22, order: 'fresh', every: 1230, speed: 0.85, els: ['E', 'L', 'I'], moves: LHS, magic: UNHOLY_MAGIC, utility: 0.35, smart: 0.3, react: 0.25, reactMs: [1100, 1500], spamCounter: 0.55, combos: ['grave'], comboRate: 0.14, parry: 0.12, parrySig: 0.15, parryAim: 0.34, hintMs: 300, habit: 'curser', habitStrength: 0.6 },
  tide: { setupDelay: 550, ...BOT, miss: 0.2, order: 'fresh', every: 1110, speed: 0.8, els: ['W', 'I', 'L'], moves: LHS, healBelow: 0.3, react: 0.35, reactMs: [1000, 1400], circle: 0.3, spamCounter: 0.6, combos: ['storm'], comboRate: 0.17, parry: 0.15, parrySig: 0.2, parryAim: 0.36, hintMs: 900, smart: 0.32, magic: ['aegis'], utility: 0.2, habit: 'counter', habitStrength: 0.6 },
  zealot: { setupDelay: 500, ...BOT, miss: 0.18, order: 'fresh', every: 1090, speed: 0.78, els: ['F', 'E', 'W'], moves: LHS, magic: ALL_MAGIC, utility: 0.4, smart: 0.4, healBelow: 0.35, react: 0.42, reactMs: [1000, 1400], circle: 0.3, spamCounter: 0.65, combos: ['sunfire', 'twilight'], comboRate: 0.17, parry: 0.18, parrySig: 0.2, parryAim: 0.38, hintMs: 900, habit: 'shadow', habitStrength: 0.6 },
  warden: { setupDelay: 450, ...BOT, miss: 0.15, every: 1010, speed: 0.75, healBelow: 0.25, react: 0.38, reactMs: [1000, 1300], spamCounter: 0.75, stun: 0.2, read: 0.25, magic: ALL_MAGIC, utility: 0.03, smart: 0.42, combos: ['magma', 'glacier'], comboRate: 0.12, parry: 0.2, parrySig: 0.25, parryAim: 0.4, comboHintMs: 1500 , circle: 0.32, habit: 'interrupter', habitStrength: 0.6 },
  adept: { setupDelay: 400, parry: 0.22, parrySig: 0.28, parryAim: 0.42, reparry: 0.02, spamAt: 3, every: 850, speed: 0.68, ramp: false, healBelow: 0.3, react: 0.5, reactMs: [900, 1200], circle: 0.35, miss: 0.12, capitalize: false, reroll: 0, spamCounter: 0.8, stun: 0.3, read: 0.3, heal: 0.25, dodge: 0, healPunish: false, drop: 0.05, utility: 0.08, smart: 0.45, combos: ['magma', 'steam'], comboRate: 0.15, comboCounter: 0.1, habit: 'exam', examOf: ['curser', 'counter', 'shadow', 'interrupter', 'combo'], habitStrength: 0.45 },
  magus: { setupDelay: 300, parry: 0.3, parrySig: 0.35, parryAim: 0.45, reparry: 0.04, spamAt: 3, every: 730, speed: 0.62, ramp: false, healBelow: 0.33, react: 0.48, reactMs: [800, 1050], circle: 0.35, miss: 0.1, capitalize: true, reroll: 2400, spamCounter: 0.85, stun: 0.35, read: 0.45, heal: 0.5, dodge: 0.05, healPunish: false, drop: 0.15, utility: 0.12, smart: 0.5, combos: ['magma', 'steam', 'storm', 'sunfire'], comboRate: 0.17, comboCounter: 0.25, habit: 'punisher', habitStrength: 0.35 },
  archmage: { setupDelay: 250, parry: 0.42, parrySig: 0.46, parryAim: 0.48, reparry: 0.08, spamAt: 3, every: 650, speed: 0.57, ramp: true, healBelow: 0.36, react: 0.56, reactMs: [700, 950], circle: 0.45, miss: 0.07, capitalize: true, reroll: 1800, spamCounter: 0.9, stun: 0.45, read: 0.65, heal: 0.65, dodge: 0.15, healPunish: false, drop: 0.28, utility: 0.2, smart: 0.75, combos: ALL_COMBOS.filter((c) => c !== 'glacier'), comboRate: 0.19, comboCounter: 0.5, habit: 'shapeshift', habitStrength: 0.35 },
  lich: { setupDelay: 200, parry: 0.45, parrySig: 0.5, parryAim: 0.5, reparry: 0.12, spamAt: 3, every: 610, speed: 0.55, ramp: true, healBelow: 0.4, react: 0.6, reactMs: [650, 880], circle: 0.5, miss: 0.04, capitalize: true, reroll: 1400, spamCounter: 0.92, stun: 0.55, read: 0.9, heal: 0.8, dodge: 0.32, healPunish: true, drop: 0.33, utility: 0.26, smart: 1, combos: ALL_COMBOS, comboRate: 0.22, comboCounter: 0.75, habit: 'mirror', habitStrength: 0.35 },
  // The finale: the whole kit, used on purpose, no mistakes. A step above Lich in every number.
  ascendant: { setupDelay: 150, parry: 0.5, parrySig: 0.55, parryAim: 0.53, reparry: 0.15, spamAt: 3, every: 570, speed: 0.53, ramp: true, healBelow: 0.4, react: 0.66, reactMs: [580, 780], circle: 0.6, miss: 0, capitalize: true, reroll: 1200, spamCounter: 0.95, stun: 0.6, read: 1, heal: 0.88, dodge: 0.38, healPunish: true, drop: 0.38, utility: 0.3, smart: 1, combos: ALL_COMBOS, comboRate: 0.26, comboCounter: 1, habit: 'exam', examOf: ['setup', 'counter', 'interrupter', 'punisher', 'mirror', 'mirror'], habitStrength: 0.3 },
}
/** The practice ladder, in order. */
export const LADDER: { id: Difficulty; name: string }[] = [
  { id: 'pebble', name: 'Old Bram' },
  { id: 'ember', name: 'Pip' },
  { id: 'frost', name: 'Miss Hollis' },
  { id: 'cleric', name: 'Brother Alden' },
  { id: 'hexer', name: 'Morwen' },
  { id: 'tide', name: 'Master Ito' },
  { id: 'zealot', name: 'Nyx' },
  { id: 'warden', name: 'Proctor Vell' },
  { id: 'adept', name: 'Rook' },
  { id: 'magus', name: 'Gideon' },
  { id: 'archmage', name: 'Tamsin' },
  { id: 'lich', name: 'Lady Glass' },
  { id: 'ascendant', name: 'The Archwizard' },
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
  line: 800, // Nov 24: was 600
  h: 2400, // Nov 24: was 1800 (a beginner needs time to read and counter a heavy)
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
  // Combos, by how much drawing each one is. Nov 24: about twice a signature. A hand in the air, drawing
  // something unfamiliar to a camera, is far slower than a pencil; Sunfire and Plasma are the slowest by far.
  tomb: 5000, // 9 straight lines
  iceberg: 5200, // 10 straight lines
  volcano: 5200, // 9 lines and a small arc
  cloud: 5600, // three arcs, then the bolt
  thermo: 6000, // tube, bulb, then a 4-line crack
  puff: 6200, // 8 humps, each a careful arc
  yinyang: 6200, // circle, the S, both dots
  plasma: 7500, // 3 curved petals, then the ball around them
  sun: 8000, // 16 lines, exactly 8 points
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
  if (!c) return samplePath(shape) // Angelic, Unholy and combo shapes: along their guide path
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

/** How much a faster opponent speeds up a drawing: fully for simple shapes (line, H, circle), half for
 *  signatures and Angelic/Unholy, a little for combos. Complex drawings take time however good you are. */
const speedFor = (shape: string, speed: number) =>
  shape === 'line' || shape === 'h' || shape === 'circle' || shape === 'jab' ? speed : COMBO_SHAPES.has(shape) ? lerp(speed, 1, 0.7) : lerp(speed, 1, 0.5)
const COMBO_SHAPES = new Set(Object.values(COMBO_SHAPE))
const COMBO_LETTER_MS = 400 // each of a combo's letters (C, then two elements), at speed 1: about a person's pace

/** Practice AI drawing times (Nov 25), per floor rather than by its speed setting. At the bottom of the tower
 *  (p = 0) a heavy takes 4 s, a signature ~5.5 s, a combo ~10 s, a light a third of a heavy; at the top
 *  (p = 1) 1.2 s, ~2.0 s and ~4 s (Nov 25: were 1.5, 2.5 and 6). In between it eases down
 *  geometrically (each floor ~8% quicker for heavies), so beginners stay slow. Counter circles and quick
 *  interrupts keep their speed-based time. `ramp` (< 1) is a top bot speeding up through the fight. */
// Combos (Nov 25): 9 s at the bottom to 4 s at the top, half geometric and half linear (per floor: plans/balance.md).
const AI_DRAW = { heavy: [4000, 1200], signature: [5500, 2000], combo: [9000, 4000] } as const // signature top: Nov 25 was 2500
const SIG_AVG = 2200 // DRAW_MS average of the signatures and Angelic/Unholy shapes
const COMBO_AVG = 5900 // ...and of the combos
function aiDrawMs(shape: string, p: number, ramp: number) {
  const ease = ([slow, fast]: readonly [number, number]) => slow * (fast / slow) ** p
  if (shape === 'h') return ease(AI_DRAW.heavy) * ramp
  if (shape === 'line') return (ease(AI_DRAW.heavy) / 3) * ramp
  if (shape === 'circle' || shape === 'jab') return null
  // Combos differ less than their drawings do (Sunfire would otherwise take ~14 s at the bottom).
  if (COMBO_SHAPES.has(shape)) {
    const [slow, fast] = AI_DRAW.combo
    const mix = 0.5 * ease(AI_DRAW.combo) + 0.5 * (slow + (fast - slow) * p)
    return mix * Math.sqrt(DRAW_MS[shape] / COMBO_AVG) * ramp
  }
  // Nov 25: softened like combos (sqrt), so a big signature (Meteor) isn't much slower than a small one.
  return ease(AI_DRAW.signature) * Math.sqrt(DRAW_MS[shape] / SIG_AVG) * ramp
}

export function spellOf(el: string, shape: string, speed: number, chargeMs = CHARGE_MS * speed, ai?: { p: number; ramp: number }) {
  // Every letter takes at least LETTER_GAP_MS to sign, like a player's. Combos and combo counterspells
  // (C + two letters) are signed at about a person's pace, so you can see them coming.
  const letters = signsFor(el).length
  chargeMs = letters > 1 ? Math.max(chargeMs, letters * COMBO_LETTER_MS * lerp(speed, 1, 0.5)) : Math.max(chargeMs, letters * LETTER_GAP_MS)
  const drawMs = (ai && aiDrawMs(shape, ai.p, ai.ramp)) ?? DRAW_MS[shape] * speedFor(shape, speed)
  // Placed like a player's drawing on a 16:9 camera frame: centered, kept square, 75% of the height.
  const points = shape === 'jab' ? [] : shapePoints(shape).map((p) => ({ x: 0.5 + (p.x - 0.5) * 0.75 * (9 / 16), y: 0.5 + (p.y - 0.5) * 0.75 }))
  return { el, shape, name: spellName(el, shape), color: chargeInfo(el).color, points, chargeMs, drawMs, readyMs: shape === 'jab' ? 0 : READY_MS * speed }
}

/** A training dummy's spell: the cast time % scales every drawing fully (no opponent skill curve), and a
 *  combo's letters come at once, LETTER_GAP_MS apart (longer at a slower cast time), then it draws. */
/** Just a dummy spell's timing (ms), without its drawing: for showing cast times in settings. */
export function dummyTimes(el: string, shape: string, pct: number) {
  const letters = signsFor(el).length
  const signGap = Math.max(LETTER_GAP_MS, LETTER_GAP_MS * pct)
  const chargeMs = letters > 1 ? signGap * (letters - 1) : CHARGE_MS * pct
  return { chargeMs, drawMs: DRAW_MS[shape] * pct, readyMs: shape === 'jab' ? 0 : READY_MS * pct }
}
export function dummySpell(el: string, shape: string, pct: number) {
  const sp = spellOf(el, shape, pct)
  const drawMs = DRAW_MS[shape] * pct
  const letters = signsFor(el).length
  if (letters < 2) return { ...sp, drawMs, signGap: 0 }
  const signGap = Math.max(LETTER_GAP_MS, LETTER_GAP_MS * pct)
  return { ...sp, drawMs, chargeMs: signGap * (letters - 1), signGap }
}
/** When each letter after the first is signed: a dummy's at its fixed gap, anyone else's spread over the charge. */
export const signTimes = (sp: { chargeMs: number; signGap?: number }, signs: string[], now: number) =>
  signs.slice(1).map((el, i) => ({ at: now + (sp.signGap ? sp.signGap : sp.chargeMs / signs.length) * (i + 1), el }))

type EnemyCast = ReturnType<typeof spellOf> & {
  start: number
  ends: number
  counter?: boolean
  dodgeRolled?: boolean
  signs?: { at: number; el: string }[] // a combo's mix, signed one letter at a time while charging
}
/** Spells that hit directly (a Mirror would send them back). */
const isDirect = (el: string, shape: string) => el !== 'A' && shape !== 'scythe' && shape !== 'veil' && shape !== COUNTER && shape !== QUICK

export class PracticeArena implements Arena {
  private combat = new Combat()
  private running = false
  private enemy: EnemyCast | null = null
  private nextEnemyAt = 0
  private started = 0
  private style = AI.adept
  private els = ENEMY_ELEMENTS
  private own = [...ENEMY_ELEMENTS, 'A', 'U'] // elements it can counter with
  private magic = ALL_MAGIC
  private elIdx = 0
  private lastEl = ''
  private knockedSeen = 0
  private lastHeal = -Infinity
  private playerCharge: { el: string; since: number; rollAt: number; aegisRolled?: boolean; blindRolled?: boolean; drawRolled?: boolean; countered?: boolean } | null = null
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
  private parrySeen = new Set<number>() // bolts it already decided on
  private parryAt: number | null = null // when it pushes for a parry it decided to try
  private thrown: string[] = [] // your last throws (element:shape), to spot a spammed spell
  private cur: Habit | null = null // the habit it's playing right now (exam and shapeshift change it)
  private shiftAt = 0 // shapeshift: when it next changes habit
  private favEl: Record<string, number> = {} // mirror: how often you've charged each element
  private forceJab = false // interrupter: the counter it's about to make is a quick interrupt
  private holdSince: number | null = null // counter: how long it's been waiting for you to commit
  private spamN = 0 // spammer: casts in its current burst (two quick lights, then a heavy)
  private payoff: { until: number } | null = null // its setup is on them until then: the next cast cashes it in
  private followUp = false // setup: its chill is on the way; the next cast is the big hit, started at once
  private said: { key: Bark; n: number } | null = null
  private lastBark = -Infinity
  private lowSaid = false

  private p = 0 // its floor: 0 at the bottom of the tower, 1 at the top (drawing times, see aiDrawMs)
  /** One of its spells, drawn at its floor's pace. */
  private cast(el: string, shape: string, speed: number, chargeMs = CHARGE_MS * speed) {
    return spellOf(el, shape, speed, chargeMs, { p: this.p, ramp: speed / this.style.speed })
  }

  start(now: number, difficulty: Difficulty = 'pebble') {
    this.p = LADDER.findIndex((b) => b.id === difficulty) / (LADDER.length - 1)
    this.combat = new Combat()
    this.style = AI[difficulty]
    this.els = this.style.els ?? ENEMY_ELEMENTS
    this.magic = this.style.magic ?? ALL_MAGIC
    this.own = [...this.els, ...(this.magic.includes('aegis') || this.style.healBelow > 0 ? ['A'] : []), ...(this.magic.some((m) => UNHOLY_MAGIC.includes(m)) ? ['U'] : [])]
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
    this.parrySeen.clear()
    this.parryAt = null
    this.thrown = []
    this.favEl = {}
    this.followUp = false
    this.payoff = null
    this.spamN = 0
    this.forceJab = false
    this.holdSince = null
    const h = this.style.habit
    this.cur = h === 'exam' ? null : h === 'shapeshift' ? SHIFT_HABITS[Math.floor(Math.random() * SHIFT_HABITS.length)] : h ?? null
    this.shiftAt = now + SHIFT_MS
    this.said = null
    this.lastBark = -Infinity
    this.lowSaid = false
    this.bark('start', now)
  }

  /** Say something (start, win and lose always; mid-match lines no more than every BARK_GAP_MS). */
  private bark(key: Bark, now: number) {
    const always = key === 'start' || key === 'win' || key === 'lose'
    if (!always && now - this.lastBark < BARK_GAP_MS) return
    this.lastBark = now
    this.said = { key, n: (this.said?.n ?? 0) + 1 }
  }

  /** Rolls whether this choice follows its habit. */
  private habitRoll() {
    return Math.random() < (this.style.habitStrength ?? 0)
  }
  /** Shapeshift: a new habit every SHIFT_MS (never the same one twice in a row). */
  private shapeshift(now: number) {
    if (this.style.habit !== 'shapeshift' || now < this.shiftAt) return
    const rest = SHIFT_HABITS.filter((h) => h !== this.cur)
    this.cur = rest[Math.floor(Math.random() * rest.length)]
    this.shiftAt = now + SHIFT_MS
  }
  /** The element you charge most (mirror), once it has seen a few. */
  private favorite() {
    const e = Object.entries(this.favEl).sort((a, b) => b[1] - a[1])
    return e.length && e.reduce((t, [, n]) => t + n, 0) >= 3 ? e[0][0] : null
  }

  /** A cast that follows its habit, or null (then it plays normally). */
  private habitSpell(now: number, v: CombatView, sp: number): ReturnType<typeof spellOf> | null {
    const h = this.cur
    if (!h || !(this.followUp && (h === 'setup' || h === 'curser' || h === 'counter')) && !this.habitRoll()) return null
    const has = (m: string) => this.magic.includes(m)
    switch (h) {
      case 'wall': {
        const el = this.nextEl()
        return this.cast(el, Math.random() < 0.15 ? SIGNATURE[el] : 'h', sp)
      }
      case 'spammer': {
        // A smart spammer: Lightning while it still has static, else whichever element is least worn.
        const pw = (e: string) => this.combat.powerOf('enemy', e, now)
        const el = this.els.includes('L') && pw('L') >= STATIC_CUTOFF ? 'L' : this.els.reduce((a, b) => (pw(b) > pw(a) ? b : a))
        // Bursts: two quick lights, then a heavy from its freshest element (lights alone do too little).
        this.spamN = (this.spamN + 1) % 3
        if (this.spamN === 0) return this.cast(this.els.reduce((a, b) => (pw(b) > pw(a) ? b : a)), 'h', sp)
        return this.cast(el, 'line', sp)
      }
      case 'setup': {
        // Chill first; then the big hit, started the moment the chill is thrown so it lands inside the chill.
        // A heavy, not a signature: a signature takes too long to draw to arrive in time.
        if (!this.followUp && !(v.chill.player > 0) && this.els.includes('I')) {
          this.followUp = true
          return this.cast('I', Math.random() < 0.5 ? 'line' : 'h', sp)
        }
        this.followUp = false
        const big = this.els.filter((e) => e !== 'I')
        return this.cast(big.length ? big[Math.floor(Math.random() * big.length)] : this.nextEl(), 'h', sp)
      }
      case 'curser': {
        // Nov 25: a slow, obvious setup, then a sudden punish. Execute is drawn 40% faster, and only thrown if
        // a curse will still be on you when it lands. Grave (10 s of no-heal) is the main setup; Doom (2.5 s)
        // is just pressure now and then.
        const left = Math.max(v.noHeal.player, v.exposed.player, v.fog.player, v.chillMs?.player ?? 0)
        if (has('blade') && !(v.shield.player > 0)) {
          const ex = this.cast('U', 'blade', sp)
          const quick = { ...ex, drawMs: ex.drawMs * 0.45 }
          if (left > quick.chargeMs + quick.drawMs + quick.readyMs + 500) {
            this.followUp = false
            return quick
          }
        }
        // The quick setup: an Ice light (4 s of chill), and the Execute starts the moment it's thrown.
        if (has('blade') && this.els.includes('I') && !this.followUp && Math.random() < 0.5) {
          this.followUp = true
          return this.cast('I', 'line', sp)
        }
        this.followUp = false
        if (this.style.combos?.includes('grave') && !(v.noHeal.player > 0)) {
          const g = this.comboSpell(now, v, sp, true)
          if (g) return g
        }
        if (has('scythe') && !(v.doom.player > 0) && Math.random() < 0.3) return this.cast('U', 'scythe', sp)
        return null
      }
      case 'shadow': {
        // Nov 25: Shroud, then quick hidden heavies while it lasts (a slow signature gave you time to react).
        if (has('veil') && !(v.shroud.enemy > 0)) return (({ drawMs, ...c }) => ({ ...c, drawMs: drawMs * 0.7 }))(this.cast('U', 'veil', sp))
        if (v.shroud.enemy > 1500) {
          const h = this.cast(this.nextEl(), 'h', sp)
          return { ...h, drawMs: h.drawMs * 0.65 }
        }
        return null
      }
      case 'combo':
        return this.comboSpell(now, v, sp, true)
      case 'punisher': {
        if (!(v.silenced.player > 0 || v.locked.player > 0 || v.fizzled.player > 0 || v.staggered.player > 0)) return null
        const el = this.nextEl()
        return this.cast(el, SIGNATURE[el], sp)
      }
      case 'counter':
        // Its counter just landed: the punish, a quick heavy (drawn 30% faster). Otherwise it acts in react().
        if (!this.followUp) return null
        this.followUp = false
        return (({ drawMs, ...h }) => ({ ...h, drawMs: drawMs * 0.7 }))(this.cast(this.nextEl(), 'h', sp))
      default:
        return null // interrupter and mirror act in react()
    }
  }

  /** Nov 25: its own setup (chill, Exposed) is on you: the strongest spell that still lands inside it. Execute if
   *  it has one (they're cursed), else a signature, a heavy, a light, from its freshest element other than Ice
   *  (a second chill doesn't stack). Never a combo: too slow, and the setup would be wasted. */
  private payoffSpell(now: number, sp: number): ReturnType<typeof spellOf> | null {
    const p = this.payoff
    this.payoff = null
    if (!p || now >= p.until) return null
    const left = p.until - now - 250 // a little slack for the push
    const pw = (e: string) => this.combat.powerOf('enemy', e, now)
    const pool = this.els.filter((e) => e !== 'I')
    const el = (pool.length ? pool : this.els).reduce((a, b) => (pw(b) > pw(a) ? b : a))
    const tries: [string, string, number][] = [
      ...(this.magic.includes('blade') ? [['U', 'blade', FLY_MS.signature] as [string, string, number]] : []),
      [el, SIGNATURE[el], FLY_MS.signature],
      [el, 'h', FLY_MS.heavy],
      [el, 'line', FLY_MS.light],
    ]
    for (const [e, shape, fly] of tries) {
      const c = this.cast(e, shape, sp)
      if (c.chargeMs + c.drawMs + c.readyMs + fly <= left) return c
    }
    return null
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
    if (r?.el === 'A') this.lastPlayerHeal = now
    if (r) this.thrown = [...this.thrown.slice(-2), `${r.el}:${r.shape}`]
    if (shape === COUNTER || shape === QUICK) {
      // A real counter: you weren't bluffing, so it trusts the threat a little more again.
      this.baitCheck = null
      this.baits = Math.max(0, this.baits - 1)
    }
    // How long you take from charge to throw (it learns your pace to time its counters).
    if (this.playerCharge && shape && shape !== QUICK) this.castTimes = [...this.castTimes.slice(-2), now - this.playerCharge.since]
    if (shape && shape !== COUNTER && r?.el !== 'A') this.unanswered++
    if (shape && shape !== COUNTER && r?.el !== 'A') this.moves = [...this.moves.slice(-5), kindOf(shape)]
    this.playerCharge = null
    // A regen keeps ticking after the throw, so a counter already planned against it still goes.
    if (!(r?.el === 'A' && r.shape === 'hourglass')) this.reactAt = null
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
    // Cleanse (Nov 25): healers star off a burn, chill or static once they've taken some damage; smarter ones more often.
    const afflicted = v.burning.enemy || v.chillMs.enemy > 0 || v.static.enemy !== null || v.noHeal.enemy > 0 || v.exposed.enemy > 0 || v.fog.enemy > 0 || (v.doom?.enemy ?? 0) > 0
    if (s.healBelow > 0 && afflicted && (v.wear?.enemy?.A ?? 100) >= 100 && hpShare < 0.9 && now - this.lastHeal > 6000 && Math.random() < 0.25 + 0.5 * s.smart) {
      this.lastHeal = now
      return this.cast('A', 'star', sp)
    }
    // Low: regen is the bigger heal; the star when very low (it lands at once).
    if (hpShare < s.healBelow && now - this.lastHeal > 6000 && Math.random() < (s.capitalize ? 0.85 : 0.5)) {
      this.lastHeal = now
      return this.cast('A', hpShare < s.healBelow / 2 ? 'star' : 'hourglass', sp)
    }
    const pay = this.payoffSpell(now, sp)
    if (pay) return pay
    if (s.habit === 'exam' && s.examOf?.length) this.cur = s.examOf[Math.floor(Math.random() * s.examOf.length)]
    const habit = this.habitSpell(now, v, sp)
    if (habit) {
      if (Math.random() < 0.35) this.bark('habit', now)
      return habit
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
        return this.cast(el, SIGNATURE[el], sp)
      }
    }
    // Steam fogged it: smart ones burn the misses off with quick lights instead of wasting a big spell.
    if (v.fogShots.enemy > 0 && s.smart >= 0.3 && Math.random() < lerp(0.3, 1, s.smart)) return this.cast(this.nextEl(), 'line', sp)
    // Your armor is up: quick light hits wear it down faster than waiting on a big spell.
    if (v.shield.player > 0 && (!s.moves || s.moves.line) && Math.random() < lerp(0.1, 0.6, s.smart)) return this.cast(this.anyEl(), 'line', sp)
    // You're repeating yourself and getting away with it: throw something that stuns you or knocks
    // your charge off (more likely vs light attacks, which are too quick to counter).
    const repeating = predict(this.moves) !== null || predict(this.history) !== null
    const stun = s.stun * (predict(this.moves) === 'L' ? 1.3 : 1)
    if (repeating && this.unanswered >= 2 && Math.random() < stun && !(v.hp.player / v.maxHp.player < 0.2)) {
      // Lightning too worn for static (under STATIC_CUTOFF) can't stop anything.
      const stoppers = ANTI_LIGHT.filter(([el]) => this.els.includes(el) && (el !== 'L' || this.combat.powerOf('enemy', 'L', now) >= STATIC_CUTOFF))
      if (stoppers.length) {
        const [el, shape] = stoppers[Math.floor(Math.random() * stoppers.length)]
        return this.cast(el, shape, sp)
      }
    }
    const el = this.nextEl()
    const moves = s.moves ? Object.entries(s.moves).map(([v, w]) => ({ w, v })) : ENEMY_MOVES.map((m) => ({ w: m.w, v: m.shape }))
    // Readers (Warden and up) pick the moment: big spells while you're drawing (you'd have to drop your
    // spell to answer), lights while you're idle and ready to counter or parry.
    if (s.read > 0) {
      const drawingNow = this.playerStrokeAt !== null && now - this.playerStrokeAt > 200
      const k = lerp(1, 1.8, Math.min(1, s.read * 1.5))
      for (const m of moves) {
        if (drawingNow && m.v !== 'line') m.w *= k
        if (!drawingNow && !v.charge.player && m.v === 'line') m.w *= k
      }
    }
    let shape = pick(moves)
    if (s.capitalize && v.silenced.player > 1200) shape = 'signature' // you can't counter it now
    else if (s.capitalize && v.hp.player / v.maxHp.player < 0.2) shape = 'line' // finish fast
    return this.cast(el, shape === 'signature' ? SIGNATURE[el] : shape, sp)
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
    } else if ((this.style.smart >= 0.5 || this.style.read > 0) && this.els.length > 1) {
      // Smart ones rotate: fresher elements (less wear) are more likely.
      const now = performance.now()
      el = pick(this.els.map((x) => ({ w: this.combat.powerOf('enemy', x, now) ** 3, v: x })))
    } else el = this.anyEl()
    this.lastEl = el
    return el
  }

  /** Intro bots: once it's been charging a while, the element that counters it. */
  private hint(now: number) {
    const e = this.enemy
    if (!e || e.counter) return null
    // A combo: once its mix is locked in, the combo counterspell (C + the two elements that beat it).
    if (e.el in COMBO_MIX) {
      const ms = this.style.comboHintMs ?? this.style.hintMs
      if (ms === undefined || this.combat.chargeOf('enemy') !== e.el || now - e.start < ms) return null
      return mixCounter(COMBO_MIX[e.el].map(beaterOf))
    }
    const ms = this.style.hintMs
    if (ms === undefined || !(e.el in BEATS) || now - e.start < ms) return null
    return beaterOf(e.el)
  }

  /** One of its combos (plans/ai-combos.md). Smart ones pick the one that fits the moment; the intro
   *  bots just throw theirs now and then. Never the same combo twice in a row. */
  private comboSpell(now: number, v: CombatView, sp: number, force = false) {
    const s = this.style
    if (!COMBOS_ON || !s.combos?.length || (!force && Math.random() >= (s.comboRate ?? 0))) return null
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
    return this.cast(c, COMBO_SHAPE[c], sp)
  }

  /** Angelic buffs and Unholy curses, when one fits the moment. */
  private utilitySpell(v: CombatView, sp: number) {
    const s = this.style
    // Doomed: throw its freshest element fast (a worn one wouldn't lift Doom).
    if (v.doom.enemy > 0) {
      const now = performance.now()
      return this.cast(this.els.reduce((a, b) => (this.combat.powerOf('enemy', b, now) > this.combat.powerOf('enemy', a, now) ? b : a)), 'line', sp)
    }
    if (Math.random() >= s.utility) return null
    const armored = v.shield.player > 0
    const cursed = this.combat.cursed('player', performance.now())
    const opts: { w: number; v: [string, string] }[] = [
      // Execute: saved for when you're cursed (double damage) and your armor is gone (armor would soak it).
      { w: armored ? lerp(0.5, 0, s.smart) : cursed ? lerp(1, 5, s.smart) : lerp(0.5, 0.1, s.smart), v: ['U', 'blade'] },
      // Doom: its 30 lands as a direct hit, which armor can't stop from being a threat: better vs armor.
      { w: armored ? lerp(1, 4, s.smart) : 1, v: ['U', 'scythe'] },
      { w: v.shroud.enemy > 0 ? 0 : 1, v: ['U', 'veil'] },
      { w: v.shield.enemy > 0 ? 0 : 1, v: ['A', 'aegis'] },
    ]
    const allowed = opts.filter((o) => this.magic.includes(o.v[1]))
    if (!allowed.some((o) => o.w > 0)) return null
    const [el, shape] = pick(allowed)
    return this.cast(el, shape, sp)
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
          const base = this.cast(el, 'circle', this.speed(now))
          this.enemy = { ...base, readyMs: COUNTER_READY_MS, start: now, ends: now + base.chargeMs + base.drawMs + COUNTER_READY_MS, counter: true }
          this.combat.sign('enemy', el, now)
        } else if (!e && r < lerp(0.2, 0.6, s.smart)) this.nextEnemyAt = Math.min(this.nextEnemyAt, now)
      }
      return
    }
    // Interrupter: once you start drawing, it rolls again (it lives for your long drawings).
    const drawingNow = this.playerStrokeAt !== null && now - this.playerStrokeAt > 200
    if (pc && this.cur === 'interrupter' && drawingNow && !pc.drawRolled && !pc.countered && this.reactAt === null) {
      pc.drawRolled = true
      pc.rollAt = now
    }
    if (pc && this.reactAt === null && now >= pc.rollAt) {
      pc.rollAt = s.reroll ? now + s.reroll : Infinity // still charging later (a long heavy): roll again
      const combo = pc.el in COMBO_MIX
      // heals: any element's counterspell stops them; combos: only a combo counterspell
      const counterable = combo ? !!s.comboCounter : pc.el === 'A' || (pc.el in BEATS && this.own.includes(beaterOf(pc.el)))
      // Spamming: the same element spamAt+ times in a row (counting this one) and it's ready for it.
      const h = this.history
      const n = s.spamAt ?? 3
      const spam = s.spamCounter > 0 && h.length >= n && h.slice(-n).every((x) => x === pc.el)
      // Its guess at what you're about to throw: light means interrupt fast, heavy means circle.
      const healing = pc.el === 'A'
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
      // Habits that live on countering: they try far more often (still within their skill's timing).
      const st = s.habitStrength ?? 0
      let lean = 0
      if (this.cur === 'counter') lean = st
      else if (this.cur === 'interrupter' && drawingNow) lean = st
      else if (this.cur === 'mirror' && pc.el === this.favorite()) lean = st
      const tried = lean && !healing ? Math.max(chance, lerp(chance, 0.95, lean)) : chance
      this.forceJab = this.cur === 'interrupter' && drawingNow && Math.random() < lean
      if (counterable && Math.random() < tried) {
        // A combo takes a moment longer to recognize (which two elements, which counter pair).
        const ms = (s.reactMs[0] + Math.random() * (s.reactMs[1] - s.reactMs[0]) + (combo ? 400 : 0)) * (this.forceJab ? 0.6 : 1)
        const quick = guess === 'L' ? lerp(1, 0.45, s.read) : guess === 'H' ? lerp(1, 0.5, s.read) : 1
        const ready = expected ? lerp(1, 0.6, s.read) : again ? 0.5 : healing && low && s.read ? 0.7 : 1
        this.reactAt = now + ms * Math.min(quick, ready, spam ? lerp(0.8, 0.5, Math.min(1, s.read * 2)) : 1)
        // Expecting it (spam or a pattern) and it knows your pace: react in time to land an interrupt
        // before you throw, but never quicker than 250 ms (no mind-reading).
        // Spam is timed this way on every rung (mashing is the one thing even Adept reads).
        if ((spam || (s.read > 0 && (guess || expected))) && this.castTimes.length) {
          const hold = Math.max(SIGN_HOLD_MS, COUNTER_HOLD_MS * this.speed(now))
          const latest = pc.since + Math.min(...this.castTimes) - hold - 160 - 60
          this.reactAt = Math.max(now + 250, Math.min(this.reactAt, latest))
        }
        this.spam = spam
        this.guess = guess
        this.reactTo = pc.el
        pc.countered = true
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
    const healing = this.reactTo === 'A'
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
    // Vs heavies it wants the circle (a stun leaves room for a big punish), and each heavy you
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
    if (this.forceJab && !healing && !vsCombo && !mistake) shape = 'jab' // interrupter: a quick interrupt, mid-drawing
    this.forceJab = false
    if (!canQuick(el)) shape = 'circle' // Angelic and Unholy have no quick interrupt
    const base = this.cast(el, shape, this.speed(now), hold)
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
    const base = this.cast(mixCounter(['F', 'I']), 'circle', this.speed(now), hold * 2)
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
    const sp = this.cast(el, shape, this.speed(now))
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
  /** Parry: once per spell you throw at it, it may try; a try is timed into the window or mistimed (too early). */
  private parryCheck(now: number) {
    const s = this.style
    if (!(s.parry || s.reparry)) return
    for (const b of this.combat.view(now).bolts) {
      if (b.to !== 'enemy' || !b.parryable || b.parried || b.landed || this.parrySeen.has(b.id)) continue
      this.parrySeen.add(b.id)
      if (this.parryAt !== null) continue // already set to parry something
      const lands = b.t + b.fly
      const win = b.parryMs ?? PARRY_WINDOW_MS
      const combo = b.el in COMBO_MIX
      const heavy = s.parry ?? 0
      let chance = b.reflected ? s.reparry ?? 0 : b.tier === 'light' ? heavy / 4 : combo ? heavy * 0.6 : b.tier === 'signature' ? s.parrySig ?? heavy : heavy
      // The same spell from you 3 times in a row: it knows the timing and goes for it more.
      const key = `${b.el}:${b.shape}`
      if (!b.reflected && this.thrown.length >= 2 && this.thrown.slice(-2).every((k) => k === key)) chance = Math.min(0.95, chance * 1.6)
      // It won't throw away its own heavy or bigger spell that's already being drawn (smarter ones judge it).
      const e = this.enemy
      if (e && !e.counter && e.shape !== 'line' && now - e.start > e.chargeMs && Math.random() < lerp(0.4, 1, s.smart)) chance *= 0.15
      // Its counter will be out before your spell lands: it throws that instead of parrying.
      if (e?.counter && e.ends <= lands) chance = 0
      if (Math.random() >= chance) continue
      // Bigger windows are easier to hit; a miss is a mistimed push (too early).
      const aim = Math.min(0.97, (s.parryAim ?? 0) * Math.sqrt(win / PARRY_WINDOW_MS))
      this.parryAt = Math.random() < aim ? lands - 10 - Math.random() * (win - 30) : lands - win - 80 - Math.random() * 250
      this.parryAt = Math.max(now, this.parryAt)
    }
    if (this.parryAt !== null && now >= this.parryAt) {
      this.parryAt = null
      // Win or lose, a parry gives up its own cast (same rule as yours).
      if (this.enemy) this.nextEnemyAt = Math.max(this.nextEnemyAt, now + 500)
      this.enemy = null
      this.reactAt = null
      this.combat.parry('enemy', now)
    }
  }

  private punish(now: number, silenceLeft: number) {
    const e = this.enemy
    if (e && (e.counter || now - e.start >= e.chargeMs)) return // a counter, or already drawing: let it finish
    const el = this.anyEl()
    const window = silenceLeft + PUNISH_SLACK_MS
    const sp = this.speed(now)
    // Lower tiers don't always go for the biggest spell; it's drawn at its normal pace.
    const shapes = Math.random() < lerp(0.3, 1, this.style.smart) ? [SIGNATURE[el], 'h', 'line'] : ['h', 'line']
    for (const shape of shapes) {
      const s = this.cast(el, shape, sp)
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
    if (!this.magic.includes('aegis') || !pc || pc.aegisRolled || v.shroud.player > 0 || v.shield.enemy > 0 || pc.el === 'A') return
    const r = v.ready.player
    const big = r ? r.shape !== 'line' && r.shape !== COUNTER : this.playerStrokeAt !== null && now - this.playerStrokeAt > 500
    if (!big) return
    pc.aegisRolled = true
    const e = this.enemy
    if (e && (e.counter || now - e.start >= e.chargeMs)) return // busy drawing its own spell
    if (Math.random() >= lerp(0.1, 0.5, s.smart)) return
    const sp = this.cast('A', 'aegis', this.speed(now))
    const castMs = sp.chargeMs + sp.drawMs + sp.readyMs
    // Smart: only if it lands before you'd throw (your pace, or about 1.2 s once readied).
    const left = r ? 1200 : this.castTimes.length ? pc.since + Math.min(...this.castTimes) - now : 2500
    if (Math.random() < s.smart && castMs > left) return
    this.enemy = { ...sp, start: now, ends: now + castMs }
    this.combat.sign('enemy', 'A', now)
  }

  /** The fight as the AI may read it. */
  private seen(now: number) {
    return this.combat.view(now)
  }

  update(now: number): Snapshot {
    if (this.running) {
      this.combat.update(now)
      this.parryCheck(now)
      // Your charge, as the fight sees it: the AI may react to a new one.
      // A combo still being mixed isn't a target yet; once it locks in, it reads as the combo itself
      // (only a combo counterspell stops it).
      const sv = this.seen(now)
      const pel = sv.charge.player === 'C' ? null : sv.charge.player
      if (!pel) this.playerCharge = null
      else if (this.playerCharge?.el !== pel) {
        this.playerCharge = { el: pel, since: now, rollAt: now }
        this.history = [...this.history.slice(-4), pel]
        this.favEl[pel] = (this.favEl[pel] ?? 0) + 1
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
      // Stunned (your counter or Prison landed): whatever it was casting is gone. It starts again
      // shortly after the stun ends (which can be early: your next hit ends it).
      if (this.combat.isSilenced('enemy', now)) {
        this.nextEnemyAt = Math.max(this.nextEnemyAt, now + 300)
        this.enemy = null
        this.reactAt = null
      } else {
        // Locked out (your interrupt landed, or its own interrupt whiffed): nothing it can do until it ends.
        if (this.combat.isLocked('enemy', now)) {
          this.enemy = null
          this.reactAt = null
          this.nextEnemyAt = Math.max(this.nextEnemyAt, now + 150)
        }
        // Your interrupt landed: its spell fizzled (charge gone). It drops the cast and starts over after the lock.
        if (this.enemy && !this.combat.chargeOf('enemy') && !this.combat.view(now).ready.enemy) {
          this.enemy = null
          this.reactAt = null
          this.nextEnemyAt = Math.max(this.nextEnemyAt, now + FIZZLE_LOCK_MS + 150 + Math.random() * 250)
        }
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
        this.shapeshift(now)
        // Punisher: you're stunned, locked out or fizzled: it starts its big spell right away.
        if (!this.enemy && this.cur === 'punisher' && (v.silenced.player > 0 || v.locked.player > 0 || v.fizzled.player > 0 || v.staggered.player > 0)) this.nextEnemyAt = Math.min(this.nextEnemyAt, now)
        // Counterpuncher: you're charged and it waits for you to commit, holding its own cast (up to ~2.5 s).
        if (!this.enemy && now >= this.nextEnemyAt && this.cur === 'counter' && this.playerCharge && !(v.doom.enemy > 0)) {
          this.holdSince ??= now
          if (now - this.holdSince < (2500 * (this.style.habitStrength ?? 0)) / 0.6) this.nextEnemyAt = now + 200
        } else if (!this.playerCharge) this.holdSince = null
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
          // Nov 25: the wait depends on what it just threw: a light flows into the next cast, a big spell needs a
          // breath (like a person), plus the usual jitter.
          const after = e.shape === 'line' ? 0.6 : e.el in COMBO_SHAPE ? 1.4 : e.shape === 'h' ? 1 : 1.2
          const gap = this.style.every * (this.speed(now) / this.style.speed) * after
          this.nextEnemyAt = now + gap * (1 + (Math.random() * 2 - 1) * ENEMY_JITTER)
          // A setup thrown (any Ice, Frozen Prison, Thermal, Twilight): cash it in, starting now.
          // Adept and up always do, after a short beat to react (0.6 s at Morwen down to 0.15 s at the top).
          const setupMs = e.counter || e.shape === QUICK ? 0
            : e.el === 'I' ? (e.shape === 'line' ? CHILL_MS : CHILL_HEAVY_MS)
            : e.el === 'thermal' ? CHILL_MS : e.el === 'twilight' ? TWILIGHT_MS : 0
          const delay = this.style.setupDelay
          if (setupMs && !this.followUp && delay !== undefined) {
            this.payoff = { until: now + (e.shape === 'line' ? FLY_MS.light : FLY_MS.heavy) + setupMs }
            this.nextEnemyAt = now + delay
          }
          // A counter doesn't use up its turn: it follows up sooner than usual (not instantly).
          if (e.counter) {
            this.nextEnemyAt = Math.min(this.nextEnemyAt, now + gap * (0.4 + Math.random() * 0.2))
            // Counterpuncher: the punish starts at once.
            if (this.cur === 'counter') {
              this.followUp = true
              this.nextEnemyAt = now + 150
            }
          }
          // Setup: the chill is thrown; the big hit starts now. Spammer: lights come quicker.
          else if (this.followUp) this.nextEnemyAt = now
          else if (this.cur === 'spammer' && e.shape === 'line') this.nextEnemyAt = now + (this.nextEnemyAt - now) * 0.3
          // The same rules as yours: draw (unless it's a quick interrupt), then push.
          if (e.shape !== QUICK) this.combat.drew('enemy', e.shape, now)
          if (this.combat.push('enemy', now) === 'ok' && e.shape === 'veil') {
            this.followBig = true
            this.nextEnemyAt = Math.min(this.nextEnemyAt, now + 300) // use the Shroud while it lasts
          }
        }
      }
      const vv = this.combat.view(now)
      if (!this.lowSaid && vv.hp.enemy / vv.maxHp.enemy < 0.3) {
        this.lowSaid = true
        this.bark('low', now)
      }
      if (this.combat.winner) {
        this.running = false
        this.enemy = null
        this.bark(this.combat.winner === 'enemy' ? 'win' : 'lose', now)
      }
    }
    return { ...this.combat.view(now), enemyCast: this.enemyView(now), running: this.running, hint: this.running ? this.hint(now) : null, say: this.said }
  }
}

// ---- Training dummy: infinite health. Attacks on: it throws random spells at you (you can't be hurt
// either), so you can practice parries and counters without a real fight. ------------------------
export const DUMMY_EVERY_MS = 2600 // default time between its casts
/** A dummy's next spell from its pool. While Shrouded it attacks (no second Shroud), if it has anything else. */
/** Training dummy parry: a spell about to hit a dummy is parried back (always on time) at this % chance.
 *  Rolled once per spell, so a back-and-forth chain goes on while each roll succeeds. */
export function dummyParry(combat: Combat, ids: Fid[], pct: number, seen: Set<number>, now: number) {
  if (pct <= 0) return
  for (const b of combat.view(now).bolts) {
    if (!ids.includes(b.to) || !b.parryable || b.parried || b.landed || seen.has(b.id) || b.t + b.fly - now > 60) continue
    seen.add(b.id)
    if (Math.random() * 100 < pct) combat.parry(b.to, now)
  }
}
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
  parryPct = 0 // chance it parries a spell thrown at it (always on time)
  private parrySeen = new Set<number>()
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
    dummyParry(this.combat, ['enemy'], this.parryPct, this.parrySeen, now)
    if (this.attacking) {
      // Interrupted (or knocked down): its spell is gone; it starts over after the silence.
      if (this.enemy && (this.combat.isSilenced('enemy', now) || !this.combat.chargeOf('enemy'))) {
        this.enemy = null
        this.nextEnemyAt = now + this.gapMs / 2
      }
      if (!this.enemy && this.pool.length && now >= this.nextEnemyAt && !this.combat.isSilenced('enemy', now)) {
        const [el, shape] = dummyPick(this.pool, this.combat.view(now).shroud.enemy > 0)
        const sp = dummySpell(el, shape, this.castPct / 100)
        const signs = signsFor(el) // a combo: C, then its two letters right after, then it draws
        this.enemy = { ...sp, start: now, ends: now + sp.chargeMs + sp.drawMs + sp.readyMs, signs: signTimes(sp, signs, now) }
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
