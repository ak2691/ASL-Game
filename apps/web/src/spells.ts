// Spell = element (an ASL letter, signed first) × shape (drawn with the index finger).
// A circle with a diagonal line (a null sign) is the counterspell. Design notes: Overview.md.

export const ELEMENTS: Record<string, { name: string; color: string }> = {
  F: { name: 'Fire', color: '#ff6a3d' },
  I: { name: 'Ice', color: '#8fd8ff' },
  W: { name: 'Water', color: '#3d8bff' },
  E: { name: 'Earth', color: '#b58a4c' },
  L: { name: 'Lightning', color: '#ffe14d' },
  A: { name: 'Angelic', color: '#6be38a' }, // heals and buffs; Angelic and Unholy counter each other (signed A since Nov 25; it was Angelic, signed H)
  U: { name: 'Unholy', color: '#a05cd6' }, // curses and debuffs
}

/** The element (or C) a recognized letter charges, or null. */
export const elementOfSign = (letter: string): string | null => (ELEMENTS[letter] || (letter === COMBO && COMBOS_ON) ? letter : null)

/** Counter cycle: each element beats the next. Used by counterspells. */
export const BEATS: Record<string, string> = { W: 'F', F: 'I', I: 'E', E: 'L', L: 'W', A: 'U', U: 'A' }
export const beats = (a: string, b: string) => BEATS[a] === b

/** The counterspell's shape: a circle with a diagonal line through it (the key stays 'circle'), with any element in the counter cycle. */
export const COUNTER = 'circle'
/** The quick interrupt: charge the matching element and push, no drawing. Weaker, faster. */
export const QUICK = 'jab'
/** Angelic and Unholy only have the full counterspell, no quick interrupt (all their spells are signature-level). */
export const canQuick = (el: string) => el in BEATS && el !== 'A' && el !== 'U'

/** Shared attacks (same drawing for every element): light (a line) and heavy (an H). */
export const PUNCHES = ['line', 'h']
/** Each element's signature move: a unique, harder drawing. */
export const SIGNATURE: Record<string, string> = { F: 'flame', I: 'cage', L: 'zigzag7', E: 'battlements', W: 'spiral' }
/** Angelic: heals plus buffs. Unholy: curses. All signature-level drawings (no lines or Ws). */
export const ANGELIC_SHAPES = ['star', 'hourglass', 'aegis'] // Mirror removed for now (code kept)
export const UNHOLY_SHAPES = ['scythe', 'veil', 'blade']

// ---- Combos: sign C, then the elements to mix. The second element locks the mix into its combo charge.
export const COMBOS_ON = true
export const COMBO = 'C'
export const COMBO_INFO = { name: 'Combo', color: '#d9d9d9' }
/** Mixed elements (sorted letters) -> combo charge. Design: plans/combos.md. */
export const COMBOS: Record<string, string> = {
  EF: 'magma', LW: 'storm', EI: 'glacier', AU: 'twilight', FW: 'steam', FI: 'thermal', FL: 'plasma', AF: 'sunfire', EU: 'grave',
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
  magma: ['F', 'E'], storm: ['W', 'L'], glacier: ['I', 'E'], twilight: ['A', 'U'], steam: ['F', 'W'], thermal: ['F', 'I'], plasma: ['L', 'F'], sunfire: ['A', 'F'], grave: ['U', 'E'],
}
// ---- Bot tags (plans/bot-tags.md): what a spell does, so bots pick by tag instead of by name.
// A new spell needs only its tags here (plus a draw time) for every bot to use it sensibly.
export type SpellTag =
  | 'setup' // puts a debuff on the target (chill, Exposed, no-heal, Doom)
  | 'payoff' // hits harder into a debuff
  | 'antiHeal' // punishes or blocks a heal
  | 'antiDraw' // best while the target is drawing
  | 'antiLight' // punishes light spam
  | 'burst' // big damage, for a stunned or silenced target
  | 'stopper' // stuns, silences, locks or knocks a charge off
  | 'shield'
  | 'stealth'
  | 'selfHeal'
  | 'comeback' // best when its caster is hurt but not yet healing
  | 'lastStand' // best when its caster is very low
  | 'pressure' // best when the target has let several spells through
  | 'unparryable' // no parry stops it: for a silenced, drawing or turtling target
  | 'dot' // damage over time (burn)
