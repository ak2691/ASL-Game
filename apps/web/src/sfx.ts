// Sound effects: Web Audio playback of the files in public/sfx, plus a hook that turns
// fight changes (new throws, landings, ticks, fizzles, the result) into sounds.
import { useEffect, useRef } from 'react'
import type { CombatView, Side } from './combat'

const NAMES = [
  'ui_click', 'ui_back', 'letter', 'lockin', 'match_start', 'countdown_tick', 'fizzle_tone', 'fizzle_poof',
  'counter_cast', 'counter_hit', 'counter_miss', 'interrupt', 'hurt', 'heavy_layer', 'heartbeat', 'win', 'lose',
  'burn_tick', 'chill_tick', 'mend_tick', 'static_tick', 'regen_tick',
  ...['F', 'I', 'W', 'E', 'L'].flatMap((e) => [`${e}_cast`, `${e}_travel`, `${e}_impact`]),
  'H_impact', 'F_impact2',
  'charge_F', 'charge_I', 'charge_W', 'charge_E', 'charge_L', 'charge_H',
  'E_impact2', 'sig_F', 'sig_I', 'sig_L', 'sig_E', 'sig_W',
] as const
export type Sfx = (typeof NAMES)[number]
/** Spells with no sounds of their own borrow an element's, pitched (Unholy: low and eerie). */
const SOUND_OF: Record<string, [string, number]> = { U: ['I', 0.6], magma: ['F', 0.8], storm: ['L', 0.85], blizzard: ['I', 0.85], twilight: ['W', 0.7] }

const VOL_KEY = 'sfx-volume'
let ctx: AudioContext | null = null
let master: GainNode | null = null
const buffers = new Map<string, AudioBuffer>()
let volume = (() => {
  try {
    const v = parseFloat(localStorage.getItem(VOL_KEY) ?? '')
    return Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : 0.6
  } catch {
    return 0.6
  }
})()

function init() {
  if (ctx) return
  ctx = new AudioContext()
  master = ctx.createGain()
  master.gain.value = volume
  master.connect(ctx.destination)
  for (const n of NAMES)
    fetch(`${import.meta.env.BASE_URL}sfx/${n}.ogg`)
      .then((r) => r.arrayBuffer())
      .then((b) => ctx!.decodeAudioData(b))
      .then((buf) => buffers.set(n, buf))
      .catch(() => {})
}

// Browsers only allow audio after a user gesture: start on the first click or key.
if (typeof window !== 'undefined') {
  const unlock = () => {
    init()
    ctx?.resume()
  }
  window.addEventListener('pointerdown', unlock, { capture: true })
  window.addEventListener('keydown', unlock, { capture: true })
}

/** Play a sound. `pitch` 1 = as recorded; a little random variance keeps repeats from sounding robotic. */
export function play(name: Sfx, opts: { vol?: number; pitch?: number; delay?: number } = {}) {
  if (!ctx || !master || volume === 0) return
  const buf = buffers.get(name)
  if (!buf) return
  const src = ctx.createBufferSource()
  src.buffer = buf
  src.playbackRate.value = (opts.pitch ?? 1) * (0.95 + Math.random() * 0.1)
  const g = ctx.createGain()
  g.gain.value = (opts.vol ?? 1) * (0.92 + Math.random() * 0.08)
  src.connect(g).connect(master)
  src.start(ctx.currentTime + (opts.delay ?? 0) / 1000)
}

export const getVolume = () => volume
/** 0 = silent, 1 = full. Remembered between visits. */
export function setVolume(v: number) {
  volume = Math.max(0, Math.min(1, v))
  if (master) master.gain.value = volume
  try {
    localStorage.setItem(VOL_KEY, String(volume))
  } catch {
    /* private mode */
  }
}

// UI: a click on any button.
if (typeof document !== 'undefined')
  document.addEventListener('click', (e) => {
    if ((e.target as Element).closest?.('button')) play('ui_click', { vol: 0.5 })
  })

