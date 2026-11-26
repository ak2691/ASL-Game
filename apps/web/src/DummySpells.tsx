// Training dummy menu: pick which spells it throws at you when attacking. One section per element,
// each spell a card with its drawing; click a card to turn it on or off, or the element to toggle all.
// Each card shows how long the dummy takes to cast it on an edit strip at its bottom; tapping the strip opens a
// small popup to type that spell's time (Nov 26: the old bar under the section could open off screen).
import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { COMBO_INFO, ELEMENTS, chargeInfo, shapesFor, spellName } from './spells'
import { SHAPE_PATHS } from './shapePaths'
import { DUMMY_COMBOS, DUMMY_ELEMENTS, SPELL_PCT } from './settings'
import { dummyTimes } from './battle'

/** One section per element, plus one for all the combos. */
const GROUPS = [
  ...DUMMY_ELEMENTS.map((el) => ({ id: el, name: ELEMENTS[el].name, color: ELEMENTS[el].color, els: [el] })),
  ...(DUMMY_COMBOS.length ? [{ id: 'C', name: 'Combos', color: COMBO_INFO.color, els: DUMMY_COMBOS }] : []),
]

/** A spell's whole cast (sign + draw + ready) in seconds at a share of its default time. */
const castSecs = (key: string, share: number) => {
  const [el, sh] = key.split(':')
  const t = dummyTimes(el, sh, share)
  return (t.chargeMs + t.drawMs + t.readyMs) / 1000
}
const STEP_S = 0.1

type Props = {
  pool: string[]
  onChange: (pool: string[]) => void
  spellPct: Record<string, number> // each spell's own speed, % of its default time (missing = 100)
  allPct: number // Cast time, on top of every spell
  onSpellPct: (key: string, pct: number | null) => void
}

