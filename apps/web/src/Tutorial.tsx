// Tutorial: cast every spell once on the dummy. Each step shows the ASL letter, an animated
// drawing of the shape, and one short tip. A step passes when that spell is thrown.
import { useEffect, useRef, useState } from 'react'
import { COMBOS_ON, COMBO_SHAPE, COUNTER, FORMS, QUICK, SIGNATURE, chargeInfo, signsFor, spellName } from './spells'
import { SHAPE_PATHS, SHAPE_STARTS } from './shapePaths'
import type { Snapshot } from './battle'
import type { Hand } from './recognition'

interface Step {
  el: string
  shape: string
  tip?: string
}

const TIPS: Record<string, string> = {
  'F line': 'Hold F until it charges, keep holding it while you trace a line, then open all five fingers and push toward the camera.',
  'I w': 'Keep holding I for the whole W. Opening your hand early ends the drawing.',
  'F w': 'Any size works. Just keep the shape.',
  'F flame': 'Signatures are harder to draw but hit much harder.',
  'I line': 'Wrong shape or no charge means a fizzle. Wait it out and try again.',
  'W spiral': 'Start in the middle and spiral out.',
  'E battlements': 'Earthquake knocks your opponent down and their charge is lost.',
  'L line': 'Lightning static makes their throws fizzle.',
  'H star': 'Heal yourself.',
  'H hourglass': 'Regen heals a little at a time.',
  'H aegis': 'Aegis soaks the next hits for a few seconds.',
  'H mirror': 'Mirror sends their next hit back at them.',
  'U scythe': 'Doom: they must land a cast within 2.5 seconds or take a big hit.',
  'U veil': 'Shroud hides your charge and drawing from them.',
  'U blade': 'Execute hits harder the lower their health.',
  'magma volcano': 'Combo: sign C, then F and E, then draw. Starting to draw locks the mix.',
  'storm cloud': 'Five storm pulses. Throwing during one fizzles and hurts you.',
  'glacier iceberg': 'Takes 5 seconds to arrive. Only C, F, I and a circle stops it.',
  'twilight yinyang': 'You take half damage and they take 50% more for 6 seconds.',
  'steam puff': 'Their attacks have a 50% chance to miss for 5 seconds.',
  'thermal thermo': 'Sets off any burn or chill already on them.',
  'plasma plasma': 'Stuns them for 1.5 seconds and burns.',
  'sunfire sun': 'A long burn that heals you.',
  'grave tomb': 'They cannot heal for 9 seconds.',
  'W circle': 'Counterspell: use the element that beats theirs. Water beats Fire, Fire beats Ice, Ice beats Earth, Earth beats Lightning, Lightning beats Water.',
  'W jab': 'Interrupt: sign and push, no drawing. Faster but weaker. It only stops a plain element charge, not a heal or a combo.',
  'H circle': 'Holy beats Unholy. A counterspell of any element also stops a heal charge or a regen still ticking.',
  'U circle': 'Unholy beats Holy. Holy and Unholy can only be countered with the circle, never an interrupt.',
  'CIW circle': 'To counter a combo, sign C and the two elements that beat it, then circle. Ice and Water beat Magma. Fire and Ice also smash an Advancing Glacier on its way.',
}

/** How to draw each shape: count and orientation. */
const HINTS: Record<string, string> = {
  line: 'Any direction',
  h: 'One stroke: down, back up to the middle, across, then the other side',
  flame: 'A circle, then four spikes along its top',
  cage: 'A square, then both diagonals, in one stroke',
  zigzag7: '7 lines',
  battlements: '3 towers, flat side down',
  spiral: 'From the middle out, either way round',
  star: '5 lines, point up',
  hourglass: 'Top, diagonal, bottom, diagonal back',
  circle: 'Any direction',
  aegis: 'Shield outline, then a line up the middle',
  mirror: 'Sideways 8',
  scythe: 'Up, a big blade out and back, then cross the handle twice',
  veil: 'Three loops in a row',
  blade: 'A box, a blade under it, a post on top',
  volcano: 'Slopes, a loop on top, then the base',
  cloud: 'Three bumps, then a bolt out the bottom',
  iceberg: 'Waterline, the peaks, then the big part below',
  yinyang: 'A circle, an S through it, then both dots',
  puff: 'Three humps on top, one each side, three below',
  thermo: 'A thermometer, then a zigzag crack across it',
  plasma: 'Exactly 3 loops from the middle, a line straight up, then the circle',
  sun: 'Exactly 8 points all the way round',
  tomb: 'A tombstone, then a cross inside',
}

/** Read-only cards before the first spell: how a cast works and what drops a drawing. */
/** One read-only card before the first spell. How to cast is on each spell card itself. */
const BASICS: { title: string; points: string[] }[] = [
  {
    title: 'Get set up',
    points: [
      'Sit about an arm’s length from the camera.',
      'Keep both hands inside the frame the whole time.',
      'One hand signs the spell’s letter, the other draws with its index tip (change which in Settings).',
      'Bright, even light helps. Avoid a window behind you.',
    ],
  },
]