/** Sounds for a fight. `me` is the side this screen plays as. */
export function useFightSfx(v: CombatView & { running?: boolean }, me: Side, isMatch: boolean) {
  const seen = useRef(new Set<number>()) // bolts we've started
  const landed = useRef(new Set<number>()) // counters whose result we've played
  const floats = useRef(new Set<number>())
  const prev = useRef<(CombatView & { running?: boolean }) | null>(null)
  const beat = useRef(0)

  useEffect(() => {
    const p = prev.current
    prev.current = v
    const now = performance.now()

    // Match start / end.
    if (isMatch && v.running && p && !p.running) play('match_start', { vol: 0.6 })
    if (v.over && !p?.over) play(v.over === me ? 'win' : 'lose', { vol: 0.9 })

    // Your sign and your shape locking in.
    if (v.charge[me] && v.charge[me] !== p?.charge[me]) {
      const [c, pitch] = SOUND_OF[v.charge[me]!] ?? [v.charge[me]!, 1]
      play((c === 'C' ? 'charge' : `charge_${c}`) as Sfx, { vol: 0.6, pitch })
    }
    if (v.ready[me] && !p?.ready[me]) play('lockin', { vol: 0.6 })

    // Fizzles (static, faded, bad throw), either side.
    for (const s of ['player', 'enemy'] as Side[])
      if (v.fizzled[s] > 0 && !(p && p.fizzled[s] > 0)) {
        play('fizzle_tone', { vol: 0.6 })
        play('fizzle_poof', { vol: 0.7 })
      }

    for (const b of v.bolts) {
      // A new throw: cast + travel now, impact when it lands.
      if (!seen.current.has(b.id)) {
        seen.current.add(b.id)
        if (b.kind === 'fizzle') continue // the fizzle sound above covers it
        const interrupt = b.name.endsWith('Interrupt')
        if (b.kind === 'counter') {
          play(interrupt ? 'interrupt' : 'counter_cast', { vol: 0.8 })
          continue // result plays when it lands
        }
        const [base, low] = SOUND_OF[b.el] ?? [b.el, 1]
        const el = base as 'F' | 'I' | 'W' | 'E' | 'L' | 'H'
        const big = b.tier === 'signature'
        const heavy = b.tier === 'heavy'
        if (el === 'H') {
          play('H_impact', { vol: 0.8 })
          continue
        }
        play(`${el}_cast`, { vol: 0.7, pitch: low })
        play(`${el}_travel`, { vol: 0.5, pitch: (big ? 0.85 : 1) * low })
        if (big && el === 'F') play('sig_F', { vol: 0.8 }) // the meteor whistles on the way down
        const at = { delay: b.fly }
        const pitch = (heavy ? 0.85 : big ? 0.8 : 1) * low
        play(`${el}_impact`, { ...at, vol: 1, pitch })
        if (el === 'E') play('E_impact2', { ...at, vol: big ? 1 : 0.6 })
        if (el === 'F') play('F_impact2', { ...at, vol: 0.8 })
        if (heavy || big) play('heavy_layer', { ...at, vol: big ? 0.9 : 0.6 })
        if (big && el !== 'F') play(`sig_${el}` as Sfx, { ...at, vol: 0.9 })
        if (b.from !== me) play('hurt', { ...at, vol: 0.5 })
      }
      // A counter arrives: hit or miss.
      if ((b.kind === 'counter' || b.kind === 'missed') && b.landed && !landed.current.has(b.id)) {
        landed.current.add(b.id)
        play(b.kind === 'counter' ? 'counter_hit' : 'counter_miss', { vol: 0.9 })
      }
    }

    // Over-time effects tick as small sounds (damage/heal floats with no bolt landing right now).
    for (const f of v.floats) {
      if (floats.current.has(f.id)) continue
      floats.current.add(f.id)
      const n = Number(f.text)
      if (!Number.isFinite(n)) continue
      const landing = v.bolts.some((b) => Math.abs(b.t + (b.kind === 'heal' ? 0 : b.fly) - f.t) < 60)
      if (landing) continue
      if (n < 0 && v.burning[f.side]) play('burn_tick', { vol: 0.5 })
      else if (n > 0 && v.regen[f.side]) play('regen_tick', { vol: 0.4 })
      else if (n > 0) play('mend_tick', { vol: 0.5 })
    }

    // Chill mark applied, static pulse starting.
    for (const s of ['player', 'enemy'] as Side[]) {
      if (v.chill[s] > 0 && !(p && p.chill[s] > 0)) play('chill_tick', { vol: 0.5, delay: 120 })
      if (v.static[s] === 'on' && p?.static[s] !== 'on') play('static_tick', { vol: 0.4 })
    }

    // Low HP heartbeat (yours), faster the lower it gets.
    const frac = v.hp[me] / v.maxHp[me]
    if (v.running && !v.over && frac > 0 && frac < 0.25) {
      const gap = 450 + frac * 2400
      if (now - beat.current > gap) {
        beat.current = now
        play('heartbeat', { vol: 0.7 })
      }
    }

    // Forget old ids.
    if (seen.current.size > 300) {
      const live = new Set(v.bolts.map((b) => b.id))
      for (const id of seen.current) if (!live.has(id)) seen.current.delete(id)
      for (const id of landed.current) if (!live.has(id)) landed.current.delete(id)
    }
    if (floats.current.size > 300) {
      const live = new Set(v.floats.map((f) => f.id))
      for (const id of floats.current) if (!live.has(id)) floats.current.delete(id)
    }
  }, [v, me, isMatch])
}
