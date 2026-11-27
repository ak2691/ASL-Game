// Chunky cartoon portraits of the practice opponents (the wizard-school cast): a colored badge with a rim,
// a big character head, thick ink outline, cel shading (one hard shadow tone + a highlight).
import { useId } from 'react'

const INK = '#1d1b2e'
/** Glow version (trying it, Nov 22 2026): no ink outlines, a dark badge with a lit center and a glowing
 *  rim, and the whole character glows (see Portrait in Ladder.tsx). false = the inked brawler look. */
export const GLOW = false
const O = GLOW
  ? { stroke: 'none', strokeLinejoin: 'round' as const, strokeLinecap: 'round' as const }
  : { stroke: INK, strokeWidth: 2.4, strokeLinejoin: 'round' as const, strokeLinecap: 'round' as const }

/** The round badge behind each head: dark rim, colored field, a lighter top half. */
function Badge({ bg, hi }: { bg: string; hi: string }) {
  const id = useId()
  if (GLOW)
    return (
      <>
        <defs>
          <radialGradient id={id} cy="0.45">
            <stop offset="0" stopColor={hi} stopOpacity="0.55" />
            <stop offset="0.7" stopColor={bg} stopOpacity="0.35" />
            <stop offset="1" stopColor="#0e0c1e" />
          </radialGradient>
        </defs>
        <circle cx="24" cy="24" r="23" fill="#0e0c1e" />
        <circle cx="24" cy="24" r="21" fill={`url(#${id})`} />
        <circle cx="24" cy="24" r="21.5" fill="none" stroke={hi} strokeWidth="1.4" />
      </>
    )
  return (
    <>
      <circle cx="24" cy="24" r="23" fill={INK} />
      <circle cx="24" cy="24" r="20.5" fill={bg} />
      <path d="M5 22 A19 19 0 0 1 43 22 Q24 16 5 22 Z" fill={hi} opacity="0.55" />
    </>
  )
}

/** Each portrait's glow color (its main element). */
export const GLOW_COLOR: Record<string, string> = {
  pebble: '#ffcf8a', ember: '#ff8a3d', frost: '#8fd8ff', cleric: '#8cf0b0', hexer: '#c58bff', tide: '#7fbcff',
  zealot: '#ffd24d', warden: '#ffd24d', adept: '#7aa0ff', magus: '#c58bff', archmage: '#ff7a8a', lich: '#8cff9a', ascendant: '#ffe9a8',
}

/** Big cartoon eyes: white, a pupil looking to one side, and an angled brow for attitude. */
function Eye({ x, y, r = 4, look = 0.8, brow = 0, lid = 0 }: { x: number; y: number; r?: number; look?: number; brow?: number; lid?: number }) {
  return (
    <g>
      <ellipse cx={x} cy={y} rx={r * 0.85} ry={r} fill="#fff" {...O} strokeWidth={1.8} />
      <circle cx={x + look} cy={y + 0.6} r={r * 0.5} fill={INK} />
      <circle cx={x + look - 0.7} cy={y - 0.6} r={r * 0.17} fill="#fff" />
      {lid > 0 && <path d={`M${x - r} ${y - r * 0.2} Q${x} ${y - r * 1.3} ${x + r} ${y - r * 0.2} L${x + r} ${y - r} L${x - r} ${y - r} Z`} transform={`translate(0 ${lid})`} fill="currentColor" {...O} strokeWidth={1.6} />}
      {brow !== 0 && <path d={`M${x - r} ${y - r - 1.5 - brow} L${x + r} ${y - r - 1.5 + brow}`} {...O} strokeWidth={2.6} fill="none" />}
    </g>
  )
}

export function brawlerPortrait(id: string) {
  return person(id)
}

