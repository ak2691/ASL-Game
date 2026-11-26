// Sound effects: Web Audio playback of the files in public/sfx, plus a hook that turns
// fight changes (new throws, landings, ticks, fizzles, the result) into sounds.
import { useEffect, useRef } from 'react'
import type { CombatView, Side } from './combat'

const NAMES = [
  'ui_click', 'ui_back', 'letter', 'lockin', 'match_start', 'countdown_tick', 'fizzle_tone', 'fizzle_poof',
  'counter_cast', 'counter_hit', 'counter_miss', 'interrupt', 'hurt', 'heavy_layer', 'heartbeat', 'win', 'lose',
  'burn_tick', 'chill_tick', 'mend_tick', 'static_tick', 'regen_tick',
  ...['F', 'I', 'W', 'E', 'L'].flatMap((e) => [`${e}_cast`, `${e}_travel`, `${e}_impact`]),
  'A_impact', 'F_impact2',
  'charge', 'charge_F', 'charge_I', 'charge_W', 'charge_E', 'charge_L', 'charge_A', // 'charge': C (a combo)
  'E_impact2', 'sig_F', 'sig_I', 'sig_L', 'sig_E', 'sig_W',
] as const
export type Sfx = (typeof NAMES)[number]
/** Spells with no sounds of their own borrow an element's, pitched (Unholy: low and eerie). */
const SOUND_OF: Record<string, [string, number]> = { U: ['I', 0.6], magma: ['F', 0.8], storm: ['L', 0.85], glacier: ['I', 0.6], twilight: ['W', 0.7], steam: ['W', 0.9], thermal: ['I', 0.9], plasma: ['L', 0.7], sunfire: ['F', 1.1], grave: ['I', 0.5] }

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
  // A limiter on the way out: layered hits stay loud without clipping into distortion.
  const limit = ctx.createDynamicsCompressor()
  limit.threshold.value = -6
  limit.knee.value = 6
  limit.ratio.value = 12
  limit.attack.value = 0.002
  limit.release.value = 0.15
  master.connect(limit).connect(ctx.destination)
  for (const n of NAMES)
    fetch(`${import.meta.env.BASE_URL}sfx/${n}.ogg`)
      .then((r) => r.arrayBuffer())
      .then((b) => ctx!.decodeAudioData(b))
      .then((buf) => buffers.set(n, buf))
      .catch(() => {})
}

// Browsers only allow audio after a user gesture: start on the first click or key.
// Phones also suspend audio when the page is hidden, the screen locks or a call or notification takes the
// audio over. A fight has no taps (you sign), so it must wake by itself (Nov 26: sounds dropped out until
// the next tap): when the page shows again, and before any sound plays.
if (typeof window !== 'undefined') {
  const unlock = () => {
    init()
    wake()
  }
  window.addEventListener('pointerdown', unlock, { capture: true })
  window.addEventListener('keydown', unlock, { capture: true })
  document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && wake())
}
function wake() {
  if (ctx && ctx.state !== 'running' && ctx.state !== 'closed') ctx.resume().catch(() => {})
}

/** Play a sound. `pitch` 1 = as recorded; a little random variance keeps repeats from sounding robotic. */
export function play(name: Sfx, opts: { vol?: number; pitch?: number; delay?: number } = {}) {
  if (!ctx || !master || volume === 0) return
  wake()
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

/** A burst of filtered noise: `type`/`freq` shape it, it fades out over `ms`. */
let noiseBuf: AudioBuffer | null = null
/** Impacts still ringing (end times). Capped so a volley can't flood the audio thread and drop out. */
const impactEnds: number[] = []
const MAX_IMPACTS = 6

function noiseHit(opts: { type: BiquadFilterType; freq: number; q?: number; ms: number; vol: number; t: number }) {
  if (!ctx || !master) return
  // One shared 2 s noise buffer, played from a random offset: no per-hit allocation.
  if (!noiseBuf) {
    noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate)
    const d = noiseBuf.getChannelData(0)
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1
  }
  const src = ctx.createBufferSource()
  src.buffer = noiseBuf
  const f = ctx.createBiquadFilter()
  f.type = opts.type
  f.frequency.value = opts.freq
  f.Q.value = opts.q ?? 0.8
  const g = ctx.createGain()
  g.gain.setValueAtTime(opts.vol, opts.t)
  g.gain.exponentialRampToValueAtTime(0.0001, opts.t + opts.ms / 1000)
  src.connect(f).connect(g).connect(master)
  src.start(opts.t, Math.random() * (2 - opts.ms / 1000))
  src.stop(opts.t + opts.ms / 1000)
}