/** Keyed by spell id: a signature/Angelic/Unholy shape, or a combo id. Lights and heavies are untagged. */
export const SPELL_TAGS: Record<string, SpellTag[]> = {
  // Signatures
  flame: ['burst', 'dot'], // Meteor
  cage: ['stopper', 'antiLight', 'setup'], // Frozen Prison
  zigzag7: ['stopper', 'antiLight'], // Thunderbolt
  battlements: ['stopper', 'antiLight', 'burst'], // Earthquake
  spiral: ['selfHeal'], // Tidal Wave
  // Angelic / Unholy
  star: ['selfHeal'],
  hourglass: ['selfHeal'],
  aegis: ['shield'],
  scythe: ['setup'], // Doom
  veil: ['stealth'], // Shroud
  blade: ['payoff'], // Execute
  // Combos
  magma: ['burst'],
  storm: ['antiLight'],
  glacier: ['unparryable'],
  twilight: ['lastStand', 'selfHeal'],
  steam: ['pressure'],
  thermal: ['payoff', 'setup'],
  plasma: ['antiDraw'],
  sunfire: ['comeback'],
  grave: ['antiHeal', 'setup'],
}
export const hasTag = (spell: string, tag: SpellTag) => SPELL_TAGS[spell]?.includes(tag) ?? false

/** Elements that can go into a combo. */
export const MIXABLE = ['F', 'I', 'W', 'E', 'L', 'A', 'U']
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
  el === 'A' ? ANGELIC_SHAPES : el === 'U' ? UNHOLY_SHAPES : el in COMBO_CHARGES ? [COMBO_SHAPE[el]] : el in ELEMENTS ? [...PUNCHES, SIGNATURE[el]] : []

/** Shapes held to the stricter signature threshold when recognized. */
export const STRICT_SHAPES = new Set([...Object.values(SIGNATURE), 'aegis', 'mirror', ...UNHOLY_SHAPES, ...Object.values(COMBO_SHAPE).filter((x) => x !== 'plasma' && x !== 'sun')]) // Plasma and Sunfire: loose (hard to draw)

/** Short labels for the guide. */
/** The shortest way to say a charge (Nov 28, the phone teammate card): an element's letter ("F"), a combo's first
 *  three letters and its elements ("Mag F+E"), a mixed counter's elements ("F+E"). */
export function shortCharge(el: string) {
  if (el in ELEMENTS) return el
  if (el in COMBO_CHARGES) return `${COMBO_CHARGES[el].name.slice(0, 3)} ${COMBO_MIX[el].join('+')}`
  if (isMixCounter(el)) return `${el[1]}+${el[2]}`
  return el === COMBO ? 'Combo' : el
}
/** A spell's shape in a word or two (combos' own shapes say nothing extra: the charge already names them). */
export function shortShape(shape: string) {
  const SHORT: Record<string, string> = { line: 'Light', h: 'Heavy', circle: 'Counter', jab: 'Int', cage: 'Prison', zigzag7: 'Bolt', battlements: 'Quake', spiral: 'Wave' }
  if (SHORT[shape]) return SHORT[shape]
  if (Object.values(COMBO_SHAPE).includes(shape)) return ''
  return FORMS[shape] ?? ''
}

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
  A: { star: 'Heal', hourglass: 'Regenerate', aegis: 'Aegis', mirror: 'Mirror' },
  U: { scythe: 'Doom', veil: 'Shroud', blade: 'Execute' },
}

export const spellName = (el: string, shape: string) =>
  el in COMBO_CHARGES
    ? COMBO_CHARGES[el].name
    : isMixCounter(el) ? `${chargeInfo(el).name} Counterspell` : shape === COUNTER ? `${ELEMENTS[el].name} Counterspell` : shape === QUICK ? `${ELEMENTS[el].name} Interrupt` : NAMES[el]?.[shape] ?? `${ELEMENTS[el].name} ${FORMS[shape] ?? shape}`
