// Player settings saved between visits (home Settings panel and the in-game Esc menu).
import type { Hand } from './recognition'
import { COMBOS_ON, COMBO_SHAPE, SIGNATURE, shapesFor } from './spells'

export const DRAW_HAND_KEY = 'spells-draw-hand'
export function loadDrawHand(): Hand {
  try {
    const v = localStorage.getItem(DRAW_HAND_KEY)
    if (v === 'left' || v === 'right') return v
  } catch {
    /* fall through */
  }
  return 'right' // most players are right-handed: the right hand draws, the left signs
}

// Sign delay: how long a letter (or open hand) must be held before it counts. 0 = instant; players who
// get misreads while moving between letters can add up to 100 ms. Read live every frame.
export const SIGN_DELAY_KEY = 'spells-sign-delay'
export const SIGN_DELAY_MAX = 100
const clampDelay = (v: number) => Math.min(SIGN_DELAY_MAX, Math.max(0, Math.round(v / 10) * 10))
let signDelay = (() => {
  try {
    return clampDelay(Number(localStorage.getItem(SIGN_DELAY_KEY)) || 0)
  } catch {
    return 0
  }
})()
export const getSignDelay = () => signDelay
export function setSignDelay(v: number) {
  signDelay = clampDelay(v)
  try {
    localStorage.setItem(SIGN_DELAY_KEY, String(signDelay))
  } catch {
    /* not saved */
  }
}

// Push sensitivity: how much the hand must grow on screen (move toward the camera) to throw or parry.
// Lower = a smaller push counts (less effort, but leaning in can set it off). Read live every frame.
export const PUSH_KEY = 'spells-push'
// Stored as a growth ratio (1.2 = the hand looks 20% bigger). Players set it as a whole percent, 1 to 100.
export const PUSH_MIN = 1
export const PUSH_MAX = 100
export const PUSH_DEFAULT = 1.2
const clampPush = (g: number) => 1 + Math.min(PUSH_MAX, Math.max(PUSH_MIN, Math.round((g - 1) * 100))) / 100
let push = (() => {
  try {
    const v = Number(localStorage.getItem(PUSH_KEY))
    return v > 1 ? clampPush(v) : PUSH_DEFAULT
  } catch {
    return PUSH_DEFAULT
  }
})()
export const getPushGrowth = () => push
export function setPushGrowth(v: number) {
  push = clampPush(v)
  try {
    localStorage.setItem(PUSH_KEY, String(push))
  } catch {
    /* not saved */
  }
}

// Drawing zoom (Nov 27): on 2v2 cards, a foe's small drawing is zoomed in to stay readable. Until set, on for
// phones and tablets (touch screens, where the cards are small), off on desktop. Read live every render.
const ZOOM_KEY = 'spells-drawing-zoom'
let drawingZoom = (() => {
  const touch = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches
  try {
    const v = localStorage.getItem(ZOOM_KEY)
    return v === null ? touch : v === '1'
  } catch {
    return touch
  }
})()
export const getDrawingZoom = () => drawingZoom
export function setDrawingZoom(on: boolean) {
  drawingZoom = on
  try {
    localStorage.setItem(ZOOM_KEY, on ? '1' : '0')
  } catch {
    /* not saved */
  }
}

