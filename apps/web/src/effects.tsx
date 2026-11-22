// Spell impact visuals: the name flies across, then the target's half gets an element effect.
// Strength sets the size: light (line) < heavy (W, counter, heal) < signature.
import { useEffect, useRef, useState, type CSSProperties, type ReactElement, type RefObject } from 'react'
import { AEGIS_HP, MIRROR_MS, SHROUD_MS, type Bolt, type CombatView, type Side } from './combat'

const SHAKE = { light: { px: 4, ms: 180 }, heavy: { px: 10, ms: 320 }, signature: { px: 22, ms: 650 } }
const COUNT = { light: 6, heavy: 14, signature: 30 }
/** A combo's impact uses both of its elements' particles. */
const PARTS: Record<string, string[]> = { magma: ['F', 'E'], storm: ['W', 'L'], blizzard: ['I', 'W'], twilight: ['H', 'U'] }

/** Same numbers on every render for the same bolt (it re-renders every 50 ms). */
function rng(seed: number) {
  let s = (seed * 2654435761) >>> 0 || 1
  return () => {
    s ^= s << 13
    s ^= s >>> 17
    s ^= s << 5
    return ((s >>> 0) % 10000) / 10000
  }
}

type Vars = CSSProperties & Record<`--${string}`, string | number>

/** The flying names, over both halves. */
export function BoltLayer({ bolts }: { bolts: Bolt[] }) {
  return (
    <div className="bolt-layer">
      {bolts.map((b) => (
        <div key={b.id} className={`bolt from-${b.from} ${b.kind} tier-${b.tier}`} style={{ color: b.color, '--fly': `${b.fly}ms` } as Vars}>
          {b.name}
        </div>
      ))}
    </div>
  )
}

/** Shake the half a spell lands on, harder for stronger spells (Earth shakes up and down). */
export function useShake(bolts: Bolt[], refs: Record<Side, RefObject<HTMLDivElement | null>>) {
  const done = useRef(new Set<number>())
  useEffect(() => {
    for (const b of bolts) {
      if (done.current.has(b.id)) continue
      if (b.kind === 'counter' && !b.landed) continue // wait to see if it hits
      done.current.add(b.id)
      if (b.kind !== 'hit' && b.kind !== 'counter') continue
      const target = b.from === 'player' ? 'enemy' : 'player'
      const { px, ms } = SHAKE[b.tier]
      const vert = b.el === 'E'
      const at = (k: number) => (vert ? `translate(0, ${k * px}px)` : `translate(${k * px}px, ${k * px * 0.35}px)`)
      refs[target].current?.animate(
        [0, -1, 0.8, -0.6, 0.4, -0.2, 0].map((k) => ({ transform: at(k) })),
        { duration: ms, delay: b.landed ? 0 : b.fly, easing: 'ease-out' },
      )
    }
  }, [bolts, refs])
}

/** What lands on one half. */
export function Impacts({ side, bolts }: { side: Side; bolts: Bolt[] }) {
  return (
    <>
      {bolts.map((b) => {
        const onTarget = b.from !== side
        if (onTarget && b.kind === 'hit') return <Impact key={b.id} b={b} />
        if (onTarget && b.kind === 'counter' && b.landed) return <Impact key={b.id} b={b} landed />
        if (!onTarget && b.kind === 'heal') return <Impact key={b.id} b={b} />
        if (onTarget && b.kind === 'missed')
          return (
            <div key={b.id} className="impact fizzle" style={{ color: '#999' }}>
              <span className="impact-name">Missed</span>
            </div>
          )
        if (!onTarget && b.kind === 'fizzle')
          return (
            <div key={b.id} className="impact fizzle" style={{ color: b.color }}>
              <span className="impact-name">{b.name}</span>
            </div>
          )
        return null
      })}
    </>
  )
}

