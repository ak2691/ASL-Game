// Chunky mobile-brawler portraits (reference: Brawl Stars / Clash Royale icons): a colored badge with a
// rim, a big character head, thick ink outline, cel shading (one hard shadow tone + a highlight).
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
  switch (id) {
    case 'pebble':
      return (
        <>
          <Badge bg="#5b8f4a" hi="#9fd27f" />
          <path d="M8 38 Q6 22 18 16 Q30 11 39 19 Q45 27 41 38 Q24 44 8 38 Z" fill="#b58a4c" {...O} />
          <path d="M30 14 Q42 18 41 38 Q32 41 24 41 Q34 30 30 14 Z" fill="#8a6634" />
          <path d="M14 21 Q18 17 23 17" fill="none" stroke="#e2bd80" strokeWidth="2.6" strokeLinecap="round" />
          <path d="M15 16 q2 -6 6 -3 q2 -5 6 -1 q4 -2 4 3" fill="#6fc35a" {...O} strokeWidth={2} />
          <g color="#b58a4c">
            <Eye x={19} y={28} r={4} look={0.4} lid={1.6} />
            <Eye x={30} y={28} r={4} look={0.4} lid={1.6} />
          </g>
          <path d="M21 36 q3 1.5 6 0" fill="none" {...O} strokeWidth={2} />
          <path d="M39 9 q3 4 0 6 q-3 -2 0 -6 Z" fill="#3d8bff" {...O} strokeWidth={1.6} />
        </>
      )
    case 'ember':
      return (
        <>
          <Badge bg="#8a2a2a" hi="#e0623a" />
          <path d="M24 4 Q30 13 34 10 Q41 20 40 30 Q39 42 24 43 Q9 42 8 30 Q8 20 15 15 Q16 22 19 20 Q17 11 24 4 Z" fill="#ff6a3d" {...O} />
          <path d="M33 13 Q41 22 39 32 Q36 41 26 43 Q36 32 33 13 Z" fill="#d8431f" />
          <path d="M24 22 Q31 29 30 37 Q24 42 18 37 Q18 30 24 22 Z" fill="#ffd24d" />
          <Eye x={18} y={27} r={3.8} look={1} brow={-1.6} />
          <Eye x={29} y={27} r={3.8} look={1} brow={1.6} />
          <path d="M18 34 Q24 40 31 34 Z" fill={INK} {...O} strokeWidth={1.8} />
          <path d="M20 34.4 h9" stroke="#fff" strokeWidth="1.6" />
          <path d="M41 6 l-4 6 h4 l-4 6" fill="none" stroke="#ffe14d" strokeWidth="2.2" strokeLinejoin="round" />
        </>
      )
    case 'frost':
      return (
        <>
          <Badge bg="#2d5a8a" hi="#8fd8ff" />
          <path d="M24 9 L38 17 L38 33 L24 42 L10 33 L10 17 Z" fill="#cdeeff" {...O} />
          <path d="M24 9 L38 17 L38 33 L24 42 Z" fill="#8fd8ff" />
          <path d="M24 9 L10 17 L17 21 Z" fill="#fff" opacity="0.9" />
          <path d="M11 16 L14 4 L19 13 L24 2 L29 13 L34 4 L37 16" fill="#e9f8ff" {...O} />
          <Eye x={18} y={26} r={3.6} look={-0.8} brow={1.2} />
          <path d="M26 25.5 q3 -2 6 0" fill="none" {...O} strokeWidth={2.4} />
          <path d="M19 35 q5 2 10 -2" fill="none" {...O} strokeWidth={2.2} />
          <path d="M40 36 q4 -2 4 -8" fill="none" stroke="#ff6a3d" strokeWidth="2.6" strokeLinecap="round" />
        </>
      )
    case 'cleric':
      return (
        <>
          <Badge bg="#2f6e55" hi="#9de8b4" />
          <ellipse cx="24" cy="9" rx="11" ry="3.4" fill="none" stroke={INK} strokeWidth="5" />
          <ellipse cx="24" cy="9" rx="11" ry="3.4" fill="none" stroke="#ffd24d" strokeWidth="2.6" />
          <path d="M24 13 Q39 28 37 35 Q34 44 24 44 Q14 44 11 35 Q9 28 24 13 Z" fill="#3d8bff" {...O} />
          <path d="M28 18 Q39 29 37 35 Q34 43 26 44 Q34 34 28 18 Z" fill="#2563c9" />
          <ellipse cx="18" cy="27" rx="2.6" ry="4" fill="#bfe0ff" />
          <path d="M16 31 q3 -3 6 0 M26 31 q3 -3 6 0" fill="none" {...O} strokeWidth={2.4} />
          <ellipse cx="15.5" cy="36" rx="2.4" ry="1.4" fill="#ff8fb1" />
          <ellipse cx="32.5" cy="36" rx="2.4" ry="1.4" fill="#ff8fb1" />
          <path d="M21 37 q3 3 6 0" fill="none" {...O} strokeWidth={2} />
          <path d="M40 17 h6 M43 14 v6" stroke={INK} strokeWidth="4.6" strokeLinecap="round" />
          <path d="M40 17 h6 M43 14 v6" stroke="#6be38a" strokeWidth="2.4" strokeLinecap="round" />
        </>
      )
    case 'hexer':
      return (
        <>
          <Badge bg="#3b2350" hi="#8a5cc2" />
          <path d="M6 46 Q6 16 24 4 Q42 16 42 46 Z" fill="#a05cd6" {...O} />
          <path d="M24 4 Q42 16 42 46 L32 46 Q36 22 24 4 Z" fill="#7a3fb0" />
          <ellipse cx="24" cy="29" rx="11" ry="12" fill="#1a0f26" {...O} strokeWidth={2} />
          <path d="M16 25 L22 28 L16 29 Z M32 25 L26 28 L32 29 Z" fill="#e6c2ff" />
          <circle cx="18" cy="27.4" r="1.2" fill="#fff" />
          <circle cx="30" cy="27.4" r="1.2" fill="#fff" />
          <path d="M19 35 l2 -1.5 l2 1.5 l2 -1.5 l2 1.5 l2 -1.5" fill="none" stroke="#e6c2ff" strokeWidth="1.6" />
          <circle cx="40" cy="39" r="5" fill="#b58a4c" {...O} strokeWidth={2} />
          <path d="M38 37 l3 2 l-1 3" fill="none" stroke={INK} strokeWidth="1.4" />
        </>
      )
    case 'tide':
      return (
        <>
          <Badge bg="#1f4f86" hi="#7fbcff" />
          <path d="M5 44 Q4 22 18 14 Q32 6 41 15 Q44 22 38 24 Q36 18 30 19 Q24 21 27 28 Q31 34 44 34 L44 44 Z" fill="#3d8bff" {...O} />
          <path d="M18 14 Q28 8 38 13 Q30 13 24 18 Q14 26 14 44 L5 44 Q4 22 18 14 Z" fill="#6fa8ff" opacity="0.6" />
          <path d="M6 44 q4 -4 8 0 q4 -4 8 0 q4 -4 8 0 q4 -4 8 0" fill="none" stroke="#e9f8ff" strokeWidth="2.4" strokeLinecap="round" />
          <Eye x={15} y={30} r={3.6} look={1} brow={-1.2} />
          <Eye x={25} y={31} r={3.6} look={1} brow={1.2} />
          <path d="M15 38 Q20 41 26 38" fill="none" {...O} strokeWidth={2.2} />
          <path d="M39 4 l-2 5 h3 l-2 5" fill="none" stroke="#ffe14d" strokeWidth="2.2" />
          <path d="M8 8 l4 4 m0 -4 l-4 4" stroke="#e9f8ff" strokeWidth="2.2" strokeLinecap="round" />
        </>
      )
    case 'zealot':
      return (
        <>
          <Badge bg="#4a2f2a" hi="#c98a5a" />
          <path d="M24 8 A17 17 0 0 1 24 42 Z" fill="#a05cd6" {...O} />
          <path d="M24 8 A17 17 0 0 0 24 42 Z" fill="#6be38a" {...O} />
          <path d="M24 8 A17 17 0 0 1 41 25 Q32 22 24 30 Z" fill="#c58bff" opacity="0.5" />
          <path d="M33 10 Q38 2 40 9 L36 13 Z" fill="#3a1f4f" {...O} strokeWidth={1.8} />
          <ellipse cx="15" cy="7" rx="7" ry="2.4" fill="none" stroke="#ffd24d" strokeWidth="2.2" />
          <path d="M18 9 Q22 2 24 8 Q26 2 30 9" fill="#ff6a3d" {...O} strokeWidth={1.8} />
          <Eye x={17} y={24} r={3.6} look={0.6} brow={1} />
          <path d="M27.5 22 L34 25 L27.5 26.5 Z" fill="#ffe14d" {...O} strokeWidth={1.4} />
          <path d="M16 33 Q24 38 32 31" fill="none" {...O} strokeWidth={2.2} />
        </>
      )
    case 'warden':
      return (
        <>
          <Badge bg="#4a4f5a" hi="#a8afbd" />
          <path d="M8 12 L40 12 L42 40 L6 40 Z" fill="#9aa1ad" {...O} />
          <path d="M30 12 L40 12 L42 40 L32 40 Z" fill="#6f7682" />
          <path d="M10 15 L22 15" stroke="#d6dbe3" strokeWidth="2.4" strokeLinecap="round" />
          <path d="M6 20 h36" {...O} strokeWidth={2} />
          {['#ff6a3d', '#8fd8ff', '#3d8bff', '#b58a4c', '#ffe14d'].map((c, i) => (
            <circle key={c} cx={12 + i * 6} cy="16.5" r="2" fill={c} stroke={INK} strokeWidth="1" />
          ))}
          <rect x="11" y="25" width="26" height="5" rx="1.5" fill={INK} />
          <rect x="13" y="26" width="8" height="3" rx="1" fill="#ffd24d" />
          <rect x="27" y="26" width="8" height="3" rx="1" fill="#ffd24d" />
          <path d="M16 35 h16" {...O} strokeWidth={2.6} />
          <path d="M14 40 v-3 M34 40 v-3" {...O} strokeWidth={2} />
        </>
      )
    default:
      return wizard(id)
  }
}