/** Read-only cards after the spells: things you can't practise on the dummy. */
const END: { title: string; points: string[]; try: 'parry' | 'two' }[] = [
  {
    title: 'Parry',
    try: 'parry',
    points: [
      'Push both hands toward the camera just before a spell hits you: the last 0.1 s.',
      'It flies back at the caster at full power. Parried again: 75%, then 50%. A fourth parry just ends it.',
      'Too early, too late, or nothing coming: staggered for 1 s (no throws, no parries).',
      'Parrying drops your own charge and readied spell. Counterspells and the Advancing Glacier can\'t be parried.',
    ],
  },
  {
    title: 'Two opponents',
    try: 'two',
    points: [
      'While a spell is ready, your signing hand aims: the side of the screen it\'s on picks the enemy.',
      'Heals and buffs always go to you (or your most hurt teammate).',
      'Not aiming? Attacks go to whoever last hit you, else the enemy with the least health.',
      '"Aiming at you" marks the enemy whose spell is coming your way. Practise it in Two dummies.',
    ],
  },
]

const STEPS: Step[] = [
  ...['F', 'I', 'W', 'E', 'L'].flatMap((el) => ['line', 'h', SIGNATURE[el]].map((shape) => ({ el, shape }))),
  { el: 'H', shape: 'star' },
  { el: 'H', shape: 'hourglass' },
  { el: 'H', shape: 'aegis' },
  { el: 'U', shape: 'scythe' },
  { el: 'U', shape: 'veil' },
  { el: 'U', shape: 'blade' },
  ...(COMBOS_ON ? Object.entries(COMBO_SHAPE).map(([el, shape]) => ({ el, shape })) : []),
  { el: 'W', shape: COUNTER },
  { el: 'W', shape: QUICK },
  { el: 'H', shape: COUNTER },
  { el: 'U', shape: COUNTER },
  ...(COMBOS_ON ? [{ el: 'CIW', shape: COUNTER }] : []),
].map((s) => ({ ...s, tip: TIPS[`${s.el} ${s.shape}`] }))

/** Acts on press (pointer down), so fast clicks never get lost; Enter/Space still work. */
const press = (fn: () => void) => ({
  onPointerDown: (e: React.PointerEvent) => {
    if (e.button === 0) fn()
  },
  onClick: (e: React.MouseEvent) => {
    if (e.detail === 0) fn()
  },
})
const LAST = STEPS.length + END.length // the "You're ready" card

