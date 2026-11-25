// Training dummy menu: pick which spells it throws at you when attacking. One section per element,
// each spell a card with its drawing; click a card to turn it on or off, or the element to toggle all.
import { COMBO_INFO, ELEMENTS, chargeInfo, shapesFor, spellName } from './spells'
import { SHAPE_PATHS } from './shapePaths'
import { DUMMY_COMBOS, DUMMY_ELEMENTS } from './settings'

/** One section per element, plus one for all the combos. */
const GROUPS = [
  ...DUMMY_ELEMENTS.map((el) => ({ id: el, name: ELEMENTS[el].name, color: ELEMENTS[el].color, els: [el] })),
  ...(DUMMY_COMBOS.length ? [{ id: 'C', name: 'Combos', color: COMBO_INFO.color, els: DUMMY_COMBOS }] : []),
]

/** The spell cards. The menu around it (DummyMenu) has the count and the All / None / Done footer. */
export function DummySpells({ pool, onChange }: { pool: string[]; onChange: (pool: string[]) => void }) {
  const toggle = (keys: string[]) => {
    const allOn = keys.every((k) => pool.includes(k))
    onChange(allOn ? pool.filter((k) => !keys.includes(k)) : [...new Set([...pool, ...keys])])
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
                  return (
                    <button key={key} className={`pool-card ${pool.includes(key) ? 'on' : ''}`} style={{ color: chargeInfo(el).color }} onClick={() => toggle([key])} aria-pressed={pool.includes(key)}>
                      <svg viewBox="0 0 40 40" width="40" height="40" aria-hidden>
                        <path d={SHAPE_PATHS[sh]} fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                      <span>{spellName(el, sh)}</span>
                    </button>
                  )
                })}
              </div>
            </section>
          )
        })}
      </div>
    </div>
  )
}