/** The wizard-school cast (Nov 24, plans/ai-personalities.md): one drawing with parts picked per character. */
type Person = {
  bg: string
  hi: string
  skin: string
  shade: string
  hat?: { kind: 'wizard' | 'witch' | 'hood' | 'cap'; color: string; shade: string; band?: string }
  hair?: { kind: 'spiky' | 'bun' | 'fringe' | 'long' | 'tonsure' | 'tufts'; color: string }
  beard?: { kind: 'bushy' | 'goatee' | 'mustache'; color: string }
  glasses?: boolean
  halo?: boolean
  split?: string // a half mask in this color (Tamsin)
  eyes: 'normal' | 'narrow' | 'closed' | 'glow' | 'wide'
  glow?: string
  brow?: number
  mouth: 'smile' | 'flat' | 'grin' | 'smirk' | 'none'
  prop?: 'bolt' | 'snow' | 'plus' | 'mark' | 'book' | 'mirror' | 'star' | 'rock' | 'drop' | 'clock' | 'flame'
}

const PEOPLE: Record<string, Person> = {
  // Old Bram, the groundskeeper: bald, bushy grey beard, sleepy eyes, a rock.
  pebble: { bg: '#4f6e3a', hi: '#9fd27f', skin: '#e0b48a', shade: '#c08d62', hair: { kind: 'tufts', color: '#c9c9c9' }, beard: { kind: 'bushy', color: '#d9d9d9' }, eyes: 'narrow', mouth: 'smile', prop: 'rock' },
  // Pip, first-year: spiky yellow hair, wide eyes, big grin, a lightning bolt.
  ember: { bg: '#2c2a6e', hi: '#ffe14d', skin: '#f7d2ae', shade: '#e0ad84', hair: { kind: 'spiky', color: '#ffd24d' }, eyes: 'wide', mouth: 'grin', prop: 'bolt' },
  // Miss Hollis: icy bun, polite raised brow, a snowflake.
  frost: { bg: '#2d5a8a', hi: '#8fd8ff', skin: '#f4e1d6', shade: '#d9bfb0', hair: { kind: 'bun', color: '#dff4ff' }, eyes: 'narrow', brow: 1.2, mouth: 'smirk', prop: 'snow' },
  // Brother Alden: tonsure, halo, happy closed eyes, a green cross.
  cleric: { bg: '#2f6e55', hi: '#9de8b4', skin: '#e8b88f', shade: '#c9946a', hair: { kind: 'tonsure', color: '#7a5534' }, halo: true, eyes: 'closed', mouth: 'smile', prop: 'plus' },
  // Morwen: witch hat, long black hair, knowing smirk, a curse mark.
  hexer: { bg: '#3b2350', hi: '#a77ae6', skin: '#e9dccf', shade: '#cbb8a6', hat: { kind: 'witch', color: '#5a2f82', shade: '#3e1f5c', band: '#c58bff' }, hair: { kind: 'long', color: '#2a2233' }, eyes: 'narrow', brow: -1, mouth: 'smirk', prop: 'mark' },
  // Master Ito: bald, long white mustache, calm closed eyes, a drop of water.
  tide: { bg: '#1f5a6e', hi: '#7fd8e8', skin: '#e3b98f', shade: '#c4956a', beard: { kind: 'mustache', color: '#f4f4f4' }, eyes: 'closed', mouth: 'flat', prop: 'drop' },
  // Nyx: a deep hood, only glowing eyes.
  zealot: { bg: '#1a1630', hi: '#5a4f9a', skin: '#15132e', shade: '#15132e', hat: { kind: 'hood', color: '#2e2850', shade: '#1d1938' }, eyes: 'glow', glow: '#7ff0ff', mouth: 'none' },
  // Proctor Vell: mortarboard, glasses, stern brow, a clock.
  warden: { bg: '#3f4652', hi: '#a8afbd', skin: '#efd0b4', shade: '#d3ad8c', hat: { kind: 'cap', color: '#2b2f38', shade: '#1d2027', band: '#ffd24d' }, hair: { kind: 'fringe', color: '#8a8f99' }, glasses: true, eyes: 'normal', brow: -1.4, mouth: 'flat', prop: 'clock' },
  // Rook, top of the class: blue cap with a tassel, smug smirk, a book.
  adept: { bg: '#2c4a8a', hi: '#7aa0ff', skin: '#c98e62', shade: '#a8714a', hat: { kind: 'cap', color: '#3a63c4', shade: '#2a4b99', band: '#ffd24d' }, hair: { kind: 'fringe', color: '#2a1d14' }, eyes: 'normal', brow: 0.8, mouth: 'smirk', prop: 'book' },
  // Gideon: dark red wizard hat, goatee, narrowed eyes.
  magus: { bg: '#5a1f2c', hi: '#e8606f', skin: '#e8c09a', shade: '#c99a72', hat: { kind: 'wizard', color: '#9c1528', shade: '#6e0d1c', band: '#ffd24d' }, beard: { kind: 'goatee', color: '#2a1d14' }, eyes: 'narrow', brow: -1.6, mouth: 'smirk' },
  // Tamsin: a half mask, two-tone hair, a wide grin, a star.
  archmage: { bg: '#5a2050', hi: '#ff7ad9', skin: '#f2c9a0', shade: '#d9a479', hair: { kind: 'fringe', color: '#6be38a' }, split: '#a05cd6', eyes: 'wide', mouth: 'grin', prop: 'star' },
  // Lady Glass: long silver hair, cool smirk, a hand mirror.
  lich: { bg: '#1c3a3a', hi: '#8fe0d0', skin: '#ece4f2', shade: '#cfc2d9', hair: { kind: 'long', color: '#d8dde8' }, eyes: 'narrow', brow: 0.6, mouth: 'smirk', prop: 'mirror' },
  // The Archwizard: white and gold hat, long white beard, a gold star.
  // Duo Tower (plans/duo-tower.md). Ivy and Rowan, twins: the same red hair and grin, a bun and spikes.
  ivy: { bg: '#245a5a', hi: '#7fe0d0', skin: '#f7d2ae', shade: '#e0ad84', hair: { kind: 'bun', color: '#e2643a' }, eyes: 'wide', mouth: 'grin', prop: 'bolt' },
  rowan: { bg: '#245a5a', hi: '#7fe0d0', skin: '#f7d2ae', shade: '#e0ad84', hair: { kind: 'spiky', color: '#e2643a' }, eyes: 'wide', mouth: 'grin', prop: 'drop' },
  // Bruno Kettle: the big quiet kid. Heavy fringe, sleepy eyes, says nothing, carries a rock.
  bruno: { bg: '#5a4a32', hi: '#d9b77a', skin: '#b07a52', shade: '#8f5f3c', hair: { kind: 'fringe', color: '#3a2618' }, eyes: 'narrow', mouth: 'flat', prop: 'rock' },
  // Sister Wren: a pale green hood, a halo, a happy healer.
  wren: { bg: '#2f6e55', hi: '#c8f5c0', skin: '#f2d2b6', shade: '#d8b092', hat: { kind: 'hood', color: '#cfe9c4', shade: '#9cc490' }, halo: true, eyes: 'closed', mouth: 'smile', prop: 'plus' },
  // Kai: Ito's loud student. Wild orange hair, huge grin, a flame.
  kai: { bg: '#6e2c1f', hi: '#ffb05c', skin: '#e8b88f', shade: '#c9946a', hair: { kind: 'spiky', color: '#ff8a2a' }, eyes: 'wide', mouth: 'grin', prop: 'flame' },
  // Proctor Quill: Vell's colleague. Mortarboard, glasses, a stack of forms.
  quill: { bg: '#4a3f52', hi: '#c0a8d6', skin: '#e8c8a8', shade: '#c9a483', hat: { kind: 'cap', color: '#3d2f4a', shade: '#281e33', band: '#c58bff' }, hair: { kind: 'fringe', color: '#5a4a3a' }, glasses: true, eyes: 'normal', brow: 1.4, mouth: 'flat', prop: 'book' },
  // Juno Vale: Rook's rival from another school. A teal witch hat, long violet hair, a smug look.
  juno: { bg: '#1f4a5a', hi: '#6be3d6', skin: '#f0cfae', shade: '#d4ab88', hat: { kind: 'witch', color: '#1f8a8a', shade: '#146363', band: '#ffd24d' }, hair: { kind: 'long', color: '#7a4ac9' }, eyes: 'narrow', brow: 1, mouth: 'smirk', prop: 'bolt' },
  // Old Bram, unleashed: the Archwizard's old partner. His old green hat, eyes wide open, still the rock.
  bramx: { bg: '#2f7a3a', hi: '#c8ff9a', skin: '#e0b48a', shade: '#c08d62', hat: { kind: 'wizard', color: '#3f8a3a', shade: '#2a6327', band: '#ffd24d' }, beard: { kind: 'bushy', color: '#eeeeee' }, eyes: 'normal', brow: -1.2, mouth: 'smile', prop: 'rock' },
  ascendant: { bg: '#2a2340', hi: '#ffe9a8', skin: '#f2c9a0', shade: '#d9a479', hat: { kind: 'wizard', color: '#f4efe0', shade: '#c9c0a6', band: '#ffd24d' }, beard: { kind: 'bushy', color: '#ffffff' }, eyes: 'normal', brow: 0.4, mouth: 'none', prop: 'star' },
}

