// The spellbook (Nov 25): How to cast + Spell Info in one book. One spell per page: the drawing and sign on the
// left, how to cast it and what it does on the right (a two-page spread on desktop, one page on a phone).
// Ribbons jump to chapters; arrows, swipes and arrow keys turn pages. Numbers come from combat.ts.
import { useEffect, useRef, useState, type ReactNode } from 'react'
import {
  HEAL, REGEN, AEGIS_DRAIN, AEGIS_HP, GLACIER_DMG, GLACIER_MS, GRAVE, MAGMA, PLASMA, STEAM_HIT, STEAM_MS, STEAM_SHOTS, STORM, SUNFIRE, THERMAL,
  TWILIGHT_MS, DOOM_DMG, DOOM_MS, DOOM_LIFT, SHROUD_MS, EXECUTE, BURN, CHILL, CHILL_MS, CHILL_HEAVY_MS, COUNTER_SILENCE_MS, FIZZLE_LOCK_MS, PRISON_CHILL,
  PRISON_SILENCE_MS, PUNCH, READY_LIFE_MS, STATIC_PULSES, PARRY_MISS_MS, PARRY_HIT_MS, TWILIGHT_GUARD, TWILIGHT_EXPOSE, WEAR_STEP, WEAR_FLOOR, WEAR_DECAY_MS, PARRY_WINDOWS, TIDAL_HEAL, INTERRUPT_LOCK_MS, WHIFF_MS,
} from './combat'
import { COMBO, COMBO_CHARGES, COMBO_MIX, COMBO_SHAPE, COMBOS_ON, COUNTER, ELEMENTS, SIGNATURE } from './spells'
import { SHAPE_PATHS, SHAPE_STARTS } from './shapePaths'
import { loadDrawHand } from './settings'
import { HomeButton } from './HomeCorner'
import { iconPath, type RowIcon } from './statusIcons'

const s = (ms: number) => `${ms / 1000} s`
const ATTACK_ELS = ['F', 'I', 'W', 'E', 'L']

type Page = {
  ch: string // chapter id
  title: string
  color?: string
  art: ReactNode
  how: string // how to cast / use it
  does: string // what it does
  chips?: string[]
}

const Sign = ({ l, size = 64 }: { l: string; size?: number }) => <img className="book-sign" src={`/asl/${l}.svg`} alt={`ASL ${l}`} style={{ width: size, height: size }} />
const Shape = ({ shape, color, size = 150 }: { shape: string; color?: string; size?: number }) => (
  <svg className="book-shape" viewBox="-2 -2 44 44" width={size} height={size} style={{ color }} aria-hidden>
    <path d={SHAPE_PATHS[shape]} fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
    <circle cx={SHAPE_STARTS[shape][0]} cy={SHAPE_STARTS[shape][1]} r="2.6" fill="#ffd24d" stroke="#1d1b2e" strokeWidth="1" />
  </svg>
)
const SignShape = ({ signs, shape, color }: { signs: string[]; shape: string; color?: string }) => (
  <div className="book-art">
    <Shape shape={shape} color={color} />
    <div className="book-signs">
      {signs.map((l, i) => (
        <span key={i}>
          {i > 0 && <b>+</b>}
          <Sign l={l} size={signs.length > 1 ? 48 : 64} />
        </span>
      ))}
    </div>
  </div>
)

const ATTACK_DOES: Record<string, (p: 0 | 1) => string> = {
  F: (p) => `Burns for +${BURN[p]} over 1.5 s.`,
  I: (p) => `Chills: their next hit within ${s(p ? CHILL_HEAVY_MS : CHILL_MS)} does +${CHILL[p] * 100}%.`,
  W: () => 'You heal half of what it deals.',
  E: () => 'No effect. Just the hardest hits.',
  L: (p) => `Static: ${STATIC_PULSES[p]} pulse${STATIC_PULSES[p] > 1 ? 's' : ''} where their throws fizzle.`,
}

const SIGS: Record<string, { name: string; dmg: number; does: string }> = {
  F: { name: 'Meteor', dmg: 32, does: '+18 burn over 2.5 s. The most total damage.' },
  I: { name: 'Frozen Prison', dmg: 24, does: `Stuns up to ${s(PRISON_SILENCE_MS)} and chills: their next hit within ${s(CHILL_HEAVY_MS)} does +${PRISON_CHILL * 100}%.` },
  W: { name: 'Tidal Wave', dmg: 25, does: `You heal ${TIDAL_HEAL}.` },
  E: { name: 'Earthquake', dmg: 38, does: 'At full Earth power (100%), it also knocks off their charge and readied spell.' },
  L: { name: 'Thunderbolt', dmg: 28, does: 'Three fast static pulses where their throws fizzle.' },
}

