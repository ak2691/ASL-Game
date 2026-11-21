// Tutorial: cast every spell once on the dummy. Each step shows the ASL letter, an animated
// drawing of the shape, and one short tip. A step passes when that spell is thrown.
import { useEffect, useRef, useState } from 'react'
import { COUNTER, ELEMENTS, FORMS, QUICK, SIGNATURE, spellName } from './spells'
import { SHAPE_PATHS, SHAPE_STARTS } from './SpellPage'
import type { Snapshot } from './battle'

interface Step {
  el: string
  shape: string
  tip?: string
}

const TIPS: Record<string, string> = {
  'F line': 'Hold the F sign to charge. Point only your index finger to draw. Open your whole hand (all five fingers) to finish, then push it at the camera to throw.',
  'I w': 'Hard to spread all five fingers? Turn on Easy pen-up in the Esc menu. Then raising any second finger finishes a drawing.',
  'F w': 'Any size works. Just keep the shape.',
  'F flame': 'Signatures are harder to draw but hit much harder.',
  'I line': 'Wrong shape or no charge means a fizzle. Wait it out and try again.',
  'W line': 'A charge fades after 3 seconds if you don’t draw.',
  'W spiral': 'Start in the middle and spiral out.',
  'E battlements': 'Earthquake knocks off your opponent’s charge.',
  'L line': 'Lightning static makes their throws fizzle.',
  'H star': 'Heal yourself.',
  'H hourglass': 'Regen heals a little at a time.',
  'W circle': 'Counterspell: use the element that beats theirs. Water beats Fire, Fire beats Ice, Ice beats Earth, Earth beats Lightning, Lightning beats Water.',
  'W jab': 'Interrupt: sign and push, no drawing. Faster but weaker.',
}

/** How to draw each shape: count and orientation. */
const HINTS: Record<string, string> = {
  line: 'Any direction',
  w: '4 lines. Keep it upright (an M won’t count)',
  flame: 'Points up, round bowl at the bottom',
  cage: 'A square, then both diagonals, in one stroke',
  zigzag7: '7 lines',
  battlements: '3 towers, flat side down',
  spiral: 'From the middle out, either way round',
  star: '5 lines, point up',
  hourglass: 'Top, diagonal, bottom, diagonal back',
  circle: 'Any direction',
}

const STEPS: Step[] = [
  ...['F', 'I', 'W', 'E', 'L'].flatMap((el) => ['line', 'w', SIGNATURE[el]].map((shape) => ({ el, shape }))),
  { el: 'H', shape: 'star' },
  { el: 'H', shape: 'hourglass' },
  { el: 'W', shape: COUNTER },
  { el: 'W', shape: QUICK },
].map((s) => ({ ...s, tip: TIPS[`${s.el} ${s.shape}`] }))

export function Tutorial({ notes, onHome }: { notes: Snapshot['notes']; onHome: () => void }) {
  const [i, setI] = useState(0)
  const [done, setDone] = useState(() => new Set<number>())
  const seen = useRef(new Set<number>())
  const step = STEPS[i]
  const go = (d: number) => setI((x) => Math.max(0, Math.min(STEPS.length, x + d)))
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

  const el = ELEMENTS[step.el]
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
          <div className="tut-demo">
            <figure>
              <img src={`/asl/${step.el}.svg`} alt={`ASL letter ${step.el}`} />
              <figcaption>Sign {step.el}</figcaption>
            </figure>
            <figure>
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
            <button className="small" onClick={() => go(-1)} disabled={i === 0} aria-label="Previous step">
              {'<'}
            </button>
            <button className="small" onClick={() => go(1)} aria-label="Next step">
              {'>'}
            </button>
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
  { label: 'Heal', els: ['H'] },
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
                style={{ color: ELEMENTS[s.el].color }}
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