/** A hard hit made in code, in layers: a bright crack (the moment of contact, heard on any speaker), a
 *  mid body, a deep sub sweeping down, and a low rumble tail so it rings out. `size` 0..1 scales it. */
export function impact(size: number, delay = 0) {
  if (!ctx || !master || volume === 0) return
  wake()
  const t = ctx.currentTime + delay / 1000
  const s = Math.max(0, Math.min(1, size))
  for (let i = impactEnds.length - 1; i >= 0; i--) if (impactEnds[i] <= ctx.currentTime) impactEnds.splice(i, 1)
  if (impactEnds.length >= MAX_IMPACTS) return // already loud: one more hit adds nothing audible
  impactEnds.push(t + (450 + 650 * s) / 1000)
  noiseHit({ type: 'bandpass', freq: 2600, q: 0.7, ms: 45 + 25 * s, vol: 0.9, t }) // crack
  thump({ from: 260, to: 110, ms: 160 + 120 * s, vol: 0.6, delay }) // body
  thump({ from: 120 - 25 * s, to: 38 - 6 * s, ms: 320 + 380 * s, vol: 1, delay }) // sub
  noiseHit({ type: 'lowpass', freq: 380 - 120 * s, q: 0.5, ms: 450 + 650 * s, vol: 0.35 + 0.25 * s, t }) // rumble tail
}

/** A deep thump made in code (a sine sweeping down), layered under impacts that need weight. */
export function thump(opts: { from: number; to: number; ms: number; vol: number; delay?: number }) {
  if (!ctx || !master || volume === 0) return
  const t = ctx.currentTime + (opts.delay ?? 0) / 1000
  const o = ctx.createOscillator()
  const g = ctx.createGain()
  o.type = 'sine'
  o.frequency.setValueAtTime(opts.from, t)
  o.frequency.exponentialRampToValueAtTime(opts.to, t + opts.ms / 1000)
  g.gain.setValueAtTime(0.0001, t)
  g.gain.exponentialRampToValueAtTime(opts.vol, t + 0.006) // sharp attack: the punch
  g.gain.exponentialRampToValueAtTime(0.0001, t + opts.ms / 1000)
  o.connect(g).connect(master)
  o.start(t)
  o.stop(t + opts.ms / 1000 + 0.02)
}

