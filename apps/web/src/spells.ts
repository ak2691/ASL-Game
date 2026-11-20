// Spell = element (an ASL letter, signed first) × shape (drawn with the index finger).
// A circle is the counterspell. Design notes: MVP Plan.md.

export const ELEMENTS: Record<string, { name: string; color: string }> = {
  F: { name: 'Fire', color: '#ff6a3d' },
  I: { name: 'Ice', color: '#8fd8ff' },
  W: { name: 'Water', color: '#3d8bff' },
  E: { name: 'Earth', color: '#b58a4c' },
  L: { name: 'Lightning', color: '#ffe14d' },
  H: { name: 'Heal', color: '#6be38a' }, // not part of the counter cycle
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
export const BEATS: Record<string, string> = { W: 'F', F: 'I', I: 'E', E: 'L', L: 'W' }
export const beats = (a: string, b: string) => BEATS[a] === b

/** The counterspell's shape: a circle, with any element in the counter cycle. */
export const COUNTER = 'circle'

/** Shared attacks (same drawing for every element): light (a line) and heavy (a W). */
export const PUNCHES = ['line', 'w']
/** Each element's signature move: a unique, harder drawing. */
export const SIGNATURE: Record<string, string> = { F: 'flame', I: 'cage', L: 'zigzag7', E: 'battlements', W: 'arches' }
const HEAL_SHAPES = ['star', 'hourglass']

export const shapesFor = (el: string) => (el === 'H' ? HEAL_SHAPES : [...PUNCHES, SIGNATURE[el]])

/** Short labels for the guide. */
export const FORMS: Record<string, string> = {
  line: 'Light attack',
  w: 'Heavy attack',
  star: 'Heal',
  hourglass: 'Regen',
  flame: 'Meteor',
  cage: 'Frozen Prison',
  zigzag7: 'Thunderbolt',
  battlements: 'Earthquake',
  arches: 'Tidal Wave',
  circle: 'Counterspell',
}

export const isValidSpell = (el: unknown, shape: unknown): boolean => {
  if (typeof el !== 'string' || typeof shape !== 'string' || !(el in ELEMENTS)) return false
  if (shape === COUNTER) return el in BEATS
  return shapesFor(el).includes(shape)
}

const NAMES: Record<string, Record<string, string>> = {
  F: { line: 'Fire (light)', w: 'Fire (heavy)', flame: 'Meteor' },
  I: { line: 'Ice (light)', w: 'Ice (heavy)', cage: 'Frozen Prison' },
  W: { line: 'Water (light)', w: 'Water (heavy)', arches: 'Tidal Wave' },
  E: { line: 'Earth (light)', w: 'Earth (heavy)', battlements: 'Earthquake' },
  L: { line: 'Lightning (light)', w: 'Lightning (heavy)', zigzag7: 'Thunderbolt' },
  H: { star: 'Heal', hourglass: 'Regenerate' },
}

export const spellName = (el: string, shape: string) =>
  shape === COUNTER ? `${ELEMENTS[el].name} Counterspell` : NAMES[el]?.[shape] ?? `${ELEMENTS[el].name} ${FORMS[shape] ?? shape}`
