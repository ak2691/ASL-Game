import { Children, memo, useEffect, useId, useRef, type ReactElement, type ReactNode } from 'react'
import { LADDER, type Difficulty } from './battle'
import { ELEMENTS } from './spells'
import { brawlerPortrait, GLOW, GLOW_COLOR } from './portraits'

/** Each rung's elements (shown as badges) and its one-line personality. */
const INFO: Record<Difficulty, { els: string[]; line: string }> = {
  pebble: { els: ['E', 'W'], line: 'A sleepy rock. Takes its time.' },
  ember: { els: ['F', 'L'], line: 'A jumpy spark. Never casts the same twice.' },
  frost: { els: ['I', 'F'], line: 'A chilly imp. Sometimes snaps back.' },
  cleric: { els: ['W', 'H'], line: 'Heals a lot. Hides behind Aegis.' },
  hexer: { els: ['E', 'U'], line: 'Curses you with Doom and Shroud.' },
  tide: { els: ['W', 'I', 'L'], line: 'Rolls in with three elements.' },
  zealot: { els: ['F', 'H', 'U'], line: 'Light and dark, back and forth.' },
  warden: { els: ['F', 'I', 'W', 'E', 'L'], line: 'Guards the tower door. Knows every element.' },
  adept: { els: ['F', 'I', 'W', 'E', 'L', 'H', 'U'], line: 'A real wizard now.' },
  magus: { els: ['F', 'I', 'W', 'E', 'L', 'H', 'U'], line: 'Reads your habits.' },
  archmage: { els: ['F', 'I', 'W', 'E', 'L', 'H', 'U'], line: 'Fast, and dodges your counters.' },
  lich: { els: ['F', 'I', 'W', 'E', 'L', 'H', 'U'], line: 'Never makes a mistake.' },
}

const C = (el: string) => ELEMENTS[el].color
const INK = '#1d1b2e'

/** Glow look: the badge stays put, everything drawn on it glows in the rung's color. */
function GlowParts({ id }: { id: Difficulty }) {
  const parts = Children.toArray((brawlerPortrait(id) as ReactElement<{ children: ReactNode }>).props.children)
  const c = GLOW_COLOR[id]
  const f = useId()
  return (
    <>
      <defs>
        <filter id={f} x="-60%" y="-60%" width="220%" height="220%">
          <feGaussianBlur in="SourceAlpha" stdDeviation="2.4" result="b" />
          <feFlood floodColor={c} />
          <feComposite in2="b" operator="in" result="g" />
          <feMerge>
            <feMergeNode in="g" />
            <feMergeNode in="g" />
            <feMergeNode in="g" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>
      {parts[0]}
      <g filter={`url(#${f})`}>{parts.slice(1)}</g>
    </>
  )
}

/** A portrait for each rung (see portraits.tsx for the style). */
export const Portrait = memo(function Portrait({ id }: { id: Difficulty }) {
  return (
    <svg className="portrait" viewBox="0 0 48 48" aria-hidden="true">
      {GLOW ? <GlowParts id={id} /> : brawlerPortrait(id)}
    </svg>
  )
})

/** The practice ladder as a wizard tower: Pebble at the door, Lich at the spire. */
export const Tower = memo(function Tower({ value, onPick }: { value: Difficulty; onPick: (d: Difficulty) => void }) {
  const box = useRef<HTMLDivElement>(null)
  // Keep the chosen floor in view (the tower scrolls; it starts at the bottom).
  useEffect(() => {
    box.current?.querySelector('.floor.active')?.scrollIntoView({ block: 'nearest' })
  }, [value])
  const info = INFO[value]
  return (
    <div className="tower-wrap">
      <svg className="spire" viewBox="0 0 200 60" preserveAspectRatio="none" aria-hidden="true">
          <path d="M10 60 L100 4 L190 60 Z" fill="var(--tower-roof)" stroke={INK} strokeWidth="3" strokeLinejoin="round" />
        </svg>
      <div className="tower" ref={box}>
        {[...LADDER].reverse().map((b) => {
          const rung = LADDER.indexOf(b) + 1
          return (
            <button key={b.id} className={`floor ${value === b.id ? 'active' : ''} ${rung > 8 ? 'wizard' : ''}`} onClick={() => onPick(b.id)}>
              <span className="rung">{rung}</span>
              <Portrait id={b.id} />
              <span className="floor-name">{b.name}</span>
              <span className="els">
                {INFO[b.id].els.length >= 5 ? (
                  <i className="all" style={{ background: `linear-gradient(90deg, ${INFO[b.id].els.map(C).join(', ')})` }} title="All elements" />
                ) : (
                  INFO[b.id].els.map((el) => <i key={el} style={{ background: C(el) }} title={ELEMENTS[el].name} />)
                )}
              </span>
            </button>
          )
        })}
        <div className="tower-door" aria-hidden="true" />
      </div>
      <span className="sub-line">{info.line}</span>
    </div>
  )
})
