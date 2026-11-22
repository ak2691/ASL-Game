// Spell info: every spell's damage and effects. Attack numbers come straight from combat.ts;
// signature and heal numbers are written here (keep them in sync with land() in combat.ts).
import { AEGIS_DRAIN, AEGIS_HP, BLIZZARD_SILENCE_MS, DOOM_DMG, DOOM_MS, SHROUD_MS, EXECUTE, BURN, CHILL, CHILL_MS, COUNTER_SILENCE_MS, FIZZLE_LOCK_MS, MAX_HP, PRISON_SILENCE_MS, PUNCH, QUICK_SILENCE_MS, READY_LIFE_MS, STATIC_PULSES } from './combat'
import { COMBOS_ON, COMBO_CHARGES, ELEMENTS } from './spells'

const s = (ms: number) => `${ms / 1000} s`

const ATTACK_EFFECT: Record<string, string> = {
  F: `Burn: +${BURN[0]} / +${BURN[1]} extra damage over 1.5 s`,
  I: `Chill: the next hit they take within ${s(CHILL_MS)} does +${CHILL[0]} / +${CHILL[1]}`,
  W: 'Mend: you heal half the damage dealt',
  E: 'None, just the hardest hits',
  L: `Static: ${STATIC_PULSES[0]} / ${STATIC_PULSES[1]} pulses where their throws fizzle`,
}

const SIGNATURES = [
  { el: 'F', name: 'Meteor', draw: 'Circle with 4 spikes', dmg: '30', effect: '+15 burn over 2.5 s. The most total damage.' },
  { el: 'I', name: 'Frozen Prison', draw: 'Square + both diagonals', dmg: '10', effect: `Silences them for ${s(PRISON_SILENCE_MS)}, whatever their element.` },
  { el: 'W', name: 'Tidal Wave', draw: 'Spiral', dmg: '22', effect: 'You heal 20.' },
  { el: 'E', name: 'Earthquake', draw: '3 towers', dmg: '35', effect: 'Knocks off their charge and readied spell.' },
  { el: 'L', name: 'Thunderbolt', draw: '7 zigzag lines', dmg: '18', effect: 'Five fast static pulses where their throws fizzle.' },
]

const UNHOLY = [
  { name: 'Doom', draw: 'Scythe: blade, then two lines across the handle', effect: `They must land a cast within ${s(DOOM_MS)} or take ${DOOM_DMG}.` },
  { name: 'Shroud', draw: 'Three loops', effect: `For ${s(SHROUD_MS)} they can't see your charge or your drawing.` },
  { name: 'Execute', draw: 'Guillotine', effect: `${EXECUTE[0]} + ${EXECUTE[1] * 100}% of their missing HP, up to ${EXECUTE[2]}. If a counterspell catches it readied, you take half of what it would do to you.` },
]

const COMBO_ROWS = [
  { c: 'magma', mix: 'C, F, E', draw: 'Volcano with a smoke loop', dmg: '25', effect: '+20 burn over 4 s.' },
  { c: 'storm', mix: 'C, W, L', draw: 'Cloud with a bolt', dmg: '20', effect: 'Three static pulses where their throws fizzle.' },
  { c: 'blizzard', mix: 'C, I, W', draw: 'Three petals', dmg: '15', effect: `Chill +15 and a ${s(BLIZZARD_SILENCE_MS)} silence.` },
  { c: 'twilight', mix: 'C, H, U', draw: 'Circle with an S', dmg: '35', effect: 'Strips their Aegis and regen; cleanses you.' },
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
        <h2 style={{ color: ELEMENTS.H.color }}>Holy (H)</h2>
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
            <tr>
              <td>Aegis</td>
              <td>Shield + middle line</td>
              <td>{AEGIS_HP} armor that soaks direct hits and drains {AEGIS_DRAIN} per second. No recast until it's gone</td>
            </tr>
          </tbody>
        </table>
        <p className="info-note">Any element's counterspell stops a heal charge or a regen that's still ticking.</p>
      </section>

      <section className="info-card">
        <h2 style={{ color: ELEMENTS.U.color }}>Unholy (U)</h2>
        <table className="info-table">
          <tbody>
            {UNHOLY.map((u) => (
              <tr key={u.name}>
                <td>{u.name}</td>
                <td>{u.draw}</td>
                <td>{u.effect}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="info-note">Holy and Unholy counter each other. Holy has only the counterspell, no interrupt.</p>
      </section>

      <section className="info-card" hidden={!COMBOS_ON}>
        <h2>Combos</h2>
        <p className="info-note">Sign C, then the two elements, then draw. Starting to draw locks the mix; a mix that isn't a combo fizzles. Countered by beating either element.</p>
        <table className="info-table">
          <thead>
            <tr>
              <th>Spell</th>
              <th>Sign</th>
              <th>Draw</th>
              <th>Damage</th>
              <th>Effect</th>
            </tr>
          </thead>
          <tbody>
            {COMBO_ROWS.map((r) => (
              <tr key={r.c}>
                <td style={{ color: COMBO_CHARGES[r.c].color }}>{COMBO_CHARGES[r.c].name}</td>
                <td>{r.mix}</td>
                <td>{r.draw}</td>
                <td>{r.dmg}</td>
                <td>{r.effect}</td>
              </tr>
            ))}
          </tbody>
        </table>
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
          <li><b>Fizzled:</b> a wrong drawing, or a spell you didn't throw in time. No throws for {s(FIZZLE_LOCK_MS)}, and your charge is gone.</li>
          <li><b>Static:</b> throws during a pulse fizzle. Wait for the gap.</li>
          <li><b>Chilled:</b> the next hit you take does extra damage.</li>
          <li><b>Burning:</b> extra damage ticks every 0.5 s.</li>
          <li><b>Knocked off:</b> your charge is gone. Sign your element again.</li>
          <li><b>Armor (Aegis):</b> direct hits are soaked first. It drains over time.</li>
          <li><b>Doomed:</b> a countdown. Land any cast before it ends.</li>
          <li><b>Shrouded:</b> your opponent can't see your charge or drawing.</li>
        </ul>
      </section>

      <section className="info-card">
        <h2>Timing</h2>
        <ul className="info-list">
          <li>A charge stays until you use it. Open all five fingers (not right after a drawing) to drop it.</li>
          <li>A drawn spell fades (and fizzles) after {s(READY_LIFE_MS)} if you don't push.</li>
          <li>Spells fly before they land: light is fastest, signatures slowest. Counters fly fastest of all.</li>
        </ul>
      </section>
    </main>
  )
}