const COMBO_DOES: Record<string, { dmg: number; does: string }> = {
  magma: { dmg: MAGMA[0], does: `+${MAGMA[1]} burn over 5 s.` },
  storm: { dmg: STORM.hit, does: `${STORM.count} static pulses, ${STORM.pulse} each. A throw in a pulse fizzles and takes ${STORM.zap}.` },
  glacier: { dmg: GLACIER_DMG, does: `Takes ${s(GLACIER_MS)} to arrive. Only a Fire + Ice combo counterspell stops it.` },
  twilight: { dmg: 0, does: `For ${s(TWILIGHT_MS)} you take half damage and they take double.` },
  steam: { dmg: STEAM_HIT, does: `Their next ${STEAM_SHOTS} attacks within ${s(STEAM_MS)} miss.` },
  thermal: { dmg: THERMAL.hit, does: `+${THERMAL.burn} burn and a chill: their next hit does +${THERMAL.chill * 100}%.` },
  plasma: { dmg: PLASMA.hit, does: `+${PLASMA.burn} burn, knocks off their charge, and caps their elements at ${PLASMA.cap * 100}%.` },
  sunfire: { dmg: SUNFIRE[0], does: `+${SUNFIRE[1]} burn over 6 s that heals you.` },
  grave: { dmg: GRAVE.hit, does: `For ${s(GRAVE.ms)} nothing heals them or gives them armor. A Heal clears it, but heals nothing that time.` },
}

const MAGIC: { el: 'A' | 'U'; shape: string; name: string; does: string; chips: string[] }[] = [
  { el: 'A', shape: 'star', name: 'Heal', does: 'Heals right away. At full Angelic power (100%) it also clears every debuff on you. Under a Grave it clears the Grave but heals nothing.', chips: [`+${HEAL} HP`] },
  { el: 'A', shape: 'hourglass', name: 'Regen', does: 'The bigger heal, over 2.5 s. A counterspell cuts off what is left.', chips: [`+${REGEN.amount * REGEN.ticks} HP`] },
  { el: 'A', shape: 'aegis', name: 'Aegis', does: `Armor that soaks direct hits and drains ${AEGIS_DRAIN} a second. No recast until it's gone.`, chips: [`${AEGIS_HP} armor`] },
  { el: 'U', shape: 'scythe', name: 'Doom', does: `Within ${s(DOOM_MS)} they must throw a spell whose element is at ${DOOM_LIFT * 100}% power or higher (not worn down), or take ${DOOM_DMG}.`, chips: [`${DOOM_DMG} dmg`, s(DOOM_MS)] },
  { el: 'U', shape: 'veil', name: 'Shroud', does: "They can't see your charge or your drawing.", chips: [s(SHROUD_MS)] },
  { el: 'U', shape: 'blade', name: 'Execute', does: 'Double damage if they are cursed when it lands: burning, chilled, static, Doomed and more.', chips: [`${EXECUTE.base} dmg`, `${EXECUTE.cursed} cursed`] },
]

/** ASL "5" (open hand) and "1" (pointing), cut from the public-domain Gallaudet sheet on Wikimedia (public/hands). */
const Hand = ({ kind, flip, size = 76 }: { kind: 'open' | 'point'; flip?: boolean; size?: number }) => (
  <img className="book-hand" src={kind === "open" ? "/hands/asl-five.svg" : "/hands/asl-one.svg"} alt="" style={{ width: size, height: size * 1.33, transform: flip ? 'scaleX(-1)' : undefined }} />
)
/** Read when a page is shown, so changing the draw hand in Settings takes effect. Pictures are as the camera
 *  shows you (mirrored): drawing right, the signing hand is on the left and unflipped. */
const isDrawRight = () => loadDrawHand() === 'right'