/** The spell cards. The menu around it (DummyMenu) has the count and the All / None / Done footer. */
export function DummySpells({ pool, onChange, spellPct, allPct, onSpellPct }: Props) {
  const [editing, setEditing] = useState<string | null>(null)
  const toggle = (keys: string[]) => {
    const allOn = keys.every((k) => pool.includes(k))
    onChange(allOn ? pool.filter((k) => !keys.includes(k)) : [...new Set([...pool, ...keys])])
  }
  const secs = (key: string) => castSecs(key, ((spellPct[key] ?? 100) * allPct) / 10000)
  /** Set a spell's cast to `target` seconds (as shown, Cast time included). Time isn't exactly proportional to
   *  the speed % (some parts don't scale), so the % is searched for. */
  const setSecs = (key: string, target: number) => {
    let [lo, hi] = [SPELL_PCT.min, SPELL_PCT.max]
    for (let i = 0; i < 30; i++) {
      const mid = (lo + hi) / 2
      if (castSecs(key, (mid * allPct) / 10000) < target) lo = mid
      else hi = mid
    }
    onSpellPct(key, (lo + hi) / 2)
  }
  return (
    <div className="dummy-spells">
      <div className="dummy-spells-list">
        {GROUPS.map((g) => {
          const keys = g.els.flatMap((el) => shapesFor(el).map((sh) => `${el}:${sh}`))
          const on = keys.filter((k) => pool.includes(k)).length
          return (
            <section key={g.id} className="pool-el" style={{ color: g.color }}>
              <button className="pool-el-name" onClick={() => toggle(keys)} title={on === keys.length ? 'Turn all off' : 'Turn all on'}>
                {g.name}
                <small>
                  {on}/{keys.length}
                </small>
              </button>
              <div className="pool-cards">
                {keys.map((key) => {
                  const [el, sh] = key.split(':')
                  const custom = key in spellPct && spellPct[key] !== 100
                  return (
                    <div key={key} className="pool-card-wrap">
                      <button className={`pool-card ${pool.includes(key) ? 'on' : ''} ${editing === key ? 'editing' : ''}`} style={{ color: chargeInfo(el).color }} onClick={() => toggle([key])} aria-pressed={pool.includes(key)}>
                        <svg viewBox="0 0 40 40" width="40" height="40" aria-hidden>
                          <path d={SHAPE_PATHS[sh]} fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                        <span>{spellName(el, sh)}</span>
                      </button>
                      <button className={`pool-time ${custom ? 'custom' : ''}`} aria-label={`${spellName(el, sh)}: ${secs(key).toFixed(1)} seconds. Change`} onClick={() => setEditing(key)}>
                        <svg viewBox="0 0 24 24" aria-hidden>
                          <path d="M4 20h4L19 9l-4-4L4 16z M14 6l4 4" />
                        </svg>
                        {secs(key).toFixed(1)} s
                      </button>
                    </div>
                  )
                })}
              </div>
            </section>
          )
        })}
      </div>
      {editing && (
        <SpeedPopup
          key={editing}
          spell={editing}
          secs={secs(editing)}
          min={castSecs(editing, (SPELL_PCT.min * allPct) / 10000)}
          max={castSecs(editing, (SPELL_PCT.max * allPct) / 10000)}
          custom={editing in spellPct}
          onSet={(t) => setSecs(editing, t)}
          onDefault={() => onSpellPct(editing, null)}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  )
}

/** One spell's cast time: type it (kept between min and max), or step it by 0.1 s. */
function SpeedPopup(p: { spell: string; secs: number; min: number; max: number; custom: boolean; onSet: (t: number) => void; onDefault: () => void; onClose: () => void }) {
  const [el, sh] = p.spell.split(':')
  const [text, setText] = useState(p.secs.toFixed(1))
  useEffect(() => setText(p.secs.toFixed(1)), [p.secs])
  const clamp = (t: number) => Math.min(p.max, Math.max(p.min, t))
  const commit = () => {
    const t = Number(text)
    if (!text.trim() || !Number.isFinite(t)) return setText(p.secs.toFixed(1))
    const c = Math.round(clamp(t) * 10) / 10
    setText(c.toFixed(1))
    if (Math.abs(c - p.secs) > 0.01) p.onSet(c)
  }
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && p.onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [p])
  // On the page itself: the menu's scroller clips (contain: paint), so a popup inside it would be cut off.
  return createPortal(
    <div className="speed-pop-backdrop" onClick={p.onClose}>
      <div className="speed-pop" role="dialog" aria-label={`${spellName(el, sh)} cast time`} onClick={(e) => e.stopPropagation()} style={{ color: chargeInfo(el).color }}>
        <div className="speed-pop-head">
          <svg viewBox="0 0 40 40" width="40" height="40" aria-hidden>
            <path d={SHAPE_PATHS[sh]} fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          <b>{spellName(el, sh)}</b>
        </div>
        <span className="speed-pop-label">Cast time</span>
        <div className="speed-pop-step">
          <button aria-label="Faster" disabled={p.secs <= p.min + 0.001} onClick={() => p.onSet(Math.round(clamp(p.secs - STEP_S) * 10) / 10)}>
            −
          </button>
          <label>
            <input type="number" inputMode="decimal" step={STEP_S} min={p.min.toFixed(1)} max={p.max.toFixed(1)} value={text} aria-label="Seconds"
              onChange={(e) => setText(e.target.value)} onBlur={commit} onKeyDown={(e) => e.key === 'Enter' && (e.currentTarget as HTMLInputElement).blur()} />
            <b>s</b>
          </label>
          <button aria-label="Slower" disabled={p.secs >= p.max - 0.001} onClick={() => p.onSet(Math.round(clamp(p.secs + STEP_S) * 10) / 10)}>
            +
          </button>
        </div>
        <small className="speed-pop-range">
          From {p.min.toFixed(1)} s to {p.max.toFixed(1)} s
        </small>
        <div className="speed-pop-actions">
          <button disabled={!p.custom} onClick={p.onDefault}>
            Default
          </button>
          <button className="cta" onClick={p.onClose}>
            Done
          </button>
        </div>
      </div>
    </div>,
    document.body,
  )
}
