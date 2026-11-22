// How to cast: every sign and every drawing. Shown from the in-game Esc menu and from the home page.
import { BEATS, COMBO, COMBOS_ON, COMBO_CHARGES, COMBO_INFO, COMBO_MIX, COMBO_SHAPE, COUNTER, ELEMENTS, FORMS, HOLY_SHAPES, PUNCHES, SIGNATURE, TRAITS, UNHOLY_SHAPES } from './spells'
import { SHAPE_PATHS, SHAPE_STARTS } from './shapePaths'

/** What each Holy/Unholy/combo spell does, in a few words (numbers: Spell Info). */
const SHORT: Record<string, string> = {
  star: 'Heal now',
  hourglass: 'Heal over time',
  aegis: 'Armor',
  mirror: 'Reflect a hit',
  scythe: 'Cast in 2.5 s or get hit',
  veil: 'Hide your casting',
  blade: 'Finisher',
}

export function ShapeCard({ shape, color, label, sub }: { shape: string; color?: string; label: string; sub?: string }) {
  return (
    <div className="shape-card" style={{ color }}>
      <svg viewBox="0 0 40 40" width="48" height="48" aria-hidden>
        <path d={SHAPE_PATHS[shape]} fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
        <circle cx={SHAPE_STARTS[shape][0]} cy={SHAPE_STARTS[shape][1]} r="3" fill="var(--main)" />
      </svg>
      <span>{label}</span>
      {sub && <small className="shape-sub">{sub}</small>}
    </div>
  )
}

const Sign = ({ l }: { l: string }) => <img className="asl-mini" src={`/asl/${l}.svg`} alt={`ASL ${l}`} />

export function CastGuide() {
  return (
    <div className="spell-help">
      <b>1. Charge</b> — sign a letter and hold:
      <ul>
        {Object.entries(ELEMENTS).map(([l, e]) => (
          <li key={l} style={{ color: e.color }}>
            <Sign l={l} /> {l} = {e.name}
          </li>
        ))}
        {COMBOS_ON && (
          <li style={{ color: COMBO_INFO.color }}>
            <Sign l={COMBO} /> C = Combo: then sign the two elements to mix
          </li>
        )}
      </ul>
      <p className="shape-note">To drop a charge, open all five fingers and hold a moment.</p>
      <b>2. Draw</b> — keep holding your letter and trace a shape with your other hand's index tip. Open your signing hand, all five fingers up, to finish.
      <div className="guide-sub">Attacks + counterspell (Fire, Ice, Water, Earth, Lightning)</div>
      <div className="shape-guide">
        {[...PUNCHES, COUNTER].map((sh) => (
          <ShapeCard key={sh} shape={sh} label={FORMS[sh]} />
        ))}
      </div>
      <div className="guide-sub">Signatures (harder, stronger)</div>
      <div className="shape-guide">
        {Object.entries(SIGNATURE).map(([el, sh]) => (
          <ShapeCard key={sh} shape={sh} color={ELEMENTS[el].color} label={FORMS[sh]} />
        ))}
      </div>
      <div className="guide-sub">Holy (H): heals and buffs</div>
      <div className="shape-guide">
        {HOLY_SHAPES.map((sh) => (
          <ShapeCard key={sh} shape={sh} color={ELEMENTS.H.color} label={FORMS[sh]} sub={SHORT[sh]} />
        ))}
      </div>
      <div className="guide-sub">Unholy (U): curses</div>
      <div className="shape-guide">
        {UNHOLY_SHAPES.map((sh) => (
          <ShapeCard key={sh} shape={sh} color={ELEMENTS.U.color} label={FORMS[sh]} sub={SHORT[sh]} />
        ))}
      </div>
      {COMBOS_ON && <div className="guide-sub">Combos: sign C, then both letters, then draw</div>}
      <div className="shape-guide" hidden={!COMBOS_ON}>
        {Object.keys(COMBO_SHAPE).map((c) => (
          <div key={c} className="combo-card">
            <div className="combo-signs">
              {[COMBO, ...COMBO_MIX[c]].map((l, i) => (
                <span key={l}>
                  {i > 0 && '+'}
                  <Sign l={l} />
                </span>
              ))}
            </div>
            <ShapeCard shape={COMBO_SHAPE[c]} color={COMBO_CHARGES[c].color} label={COMBO_CHARGES[c].name} sub={COMBO_MIX[c].map((l) => ELEMENTS[l].name).join(' + ')} />
          </div>
        ))}
      </div>
      <div className="shape-note">yellow dot = a place to start (any start or direction works)</div>
      <div className="guide-sub">What each element's attacks do</div>
      <ul>
        {Object.entries(TRAITS).map(([el, t]) => (
          <li key={el} style={{ color: ELEMENTS[el].color }}>
            {ELEMENTS[el].name}: {t}
          </li>
        ))}
      </ul>
      <b>3. Throw</b> — push your hand toward the camera.
      <p>
        <b>Counter cycle</b> — Water → Fire → Ice → Earth → Lightning → Water (each beats the next). Holy and Unholy beat each other.{COMBOS_ON && ' A combo is countered by beating either of its elements.'}
      </p>
      <p>
        <b>Counterspell</b> — sign an element, draw a <b>circle</b>, push. If your opponent is still charged with the element yours
        beats when it lands, they're silenced for 2 s and lose their charge. Otherwise it's wasted. A counterspell of <b>any</b>{' '}
        element also stops a heal (a Holy charge, or a regen still ticking).
      </p>
      <p>
        <b>Interrupt</b> — sign the element that beats theirs and just push, no drawing. Faster to land but weaker: 0.5 s silence. It
        can't stop heals. Holy has no interrupt{BEATS.H ? ', only the counterspell' : ''}.
      </p>
      <p className="shape-note">Fast strokes are fine — just keep your hand in view. A charge fades after 3 s if you don't draw.</p>
    </div>
  )
}

/** The guide as its own page, from the home screen. */
export function GuidePage({ onHome }: { onHome: () => void }) {
  return (
    <main className="page info-page">
      <div className="info-top">
        <h1 className="logo">How to cast</h1>
        <button className="small" onClick={onHome}>
          Home
        </button>
      </div>
      <section className="info-card">
        <CastGuide />
      </section>
    </main>
  )
}