/** Parry: the light-blue circle the camera view flashes around each palm when you push both hands. */
const parryArt = (
  <div className="book-parry">
    <span className="book-parry-hand"><span className="book-pusher"><Hand kind="open" size={92} /></span></span>
    <span className="book-parry-hand"><span className="book-pusher"><Hand kind="open" flip size={92} /></span></span>
  </div>
)
/** Interrupt: the signing hand pushed at the camera, no drawing; the drawing hand smaller behind. */
const InterruptArt = () => {
  const r = isDrawRight()
  return (
    <div className="book-two-hands" style={{ flexDirection: r ? 'row' : 'row-reverse' }}>
      <div className="book-push-sign" style={{ color: ELEMENTS.W.color }}>
        <span className="book-pusher">
          <span style={{ display: 'inline-block', transform: r ? undefined : 'scaleX(-1)' }}>
            <Sign l="W" size={120} />
          </span>
        </span>
        <span className="book-push-lines" aria-hidden />
      </div>
      <span className="book-back-hand">
        <Hand kind="point" flip={r} size={80} />
      </span>
    </div>
  )
}
/** Throw: the signing hand opened to a 5 and pushed at the camera; the drawing hand smaller behind. */
const ThrowArt = () => {
  const r = isDrawRight()
  return (
    <div className="book-two-hands" style={{ flexDirection: r ? 'row' : 'row-reverse' }}>
      <div className="book-push-sign" style={{ color: ELEMENTS.F.color }}>
        <span className="book-pusher">
          <Hand kind="open" flip={!r} size={110} />
        </span>
        <span className="book-push-lines" aria-hidden />
      </div>
      <span className="book-back-hand">
        <Hand kind="point" flip={r} size={80} />
      </span>
    </div>
  )
}
/** Wear: the same chips a fight shows under your health bar (only worn elements appear). */
const wearArt = (
  <div className="book-wear-demo">
    <div className="wear-chips">
      {[['F', 70], ['I', 40], ['W', 85]].map(([e, v]) => (
        <span key={e as string} style={{ '--el': ELEMENTS[e as string].color } as React.CSSProperties}>
          {e} {v}%
        </span>
      ))}
    </div>
    <small>Shown under your health bar. Fresh elements don't show.</small>
  </div>
)

/** Draw: the pointing hand with its fingertip on the H's yellow start dot. */
const DrawDemo = () => {
  const drawRight = isDrawRight()
  const box = 140
  const [sx, sy] = SHAPE_STARTS.h
  const dot = { x: `${((sx + 2) / 44) * 100}%`, y: `${((sy + 2) / 44) * 100}%` } // the drawing's viewBox is 44 wide
  return (
    <div className="book-draw-demo" style={{ width: box, height: box }}>
      <Shape shape="h" color={ELEMENTS.F.color} size={box} />
      <span className="book-fingertip" style={{ left: dot.x, top: dot.y, transform: drawRight ? 'scaleX(-1)' : undefined }}>
        <img src="/hands/asl-one.svg" alt="" />
      </span>
    </div>
  )
}

const cycle = (
  <div className="book-cycle-wrap">
    <div className="book-cycle">
      {['W', 'F', 'I', 'E', 'L'].map((l, k) => (
        <span key={l} className="book-cycle-item">
          {k > 0 && <b className="book-arrow">→</b>}
          <span style={{ color: ELEMENTS[l].color }}>
            <Sign l={l} size={56} />
            <small>{ELEMENTS[l].name}</small>
          </span>
        </span>
      ))}
    </div>
    <div className="book-cycle">
      <span style={{ color: ELEMENTS.A.color }}>
        <Sign l="A" size={56} />
        <small>Angelic</small>
      </span>
      <b className="book-arrow">⇄</b>
      <span style={{ color: ELEMENTS.U.color }}>
        <Sign l="U" size={56} />
        <small>Unholy</small>
      </span>
    </div>
  </div>
)

