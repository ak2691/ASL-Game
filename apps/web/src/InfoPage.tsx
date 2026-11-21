// Spell info: every spell's damage and effects. Attack numbers come straight from combat.ts;
// signature and heal numbers are written here (keep them in sync with land() in combat.ts).
import { BURN, CHARGE_LIFE_MS, CHILL, CHILL_MS, COUNTER_SILENCE_MS, FIZZLE_LOCK_MS, MAX_HP, PRISON_SILENCE_MS, PUNCH, QUICK_SILENCE_MS, READY_LIFE_MS, STATIC_PULSES } from './combat'
import { ELEMENTS } from './spells'

const s = (ms: number) => `${ms / 1000} s`

const ATTACK_EFFECT: Record<string, string> = {
  F: `Burn: +${BURN[0]} / +${BURN[1]} extra damage over 1.5 s`,
  I: `Chill: the next hit they take within ${s(CHILL_MS)} does +${CHILL[0]} / +${CHILL[1]}`,
  W: 'Mend: you heal half the damage dealt',
  E: 'None, just the hardest hits',
  L: `Static: ${STATIC_PULSES[0]} / ${STATIC_PULSES[1]} pulses where their throws fizzle`,
}

const SIGNATURES = [
  { el: 'F', name: 'Meteor', draw: 'Flame', dmg: '30', effect: '+15 burn over 2.5 s. The most total damage.' },
  { el: 'I', name: 'Frozen Prison', draw: 'Square + both diagonals', dmg: '10', effect: `Silences them for ${s(PRISON_SILENCE_MS)}, whatever their element.` },
  { el: 'W', name: 'Tidal Wave', draw: 'Spiral', dmg: '22', effect: 'You heal 20.' },
  { el: 'E', name: 'Earthquake', draw: '3 towers', dmg: '35', effect: 'Knocks off their charge and readied spell.' },
  { el: 'L', name: 'Thunderbolt', draw: '7 zigzag lines', dmg: '18', effect: 'Five fast static pulses where their throws fizzle.' },
]

export function InfoPage({ onHome }: { onHome: () => void }) {
  return (
    <main className="page info-page">
      <div className="info-top">
        <h1 className="logo">Spell Info</h1>
        <button className="small" onClick={onHome}>
          Home
        </button>
      </div>
      <p className="info-lead">
        Everyone starts with {MAX_HP} HP. Sign a letter to charge an element, draw a shape, push to throw.
      </p>

      <section className="info-card">
        <h2>Attacks</h2>
        <p className="info-note">Light = a line. Heavy = a W. Same drawings for every element.</p>
        <table className="info-table">
          <thead>
            <tr>
              <th>Element</th>
              <th>Light</th>
              <th>Heavy</th>
              <th>Effect (light / heavy)</th>
            </tr>
          </thead>
          <tbody>
            {Object.entries(PUNCH).map(([el, [light, heavy]]) => (
              <tr key={el}>
                <td style={{ color: ELEMENTS[el].color }}>
                  <img className="asl-mini" src={`/asl/${el}.svg`} alt="" /> {ELEMENTS[el].name} ({el})
                </td>
                <td>{light}</td>
                <td>{heavy}</td>
                <td>{ATTACK_EFFECT[el]}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="info-card">
        <h2>Signatures</h2>
        <p className="info-note">One per element. Harder to draw, much stronger.</p>
        <table className="info-table">
          <thead>
            <tr>
              <th>Spell</th>
              <th>Draw</th>
              <th>Damage</th>
              <th>Effect</th>
            </tr>
          </thead>
          <tbody>
            {SIGNATURES.map((g) => (
              <tr key={g.name}>
                <td style={{ color: ELEMENTS[g.el].color }}>
                  {g.name} ({g.el})
                </td>
                <td>{g.draw}</td>
                <td>{g.dmg}</td>
                <td>{g.effect}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="info-card">
        <h2 style={{ color: ELEMENTS.H.color }}>Healing (H)</h2>
        <table className="info-table">
          <tbody>
            <tr>
              <td>Heal</td>
              <td>Star</td>
              <td>+20 HP right away</td>
            </tr>
            <tr>
              <td>Regen</td>
              <td>Hourglass</td>
              <td>+30 HP over 2.5 s (6 every 0.5 s)</td>
            </tr>
          </tbody>
        </table>
        <p className="info-note">Any element's counterspell stops a heal charge or a regen that's still ticking.</p>
      </section>

      <section className="info-card">
        <h2>Counters</h2>
        <p>
          Each element beats the next: Water → Fire → Ice → Earth → Lightning → Water.
        </p>
        <table className="info-table">
          <tbody>
            <tr>
              <td>Counterspell</td>
              <td>Sign the beating element, draw a circle, push</td>
              <td>Silences them {s(COUNTER_SILENCE_MS)} and drops their charge, if they still hold the element yours beats when it lands</td>
            </tr>
            <tr>
              <td>Interrupt</td>
              <td>Sign the beating element, just push</td>
              <td>Faster, silences {s(QUICK_SILENCE_MS)}. Can't stop heals</td>
            </tr>
          </tbody>
        </table>
      </section>

      <section className="info-card">
        <h2>Status effects</h2>
        <ul className="info-list">
          <li><b>Silenced:</b> you can't charge, draw or throw. Your charge and readied spell are gone.</li>
          <li><b>Fizzled:</b> a wrong drawing, or a spell you didn't throw in time. No throws for {s(FIZZLE_LOCK_MS)}; you keep your charge.</li>
          <li><b>Static:</b> throws during a pulse fizzle. Wait for the gap.</li>
          <li><b>Chilled:</b> the next hit you take does extra damage.</li>
          <li><b>Burning:</b> extra damage ticks every 0.5 s.</li>
          <li><b>Knocked off:</b> your charge is gone. Sign your element again.</li>
        </ul>
      </section>

      <section className="info-card">
        <h2>Timing</h2>
        <ul className="info-list">
          <li>A charge fades after {s(CHARGE_LIFE_MS)} if you don't draw.</li>
          <li>A drawn spell fades (and fizzles) after {s(READY_LIFE_MS)} if you don't push.</li>
          <li>Spells fly before they land: light is fastest, signatures slowest. Counters fly fastest of all.</li>
        </ul>
      </section>
    </main>
  )
}