function Impact({ b, landed = false }: { b: Bolt; landed?: boolean }) {
  const r = rng(b.id)
  const n = COUNT[b.tier]
  const delay = b.kind === 'heal' || landed ? 0 : b.fly
  const el = b.kind === 'counter' ? 'counter' : b.el
  const els = PARTS[el] ?? [el]
  const parts: ReactElement[] = []
  const add = (cls: string, v: Vars) => parts.push(<i key={parts.length} className={cls} style={v} />)
  const d = (extra = 0) => `${delay + extra}ms`

  if (els.includes('F'))
    for (let i = 0; i < n; i++) {
      const a = r() * Math.PI * 2
      const dist = 60 + r() * (b.tier === 'signature' ? 380 : 200)
      add('p ember', { '--dx': `${Math.cos(a) * dist}px`, '--dy': `${Math.sin(a) * dist * 0.7 - 60 - r() * 80}px`, '--s': `${5 + r() * 9}px`, '--d': d(r() * 80), '--t': `${600 + r() * 500}ms` })
    }
  if (els.includes('I') || el === 'counter') {
    for (let i = 0; i < n; i++) {
      const a = r() * Math.PI * 2
      const dist = 70 + r() * (b.tier === 'signature' ? 340 : 180)
      add('p shard', { '--dx': `${Math.cos(a) * dist}px`, '--dy': `${Math.sin(a) * dist}px`, '--rot': `${(a * 180) / Math.PI}deg`, '--s': `${10 + r() * 16}px`, '--d': d(r() * 40), '--t': `${500 + r() * 300}ms` })
    }
    if (els.includes('I') && b.tier !== 'light') add('frost', { '--d': d(), '--t': b.tier === 'signature' ? '1800ms' : '900ms' })
  }
  if (els.includes('W')) {
    const rings = b.tier === 'light' ? 1 : b.tier === 'heavy' ? 2 : 4
    for (let i = 0; i < rings; i++) add('ring', { '--d': d(i * 140), '--t': `${700 + i * 60}ms`, '--end': b.tier === 'signature' ? 40 : 22 })
    for (let i = 0; i < n / 2; i++) {
      const a = -Math.PI * (0.15 + r() * 0.7)
      const dist = 60 + r() * 160
      add('p drop', { '--dx': `${Math.cos(a) * dist}px`, '--dy': `${Math.sin(a) * dist}px`, '--s': `${5 + r() * 7}px`, '--d': d(r() * 60), '--t': `${600 + r() * 300}ms` })
    }
  }
  if (els.includes('E'))
    for (let i = 0; i < n; i++)
      add('p rock', { '--x': `${(r() - 0.5) * 90}%`, '--s': `${8 + r() * (b.tier === 'signature' ? 26 : 14)}px`, '--rot': `${r() * 360}deg`, '--d': d(r() * 200), '--t': `${500 + r() * 400}ms` })
  if (els.includes('L')) {
    const bolts = b.tier === 'light' ? 1 : b.tier === 'heavy' ? 2 : 4
    add('lflash', { '--d': d(), '--t': b.tier === 'signature' ? '500ms' : '260ms' })
    for (let k = 0; k < bolts; k++) {
      let x = 20 + r() * 60
      const pts = [`${x},0`]
      for (let y = 10; y <= 100; y += 10) pts.push(`${(x = Math.max(2, Math.min(98, x + (r() - 0.5) * 22)))},${y}`)
      parts.push(
        <svg key={parts.length} className="crack" viewBox="0 0 100 100" preserveAspectRatio="none" style={{ '--d': d(k * 70), '--t': '420ms' } as Vars}>
          <polyline points={pts.join(' ')} />
        </svg>,
      )
    }
  }
  if (els.includes('H'))
    for (let i = 0; i < n; i++)
      add('p sparkle', { '--x': `${(r() - 0.5) * 70}%`, '--s': `${4 + r() * 7}px`, '--d': d(r() * 400), '--t': `${800 + r() * 500}ms` })

  if (els.includes('U'))
    // Curses: violet wisps curl up and away.
    for (let i = 0; i < n; i++) {
      const a = -Math.PI * (0.1 + r() * 0.8)
      const dist = 60 + r() * 220
      add('p wisp', { '--dx': `${Math.cos(a) * dist}px`, '--dy': `${Math.sin(a) * dist}px`, '--s': `${8 + r() * 14}px`, '--d': d(r() * 150), '--t': `${900 + r() * 600}ms` })
    }

  if (b.tier === 'signature' && b.kind === 'hit') signature(b, r, parts)
  if (b.kind !== 'counter') special(b, r, parts, delay)

  return (
    <div className={`impact ${b.kind} tier-${b.tier}`} style={{ color: b.color, '--d': d(), '--fly': d() } as Vars}>
      <div className="impact-flash" />
      {parts}
      <span className="impact-name">{b.kind === 'counter' ? 'Interrupted!' : b.name}</span>
    </div>
  )
}

/** Silence, shown on the health bar: a lock badge with the seconds left, and stripes over the bar
 *  that shrink as the silence runs out. */
export function SilenceLock({ ms }: { ms: number }) {
  const longest = useRef(0) // how long this silence was at its start
  if (ms <= 0) longest.current = 0
  else if (ms > longest.current) longest.current = ms
  if (ms <= 0) return null
  return (
    <div className="hp-lock">
      <div className="hp-lock-stripes" style={{ width: `${(100 * ms) / (longest.current || 1)}%` }} />
      <span className="lock-badge">
        <svg viewBox="0 0 16 18" aria-hidden>
          <path d="M4 8V5.5a4 4 0 0 1 8 0V8" fill="none" stroke="currentColor" strokeWidth="2.4" />
          <rect x="1.5" y="8" width="13" height="9" rx="2" fill="currentColor" />
        </svg>
        {(ms / 1000).toFixed(1)}
      </span>
    </div>
  )
}

