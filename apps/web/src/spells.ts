// Spell = element (an ASL letter, signed first) × shape (drawn with the index finger).
// A circle is the counterspell. Design notes: MVP Plan.md.

export const ELEMENTS: Record<string, { name: string; color: string }> = {
  F: { name: 'Fire', color: '#ff6a3d' },
  I: { name: 'Ice', color: '#8fd8ff' },
  W: { name: 'Water', color: '#3d8bff' },
  E: { name: 'Earth', color: '#b58a4c' },
  L: { name: 'Lightning', color: '#ffe14d' },
  H: { name: 'Holy', color: '#6be38a' }, // heals and buffs; Holy and Unholy counter each other
  U: { name: 'Unholy', color: '#a05cd6' }, // curses and debuffs
}

/** One-line identity of each element's punches (shown in the guide). */
export const TRAITS: Record<string, string> = {
  E: 'Hardest direct hits',
  F: 'Burn: extra damage over time (most total)',
  W: 'Mend: heals you half of what you deal',
  L: 'Static: throws fizzle during its pulses',
  I: 'Chill: their next hit taken does extra',
}

/** Counter cycle: each element beats the next. Used by counterspells. */
export const BEATS: Record<string, string> = { W: 'F', F: 'I', I: 'E', E: 'L', L: 'W', H: 'U', U: 'H' }
export const beats = (a: string, b: string) => BEATS[a] === b

/** The counterspell's shape: a circle, with any element in the counter cycle. */
export const COUNTER = 'circle'
/** The quick interrupt: charge the matching element and push, no drawing. Weaker, faster. */
export const QUICK = 'jab'
/** Holy and Unholy only have the full counterspell, no quick interrupt (all their spells are signature-level). */
export const canQuick = (el: string) => el in BEATS && el !== 'H' && el !== 'U'

/** Shared attacks (same drawing for every element): light (a line) and heavy (an H). */
export const PUNCHES = ['line', 'h']
/** Each element's signature move: a unique, harder drawing. */
export const SIGNATURE: Record<string, string> = { F: 'flame', I: 'cage', L: 'zigzag7', E: 'battlements', W: 'spiral' }
/** Holy: heals plus buffs. Unholy: curses. All signature-level drawings (no lines or Ws). */
export const HOLY_SHAPES = ['star', 'hourglass', 'aegis'] // Mirror removed for now (code kept)
export const UNHOLY_SHAPES = ['scythe', 'veil', 'blade']

// ---- Combos: sign C, then the elements to mix. The second element locks the mix into its combo charge.
export const COMBOS_ON = true
export const COMBO = 'C'
export const COMBO_INFO = { name: 'Combo', color: '#d9d9d9' }
/** Mixed elements (sorted letters) -> combo charge. Design: plans/combos.md. */
export const COMBOS: Record<string, string> = {
  EF: 'magma', LW: 'storm', EI: 'glacier', HU: 'twilight', FW: 'steam', FI: 'thermal', FL: 'plasma', FH: 'sunfire', EU: 'grave',
}
export const COMBO_CHARGES: Record<string, { name: string; color: string }> = {
  magma: { name: 'Magma', color: '#ff8a1f' },
  storm: { name: 'Storm', color: '#7f9cff' },
  glacier: { name: 'Advancing Glacier', color: '#bfe9ff' },
  twilight: { name: 'Twilight', color: '#c8a2ff' },
  steam: { name: 'Steam', color: '#e8eef2' },
  thermal: { name: 'Thermal Shock', color: '#ff9ad5' },
  plasma: { name: 'Plasma', color: '#ff6df0' },
  sunfire: { name: 'Sunfire', color: '#ffd23d' },
  grave: { name: 'Grave', color: '#8a7a9c' },
}
/** Each combo's one drawing (its signature). */
export const COMBO_SHAPE: Record<string, string> = {
  magma: 'volcano', storm: 'cloud', glacier: 'iceberg', twilight: 'yinyang', steam: 'puff', thermal: 'thermo', plasma: 'plasma', sunfire: 'sun', grave: 'tomb',
}
/** The letters each combo mixes, in guide order. */
export const COMBO_MIX: Record<string, string[]> = {
  magma: ['F', 'E'], storm: ['W', 'L'], glacier: ['I', 'E'], twilight: ['H', 'U'], steam: ['F', 'W'], thermal: ['F', 'I'], plasma: ['L', 'F'], sunfire: ['H', 'F'], grave: ['U', 'E'],
}
/** Elements that can go into a combo. */
export const MIXABLE = ['F', 'I', 'W', 'E', 'L', 'H', 'U']
/** The letters to sign for a charge: a combo is C, then its two elements. */
export const signsFor = (el: string) => (el in COMBO_MIX ? [COMBO, ...COMBO_MIX[el]] : isMixCounter(el) ? [COMBO, el[1], el[2]] : [el])
export const comboOf = (mix: string[]) => COMBOS[[...mix].sort().join('')] ?? null
/** A combo counterspell: C + two counter elements + circle. Its charge is 'C' plus the two letters (sorted), e.g. 'CIW'. */
export const mixCounter = (mix: string[]) => COMBO + [...mix].sort().join('')
export const isMixCounter = (el: string) => /^C[A-Z]{2}$/.test(el) && el[1] in BEATS && el[2] in BEATS && el[1] !== el[2]
/** Does a combo counter of these elements beat every element of `mix`? */
export const mixBeats = (counter: string, mix: string[]) => {
  const ours = counter.slice(1).split('')
  return mix.length === 2 && ((beats(ours[0], mix[0]) && beats(ours[1], mix[1])) || (beats(ours[0], mix[1]) && beats(ours[1], mix[0])))
}
/** Name and color of any charge: an element, the combo being mixed, or a locked combo. */
export const chargeInfo = (el: string) =>
  ELEMENTS[el] ?? COMBO_CHARGES[el] ?? (isMixCounter(el) ? { name: `${ELEMENTS[el[1]].name} + ${ELEMENTS[el[2]].name}`, color: COMBO_INFO.color } : COMBO_INFO)

