// The Duo Tower's floor picker (plans/duo-tower.md): the 1v1 tower's look, a pair in each window.
// In a room, only the host picks; floors past the room's best are locked.
import { Fragment, memo, useEffect, useRef } from 'react'
import { DUO_CHARS, DUO_FLOORS, duoLine } from './duo'
import { Portrait } from './Ladder'

type Tier = 'apprentice' | 'adept' | 'master'
const tierOf = (floor: number): Tier => (floor <= 4 ? 'apprentice' : floor <= 8 ? 'adept' : 'master')
const TIER_NAME: Record<Tier, string> = { apprentice: 'Apprentice', adept: 'Adept', master: 'Master' }

/** "Ivy and Rowan", "Old Bram and Pip". */
export const pairName = (floor: number) =>
  DUO_FLOORS[floor - 1].pair.map((b) => DUO_CHARS[b.who].name).join(' and ')

export const DuoTower = memo(function DuoTower({ floor, unlocked, onPick }: { floor: number; unlocked: number; onPick: ((n: number) => void) | null }) {
  const box = useRef<HTMLDivElement>(null)
  // Keep the chosen floor in view, also after the layout settles or the page is resized (like the 1v1 tower).
  useEffect(() => {
    const show = () => box.current?.querySelector('.floor.active')?.scrollIntoView({ block: 'nearest' })
    show()
    const ro = new ResizeObserver(() => requestAnimationFrame(show))
    if (box.current) ro.observe(box.current)
    return () => ro.disconnect()
  }, [floor])
  // Its quote: the first one's opening line (the twins say theirs together).
  const [a, b] = DUO_FLOORS[floor - 1].pair.map((x) => x.who)
  const quote = a === 'ivy' ? `${duoLine(a, 'start')} ${duoLine(b, 'start')}` : duoLine(a, 'start')
  return (
    <div className="tower-wrap duo-tower">
      <div className="tower" ref={box}>
        {DUO_FLOORS.map((_, k) => k + 1)
          .reverse()
          .map((n, i, all) => {
            const f = DUO_FLOORS[n - 1]
            const tier = tierOf(n)
            const band = i === 0 || tierOf(all[i - 1]) !== tier
            const locked = n > unlocked
            return (
              <Fragment key={n}>
                {band && (
                  <div className={`tier-band ${tier}`} aria-hidden="true">
                    <span>{TIER_NAME[tier]}</span>
                  </div>
                )}
                <button className={`floor ${tier} ${n === floor ? 'active' : ''} ${locked ? 'locked' : ''}`} disabled={locked || !onPick} onClick={() => onPick?.(n)}>
                  <span className="rung">{n}</span>
                  <span className="window pair">
                    {f.pair.map((b) => (
                      <Portrait key={b.who} id={DUO_CHARS[b.who].portrait} />
                    ))}
                  </span>
                  <span className="floor-text">
                    <span className="floor-name">{pairName(n)}</span>
                    <span className="trait">{f.habit}</span>
                  </span>
                </button>
              </Fragment>
            )
          })}
      </div>
      <span className="sub-line tower-quote">&ldquo;{quote}&rdquo;</span>
    </div>
  )
})