/** Ongoing effects on one half: silence greys it out, static crackles the edges, chill frosts them,
 *  burn flickers from below, regen pulses green, and a knock-off drops rubble. */
export function StatusFx({ side, view }: { side: Side; view: CombatView }) {
  const silenced = view.silenced[side]
  const knocks = view.knocked[side]
  const seenKnocks = useRef(knocks)
  const [knockId, setKnockId] = useState<number | null>(null)
  useEffect(() => {
    if (knocks > seenKnocks.current) setKnockId(knocks)
    seenKnocks.current = knocks
  }, [knocks])
  const r = rng(side === 'player' ? 7 : 13)
  const st = view.static[side]
  return (
    <div className="status-fx">
      {view.burning[side] && <div className="st-burn" />}
      {view.regen[side] && <div className="st-regen" />}
      {view.chill[side] > 0 && <div className="st-chill" />}
      {view.shield[side] > 0 && <div className="st-aegis" />}
      {view.mirror[side] > 0 && <div className="st-mirror" />}
      {view.shroud[side] > 0 && <div className="st-shroud" />}
      {view.doom[side] > 0 && (
        <div className="st-doom">
          <b>{(view.doom[side] / 1000).toFixed(1)}</b>
        </div>
      )}
      <Timers view={view} side={side} />
      {st && (
        <div className={`st-static ${st}`}>
          {st === 'on' &&
            Array.from({ length: 10 }, (_, i) => {
              const edge = i % 4
              const at = `${8 + r() * 84}%`
              const pos: Vars = edge === 0 ? { top: 0, left: at } : edge === 1 ? { bottom: 0, left: at } : edge === 2 ? { left: 0, top: at } : { right: 0, top: at }
              return <i key={i} style={{ ...pos, '--rot': `${r() * 360}deg`, '--d': `${r() * 150}ms` } as Vars} />
            })}
        </div>
      )}
      {silenced > 0 && <div className="st-silence" />}
      {knockId !== null && (
        <div key={knockId} className="st-knock" onAnimationEnd={() => setKnockId(null)}>
          {Array.from({ length: 10 }, (_, i) => (
            <i key={i} style={{ '--x': `${r() * 160}px`, '--rot': `${r() * 400 - 200}deg`, '--s': `${6 + r() * 10}px`, '--d': `${r() * 120}ms` } as Vars} />
          ))}
          <span>Charge lost</span>
        </div>
      )}
    </div>
  )
}

/** Each signature's own big visual, on top of its element's burst. Pieces with --d: 0ms start
 *  while the name is still flying, so they arrive together. */
function signature(b: Bolt, r: () => number, parts: ReactElement[]) {
  const k = () => parts.length
  const fromLeft = b.from === 'player' // the caster's side, as the target sees it
  if (b.el === 'F') {
    // Meteor: a burning ball drops from the top corner, lands as the name does.
    parts.push(
      <div key={k()} className={`sig-meteor ${fromLeft ? 'from-left' : 'from-right'}`} style={{ '--d': '0ms' } as Vars}>
        <div className="ball" />
      </div>,
    )
    parts.push(<div key={k()} className="sig-scorch" />)
  }
  if (b.el === 'I')
    // Frozen Prison: ice bars slam down over the half and hold for the silence, then shatter.
    // Four thin bars, kept toward the edges so the middle (where they draw) stays clear.
    [6, 22, 76, 92].forEach((x, i) => parts.push(<div key={k()} className="sig-bar" style={{ '--x': `${x}%`, '--d2': `${i * 40}ms` } as Vars} />))
  if (b.el === 'L') {
    // Thunderbolt: the sky darkens, then one huge bolt splits the half.
    parts.push(<div key={k()} className="sig-dark" style={{ '--d': '200ms' } as Vars} />)
    let x = 50
    const pts = [`${x},-2`]
    for (let y = 8; y <= 100; y += 8) pts.push(`${(x = Math.max(15, Math.min(85, x + (r() - 0.5) * 30)))},${y}`)
    parts.push(
      <svg key={k()} className="sig-bolt" viewBox="0 0 100 100" preserveAspectRatio="none">
        <polyline points={pts.join(' ')} />
      </svg>,
    )
  }
  if (b.el === 'E')
    // Earthquake: cracks run up from the ground.
    for (let c = 0; c < 4; c++) {
      let x = 10 + c * 26 + r() * 10
      const pts = [`${x},100`]
      for (let y = 88; y >= 30 + r() * 30; y -= 8) pts.push(`${(x += (r() - 0.5) * 14)},${y}`)
      parts.push(
        <svg key={k()} className="sig-crack" viewBox="0 0 100 100" preserveAspectRatio="none" style={{ '--d2': `${c * 60}ms` } as Vars}>
          <polyline points={pts.join(' ')} />
        </svg>,
      )
    }
  if (b.el === 'W')
    // Tidal Wave: a wall of water sweeps across from the caster's side.
    parts.push(
      <div key={k()} className={`sig-wave ${fromLeft ? 'from-left' : 'from-right'}`} style={{ '--d': '150ms' } as Vars}>
        <svg viewBox="0 0 100 100" preserveAspectRatio="none">
          <path d="M0,100 L0,30 Q10,10 20,28 T40,26 T60,24 T80,28 T100,22 L100,100 Z" />
        </svg>
      </div>,
    )
}

