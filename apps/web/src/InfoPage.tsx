// Spell info: every spell's damage and effects. Attack numbers come straight from combat.ts;
// signature and heal numbers are written here (keep them in sync with land() in combat.ts).
import { HEAL, REGEN, AEGIS_DRAIN, AEGIS_HP, GLACIER_DMG, GLACIER_MS, GRAVE, MAGMA, PLASMA, STEAM_HIT, STEAM_MS, STORM, SUNFIRE, THERMAL, TWILIGHT_MS, DOOM_DMG, DOOM_MS, SHROUD_MS, EXECUTE, BURN, CHILL, CHILL_MS, COUNTER_SILENCE_MS, FIZZLE_LOCK_MS, MAX_HP, PRISON_CHILL, PRISON_SILENCE_MS, PUNCH, READY_LIFE_MS, STATIC_PULSES, WEAR_STEP, WEAR_FLOOR, WEAR_DECAY_MS, STATIC_CUTOFF, STUN_MIN_MS, SHROUD_MIN_MS, PARRY_WINDOWS, TIDAL_HEAL, INTERRUPT_LOCK_MS, WHIFF_MS } from './combat'
import { COMBOS_ON, COMBO_CHARGES, ELEMENTS } from './spells'
import { IconLegend } from './effects'
import { LEGEND_HAND, ROW_ICONS, type RowIcon } from './statusIcons'

const HAND_KEYS = LEGEND_HAND
const ROW_KEYS = Object.keys(ROW_ICONS) as RowIcon[]

const s = (ms: number) => `${ms / 1000} s`

const ATTACK_EFFECT: Record<string, string> = {
  F: `Burn: +${BURN[0]} / +${BURN[1]} extra damage over 1.5 s`,
  I: `Chill: the next hit they take within ${s(CHILL_MS)} does +${CHILL[0] * 100}% / +${CHILL[1] * 100}% (doesn't stack)`,
  W: 'Mend: you heal half the damage dealt',
  E: 'None, just the hardest hits',
  L: `Static: ${STATIC_PULSES[0]} / ${STATIC_PULSES[1]} pulses where their throws fizzle`,
}

const SIGNATURES = [
  { el: 'F', name: 'Meteor', draw: 'Circle with 4 spikes', dmg: '32', effect: '+18 burn over 2.5 s. The most total damage.' },
  { el: 'I', name: 'Frozen Prison', draw: 'Square + both diagonals', dmg: '24', effect: `Stuns them up to ${s(PRISON_SILENCE_MS)}, whatever their element, and chills them: their next hit within ${s(CHILL_MS)} does +${PRISON_CHILL * 100}%.` },
  { el: 'W', name: 'Tidal Wave', draw: 'Spiral', dmg: '25', effect: `You heal ${TIDAL_HEAL}.` },
  { el: 'E', name: 'Earthquake', draw: '3 towers', dmg: '38', effect: 'Knocks off their charge and readied spell.' },
  { el: 'L', name: 'Thunderbolt', draw: '7 zigzag lines', dmg: '28', effect: 'Three fast static pulses where their throws fizzle.' },
]

const UNHOLY = [
  { name: 'Doom', draw: 'Scythe: blade, then two lines across the handle', effect: `They must land a cast within ${s(DOOM_MS)} or take ${DOOM_DMG}.` },
  { name: 'Shroud', draw: 'Three loops', effect: `For ${s(SHROUD_MS)} they can't see your charge or your drawing.` },
  { name: 'Execute', draw: 'Guillotine', effect: `${EXECUTE[0]} + ${EXECUTE[1] * 100}% of their missing HP, up to ${EXECUTE[2]}. If a counterspell catches it readied, you take half of what it would do to you.` },
]