// Drawing: "soft graphite", made in code: pink noise (less harsh than white noise, which sounded sandy)
// in a narrow band around 1.5 kHz with the top cut. As loud as the fingertip is fast.
// One voice for you, one quieter for the enemy, panned to their side. Picked by ear on a test page.
const PENCIL_VOL = 1.4 // loudness: about as noticeable as the first pencil sound (the narrow band is quieter at the same gain)
type Voice = { gain: GainNode }
const voices = new Map<string, Voice>()
function pinkNoise(c: AudioContext, seconds: number) {
  const buf = c.createBuffer(1, c.sampleRate * seconds, c.sampleRate)
  const d = buf.getChannelData(0)
  let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0
  for (let i = 0; i < d.length; i++) {
    // Paul Kellet's pink filter over white noise.
    const w = Math.random() * 2 - 1
    b0 = 0.99886 * b0 + w * 0.0555179
    b1 = 0.99332 * b1 + w * 0.0750759
    b2 = 0.969 * b2 + w * 0.153852
    b3 = 0.8665 * b3 + w * 0.3104856
    b4 = 0.55 * b4 + w * 0.5329522
    b5 = -0.7616 * b5 - w * 0.016898
    d[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362) * 0.11
    b6 = w * 0.115926
  }
  return buf
}
function voice(key: 'me' | 'enemy'): Voice | null {
  if (!ctx || !master) return null
  let v = voices.get(key)
  if (v) return v
  const src = ctx.createBufferSource()
  src.buffer = pinkNoise(ctx, 3)
  src.loop = true
  const band = ctx.createBiquadFilter() // the graphite body
  band.type = 'bandpass'
  band.frequency.value = 1500
  band.Q.value = 1.1
  const lp = ctx.createBiquadFilter() // no harsh top
  lp.type = 'lowpass'
  lp.frequency.value = 3000
  lp.Q.value = 0.5
  const gain = ctx.createGain()
  gain.gain.value = 0
  const pan = ctx.createStereoPanner()
  pan.pan.value = key === 'enemy' ? 0.6 : -0.2
  src.connect(band).connect(lp).connect(gain).connect(pan).connect(master)
  src.start()
  v = { gain }
  voices.set(key, v)
  return v
}
/** Set the pencil sound for `key`: `speed` 0 (silent) to 1 (a fast stroke). Call it every frame. */
export function pencil(key: 'me' | 'enemy', speed: number) {
  if (!ctx || (speed <= 0 && !voices.has(key))) return
  const v = voice(key)
  if (!v) return
  const k = Math.max(0, Math.min(1, speed))
  const level = k === 0 ? 0 : (0.12 + 0.48 * k) * PENCIL_VOL * (key === 'enemy' ? 0.5 : 1)
  v.gain.gain.setTargetAtTime(level, ctx.currentTime, k === 0 ? 0.04 : 0.02)
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
      const [c, pitch] = SOUND_OF[v.charge[me]!] ?? [v.charge[me]!.slice(-1), 1]
      play((c === 'C' ? 'charge' : `charge_${c}`) as Sfx, { vol: 0.6, pitch })
    }
    if (v.ready[me] && !p?.ready[me]) play('lockin', { vol: 0.6 })

    // Fizzles (static, faded, bad throw), any fighter (2v2 too).
    const ids = v.fighters.map((f) => f.id)
    for (const s of ids)
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
          play('counter_cast', interrupt ? { vol: 0.5, pitch: 1.35 } : { vol: 0.8 })
          continue // result plays when it lands
        }
        const [base, low] = SOUND_OF[b.el] ?? [b.el.slice(-1), 1]
        const el = base as 'F' | 'I' | 'W' | 'E' | 'L' | 'A'
        const big = b.tier === 'signature'
        if (el === 'A') {
          play('A_impact', { vol: 0.8 })
          continue
        }
        play(`${el}_cast`, { vol: 0.7, pitch: low })
        play(`${el}_travel`, { vol: 0.5, pitch: (big ? 0.85 : 1) * low })
        if (big && el === 'F') play('sig_F', { vol: 0.8 }) // the meteor whistles on the way down
      }
      // It lands: the impact plays now (not scheduled at the throw, so a parried or shattered spell stays silent).
      if (b.kind === 'hit' && b.landed && !landed.current.has(b.id)) {
        landed.current.add(b.id)
        const [base, low] = SOUND_OF[b.el] ?? [b.el.slice(-1), 1]
        const el = base as 'F' | 'I' | 'W' | 'E' | 'L'
        const big = b.tier === 'signature'
        const heavy = b.tier === 'heavy'
        const pitch = (heavy ? 0.85 : big ? 0.8 : 1) * low
        play(`${el}_impact`, { vol: 1, pitch })
        if (el === 'E') play('E_impact2', { vol: big ? 1 : 0.6 })
        if (el === 'F') play('F_impact2', { vol: 0.8 })
        if (heavy || big) play('heavy_layer', { vol: big ? 0.9 : 0.6 })
        if (big && el !== 'F') play(`sig_${el}` as Sfx, { vol: 0.9 })
        if (b.from !== me) play('hurt', { vol: 0.5 })
      }
      // A counter arrives: hit or miss.
      if ((b.kind === 'counter' || b.kind === 'missed') && b.landed && !landed.current.has(b.id)) {
        landed.current.add(b.id)
        if (b.kind === 'missed') play('counter_miss', { vol: 0.9 })
        else if (b.name.endsWith('Interrupt')) {
          // Interrupt: a short, tight punch.
          play('interrupt', { vol: 1 })
          impact(0.35)
        } else {
          // Counterspell: a heavy shield clang over a long, deep boom.
          play('counter_hit', { vol: 0.9 })
          play('heavy_layer', { vol: 0.8 })
          impact(1)
        }
      }
    }

    // Over-time effects tick as small sounds (damage/heal floats with no bolt landing right now).
    for (const f of v.floats) {
      if (floats.current.has(f.id)) continue
      floats.current.add(f.id)
      const n = Number(f.text)
      if (f.text === 'Destroyed!') {
        // The end of a parry chain: the spell shatters (a bright crack, a ringing clang, a puff of dust).
        play('counter_hit', { vol: 0.9, pitch: 1.3 })
        play('fizzle_poof', { vol: 0.9, pitch: 0.8 })
        impact(0.6)
        continue
      }
      if (!Number.isFinite(n)) continue
      const landing = v.bolts.some((b) => Math.abs(b.t + (b.kind === 'heal' ? 0 : b.fly) - f.t) < 60)
      if (landing) continue
      if (n < 0 && v.burning[f.side]) play('burn_tick', { vol: 0.5 })
      else if (n > 0 && v.regen[f.side]) play('regen_tick', { vol: 0.4 })
      else if (n > 0) play('mend_tick', { vol: 0.5 })
    }

    // Chill mark applied, static pulse starting.
    for (const s of ids) {
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