const WIZ: Record<string, { bg: string; hi: string; hat: string; shade: string; band: string; beard?: string; skull?: boolean }> = {
  adept: { bg: '#2c4a8a', hi: '#7aa0ff', hat: '#5b8def', shade: '#3a63c4', band: '#ffd24d' },
  magus: { bg: '#4a2a7a', hi: '#a77ae6', hat: '#9b5de5', shade: '#6f39b8', band: '#8fd8ff', beard: '#c9c9c9' },
  archmage: { bg: '#7a1f2c', hi: '#e8606f', hat: '#d7263d', shade: '#9c1528', band: '#ffd24d', beard: '#f4f4f4' },
  lich: { bg: '#1c2a24', hi: '#4f8a6a', hat: '#2a1838', shade: '#140a1e', band: '#8cff9a', skull: true },
  ascendant: { bg: '#2a2340', hi: '#ffe9a8', hat: '#f4efe0', shade: '#c9c0a6', band: '#c8a2ff', beard: '#ffffff' }, // placeholder look
}

function wizard(id: string) {
  const w = WIZ[id]
  return (
    <>
      <Badge bg={w.bg} hi={w.hi} />
      {/* face */}
      <path d="M13 26 Q13 40 24 41 Q35 40 35 26 Z" fill={w.skull ? '#e8e4d8' : '#f2c9a0'} {...O} />
      <path d="M29 26 Q35 26 35 30 Q34 39 26 41 Q31 34 29 26 Z" fill={w.skull ? '#b9b2a0' : '#d9a479'} />
      {w.skull ? (
        <>
          <ellipse cx="19" cy="30" rx="3.4" ry="3.8" fill={INK} />
          <ellipse cx="29" cy="30" rx="3.4" ry="3.8" fill={INK} />
          <circle cx="19" cy="30.5" r="1.6" fill="#8cff9a" />
          <circle cx="29" cy="30.5" r="1.6" fill="#8cff9a" />
          <path d="M18 37 h12 M21 35.5 v3 M24 35.5 v3 M27 35.5 v3" stroke={INK} strokeWidth="1.4" />
        </>
      ) : (
        <>
          <Eye x={19} y={30} r={3.2} look={0.7} brow={id === 'archmage' ? 1.4 : id === 'magus' ? 0.8 : -0.6} />
          <Eye x={29} y={30} r={3.2} look={0.7} brow={id === 'archmage' ? -1.4 : id === 'magus' ? -0.8 : 0.6} />
          {w.beard ? (
            <path d="M14 34 Q24 52 34 34 Q29 38 24 37 Q19 38 14 34 Z" fill={w.beard} {...O} strokeWidth={2} />
          ) : (
            <path d="M20 36.5 q4 2.5 8 0" fill="none" {...O} strokeWidth={2} />
          )}
        </>
      )}
      {/* hat: brim, cone with a fold, band, star */}
      <path d="M5 26 Q24 18 43 26 Q24 31 5 26 Z" fill={w.hat} {...O} />
      <path d="M12 24 Q16 10 22 6 Q27 3 31 1 Q30 8 33 12 Q36 18 36 23 Q24 20 12 24 Z" fill={w.hat} {...O} />
      <path d="M31 1 Q30 8 33 12 Q36 18 36 23 Q31 22 28 22 Q31 12 31 1 Z" fill={w.shade} />
      <path d="M12.5 22.5 Q24 18.5 35.5 21.5" fill="none" stroke={w.band} strokeWidth="3" />
      <path d="M20 13 l1.2 2.4 l2.6 .4 l-1.9 1.8 l.5 2.6 l-2.4 -1.3 l-2.4 1.3 l.5 -2.6 l-1.9 -1.8 l2.6 -.4 Z" fill={w.band} stroke={INK} strokeWidth="1" />
      {w.skull && <path d="M16 20 l2 -5 l3 3.5 l3 -6 l3 6 l3 -3.5 l2 5 Z" fill="#ffd24d" {...O} strokeWidth={1.4} />}
    </>
  )
}