/** A status as the fight shows it: its icon (red edge bad, green good), how long it lasts, what it does. */
type StatusInfo = { icon: RowIcon; name: string; lasts: string; does: string; good?: boolean }
const StatusRows = ({ rows }: { rows: StatusInfo[] }) => (
  <ul className="book-status">
    {rows.map((r) => (
      <li key={r.name}>
        <span className={`st-icon ${r.good ? 'good' : 'bad'}`}>
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d={iconPath(r.icon)} />
          </svg>
        </span>
        <span className="book-status-text">
          <b>
            {r.name} <em>{r.lasts}</em>
          </b>
          <small>{r.does}</small>
        </span>
      </li>
    ))}
  </ul>
)
const HURT: StatusInfo[] = [
  { icon: 'burn', name: 'Burning', lasts: '1.5 s (Magma 5 s, Sunfire 6 s)', does: `Damage every 0.5 s: +${BURN[0]} light, +${BURN[1]} heavy.` },
  { icon: 'chill', name: 'Chilled', lasts: `${s(CHILL_MS)} light, ${s(CHILL_HEAVY_MS)} heavy`, does: `The next hit on you does +${CHILL[0] * 100}% (light) or +${CHILL[1] * 100}% (heavy).` },
  { icon: 'static', name: 'Static', lasts: `${STATIC_PULSES[0]} pulse light, ${STATIC_PULSES[1]} heavy`, does: 'Throwing while it is lit fizzles. Wait for the gap.' },
  { icon: 'storm', name: 'Storm', lasts: `${STORM.count} pulses`, does: `${STORM.pulse} damage a pulse. Throwing in one costs ${STORM.zap}.` },
]
const STOPPED: StatusInfo[] = [
  { icon: 'silenced', name: 'Stunned', lasts: `until their next hit, at most ${s(COUNTER_SILENCE_MS)}`, does: 'Their counterspell caught your element. No casting; your charge is gone.' },
  { icon: 'silenced', name: 'Frozen', lasts: `up to ${s(PRISON_SILENCE_MS)}`, does: 'Frozen Prison. No casting, whatever your element.' },
  { icon: 'interrupted', name: 'Interrupted', lasts: s(INTERRUPT_LOCK_MS), does: 'Their interrupt hit you. No signing, drawing or throwing.' },
  { icon: 'whiffed', name: 'Whiffed', lasts: s(WHIFF_MS), does: 'Your interrupt missed. Locked out.' },
]
const STOPPED2: StatusInfo[] = [
  { icon: 'fizzled', name: 'Fizzled', lasts: s(FIZZLE_LOCK_MS), does: 'A wrong drawing, or a spell not thrown in time. No throws; your charge is gone.' },
  { icon: 'staggered', name: 'Staggered', lasts: s(PARRY_MISS_MS), does: 'A mistimed parry. No throws and no parries.' },
  { icon: 'recover', name: 'Parried', lasts: s(PARRY_HIT_MS), does: 'A good parry. A moment before you can throw again.', good: true },
]
const CURSES: StatusInfo[] = [
  { icon: 'doom', name: 'Doomed', lasts: s(DOOM_MS), does: `Throw a spell at ${DOOM_LIFT * 100}% power or higher before it ends, or take ${DOOM_DMG}.` },
  { icon: 'exposed', name: 'Exposed', lasts: s(TWILIGHT_MS), does: `Twilight. You take +${TWILIGHT_EXPOSE * 100}% damage.` },
  { icon: 'fog', name: 'Steam', lasts: `${s(STEAM_MS)} or ${STEAM_SHOTS} attacks`, does: 'Your attacks miss.' },
  { icon: 'noHeal', name: 'Grave', lasts: s(GRAVE.ms), does: 'Nothing heals you or gives you armor. A full-power Heal clears it.' },
]
const BUFFS: StatusInfo[] = [
  { icon: 'regen', name: 'Regenerating', lasts: '2.5 s', does: `+${REGEN.amount} every 0.5 s. A counterspell stops it.`, good: true },
  { icon: 'aegis', name: 'Aegis', lasts: `until it drains (${AEGIS_DRAIN} a second)`, does: `${AEGIS_HP} armor soaks direct hits first.`, good: true },
  { icon: 'guard', name: 'Guarded', lasts: s(TWILIGHT_MS), does: `Twilight. You take ${TWILIGHT_GUARD * 100}% less damage.`, good: true },
  { icon: 'shroud', name: 'Shrouded', lasts: s(SHROUD_MS), does: "They can't see your charge or drawing.", good: true },
]