const STAR = 'l1.2 2.4 l2.6 .4 l-1.9 1.8 l.5 2.6 l-2.4 -1.3 l-2.4 1.3 l.5 -2.6 l-1.9 -1.8 l2.6 -.4 Z'

function person(id: string) {
  const p = PEOPLE[id]
  if (!p) return null
  const hood = p.hat?.kind === 'hood'
  return (
    <>
      <Badge bg={p.bg} hi={p.hi} />
      {/* behind the face: long hair, the hood */}
      {p.hair?.kind === 'long' && <path d="M10 28 Q9 15 24 14 Q39 15 38 28 L40 45 Q34 43 33 36 L15 36 Q14 43 8 45 Z" fill={p.hair.color} {...O} />}
      {hood && <path d="M6 47 Q4 15 24 6 Q44 15 42 47 Z" fill={p.hat!.color} {...O} />}
      {/* face */}
      <ellipse cx="24" cy="30" rx="11" ry="11.5" fill={p.skin} {...O} />
      {!hood && <path d="M30 20 Q36 26 35 32 Q33 40 26 41.5 Q32 34 30 20 Z" fill={p.shade} />}
      {p.split && <path d="M24 18.5 A11 11.5 0 0 1 24 41.5 Z" fill={p.split} {...O} strokeWidth={1.8} />}
      {hood && <path d="M12 46 Q11 22 24 16 Q37 22 36 46" fill="none" stroke={p.hat!.shade} strokeWidth="3" />}
      {/* hair on top */}
      {p.hair?.kind === 'spiky' && <path d="M12 27 L11 16 L16 20 L17 10 L22 17 L25 8 L28 17 L33 10 L33 20 L38 15 L36 27 Q30 21 24 21 Q18 21 12 27 Z" fill={p.hair.color} {...O} />}
      {p.hair?.kind === 'bun' && (
        <>
          <circle cx="24" cy="12" r="5.5" fill={p.hair.color} {...O} />
          <path d="M13 27 Q12 16 24 16 Q36 16 35 27 Q30 21 24 21 Q18 21 13 27 Z" fill={p.hair.color} {...O} />
        </>
      )}
      {(p.hair?.kind === 'fringe' || p.hair?.kind === 'long') && <path d="M13 27 Q12 17 24 16 Q36 17 35 27 Q32 22 28 23 Q26 20 22 23 Q18 21 13 27 Z" fill={p.hair.color} {...O} />}
      {p.hair?.kind === 'tonsure' && <path d="M13 31 Q12 22 16 20 L16 27 Z M35 31 Q36 22 32 20 L32 27 Z" fill={p.hair.color} {...O} strokeWidth={1.8} />}
      {p.hair?.kind === 'tufts' && (
        <>
          <ellipse cx="13" cy="27" rx="2.8" ry="3.6" fill={p.hair.color} {...O} strokeWidth={1.8} />
          <ellipse cx="35" cy="27" rx="2.8" ry="3.6" fill={p.hair.color} {...O} strokeWidth={1.8} />
        </>
      )}
      {/* eyes */}
      {p.eyes === 'glow' ? (
        <>
          <path d="M15.5 28 L22 30.5 L16 31.5 Z M32.5 28 L26 30.5 L32 31.5 Z" fill={p.glow} />
          <circle cx="18.5" cy="30.2" r="0.9" fill="#fff" />
          <circle cx="29.5" cy="30.2" r="0.9" fill="#fff" />
        </>
      ) : p.eyes === 'closed' ? (
        <path d="M16 30.5 q3 -3 6 0 M26 30.5 q3 -3 6 0" fill="none" {...O} strokeWidth={2.4} />
      ) : (
        <g color={p.skin}>
          <Eye x={19} y={30} r={p.eyes === 'wide' ? 3.8 : 3.2} look={0.6} brow={p.brow ?? 0} lid={p.eyes === 'narrow' ? 1.4 : 0} />
          <Eye x={29} y={30} r={p.eyes === 'wide' ? 3.8 : 3.2} look={0.6} brow={-(p.brow ?? 0)} lid={p.eyes === 'narrow' ? 1.4 : 0} />
        </g>
      )}
      {p.glasses && (
        <>
          <circle cx="19" cy="30" r="4.6" fill="rgba(255,255,255,0.2)" stroke={INK} strokeWidth="1.8" />
          <circle cx="29" cy="30" r="4.6" fill="rgba(255,255,255,0.2)" stroke={INK} strokeWidth="1.8" />
          <path d="M23.6 30 h0.8" stroke={INK} strokeWidth="1.8" />
        </>
      )}
      {/* mouth and beard */}
      {p.beard?.kind === 'bushy' && <path d="M14 34 Q24 52 34 34 Q29 38 24 37 Q19 38 14 34 Z" fill={p.beard.color} {...O} strokeWidth={2} />}
      {p.beard?.kind === 'goatee' && <path d="M21 38 Q24 45 27 38 Q24 39.5 21 38 Z" fill={p.beard.color} {...O} strokeWidth={1.8} />}
      {p.beard?.kind === 'mustache' && <path d="M24 35.5 Q19 34 16 37 Q14 41 15 46 M24 35.5 Q29 34 32 37 Q34 41 33 46" fill="none" stroke={p.beard.color} strokeWidth="2.6" strokeLinecap="round" />}
      {p.mouth === 'smile' && !p.beard?.kind.startsWith('bushy') && <path d="M20 36.5 q4 2.5 8 0" fill="none" {...O} strokeWidth={2} />}
      {p.mouth === 'smile' && p.beard?.kind === 'bushy' && <path d="M21 38.5 q3 1.6 6 0" fill="none" {...O} strokeWidth={1.8} />}
      {p.mouth === 'flat' && <path d="M21 37.5 h6" {...O} strokeWidth={2} />}
      {p.mouth === 'smirk' && <path d="M21 37.5 q4 1 7 -2" fill="none" {...O} strokeWidth={2} />}
      {p.mouth === 'grin' && (
        <>
          <path d="M18.5 35 Q24 41.5 29.5 35 Z" fill={INK} {...O} strokeWidth={1.8} />
          <path d="M20 35.4 h8" stroke="#fff" strokeWidth="1.4" />
        </>
      )}
      {/* hats */}
      {p.hat?.kind === 'wizard' && (
        <>
          <path d="M5 23 Q24 15 43 23 Q24 28 5 23 Z" fill={p.hat.color} {...O} />
          <path d="M12 21 Q16 8 22 4 Q27 1 31 -1 Q30 6 33 10 Q36 16 36 20 Q24 17 12 21 Z" fill={p.hat.color} {...O} />
          <path d="M31 -1 Q30 6 33 10 Q36 16 36 20 Q31 19 28 19 Q31 9 31 -1 Z" fill={p.hat.shade} />
          <path d="M12.5 19.5 Q24 15.5 35.5 18.5" fill="none" stroke={p.hat.band} strokeWidth="3" />
          <path d={`M20 10 ${STAR}`} fill={p.hat.band} stroke={INK} strokeWidth="1" />
        </>
      )}
      {p.hat?.kind === 'witch' && (
        <>
          <path d="M3 22 Q24 14 45 22 Q24 27 3 22 Z" fill={p.hat.color} {...O} />
          <path d="M13 20 Q16 9 24 5 Q31 1 38 4 Q32 6 31 10 Q33 15 35 19 Q24 16 13 20 Z" fill={p.hat.color} {...O} />
          <path d="M38 4 Q32 6 31 10 Q33 15 35 19 Q31 18 28 18 Q29 8 38 4 Z" fill={p.hat.shade} />
          <path d="M13.5 18.5 Q24 15 34.5 17.5" fill="none" stroke={p.hat.band} strokeWidth="2.6" />
        </>
      )}
      {p.hat?.kind === 'cap' && (
        <>
          <path d="M14 19 Q24 23 34 19 L34 23 Q24 27 14 23 Z" fill={p.hat.shade} {...O} strokeWidth={2} />
          <path d="M6 15 L24 8 L42 15 L24 21 Z" fill={p.hat.color} {...O} />
          <path d="M24 14.5 L38 17 L38 25" fill="none" stroke={p.hat.band} strokeWidth="1.8" />
          <circle cx="38" cy="26" r="1.8" fill={p.hat.band} stroke={INK} strokeWidth="1" />
        </>
      )}
      {p.halo && (
        <>
          <ellipse cx="24" cy="10" rx="11" ry="3.4" fill="none" stroke={INK} strokeWidth="5" />
          <ellipse cx="24" cy="10" rx="11" ry="3.4" fill="none" stroke="#ffd24d" strokeWidth="2.6" />
        </>
      )}
      {/* a small prop that hints at how they play */}
      {p.prop === 'bolt' && <path d="M42 3 l-4 6 h4 l-4 6" fill="none" stroke="#ffe14d" strokeWidth="2.4" strokeLinejoin="round" />}
      {p.prop === 'snow' && <path d="M40 4 v10 M35.7 6.5 l8.6 5 M35.7 11.5 l8.6 -5" stroke="#e9f8ff" strokeWidth="2" strokeLinecap="round" />}
      {p.prop === 'plus' && (
        <>
          <path d="M37 9 h7 M40.5 5.5 v7" stroke={INK} strokeWidth="4.6" strokeLinecap="round" />
          <path d="M37 9 h7 M40.5 5.5 v7" stroke="#6be38a" strokeWidth="2.4" strokeLinecap="round" />
        </>
      )}
      {p.prop === 'mark' && (
        <>
          <circle cx="40" cy="40" r="5" fill="#2a1638" stroke="#c58bff" strokeWidth="1.6" />
          <path d="M37.5 40 Q40 37.5 42.5 40 Q40 42.5 37.5 40 Z" fill="#c58bff" />
        </>
      )}
      {p.prop === 'drop' && <path d="M40 3 Q44 9 44 11 A4 4 0 0 1 36 11 Q36 9 40 3 Z" fill="#3d8bff" {...O} strokeWidth={1.6} />}
      {p.prop === 'clock' && (
        <>
          <circle cx="40" cy="40" r="5" fill="#fffaf0" stroke={INK} strokeWidth="1.6" />
          <path d="M40 40 v-3 M40 40 h2.4" stroke={INK} strokeWidth="1.4" strokeLinecap="round" />
        </>
      )}
      {p.prop === 'book' && <path d="M35 38 L40 40 L45 38 L45 45 L40 47 L35 45 Z M40 40 V47" fill="#ffd24d" {...O} strokeWidth={1.4} />}
      {p.prop === 'mirror' && (
        <>
          <path d="M40 46 v-4" stroke="#b8902c" strokeWidth="2.4" strokeLinecap="round" />
          <ellipse cx="40" cy="38" rx="3.6" ry="4.4" fill="#cfefff" stroke="#b8902c" strokeWidth="1.8" />
          <path d="M38.6 36.4 l1.6 -1.4" stroke="#fff" strokeWidth="1.2" strokeLinecap="round" />
        </>
      )}
      {p.prop === 'star' && <path d={`M40 3 ${STAR}`} transform="translate(40 3) scale(1.4) translate(-40 -3)" fill="#ffd24d" stroke={INK} strokeWidth="0.9" />}
      {p.prop === 'flame' && <path d="M40 2 Q46 8 44 13 Q43 16 40 16 Q36 16 36 12 Q36 9 39 7 Q39 10 41 10 Q42 6 40 2 Z" fill="#ff8a2a" {...O} strokeWidth={1.6} />}
      {p.prop === 'rock' && <path d="M35 45 Q34 39 39 38 Q44 37 45 42 Q45 46 40 46 Z" fill="#a8885a" {...O} strokeWidth={1.6} />}
    </>
  )
}