// Training dummy: which spells it may throw when attacking, as "element:shape" ("F:line", "A:star", ...).
export const DUMMY_POOL_KEY = 'spells-dummy-pool'
export const DUMMY_ELEMENTS = ['F', 'I', 'W', 'E', 'L', 'A', 'U']
export const DUMMY_COMBOS = COMBOS_ON ? Object.keys(COMBO_SHAPE) : []
export const ALL_DUMMY_SPELLS = [...DUMMY_ELEMENTS, ...DUMMY_COMBOS].flatMap((el) => shapesFor(el).map((sh) => `${el}:${sh}`))
export const DUMMY_POOL2_KEY = 'spells-dummy-pool-2' // the second enemy's spells
export const DUMMY_TWO_KEY = 'spells-dummy-two' // '1' = a second enemy
export function loadDummyPool(key = DUMMY_POOL_KEY): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(key) ?? 'null')
    if (Array.isArray(v)) {
      // Older saves used "F:signature" (the element's signature shape) and had no Angelic or Unholy: those start on.
      const old = v.some((x) => typeof x === 'string' && x.endsWith(':signature'))
      // Angelic became Angelic (Nov 25): saved "H:star" is now "A:star".
      const pool = v.map((x) => (typeof x === 'string' && x.endsWith(':signature') ? `${x[0]}:${SIGNATURE[x[0]]}` : typeof x === 'string' && x.startsWith('H:') ? `A:${x.slice(2)}` : x))
      if (old) pool.push(...ALL_DUMMY_SPELLS.filter((k) => k[0] === 'A' || k[0] === 'U'))
      return pool.filter((x) => ALL_DUMMY_SPELLS.includes(x))
    }
  } catch {
    /* fall through */
  }
  return ALL_DUMMY_SPELLS
}
export function saveDummyPool(pool: string[], key = DUMMY_POOL_KEY) {
  try {
    localStorage.setItem(key, JSON.stringify(pool))
  } catch {
    /* not saved */
  }
}
export function loadDummyTwo() {
  try {
    return localStorage.getItem(DUMMY_TWO_KEY) === '1'
  } catch {
    return false
  }
}
export function saveDummyTwo(on: boolean) {
  try {
    localStorage.setItem(DUMMY_TWO_KEY, on ? '1' : '0')
  } catch {
    /* not saved */
  }
}

// Training dummy pace: cast time as a % of the default, and the time between casts (ms).
const DUMMY_PACE_KEY = 'spells-dummy-pace'
export const CAST_PCT = { min: 50, max: 200 }
export const GAP_MS = { min: 500, max: 8000, def: 2600 }
// spellPct (Nov 26): each spell's own speed, % of its default cast ("el:shape" keys; missing = 100). castPct then
// scales every spell on top. template: the tower wizard whose speeds were applied (cleared by a manual edit).
export const SPELL_PCT = { min: 25, max: 300 }
export type DummyPace = { castPct: number; gapMs: number; parryPct: number; spellPct: Record<string, number>; template: string | null }
const cleanSpellPct = (v: unknown): Record<string, number> =>
  v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).filter(([, x]) => typeof x === 'number').map(([k, x]) => [k, Math.min(SPELL_PCT.max, Math.max(SPELL_PCT.min, x as number))])) : {}
export function loadDummyPace(): DummyPace {
  try {
    const v = JSON.parse(localStorage.getItem(DUMMY_PACE_KEY) ?? 'null')
    if (v && typeof v.castPct === 'number' && typeof v.gapMs === 'number')
      return { castPct: Math.min(CAST_PCT.max, Math.max(CAST_PCT.min, v.castPct)), gapMs: Math.min(GAP_MS.max, Math.max(GAP_MS.min, v.gapMs)), parryPct: typeof v.parryPct === 'number' ? Math.min(100, Math.max(0, v.parryPct)) : 0, spellPct: cleanSpellPct(v.spellPct), template: typeof v.template === 'string' ? v.template : null }
  } catch {
    /* fall through */
  }
  return { castPct: 100, gapMs: GAP_MS.def, parryPct: 0, spellPct: {}, template: null }
}
export function saveDummyPace(p: DummyPace) {
  try {
    localStorage.setItem(DUMMY_PACE_KEY, JSON.stringify(p))
  } catch {
    /* not saved */
  }
}

// Training dummy aids: show the element that counters its charge, and the parry timing rings.
const DUMMY_AIDS_KEY = 'spells-dummy-aids'
export type DummyAids = { hint: boolean; parryTimer: boolean }
export function loadDummyAids(): DummyAids {
  try {
    return { hint: false, parryTimer: true, ...JSON.parse(localStorage.getItem(DUMMY_AIDS_KEY) ?? '{}') }
  } catch {
    return { hint: false, parryTimer: true }
  }
}
export function saveDummyAids(a: DummyAids) {
  try {
    localStorage.setItem(DUMMY_AIDS_KEY, JSON.stringify(a))
  } catch {
    /* not saved */
  }
}

/** Practice opponents' lines (speech bubbles): on unless turned off in the menu. */
const CHATTER_KEY = 'spells-chatter'
export function loadChatter() {
  try {
    return localStorage.getItem(CHATTER_KEY) !== '0'
  } catch {
    return true
  }
}
export function saveChatter(on: boolean) {
  try {
    localStorage.setItem(CHATTER_KEY, on ? '1' : '0')
  } catch {
    /* not saved */
  }
}

