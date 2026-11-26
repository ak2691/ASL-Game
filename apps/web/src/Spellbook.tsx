// The spellbook (Nov 25): How to cast + Spell Info in one book. One spell per page: the drawing and sign on the
// left, how to cast it and what it does on the right (a two-page spread on desktop, one page on a phone).
// Ribbons jump to chapters; arrows, swipes and arrow keys turn pages. Numbers come from combat.ts.
import { useEffect, useRef, useState, type ReactNode } from 'react'
import {
  HEAL, REGEN, AEGIS_DRAIN, AEGIS_HP, GLACIER_DMG, GLACIER_MS, GRAVE, MAGMA, PLASMA, STEAM_HIT, STEAM_MS, STEAM_SHOTS, STORM, SUNFIRE, THERMAL,
  TWILIGHT_MS, DOOM_DMG, DOOM_MS, DOOM_LIFT, SHROUD_MS, EXECUTE, BURN, CHILL, CHILL_MS, CHILL_HEAVY_MS, COUNTER_SILENCE_MS, FIZZLE_LOCK_MS, PRISON_CHILL,
  PRISON_SILENCE_MS, PUNCH, READY_LIFE_MS, STATIC_PULSES, STATIC_CUTOFF, COUNTER_CUTOFF, PARRY_MISS_MS, TWILIGHT_GUARD, TWILIGHT_EXPOSE, WEAR_STEP, WEAR_FLOOR, WEAR_DECAY_MS, PARRY_WINDOWS, TIDAL_HEAL, INTERRUPT_LOCK_MS, WHIFF_MS,
  SIG_HIT,
} from './combat'
import { COMBO, COMBO_CHARGES, COMBO_MIX, COMBO_SHAPE, COMBOS_ON, COUNTER, ELEMENTS, SIGNATURE } from './spells'
import { SHAPE_PATHS, SHAPE_STARTS } from './shapePaths'
import { loadDrawHand } from './settings'
import { Chevron, HomeButton } from './HomeCorner'
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
  spread?: (ch: { name: string; color: string }) => ReactNode // a page that draws both leaves itself (Statuses)
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
  F: (p) => `Burns them for ${BURN[p]} over 1.5 s.`,
  I: (p) => `Chills them: the next hit they take does +${CHILL[p] * 100}%, for ${s(p ? CHILL_HEAVY_MS : CHILL_MS)}.`,
  W: () => 'Heals you half the damage it deals.',
  E: () => 'No effect, but it hits the hardest.',
  L: (p) => `Static on them: ${STATIC_PULSES[p]} pulse${STATIC_PULSES[p] > 1 ? 's' : ''}, on 0.5 s, off 1 s. Their throws fizzle while it's on.`,
}

const SIGS: Record<string, { name: string; dmg: number; does: string }> = {
  F: { name: 'Meteor', dmg: SIG_HIT.flame, does: 'Burns them for 18 over 2.5 s. The most total damage of any signature.' },
  I: { name: 'Frozen Prison', dmg: SIG_HIT.cage, does: `Stuns them for ${s(PRISON_SILENCE_MS)}, whatever their element, then chills: their next hit taken does +${PRISON_CHILL * 100}%, for ${s(CHILL_HEAVY_MS)}.` },
  W: { name: 'Tidal Wave', dmg: SIG_HIT.spiral, does: `Heals you ${TIDAL_HEAL}.` },
  E: { name: 'Earthquake', dmg: SIG_HIT.battlements, does: 'At 100% Earth power, knocks off their charge and readied spell.' },
  L: { name: 'Thunderbolt', dmg: SIG_HIT.zigzag7, does: "Static on them: 3 pulses, on 0.5 s, off 0.8 s. Their throws fizzle while it's on." },
}