export function Tutorial({ notes, onHome, drawHand, twoHands, onTry }: { notes: Snapshot['notes']; onHome: () => void; drawHand: Hand; twoHands: boolean; onTry: (kind: 'parry' | 'two' | null) => void }) {
  const [i, setI] = useState(-BASICS.length)
  const [trying, setTrying] = useState<'parry' | 'two' | null>(null)
  const tryIt = (kind: 'parry' | 'two' | null) => {
    setTrying(kind)
    onTry(kind)
  }
  const [done, setDone] = useState(() => new Set<number>())
  const seen = useRef(new Set<number>())
  const step = STEPS[i]
  const go = (d: number) => setI((x) => Math.max(-BASICS.length, Math.min(LAST, x + d)))
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowLeft') go(-1)
      if (e.key === 'ArrowRight') go(1)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
  useEffect(() => {
    if (!step) return
    const want = spellName(step.el, step.shape)
    for (const n of notes) {
      if (seen.current.has(n.id)) continue
      seen.current.add(n.id)
      if (n.side === 'player' && n.ok && n.name === want) {
        setDone((d) => new Set(d).add(i))
        setI((x) => x + 1)
      }
    }
  }, [notes, step, i])

  useEffect(() => {
    if (trying) tryIt(null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [i])
  useEffect(() => {
    if (i >= STEPS.length && i < LAST) setDone((d) => (d.has(i) ? d : new Set(d).add(i)))
  }, [i])

  if (i < 0) {
    const b = BASICS[i + BASICS.length]
    return (
      <div className="tutorial">
        <div className="tut-card">
          <div className="tut-head" style={{ background: 'var(--main)' }}>
            <b className="tut-title">{b.title}</b>
            <span className="tut-count">
              Basics {i + BASICS.length + 1} / {BASICS.length}
            </span>
          </div>
          <div className="tut-body">
            <ul className="tut-basics">
              {b.points.map((p) => (
                <li key={p}>{p}</li>
              ))}
            </ul>
            {i === -BASICS.length && <p className="tut-hint">Your camera video stays on your device. It's never saved or shown to anyone.</p>}
            <div className="row">
              <button className="small" {...press(() => go(-1))} disabled={i === -BASICS.length} aria-label="Previous step">
                {'<'}
              </button>
              <button {...press(() => go(1))}>{i === -1 ? 'Start casting' : 'Next'}</button>
            </div>
          </div>
        </div>
      </div>
    )
  }

  if (i >= STEPS.length && i < LAST) {
    const b = END[i - STEPS.length]
    if (trying)
      // Card minimized: the practice runs, one button brings the card back.
      return (
        <div className="tut-mini">
          <b>{trying === 'parry' ? 'Parry the heavy Earth' : 'Aim at a dummy'}</b>
          <button {...press(() => tryIt(null))}>Back to the card</button>
        </div>
      )
    return (
      <div className="tutorial">
        <div className="tut-card">
          <div className="tut-head" style={{ background: 'var(--main)' }}>
            <b className="tut-title">{b.title}</b>
            <span className="tut-count">
              {i + 1} / {LAST}
            </span>
          </div>
          <div className="tut-body">
            <ul className="tut-basics">
              {b.points.map((p) => (
                <li key={p}>{p}</li>
              ))}
            </ul>
            <button className="tut-try" {...press(() => tryIt(b.try))}>
              Try it
            </button>
            <div className="row">
              <button className="small" {...press(() => go(-1))} aria-label="Previous step">
                {'<'}
              </button>
              <button {...press(() => go(1))}>Next</button>
            </div>
          </div>
        </div>
        <ProgressBar at={i} done={done} onPick={setI} />
      </div>
    )
  }

  if (!step)
    return (
      <div className="tutorial">
        <b className="result">You're ready!</b>
        <div className="row">
          <button className="small" {...press(() => go(-1))}>
            {'<'}
          </button>
          <button {...press(onHome)}>Home</button>
        </div>
        <ProgressBar at={i} done={done} onPick={setI} />
      </div>
    )

  const el = chargeInfo(step.el)
  const signs = signsFor(step.el)
  return (
    <div className="tutorial">
      <div className="tut-card" style={{ color: el.color }}>
        <div className="tut-head" style={{ background: el.color }}>
          <b className={`tut-title ${spellName(step.el, step.shape).length > 16 ? 'long' : ''}`}>{spellName(step.el, step.shape)}</b>
          <span className="tut-count">
            {i + 1} / {LAST}
          </span>
        </div>
        <div className="tut-body">
          <div className="tut-demo" style={{ flexDirection: twoHands && drawHand === 'left' ? 'row-reverse' : 'row' }}>
            <figure>
              <b className="tut-hand">{twoHands ? (drawHand === 'right' ? 'Left hand' : 'Right hand') : 'Sign'}</b>
              <div className={`tut-signs ${signs.length > 1 ? 'multi' : ''}`}>
                {signs.map((l) => (
                  <img key={l} src={`/asl/${l}.svg`} alt={`ASL letter ${l}`} />
                ))}
              </div>
              <figcaption>Sign {signs.join(', then ')}</figcaption>
            </figure>
            <figure>
              <b className="tut-hand">{twoHands ? (drawHand === 'right' ? 'Right hand' : 'Left hand') : 'Then draw'}</b>
              {step.shape === QUICK ? (
                <div className="tut-push">Push!</div>
              ) : (
                <svg viewBox="0 0 40 40" key={i} role="img" aria-label={`Draw: ${FORMS[step.shape]}`}>
                  <path d={SHAPE_PATHS[step.shape]} className="tut-ghost" />
                  <path d={SHAPE_PATHS[step.shape]} pathLength={1} className="tut-draw" />
                  <circle cx={SHAPE_STARTS[step.shape][0]} cy={SHAPE_STARTS[step.shape][1]} r="2" fill="#fff" />
                </svg>
              )}
              <figcaption>
                {FORMS[step.shape]}
                {HINTS[step.shape] && <small className="tut-hint">{HINTS[step.shape]}</small>}
              </figcaption>
            </figure>
          </div>
          {step.tip && <p className="tut-tip">{step.tip}</p>}
          <div className="row">
            <button className="small" {...press(() => go(-1))} aria-label="Previous step">
              {'<'}
            </button>
            <button {...press(() => go(1))}>Next</button>
          </div>
        </div>
      </div>
      <ProgressBar at={i} done={done} onPick={setI} />
    </div>
  )
}

/** One bar under the card: a segment per spell in its element's color, filled once cast. Click to jump;
 *  it scrolls sideways when there are too many to fit. */
function ProgressBar({ at, done, onPick }: { at: number; done: Set<number>; onPick: (i: number) => void }) {
  const bar = useRef<HTMLElement>(null)
  useEffect(() => {
    bar.current?.querySelector('[aria-current]')?.scrollIntoView({ block: 'nearest', inline: 'center', behavior: 'smooth' })
  }, [at])
  return (
    <nav className="tut-bar" ref={bar} aria-label="Tutorial steps">
      {[...STEPS.map((s) => ({ name: spellName(s.el, s.shape), color: chargeInfo(s.el).color })), ...END.map((e) => ({ name: e.title, color: 'var(--main)' }))].map((s, i) => (
        <button
          key={i}
          className={`tut-seg ${done.has(i) ? 'done' : ''}`}
          style={{ color: s.color }}
          {...press(() => onPick(i))}
          aria-label={`${s.name}${done.has(i) ? ' (done)' : ''}`}
          aria-current={i === at ? 'step' : undefined}
        />
      ))}
    </nav>
  )
}
