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
  'E battlements': 'Earthquake knocks off your opponent’s charge.',
  'L line': 'Lightning static makes their throws fizzle.',
  'H star': 'Heal yourself.',
  'H hourglass': 'Regen heals a little at a time.',
  'H aegis': 'Aegis soaks the next hits for a few seconds.',
  'H mirror': 'Mirror sends their next hit back at them.',
  'U scythe': 'Doom: they must land a cast within 2.5 seconds or take a big hit.',
  'U veil': 'Shroud hides your charge and drawing from them.',
  'U blade': 'Execute hits harder the lower their health.',
  'magma volcano': 'Combo: sign C, then F and E, then draw. Starting to draw locks the mix.',
  'storm cloud': 'A mix that is not a combo fizzles.',
  'blizzard trefoil': 'A combo can be countered by beating either of its elements.',
  'twilight yinyang': 'The strongest spell: strips their buffs and clears your curses.',
  'W circle': 'Counterspell: use the element that beats theirs. Water beats Fire, Fire beats Ice, Ice beats Earth, Earth beats Lightning, Lightning beats Water.',
  'W jab': 'Interrupt: sign and push, no drawing. Faster but weaker.',
}

/** How to draw each shape: count and orientation. */
const HINTS: Record<string, string> = {
  line: 'Any direction',
  w: '4 lines. Keep it upright (an M won’t count)',
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
  volcano: 'Slopes with a smoke loop on top',
  cloud: 'Three bumps, then a bolt out the bottom',
  trefoil: 'Three petals',
  yinyang: 'A circle, then an S through it',
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

const STEPS: Step[] = [
  ...['F', 'I', 'W', 'E', 'L'].flatMap((el) => ['line', 'w', SIGNATURE[el]].map((shape) => ({ el, shape }))),
  { el: 'H', shape: 'star' },
  { el: 'H', shape: 'hourglass' },
  { el: 'H', shape: 'aegis' },
  { el: 'U', shape: 'scythe' },
  { el: 'U', shape: 'veil' },
  { el: 'U', shape: 'blade' },
  ...(COMBOS_ON ? Object.entries(COMBO_SHAPE).map(([el, shape]) => ({ el, shape })) : []),
  { el: 'W', shape: COUNTER },
  { el: 'W', shape: QUICK },
].map((s) => ({ ...s, tip: TIPS[`${s.el} ${s.shape}`] }))

export function Tutorial({ notes, onHome, drawHand, twoHands }: { notes: Snapshot['notes']; onHome: () => void; drawHand: Hand; twoHands: boolean }) {
  const [i, setI] = useState(-BASICS.length)
  const [done, setDone] = useState(() => new Set<number>())
  const seen = useRef(new Set<number>())
  const step = STEPS[i]
  const go = (d: number) => setI((x) => Math.max(-BASICS.length, Math.min(STEPS.length, x + d)))
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
              <button className="small" onClick={() => go(-1)} disabled={i === -BASICS.length} aria-label="Previous step">
                {'<'}
              </button>
              <button onClick={() => go(1)}>{i === -1 ? 'Start casting' : 'Next'}</button>
            </div>
          </div>
        </div>
      </div>
    )
  }

  if (!step)
    return (
      <div className="tutorial">
        <Checklist at={i} done={done} onPick={setI} />
        <b className="result">You're ready!</b>
        <div className="row">
          <button className="small" onClick={() => go(-1)}>
            {'<'}
          </button>
          <button onClick={onHome}>Home</button>
        </div>
      </div>
    )

  const el = chargeInfo(step.el)
  const signs = signsFor(step.el)
  return (
    <div className="tutorial">
      <Checklist at={i} done={done} onPick={setI} />
      <div className="tut-card" style={{ color: el.color }}>
        <div className="tut-head" style={{ background: el.color }}>
          <b className="tut-title">{spellName(step.el, step.shape)}</b>
          <span className="tut-count">
            {i + 1} / {STEPS.length}
          </span>
        </div>
        <div className="tut-body">
          <div className="tut-demo" style={{ flexDirection: twoHands && drawHand === 'left' ? 'row-reverse' : 'row' }}>
            <figure>
              <b className="tut-hand">{twoHands ? (drawHand === 'right' ? 'Left hand' : 'Right hand') : 'Sign'}</b>
              <div className="tut-signs">
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
            <button className="small" onClick={() => go(-1)} aria-label="Previous step">
              {'<'}
            </button>
            <button onClick={() => go(1)}>Next</button>
          </div>
        </div>
      </div>
    </div>
  )
}

/** Steps grouped by element: a tick for each spell cast, the current one marked. Click to jump. */
const GROUPS = [
  { label: 'Fire', els: ['F'] },
  { label: 'Ice', els: ['I'] },
  { label: 'Water', els: ['W'], shapes: ['line', 'w', 'spiral'] },
  { label: 'Earth', els: ['E'] },
  { label: 'Lightning', els: ['L'] },
  { label: 'Holy', els: ['H'] },
  { label: 'Unholy', els: ['U'] },
  ...(COMBOS_ON ? [{ label: 'Combos', els: Object.keys(COMBO_SHAPE) }] : []),
  { label: 'Counters', shapes: [COUNTER, QUICK] },
]
function Checklist({ at, done, onPick }: { at: number; done: Set<number>; onPick: (i: number) => void }) {
  return (
    <nav className="tut-list" aria-label="Tutorial steps">
      <b className="tut-list-title">Checklist</b>
      {GROUPS.map((g) => {
        const idx = STEPS.map((s, i) => ({ s, i })).filter(({ s }) => (g.els ? g.els.includes(s.el) : true) && (g.shapes ? g.shapes.includes(s.shape) : true))
        const all = idx.every(({ i }) => done.has(i))
        return (
          <div key={g.label} className={`tut-row ${all ? 'all' : ''}`}>
            <span className="tut-row-name">{g.label}</span>
            {idx.map(({ s, i }) => (
              <button
                key={i}
                className={`tut-dot ${done.has(i) ? 'done' : ''} ${i === at ? 'now' : ''}`}
                style={{ color: chargeInfo(s.el).color }}
                onClick={() => onPick(i)}
                aria-label={`${spellName(s.el, s.shape)}${done.has(i) ? ' (done)' : ''}`}
                aria-current={i === at ? 'step' : undefined}
              >
                {done.has(i) ? '✓' : ''}
              </button>
            ))}
          </div>
        )
      })}
    </nav>
  )
}