/** Holy, Unholy and combo spells: one look each, on top of their particles. */
function special(b: Bolt, r: () => number, parts: ReactElement[], delay: number) {
  const k = () => parts.length
  const d = (extra = 0) => `${delay + extra}ms`
  switch (b.shape) {
    case 'aegis': // a dome of light settles over the caster
      parts.push(<div key={k()} className="fx-aegis" style={{ '--d': d() } as Vars} />)
      break
    case 'mirror': // a glassy sheen sweeps across
      parts.push(<div key={k()} className="fx-mirror" style={{ '--d': d() } as Vars} />)
      break
    case 'scythe': // a curved blade swings through
      parts.push(
        <svg key={k()} className="fx-scythe" viewBox="0 0 100 100" preserveAspectRatio="none" style={{ '--d': d() } as Vars}>
          <path d="M8 18 Q60 -10 92 70" pathLength={1} />
        </svg>,
      )
      break
    case 'veil': // dark fog rolls over the caster
      parts.push(<div key={k()} className="fx-shroud" style={{ '--d': d() } as Vars} />)
      break
    case 'blade': // a blade drops from the top
      parts.push(<div key={k()} className="fx-blade" style={{ '--d': d() } as Vars} />)
      break
    case 'volcano': // lava wells up from below
      parts.push(<div key={k()} className="fx-lava" style={{ '--d': d() } as Vars} />)
      break
    case 'cloud': {
      // the sky darkens and a bolt splits it
      parts.push(<div key={k()} className="sig-dark" style={{ '--d': d(100) } as Vars} />)
      let x = 50
      const pts = [`${x},-2`]
      for (let y = 8; y <= 100; y += 8) pts.push(`${(x = Math.max(15, Math.min(85, x + (r() - 0.5) * 30)))},${y}`)
      parts.push(
        <svg key={k()} className="sig-bolt" viewBox="0 0 100 100" preserveAspectRatio="none" style={{ '--d': d(150) } as Vars}>
          <polyline points={pts.join(' ')} />
        </svg>,
      )
      break
    }
    case 'trefoil': // snow drives down
      for (let i = 0; i < 26; i++)
        parts.push(<i key={k()} className="p snow" style={{ '--x': `${(r() - 0.5) * 100}%`, '--s': `${4 + r() * 6}px`, '--d': d(r() * 500), '--t': `${900 + r() * 700}ms` } as Vars} />)
      break
    case 'yinyang': // light and dark split the half and spin
      parts.push(<div key={k()} className="fx-twilight" style={{ '--d': d() } as Vars} />)
      break
  }
}

/** Buffs with a clock: how much is left, as a label and a bar that runs down. */
function Timers({ view, side }: { view: CombatView; side: Side }) {
  const items = [
    view.shield[side] > 0 && { k: 'aegis', label: `Armor ${view.shield[side]}`, f: view.shield[side] / AEGIS_HP },
    view.mirror[side] > 0 && { k: 'mirror', label: `Mirror ${(view.mirror[side] / 1000).toFixed(1)} s`, f: view.mirror[side] / MIRROR_MS },
    view.shroud[side] > 0 && { k: 'shroud', label: `Shroud ${(view.shroud[side] / 1000).toFixed(1)} s`, f: view.shroud[side] / SHROUD_MS },
  ].filter((x): x is { k: string; label: string; f: number } => !!x)
  if (!items.length) return null
  return (
    <div className={`st-timers ${side === 'player' ? 'mine' : ''}`}>
      {items.map((t) => (
        <span key={t.k} className={`st-timer ${t.k}`}>
          {t.label}
          <i style={{ width: `${Math.min(1, t.f) * 100}%` }} />
        </span>
      ))}
    </div>
  )
}