const PAGES: Page[] = [
  { ch: 'basics', title: 'Charge', art: <div className="book-signs wrap">{[...ATTACK_ELS, 'A', 'U'].map((l) => <span key={l} className="book-sign-cap" style={{ color: ELEMENTS[l].color }}><Sign l={l} size={68} /><small>{ELEMENTS[l].name}</small></span>)}</div>, how: 'Sign a letter with one hand and hold it.', does: 'Your hand charges with that element. Open all five fingers and hold to drop it.' },
  { ch: 'basics', title: 'Draw', art: <DrawDemo />, how: "Keep holding the letter. Trace a shape with your other hand's index finger.", does: 'Open your signing hand to finish. The yellow dot is one place to start: any start or direction works.' },
  { ch: 'basics', title: 'Throw', art: <ThrowArt />, how: 'Open your signing hand to a 5, then push it at the camera.', does: `The spell flies. Push within ${s(READY_LIFE_MS)} or it fizzles.` },
  { ch: 'basics', title: 'Who beats who', art: cycle, how: 'Each element beats the next one, round the circle. Angelic and Unholy beat each other.', does: 'Use the element that beats theirs to counter or interrupt.' },
  ...ATTACK_ELS.flatMap((el): Page[] => [
    { ch: 'elements', title: `${ELEMENTS[el].name} light`, color: ELEMENTS[el].color, art: <SignShape signs={[el]} shape="line" color={ELEMENTS[el].color} />, how: `Sign ${el}, draw one line.`, does: ATTACK_DOES[el](0), chips: [`${PUNCH[el][0]} dmg`, 'Fast'] },
    { ch: 'elements', title: `${ELEMENTS[el].name} heavy`, color: ELEMENTS[el].color, art: <SignShape signs={[el]} shape="h" color={ELEMENTS[el].color} />, how: `Sign ${el}, draw an H.`, does: ATTACK_DOES[el](1), chips: [`${PUNCH[el][1]} dmg`, 'Slower'] },
  ]),
  ...ATTACK_ELS.map((el): Page => ({ ch: 'signatures', title: SIGS[el].name, color: ELEMENTS[el].color, art: <SignShape signs={[el]} shape={SIGNATURE[el]} color={ELEMENTS[el].color} />, how: `Sign ${el}, draw the ${SIGS[el].name}.`, does: SIGS[el].does, chips: [`${SIGS[el].dmg} dmg`] })),
  ...MAGIC.map((m): Page => ({ ch: 'magic', title: m.name, color: ELEMENTS[m.el].color, art: <SignShape signs={[m.el]} shape={m.shape} color={ELEMENTS[m.el].color} />, how: `Sign ${m.el}, draw the ${m.name}.`, does: m.does, chips: m.chips })),
  ...(COMBOS_ON
    ? Object.keys(COMBO_SHAPE).map((c): Page => ({
        ch: 'combos',
        title: COMBO_CHARGES[c].name,
        color: COMBO_CHARGES[c].color,
        art: <SignShape signs={[COMBO, ...COMBO_MIX[c]]} shape={COMBO_SHAPE[c]} color={COMBO_CHARGES[c].color} />,
        how: `Sign C, ${COMBO_MIX[c].map((l) => ELEMENTS[l].name).join(', then ')}. Then draw.`,
        does: COMBO_DOES[c].does,
        chips: COMBO_DOES[c].dmg ? [`${COMBO_DOES[c].dmg} dmg`] : [],
      }))
    : []),
  { ch: 'defense', title: 'Counterspell', art: <SignShape signs={['W']} shape={COUNTER} color={ELEMENTS.W.color} />, how: 'They charge Fire? Water beats Fire: sign W, draw a circle, push.', does: `If they still hold the beaten element, they're stunned until your next hit (at most ${s(COUNTER_SILENCE_MS)}). Any element's circle stops a heal.` },
  { ch: 'defense', title: 'Interrupt', art: <InterruptArt />, how: 'They charge Fire? Sign W and push it at the camera. No drawing.', does: `Their spell fizzles and they're locked out ${s(INTERRUPT_LOCK_MS)}. Miss and you're locked out ${s(WHIFF_MS)}. Can't stop heals.` },
  { ch: 'defense', title: 'Parry', art: parryArt, how: 'A ring closes in on your hands as a spell flies at you. When it flashes white, push both hands at the camera.', does: `It flies back at half power. You get ${PARRY_WINDOWS.light / 1000} s to push for a light, ${PARRY_WINDOWS.heavy / 1000} s for a heavy, ${PARRY_WINDOWS.signature / 1000} s for a signature.` },
  { ch: 'status', title: 'Wear', art: wearArt, how: `Power is how strong an element's spells are. At 70%, a 24 damage heavy does 17, and heals, burns and chills shrink the same way.`, does: `A light or Angelic throw takes ${WEAR_STEP * 50}%, anything else ${WEAR_STEP * 100}%, down to ${WEAR_FLOOR * 100}%. It comes back ${WEAR_STEP * 100}% every ${s(WEAR_DECAY_MS)}, so switch elements.` },
  { ch: 'status', title: 'Burning and slowed', art: <StatusRows rows={HURT} />, how: 'Icons under a health bar, with a bar that runs down with the time left.', does: 'Worn spells give shorter, weaker effects.' },
  { ch: 'status', title: "Can't act", art: <StatusRows rows={STOPPED} />, how: 'Your hand shows a red ring that drains, and a word saying why.', does: 'Wait it out. The ring is the timer.' },
  { ch: 'status', title: "Can't act, part 2", art: <StatusRows rows={STOPPED2} />, how: 'Short lockouts from your own mistakes.', does: 'A good parry shows a green shield instead.' },
  { ch: 'status', title: 'Curses', art: <StatusRows rows={CURSES} />, how: 'Red-edged icons under your health bar.', does: 'A Heal at full Angelic power clears them all.' },
  { ch: 'status', title: 'Buffs', art: <StatusRows rows={BUFFS} />, how: 'Green-edged icons under your health bar.', does: 'Wear shortens them too, if the spell was worn.' },
]