const COMBO_DOES: Record<string, { dmg: number; does: string }> = {
  magma: { dmg: MAGMA[0], does: `Burns them for ${MAGMA[1]} over 5 s.` },
  storm: { dmg: STORM.hit, does: `Storm on them: ${STORM.count} pulses of ${STORM.pulse}, on 0.35 s, off 0.6 s. A throw while it's on fizzles and costs them ${STORM.zap}.` },
  glacier: { dmg: GLACIER_DMG, does: `Arrives after ${s(GLACIER_MS)} and can't be parried. Only a Fire + Ice combo counterspell stops it.` },
  twilight: { dmg: 0, does: `For ${s(TWILIGHT_MS)}, you take ${TWILIGHT_GUARD * 100}% less damage and they take +${TWILIGHT_EXPOSE * 100}%.` },
  steam: { dmg: STEAM_HIT, does: `Their next ${STEAM_SHOTS} attacks miss, for up to ${s(STEAM_MS)}.` },
  thermal: { dmg: THERMAL.hit, does: `Burns them for ${THERMAL.burn} and chills them: their next hit taken does +${THERMAL.chill * 100}%, for ${s(THERMAL.chillMs)}. The strongest chill.` },
  plasma: { dmg: PLASMA.hit, does: `Burns them for ${PLASMA.burn}, knocks off their charge, and drops their elements and parry to ${PLASMA.cap * 100}% power.` },
  sunfire: { dmg: SUNFIRE[0], does: `Burns them for ${SUNFIRE[1]} over 6 s and heals you the same.` },
  grave: { dmg: GRAVE.hit, does: `No healing or armor for them, for ${s(GRAVE.ms)}. A Heal clears it but heals nothing.` },
}