const COMBO_ROWS = [
  { c: 'magma', mix: 'C, F, E', draw: 'Volcano with a base', dmg: `${MAGMA[0]}`, effect: `+${MAGMA[1]} burn over 5 s.` },
  { c: 'storm', mix: 'C, W, L', draw: 'Cloud with a bolt', dmg: `${STORM.hit}`, effect: `${STORM.count} static pulses, ${STORM.pulse} damage each. A throw in a pulse fizzles and takes ${STORM.zap}.` },
  { c: 'glacier', mix: 'C, I, E', draw: 'Iceberg', dmg: `${GLACIER_DMG}`, effect: `Takes ${s(GLACIER_MS)} to arrive. Only a Fire + Ice combo counterspell stops it.` },
  { c: 'twilight', mix: 'C, A, U', draw: 'Yin-yang with dots', dmg: '0', effect: `For ${s(TWILIGHT_MS)} you take 50% less and they take double damage.` },
  { c: 'steam', mix: 'C, F, W', draw: 'Puffy cloud', dmg: `${STEAM_HIT}`, effect: `For ${s(STEAM_MS)} their attacks have a 50% chance to miss.` },
  { c: 'thermal', mix: 'C, F, I', draw: 'Thermometer with a crack', dmg: `${THERMAL.hit}`, effect: `+${THERMAL.burn} burn, and chills them: their next hit does +${THERMAL.chill * 100}%.` },
  { c: 'plasma', mix: 'C, L, F', draw: 'Tendrils in a ball', dmg: `${PLASMA.hit}`, effect: `Stuns up to ${s(PLASMA.stun)} and burns +${PLASMA.burn}.` },
  { c: 'sunfire', mix: 'C, A, F', draw: 'Sun', dmg: `${SUNFIRE[0]}`, effect: `+${SUNFIRE[1]} burn over 6 s that heals you.` },
  { c: 'grave', mix: 'C, U, E', draw: 'Tombstone', dmg: `${GRAVE.hit}`, effect: `For ${s(GRAVE.ms)} they can't heal or use any Angelic spell. An Angelic counterspell still works.` },
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
        <p className="info-note">Light = a line. Heavy = an H. Same drawings for every element. Heavies hit harder but fly slower, so they're easier to parry.</p>
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
        <h2 style={{ color: ELEMENTS.A.color }}>Angelic (A)</h2>
        <table className="info-table">
          <tbody>
            <tr>
              <td>Heal</td>
              <td>Star</td>
              <td>+{HEAL} HP right away</td>
            </tr>
            <tr>
              <td>Regen</td>
              <td>Hourglass</td>
              <td>+{REGEN.amount * REGEN.ticks} HP over 2.5 s ({REGEN.amount} every 0.5 s)</td>
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
        <p className="info-note">Angelic and Unholy counter each other. Neither has an interrupt, only the counterspell.</p>
      </section>

      <section className="info-card" hidden={!COMBOS_ON}>
        <h2>Combos</h2>
        <p className="info-note">Sign C, then the two elements, then draw. The second element locks the mix. To counter one, sign C and the two elements that beat it, then draw a circle.</p>
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
              <td>Stuns them until your next spell hits them (at most {s(COUNTER_SILENCE_MS)}), if they still hold the element yours beats when it lands</td>
            </tr>
            <tr>
              <td>Interrupt</td>
              <td>Sign the beating element, just push</td>
              <td>Faster. Their spell fizzles and they're locked out (no signing, drawing or throwing) for {s(INTERRUPT_LOCK_MS)}. If it misses, you're locked out for {s(WHIFF_MS)}. Can't stop heals</td>
            </tr>
          </tbody>
        </table>
      </section>

      <section className="info-card">
        <h2>Status effects</h2>
        <ul className="info-list">
          <li><b>Interrupted / Whiffed:</b> locked out: you can't sign, draw or throw until it ends.</li>
          <li><b>Stunned:</b> you can't charge, draw or throw. Your charge and readied spell are gone. It ends early when whoever stunned you hits you.</li>
          <li><b>Fizzled:</b> a wrong drawing, or a spell you didn't throw in time. No throws for {s(FIZZLE_LOCK_MS)}, and your charge is gone.</li>
          <li><b>Static:</b> throws during a pulse fizzle. Wait for the gap.</li>
          <li><b>Chilled:</b> the next hit you take does extra damage.</li>
          <li><b>Burning:</b> extra damage ticks every 0.5 s.</li>
          <li><b>Knocked down:</b> your charge is gone. Sign your element again.</li>
          <li><b>Armor (Aegis):</b> direct hits are soaked first. It drains over time.</li>
          <li><b>Doomed:</b> a countdown. Land any cast before it ends.</li>
          <li><b>Shrouded:</b> your opponent can't see your charge or drawing.</li>
          <li><b>Worn:</b> every throw wears its element (a light half as much). Each stack takes {WEAR_STEP * 100}% off that element's damage and heals, down to {WEAR_FLOOR * 100}%. Wear also shrinks chills, stuns, timed effects and Doom (a stun never below {s(STUN_MIN_MS)}, Shroud never below {s(SHROUD_MIN_MS)}). Lightning below {STATIC_CUTOFF * 100}% adds no static. A stack fades every {s(WEAR_DECAY_MS)}. A combo hits at the average of its two elements and wears both. Mix your elements.</li>
        </ul>
        <h3>Icons</h3>
        <p className="info-note">When you can't act, your hand shows this with a red ring that drains, and a word under it saying why. After a good parry: a green shield.</p>
        <IconLegend keys={HAND_KEYS} />
        <p className="info-note">Everything else shows as icons under a fighter's health bar. Red edge: bad for them. Green: good. The bar under each runs down with its time.</p>
        <IconLegend keys={ROW_KEYS} />
      </section>

      <section className="info-card">
        <h2>Timing</h2>
        <ul className="info-list">
          <li>A charge stays until you use it. Open all five fingers (not right after a drawing) to drop it.</li>
          <li>A drawn spell fades (and fizzles) after {s(READY_LIFE_MS)} if you don't push.</li>
          <li>Spells fly before they land: light is fastest, combos slowest. Counters fly fastest of all.</li>
          <li>Parry: push with both hands just before a spell hits. The window is {PARRY_WINDOWS.light} ms for lights, {PARRY_WINDOWS.heavy} ms for heavies, {PARRY_WINDOWS.signature} ms for signatures and {PARRY_WINDOWS.combo} ms for combos. It goes back at half power, faster, and only a {PARRY_WINDOWS.light} ms parry returns it again.</li>
        </ul>
      </section>
    </main>
  )
}