export const shapesFor = (el: string) =>
  el === 'H' ? HOLY_SHAPES : el === 'U' ? UNHOLY_SHAPES : el in COMBO_CHARGES ? [COMBO_SHAPE[el]] : el in ELEMENTS ? [...PUNCHES, SIGNATURE[el]] : []

/** Shapes held to the stricter signature threshold when recognized. */
export const STRICT_SHAPES = new Set([...Object.values(SIGNATURE), 'aegis', 'mirror', ...UNHOLY_SHAPES, ...Object.values(COMBO_SHAPE).filter((x) => x !== 'plasma' && x !== 'sun')]) // Plasma and Sunfire: loose (hard to draw)

/** Short labels for the guide. */
export const FORMS: Record<string, string> = {
  line: 'Light attack',
  h: 'Heavy attack',
  star: 'Heal',
  hourglass: 'Regen',
  flame: 'Meteor',
  cage: 'Frozen Prison',
  zigzag7: 'Thunderbolt',
  battlements: 'Earthquake',
  spiral: 'Tidal Wave',
  circle: 'Counterspell',
  jab: 'Interrupt',
  aegis: 'Aegis',
  mirror: 'Mirror',
  scythe: 'Doom',
  veil: 'Shroud',
  blade: 'Execute',
  volcano: 'Magma',
  cloud: 'Storm',
  iceberg: 'Advancing Glacier',
  yinyang: 'Twilight',
  puff: 'Steam',
  thermo: 'Thermal Shock',
  plasma: 'Plasma',
  sun: 'Sunfire',
  tomb: 'Grave',
}

export const isValidSpell = (el: unknown, shape: unknown): boolean => {
  if (typeof el !== 'string' || typeof shape !== 'string') return false
  if (el in COMBO_CHARGES) return COMBO_SHAPE[el] === shape
  if (isMixCounter(el)) return shape === COUNTER
  if (!(el in ELEMENTS)) return false
  if (shape === COUNTER) return el in BEATS
  if (shape === QUICK) return canQuick(el)
  return shapesFor(el).includes(shape)
}

const NAMES: Record<string, Record<string, string>> = {
  F: { line: 'Fire', h: 'Heavy Fire', flame: 'Meteor' },
  I: { line: 'Ice', h: 'Heavy Ice', cage: 'Frozen Prison' },
  W: { line: 'Water', h: 'Heavy Water', spiral: 'Tidal Wave' },
  E: { line: 'Earth', h: 'Heavy Earth', battlements: 'Earthquake' },
  L: { line: 'Lightning', h: 'Heavy Lightning', zigzag7: 'Thunderbolt' },
  H: { star: 'Heal', hourglass: 'Regenerate', aegis: 'Aegis', mirror: 'Mirror' },
  U: { scythe: 'Doom', veil: 'Shroud', blade: 'Execute' },
}

export const spellName = (el: string, shape: string) =>
  el in COMBO_CHARGES
    ? COMBO_CHARGES[el].name
    : isMixCounter(el) ? `${chargeInfo(el).name} Counterspell` : shape === COUNTER ? `${ELEMENTS[el].name} Counterspell` : shape === QUICK ? `${ELEMENTS[el].name} Interrupt` : NAMES[el]?.[shape] ?? `${ELEMENTS[el].name} ${FORMS[shape] ?? shape}`