const MAGIC: { el: 'A' | 'U'; shape: string; name: string; does: string; chips: string[] }[] = [
  { el: 'A', shape: 'star', name: 'Heal', does: 'Heals you at once. At 100% Angelic power, it also clears your curses. Under a Grave, it clears the Grave and heals nothing.', chips: [`+${HEAL} HP`] },
  { el: 'A', shape: 'hourglass', name: 'Regen', does: 'Heals you over 2.5 s, more than Heal. A counterspell ends it.', chips: [`+${REGEN.amount * REGEN.ticks} HP`, '2.5 s'] },
  { el: 'A', shape: 'aegis', name: 'Aegis', does: `Armor that soaks direct hits, draining ${AEGIS_DRAIN} a second. Can't recast while it lasts.`, chips: [`${AEGIS_HP} armor`] },
  { el: 'U', shape: 'scythe', name: 'Doom', does: `They take ${DOOM_DMG} unless they throw a spell at ${DOOM_LIFT * 100}%+ power within ${s(DOOM_MS)}.`, chips: [`${DOOM_DMG} dmg`, s(DOOM_MS)] },
  { el: 'U', shape: 'veil', name: 'Shroud', does: "Hides your charge and drawing from them.", chips: [s(SHROUD_MS)] },
  { el: 'U', shape: 'blade', name: 'Execute', does: 'Double damage if they have a curse when it lands: burning, chilled, static, Doomed and more.', chips: [`${EXECUTE.base} dmg`, `${EXECUTE.cursed} cursed`] },
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
/** Wear: the same chips a fight shows on your status row (only worn elements appear). */
const wearArt = (
  <div className="book-wear-demo">
    <div className="wear-chips">
      {[['F', 70], ['I', 40], ['W', 85]].map(([e, v]) => (
        <span key={e as string} style={{ '--el': ELEMENTS[e as string].color } as React.CSSProperties}>
          {e} {v}
        </span>
      ))}
    </div>
    <small>Power left, shown under your health bar. Fresh elements don't show.</small>
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

/** A status as the fight shows it: its icon (red edge bad, green good), one effect line, then labeled numbers
 *  (stat-line style, like a MOBA tooltip: plans/ and memory "text style"). */
type StatusInfo = { icon: RowIcon; name: string; effect: string; stats: string[]; good?: boolean }
const GROUPS: { name: string; rows: StatusInfo[] }[] = [
  {
    name: 'Damage',
    rows: [
      { icon: 'burn', name: 'Burning', effect: 'Takes damage every 0.5 s.', stats: [`Light ${BURN[0]}, heavy ${BURN[1]} over 1.5 s`, `Magma ${MAGMA[1]} over 5 s`, `Sunfire ${SUNFIRE[1]} over 6 s, heals the caster`, `Thermal ${THERMAL.burn}, Plasma ${PLASMA.burn} over 2 s`] },
      { icon: 'chill', name: 'Chilled', effect: 'The next hit you take does more.', stats: [`Light +${CHILL[0] * 100}% for ${s(CHILL_MS)}`, `Heavy +${CHILL[1] * 100}% for ${s(CHILL_HEAVY_MS)}`, `Frozen Prison +${PRISON_CHILL * 100}% for ${s(CHILL_HEAVY_MS)}`, `Thermal Shock +${THERMAL.chill * 100}% for ${s(THERMAL.chillMs)}`] },
    ],
  },
  {
    name: 'Pulses',
    rows: [
      { icon: 'static', name: 'Static', effect: "Throwing while it's on fizzles your spell.", stats: ['On 0.5 s, off 1 s (Thunderbolt off 0.8 s)', `Pulses: light ${STATIC_PULSES[0]}, heavy ${STATIC_PULSES[1]}, Thunderbolt 3`, `From: Lightning at ${STATIC_CUTOFF * 100}%+ power`] },
      { icon: 'storm', name: 'Storm', effect: `${STORM.pulse} damage each time it's on.`, stats: [`On 0.35 s, off 0.6 s, ${STORM.count} times`, `Throwing while it's on fizzles and costs ${STORM.zap}`, 'From: Storm'] },
    ],
  },
  {
    name: "Can't act",
    rows: [
      { icon: 'silenced', name: 'Stunned', effect: "Can't draw or charge until their next hit. Charge lost.", stats: [`Up to ${s(COUNTER_SILENCE_MS)}`, 'From: their counterspell'] },
      { icon: 'silenced', name: 'Frozen', effect: "Can't draw or charge.", stats: [s(PRISON_SILENCE_MS), 'From: Frozen Prison'] },
      { icon: 'interrupted', name: 'Interrupted', effect: "Can't sign, draw or throw.", stats: [s(INTERRUPT_LOCK_MS), 'From: their interrupt'] },
    ],
  },
  {
    name: 'Your mistakes',
    rows: [
      { icon: 'whiffed', name: 'Whiffed', effect: "Can't sign, draw or throw.", stats: [s(WHIFF_MS), 'From: your interrupt missing'] },
      { icon: 'fizzled', name: 'Fizzled', effect: "Can't throw. Charge lost.", stats: [s(FIZZLE_LOCK_MS), 'From: a bad drawing or a late throw'] },
      { icon: 'staggered', name: 'Staggered', effect: "Can't throw or parry.", stats: [s(PARRY_MISS_MS), 'From: a missed parry'] },
    ],
  },
  {
    name: 'Curses',
    rows: [
      { icon: 'doom', name: 'Doomed', effect: `Take ${DOOM_DMG} when it runs out.`, stats: [s(DOOM_MS), `Lift it: throw a spell at ${DOOM_LIFT * 100}%+ power`, 'From: Doom'] },
      { icon: 'exposed', name: 'Exposed', effect: `Take +${TWILIGHT_EXPOSE * 100}% damage.`, stats: [s(TWILIGHT_MS), 'From: Twilight'] },
      { icon: 'fog', name: 'Fogged', effect: 'Your attacks miss.', stats: [`${s(STEAM_MS)} or ${STEAM_SHOTS} attacks`, 'From: Steam'] },
      { icon: 'noHeal', name: 'Grave', effect: 'No healing or armor.', stats: [s(GRAVE.ms), 'From: Grave'] },
    ],
  },
  {
    name: 'Buffs',
    rows: [
      { icon: 'regen', name: 'Regenerating', effect: `Heals ${REGEN.amount} every 0.5 s.`, stats: [`${(REGEN.ticks * 0.5).toString()} s`, 'Ended by a counterspell', 'From: Hourglass'], good: true },
      { icon: 'aegis', name: 'Aegis', effect: `${AEGIS_HP} armor that soaks direct hits.`, stats: [`Drains ${AEGIS_DRAIN} a second`, 'From: Aegis'], good: true },
      { icon: 'guard', name: 'Guarded', effect: `Take ${TWILIGHT_GUARD * 100}% less damage.`, stats: [s(TWILIGHT_MS), 'From: Twilight'], good: true },
      { icon: 'shroud', name: 'Shrouded', effect: "They can't see your charge or drawing.", stats: [s(SHROUD_MS), 'From: Shroud'], good: true },
    ],
  },
]
/** Every status on one page: its icons as the fight shows them (tap one to read it below). The lockouts share
 *  one symbol in a fight, so they share one icon here too, and its entry lists every cause. */
const LOCKOUTS = GROUPS.filter((g) => g.name === "Can't act" || g.name === 'Your mistakes').flatMap((g) => g.rows)
type Entry = { key: string; icon: RowIcon; good?: boolean; group: string; rows: StatusInfo[]; compact?: boolean }
const ENTRIES: Entry[] = GROUPS.flatMap((g): Entry[] =>
  g.name === 'Your mistakes'
    ? []
    : g.name === "Can't act"
      ? [{ key: 'lockouts', icon: 'silenced', group: "Can't act", rows: LOCKOUTS, compact: true }]
      : g.rows.map((r) => ({ key: r.name, icon: r.icon, good: r.good, group: g.name, rows: [r] })),
)
function StatusSpread({ ch }: { ch: { name: string; color: string } }) {
  const [k, setK] = useState(0)
  const e = ENTRIES[Math.min(k, ENTRIES.length - 1)]
  const one = e.rows.length === 1 ? e.rows[0] : null
  return (
    <>
      <div className="book-leaf left status-left">
        <span className="book-chapter" style={{ background: ch.color }}>{ch.name}</span>
        <div className="book-status-list" onPointerDown={(ev) => ev.stopPropagation()} onPointerUp={(ev) => ev.stopPropagation()}>
          <div className="book-status-grid" role="tablist" aria-label="Statuses">
            {ENTRIES.map((x, j) => (
              <button key={x.key} role="tab" aria-selected={j === k} aria-label={x.rows.length > 1 ? x.group : x.rows[0].name} className={j === k ? 'on' : ''} onClick={() => setK(j)}>
                <span className={`st-icon ${x.good ? 'good' : 'bad'}`}>
                  <svg viewBox="0 0 24 24" aria-hidden="true">
                    <path d={iconPath(x.icon)} />
                  </svg>
                </span>
              </button>
            ))}
          </div>
          <small className="book-status-note">Shown under each health bar. Red edge hurts you, green helps. Tap one to read it.</small>
        </div>
      </div>
      <div className="book-leaf right status-right" role="tabpanel">
        {one && <small className="book-status-group">{e.group}</small>}
        <h2>{one ? one.name : e.group}</h2>
        {one ? (
          <>
            <p className="book-how">{one.effect}</p>
            <div className="book-chips">
              {one.stats.map((t) => (
                <span key={t}>{t}</span>
              ))}
            </div>
          </>
        ) : (
          <ul className="book-lockouts">
            {e.rows.map((r) => (
              <li key={r.name}>
                <b>
                  {r.name} <em>{r.stats[0]}</em>
                </b>
                <small>
                  {r.effect} {r.stats[1]}
                </small>
              </li>
            ))}
          </ul>
        )}
      </div>
    </>
  )
}

const PAGES: Page[] = [
  { ch: 'basics', title: 'Charge', art: <div className="book-signs wrap">{[...ATTACK_ELS, 'A', 'U'].map((l) => <span key={l} className="book-sign-cap" style={{ color: ELEMENTS[l].color }}><Sign l={l} size={68} /><small>{ELEMENTS[l].name}</small></span>)}</div>, how: 'Sign a letter with one hand and hold it.', does: 'Your hand charges with that element. Open all five fingers and hold to drop it.' },
  { ch: 'basics', title: 'Draw', art: <DrawDemo />, how: "Keep holding the letter. Trace a shape with your other hand's index finger.", does: 'Open your signing hand to finish. The yellow dot is one place to start: any start or direction works.' },
  { ch: 'basics', title: 'Throw', art: <ThrowArt />, how: 'Open your signing hand to a 5, then push it at the camera.', does: `Push within ${s(READY_LIFE_MS)} of drawing, or the spell fizzles.` },
  { ch: 'basics', title: 'Who beats who', art: cycle, how: 'Each element beats the next one, round the circle. Angelic and Unholy beat each other.', does: 'Counter or interrupt with the element that beats theirs.' },
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
  { ch: 'defense', title: 'Counterspell', art: <SignShape signs={['W']} shape={COUNTER} color={ELEMENTS.W.color} />, how: 'They charge Fire? Water beats Fire: sign W, draw a circle with a diagonal line through it, push.', does: `If they still hold the element yours beats, they're stunned until your next hit, up to ${s(COUNTER_SILENCE_MS)}. Any element's counterspell stops a heal.`, chips: [`Stun up to ${s(COUNTER_SILENCE_MS)}`, `Needs ${COUNTER_CUTOFF * 100}%+ power`] },
  { ch: 'defense', title: 'Interrupt', art: <InterruptArt />, how: 'They charge Fire? Sign W and push it at the camera. No drawing.', does: `Their spell fizzles and they can't act for ${s(INTERRUPT_LOCK_MS)}. If it misses, you can't act for ${s(WHIFF_MS)}. Doesn't stop heals.`, chips: [`Lock ${s(INTERRUPT_LOCK_MS)}`, `Miss ${s(WHIFF_MS)}`, `Needs ${COUNTER_CUTOFF * 100}%+ power`] },
  { ch: 'defense', title: 'Parry', art: parryArt, how: `Push both hands at the camera in the last ${PARRY_WINDOWS.light} ms before a spell hits you.`, does: `Parry timer in the Training dummy shows that moment. Each parry, hit or miss, wears your parry ${WEAR_STEP * 100}%: at 70%, 70% goes back and 30% hits you.`, chips: [`Miss: stagger ${s(PARRY_MISS_MS)}`] },
  { ch: 'status', title: 'Wear', art: wearArt, how: "Each cast, counters included, weakens that element.", does: `At 70%, a 24 damage heavy does 17. Burns, chills and heals shrink too.`, chips: [`-${WEAR_STEP * 100}% a throw`, `-${WEAR_STEP * 50}% light, Angelic or interrupt`, `Lowest ${WEAR_FLOOR * 100}%`, `+${WEAR_STEP * 100}% every ${s(WEAR_DECAY_MS)}`] },
  { ch: 'status', title: 'Statuses', art: null, spread: (ch) => <StatusSpread ch={ch} />, how: 'Icons under each health bar. Red edge hurts you, green helps.', does: 'The bar under an icon is its time left. Worn spells give weaker, shorter statuses. A full-power Heal clears curses.' },
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
let lastPage = 0 // the book opens where you left it (this visit)
export function Spellbook({ onHome, inMatch }: { onHome: () => void; inMatch?: boolean }) {
  const [i, setI] = useState(() => lastPage)
  const go = (to: number) => {
    const n = Math.max(0, Math.min(PAGES.length - 1, to))
    if (n === i) return
    lastPage = n
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
  // The chapter tabs scroll sideways on a phone: the open chapter's tab slides to the middle (Nov 26: the last
  // ones were off screen with nothing saying so), so tapping the last visible tab brings the next ones in.
  const ribbons = useRef<HTMLElement>(null)
  useEffect(() => {
    const nav = ribbons.current
    const tab = nav?.querySelector<HTMLElement>('button.on')
    if (!nav || !tab) return
    nav.scrollTo({ left: tab.offsetLeft - (nav.clientWidth - tab.offsetWidth) / 2, behavior: 'smooth' })
  }, [p.ch])
  return (
    <main className={`page info-page book-page ${inMatch ? 'in-match' : ''}`}>
      <div className="info-top">
        <h1 className="logo">Spellbook</h1>
        <HomeButton onClick={onHome} back={inMatch} />
      </div>
      <nav className="book-ribbons" aria-label="Chapters" ref={ribbons}>
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
          {p.spread ? p.spread(ch) : (
          <>
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
          </>
          )}
        </div>
      </section>
      <div className="book-nav">
        <button className="small" onClick={() => go(i - 1)} disabled={i === 0} aria-label="Previous page">
          <Chevron dir="left" />
        </button>
        <span>
          {i + 1} / {PAGES.length}
        </span>
        <button className="small" onClick={() => go(i + 1)} disabled={i === PAGES.length - 1} aria-label="Next page">
          <Chevron dir="right" />
        </button>
      </div>
    </main>
  )
}


