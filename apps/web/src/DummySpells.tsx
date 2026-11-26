// Training dummy menu: pick which spells it throws at you when attacking. One section per element,
// each spell a card with its drawing; click a card to turn it on or off, or the element to toggle all.
// Each card shows how long the dummy takes to cast it; its edit button (Nov 26) opens a bar under the
// section to make that one spell faster or slower.
import { useState } from 'react'
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
  /** Set a spell's cast to `target` seconds (as shown, Cast time included). */
  const setSecs = (key: string, target: number) => onSpellPct(key, (target / castSecs(key, allPct / 100)) * 100)
  return (
    <div className="dummy-spells">
      <div className="dummy-spells-list">
        {GROUPS.map((g) => {
          const keys = g.els.flatMap((el) => shapesFor(el).map((sh) => `${el}:${sh}`))
          const on = keys.filter((k) => pool.includes(k)).length
          const ed = editing && keys.includes(editing) ? editing : null
          const edPct = ed ? (spellPct[ed] ?? 100) : 100
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
                        <small className={`pool-time ${custom ? 'custom' : ''}`}>{secs(key).toFixed(1)} s</small>
                      </button>
                      <button className={`pool-edit ${editing === key ? 'on' : ''}`} aria-label={`Edit ${spellName(el, sh)} speed`} onClick={() => setEditing(editing === key ? null : key)}>
                        <svg viewBox="0 0 24 24" aria-hidden>
                          <path d="M4 20h4L19 9l-4-4L4 16z M14 6l4 4" />
                        </svg>
                      </button>
                    </div>
                  )
                })}
              </div>
              {ed && (
                <div className="pool-editor">
                  <b>{spellName(ed.split(':')[0], ed.split(':')[1])}</b>
                  <span className="pool-editor-step">
                    <button className="small" aria-label="Faster" disabled={edPct <= SPELL_PCT.min} onClick={() => setSecs(ed, Math.max(STEP_S, secs(ed) - STEP_S))}>
                      −
                    </button>
                    <b>{secs(ed).toFixed(1)} s</b>
                    <button className="small" aria-label="Slower" disabled={edPct >= SPELL_PCT.max} onClick={() => setSecs(ed, secs(ed) + STEP_S)}>
                      +
                    </button>
                  </span>
                  <button className="small" disabled={!(ed in spellPct)} onClick={() => onSpellPct(ed, null)}>
                    Default
                  </button>
                </div>
              )}
            </section>
          )
        })}
      </div>
    </div>
  )
}