const CHAPTERS: { id: string; name: string; color: string }[] = [
  { id: 'basics', name: 'Basics', color: '#ff9f1c' },
  { id: 'elements', name: 'Elements', color: '#ff5470' },
  { id: 'signatures', name: 'Signatures', color: '#6c63ff' },
  { id: 'magic', name: 'Angelic & Unholy', color: '#ffd23f' },
  ...(COMBOS_ON ? [{ id: 'combos', name: 'Combos', color: '#2ec4b6' }] : []),
  { id: 'defense', name: 'Defense', color: '#4dabf7' },
  { id: 'status', name: 'Status', color: '#b197fc' },
]

/** `inMatch`: opened from the in-match menu, as an overlay over the fight, with Back instead of Home. */
export function Spellbook({ onHome, inMatch }: { onHome: () => void; inMatch?: boolean }) {
  const [i, setI] = useState(0)
  const go = (to: number) => {
    const n = Math.max(0, Math.min(PAGES.length - 1, to))
    if (n === i) return
    setI(n)
  }
  const goRef = useRef(go)
  goRef.current = go
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowRight') goRef.current(iRef.current + 1)
      if (e.key === 'ArrowLeft') goRef.current(iRef.current - 1)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
  const iRef = useRef(i)
  iRef.current = i
  const swipe = useRef<number | null>(null)
  const p = PAGES[i]
  const ch = CHAPTERS.find((c) => c.id === p.ch)!
  return (
    <main className={`page info-page book-page ${inMatch ? 'in-match' : ''}`}>
      <div className="info-top">
        <h1 className="logo">Spellbook</h1>
        <HomeButton onClick={onHome} back={inMatch} />
      </div>
      <nav className="book-ribbons" aria-label="Chapters">
        {CHAPTERS.map((c) => (
          <button key={c.id} className={c.id === p.ch ? 'on' : ''} style={{ background: c.color }} onClick={() => go(PAGES.findIndex((q) => q.ch === c.id))}>
            {c.name}
          </button>
        ))}
      </nav>
      <section
        className="book"
        onPointerDown={(e) => (swipe.current = e.clientX)}
        onPointerUp={(e) => {
          if (swipe.current === null) return
          const dx = e.clientX - swipe.current
          swipe.current = null
          if (Math.abs(dx) > 50) go(i + (dx < 0 ? 1 : -1))
        }}
      >
        <div className="book-spread" key={i}>
          <div className="book-leaf left">
            <span className="book-chapter" style={{ background: ch.color }}>{ch.name}</span>
            {p.art}
          </div>
          <div className="book-leaf right">
            <h2 style={{ color: p.color }}>{p.title}</h2>
            <p className="book-how">{p.how}</p>
            <p className="book-does">{p.does}</p>
            {!!p.chips?.length && (
              <div className="book-chips">
                {p.chips.map((c) => (
                  <span key={c}>{c}</span>
                ))}
              </div>
            )}
          </div>
        </div>
      </section>
      <div className="book-nav">
        <button className="small" onClick={() => go(i - 1)} disabled={i === 0} aria-label="Previous page">
          ◀
        </button>
        <span>
          {i + 1} / {PAGES.length}
        </span>
        <button className="small" onClick={() => go(i + 1)} disabled={i === PAGES.length - 1} aria-label="Next page">
          ▶
        </button>
      </div>
    </main>
  )
}

