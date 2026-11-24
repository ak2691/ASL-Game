// Spell impact visuals: an element projectile flies across, then the target's half gets an element effect.
// Strength sets the size: light (line) < heavy (H, counter, heal) < signature.
import { useEffect, useRef, useState, type CSSProperties, type ReactElement, type RefObject } from 'react'
import { DOOM_MS, GLACIER_MS, GRAVE, MIRROR_MS, SHROUD_MS, STEAM_MS, TWILIGHT_MS, type Bolt, type CombatView, type Fid, type Side } from './combat'
import { COMBO_MIX, isMixCounter } from './spells'

const SHAKE = { light: { px: 4, ms: 180 }, heavy: { px: 10, ms: 320 }, signature: { px: 22, ms: 650 } }
const COUNT = { light: 6, heavy: 14, signature: 30 }
/** A combo's impact uses both of its elements' particles. */
const partsOf = (el: string) => COMBO_MIX[el] ?? (isMixCounter(el) ? [el[1], el[2]] : undefined)

/** Same numbers on every render for the same bolt (it re-renders every 50 ms). */
function rng(seed: number) {
  let s = (seed * 2654435761) >>> 0 || 1
  return () => {
    s ^= s << 13
    s ^= s >>> 17
    s ^= s << 5
    return ((s >>> 0) % 10000) / 10000
  }
}

type Vars = CSSProperties & Record<`--${string}`, string | number>

/** The flying spells, over both halves: an element projectile from your half to theirs. */
export function BoltLayer({ bolts }: { bolts: Bolt[] }) {
  return (
    <div className="bolt-layer">
      {bolts.filter((b) => !b.parried).map((b) => (
        b.shape === 'battlements' && b.kind === 'hit' ? (
          // Earthquake: a crack races along the ground from your half to theirs.
          <div key={b.id}>
            {[21, 43, 65, 87].map((top, n) => (
              <svg key={n} className={`quake-run from-${b.from}`} viewBox="0 0 100 10" preserveAspectRatio="none" style={{ '--fly': `${b.fly}ms`, '--row': `${top}%`, scale: `1 ${n % 2 ? -1 : 1}` } as Vars}>
                <polyline className="glow" points="0,5 6,2 11,8 17,3 24,7 30,1 36,8 43,3 50,9 56,2 63,7 70,1 76,8 83,3 90,8 95,3 100,5" />
                <polyline points="0,5 6,2 11,8 17,3 24,7 30,1 36,8 43,3 50,9 56,2 63,7 70,1 76,8 83,3 90,8 95,3 100,5" />
              </svg>
            ))}
          </div>
        ) : (
          <FlyingBolt key={b.id} b={b} />
        )
      ))}
    </div>
  )
}

// The screen updates the fight every 50 ms, so a spell can show up a little after it was thrown. With a
// local clock (practice, dummy: bolt times are performance.now()), its animation starts from where the
// spell really is, so it reaches the target exactly when it lands. Online, bolt times are the server's.
let localClock = false
export const setLocalBoltClock = (on: boolean) => {
  localClock = on
}
/** ms since the throw, as of when this bolt first appears on screen (0 without a local clock). */
const useSinceThrow = (b: Bolt) => useState(() => (localClock ? Math.max(0, Math.min(b.fly, performance.now() - b.t)) : 0))[0]

function FlyingBolt({ b }: { b: Bolt }) {
  const since = useSinceThrow(b)
  return (
    <div className={`bolt from-${b.from} ${b.kind} tier-${b.tier} el-${b.el}`} style={{ color: b.color, '--fly': `${b.fly}ms`, animationDelay: `-${since}ms` } as Vars}>
      <Projectile b={b} />
    </div>
  )
}

const MIX: Record<string, string> = { magma: 'F', storm: 'L', glacier: 'I', twilight: 'U', steam: 'W', thermal: 'I', plasma: 'L', sunfire: 'F', grave: 'U' }

/** What flies: drawn facing right (flipped for the enemy). Bigger for heavies and signatures.
 *  Glowing-energy look (reference: spell VFX in Hades / Magicka): no outlines, a white-hot core fading
 *  out through the element's color, and a soft blurred trail. Edges fade, so it hides less of their drawing. */
function Projectile({ b }: { b: Bolt }) {
  const el = MIX[b.el] ?? b.el
  const sig = b.tier === 'signature'
  const id = `p${b.id}`
  const blur = `url(#${id}b)`
  /** Defs every projectile can use: a blur for trails/glows, a core gradient and a trail gradient. */
  const defs = (c: string, mid: string) => (
    <defs>
      <filter id={`${id}b`} x="-50%" y="-50%" width="200%" height="200%">
        <feGaussianBlur stdDeviation="4" />
      </filter>
      <radialGradient id={`${id}c`}>
        <stop offset="0" stopColor="#fff" />
        <stop offset="0.35" stopColor={mid} />
        <stop offset="0.75" stopColor={c} />
        <stop offset="1" stopColor={c} stopOpacity="0" />
      </radialGradient>
      <linearGradient id={`${id}t`} x1="0" x2="1">
        <stop offset="0" stopColor={c} stopOpacity="0" />
        <stop offset="1" stopColor={mid} stopOpacity="0.95" />
      </linearGradient>
    </defs>
  )
  const core = `url(#${id}c)`
  const trail = `url(#${id}t)`
  let art: ReactElement
  if (b.kind === 'counter')
    // A counterspell: a spinning ring of light in the element that beats theirs.
    art = (
      <>
        {defs(b.color, '#fff')}
        <g className="spin">
          <circle cx="50" cy="50" r="30" fill="none" stroke={b.color} strokeWidth="14" filter={blur} />
          <circle cx="50" cy="50" r="30" fill="none" stroke="#fff" strokeWidth="4" strokeDasharray="30 12" />
        </g>
        <circle cx="50" cy="50" r="16" fill={core} />
      </>
    )
  else if (el === 'F')
    art = sig ? (
      // Meteor: a dark rock with glowing lava cracks inside a huge fire trail.
      <>
        {defs('#ff3d1f', '#ffb13d')}
        <path d="M0 50 Q30 14 70 22 L70 78 Q30 86 0 50 Z" fill={trail} filter={blur} />
        <circle cx="72" cy="50" r="30" fill={core} filter={blur} />
        <path d="M54 32 L72 22 L90 32 L94 54 L82 72 L60 74 L50 56 Z" fill="#4a2e1e" />
        <path d="M72 22 L90 32 L94 54 L76 50 Z" fill="#3a2418" />
        <path d="M94 54 L82 72 L60 74 L76 50 Z" fill="#2a180f" />
        <path d="M54 32 L72 22 L76 50 L50 56 Z" fill="#6a4228" />
        <ellipse cx="64" cy="42" rx="5" ry="4" fill="#24140c" />
        <ellipse cx="82" cy="58" rx="4" ry="3" fill="#24140c" />
        <ellipse cx="70" cy="64" rx="3" ry="2.4" fill="#24140c" />
        <circle cx="84" cy="38" r="1.6" fill="#24140c" />
        <circle cx="58" cy="54" r="1.4" fill="#24140c" />
        <path d="M54 32 L72 22 L90 32 L94 54 L82 72 L60 74 L50 56 Z" fill="none" stroke="#ff8a2a" strokeWidth="4" strokeLinejoin="round" filter={blur} />
      </>
    ) : (
      // Fireball: a white-hot core in an orange flame, trailing fire.
      <>
        {defs('#ff4a1f', '#ffc23d')}
        <path d="M0 50 Q30 22 64 30 L64 70 Q30 78 0 50 Z" fill={trail} filter={blur} />
        <path d="M14 50 Q36 36 60 40 L60 60 Q36 64 14 50 Z" fill="#ffe08a" opacity="0.7" filter={blur} />
        <circle cx="66" cy="50" r="32" fill={core} />
      </>
    )
  else if (b.el === 'magma')
    // Magma: a molten boulder dripping lava, in a long fire trail.
    art = (
      <>
        {defs('#ff5a14', '#ffb13d')}
        <path d="M0 50 Q30 16 66 24 L66 76 Q30 84 0 50 Z" fill={trail} filter={blur} />
        <circle cx="68" cy="50" r="30" fill={core} filter={blur} />
        <path d="M50 34 L68 22 L88 30 L94 52 L84 72 L60 76 L46 58 Z" fill="#3a1c10" />
        <path d="M56 36 L70 46 L66 60 M70 46 L86 40 M66 60 L80 66 M66 60 L54 64" fill="none" stroke="#ffb13d" strokeWidth="3" strokeLinecap="round" />
        <path d="M58 76 Q57 86 60 90 Q63 86 62 76 Z M76 74 Q76 82 78 84 Q80 82 79 74 Z" fill="#ff7a1f" />
      </>
    )
  else if (b.el === 'steam')
    // Steam: a rolling ball of white puffs.
    art = (
      <>
        {defs('#cfd8df', '#ffffff')}
        <path d="M0 50 Q30 30 60 34 L60 66 Q30 70 0 50 Z" fill={trail} filter={blur} />
        <g className="spin">
          {[[50, 36, 14], [66, 42, 16], [60, 60, 15], [42, 58, 13], [36, 44, 11]].map(([x, y, r], k) => (
            <circle key={k} cx={x} cy={y} r={r} fill="#eef3f6" opacity="0.9" />
          ))}
        </g>
      </>
    )
  else if (b.el === 'thermal')
    // Thermal Shock: an orb half fire, half ice, cracking in the middle.
    art = (
      <>
        {defs('#ff6aa8', '#ffffff')}
        <path d="M0 50 Q30 26 62 32 L62 68 Q30 74 0 50 Z" fill={trail} filter={blur} />
        <path d="M68 22 A28 28 0 0 0 68 78 Z" fill="#ff5a2a" />
        <path d="M68 22 A28 28 0 0 1 68 78 Z" fill="#7fd0ff" />
        <path d="M68 22 L62 36 L72 48 L62 60 L70 78" fill="none" stroke="#fff" strokeWidth="3" strokeLinejoin="round" />
      </>
    )
  else if (b.el === 'plasma')
    // Plasma: a hot pink ball with tendrils crackling round it.
    art = (
      <>
        {defs('#e83dff', '#ffd6ff')}
        <path d="M0 50 Q30 28 60 34 L60 66 Q30 72 0 50 Z" fill={trail} filter={blur} />
        <circle cx="62" cy="50" r="30" fill={core} filter={blur} />
        <circle cx="62" cy="50" r="22" fill="none" stroke="#ffd6ff" strokeWidth="2" />
        <g className="spin" style={{ transformOrigin: '62px 50px' }}>
          <path d="M62 50 Q52 36 62 28 Q72 36 62 50 Q48 54 44 64 Q56 66 62 50 Q76 54 80 64 Q68 66 62 50" fill="none" stroke="#fff" strokeWidth="2.5" />
        </g>
      </>
    )
  else if (b.el === 'sunfire')
    // Sunfire: a blazing little sun, rays turning.
    art = (
      <>
        {defs('#ffb81f', '#fff6c2')}
        <path d="M0 50 Q30 28 60 34 L60 66 Q30 72 0 50 Z" fill={trail} filter={blur} />
        <g className="spin" style={{ transformOrigin: '64px 50px' }}>
          <path d="M64 18 L68 38 L86 28 L76 46 L96 50 L76 54 L86 72 L68 62 L64 82 L60 62 L42 72 L52 54 L32 50 L52 46 L42 28 L60 38 Z" fill="#ffd23d" />
        </g>
        <circle cx="64" cy="50" r="14" fill={core} />
      </>
    )
  else if (b.el === 'grave')
    // Grave: a tombstone in a cold purple haze.
    art = (
      <>
        {defs('#6a4a8c', '#c9b6e0')}
        <path d="M0 50 Q30 28 56 34 L56 66 Q30 72 0 50 Z" fill={trail} filter={blur} />
        <circle cx="66" cy="50" r="30" fill={core} filter={blur} opacity="0.6" />
        <path d="M52 80 L52 40 A14 14 0 0 1 80 40 L80 80 Z" fill="#8a7a9c" stroke="#3a2c4c" strokeWidth="3" />
        <path d="M66 46 L66 70 M58 54 L74 54" stroke="#3a2c4c" strokeWidth="4" strokeLinecap="round" />
      </>
    )
  else if (b.el === 'twilight')
    // Twilight: a spinning disc of light and dark.
    art = (
      <>
        {defs('#a07ad8', '#ffffff')}
        <path d="M0 50 Q30 28 60 34 L60 66 Q30 72 0 50 Z" fill={trail} filter={blur} />
        <g className="spin" style={{ transformOrigin: '64px 50px' }}>
          <circle cx="64" cy="50" r="26" fill="#fff" />
          <path d="M64 24 A26 26 0 0 1 64 76 A13 13 0 0 1 64 50 A13 13 0 0 0 64 24 Z" fill="#2a1840" />
          <circle cx="64" cy="37" r="4" fill="#2a1840" />
          <circle cx="64" cy="63" r="4" fill="#fff" />
        </g>
      </>
    )
  else if (b.el === 'glacier')
    // Advancing Glacier: a slow wall of ice, drawn under everything else the caster throws.
    art = (
      <>
        {defs('#7fd0ff', '#e8f8ff')}
        <path d="M18 92 L26 30 L40 40 L52 8 L66 34 L80 22 L90 92 Z" fill="#cdeeff" opacity="0.9" />
        <path d="M52 8 L66 34 L60 92 L44 92 Z" fill="#9fdcff" opacity="0.8" />
        <path d="M18 92 L26 30 L40 40 L52 8 L66 34 L80 22 L90 92 Z" fill="none" stroke="#fff" strokeWidth="2" />
      </>
    )
  else if (el === 'I' && sig)
    // Frozen Prison: a cage of glowing ice bars.
    art = (
      <>
        {defs('#5fc8ff', '#dff6ff')}
        <g className="upright">
        <rect x="14" y="10" width="72" height="80" rx="8" fill="#8fd8ff" opacity="0.25" filter={blur} />
        {[26, 42, 58, 74].map((x) => (
          <g key={x}>
            <rect x={x - 5} y="12" width="10" height="76" rx="4" fill="#8fd8ff" filter={blur} />
            <rect x={x - 2} y="12" width="4" height="76" rx="2" fill="#fff" />
          </g>
        ))}
        <rect x="10" y="8" width="80" height="8" rx="4" fill="#e9f8ff" />
        <rect x="10" y="84" width="80" height="8" rx="4" fill="#e9f8ff" />
        </g>
      </>
    )
  else if (el === 'I')
    // Ice shard: a bright crystal with a frosty glow and sparkles in its wake.
    art = (
      <>
        {defs('#5fc8ff', '#dff6ff')}
        <path d="M0 50 Q30 36 60 40 L60 60 Q30 64 0 50 Z" fill={trail} filter={blur} />
        <path d="M14 50 L56 24 L98 50 L56 76 Z" fill="#8fd8ff" filter={blur} />
        <path d="M18 50 L56 28 L94 50 L56 72 Z" fill="#cdeeff" />
        <path d="M30 50 L56 36 L82 50 L56 64 Z" fill="#fff" />
        {[[22, 30], [30, 70], [10, 42]].map(([x, y]) => (
          <path key={x} d={`M${x} ${y - 5} L${x + 1.5} ${y - 1.5} L${x + 5} ${y} L${x + 1.5} ${y + 1.5} L${x} ${y + 5} L${x - 1.5} ${y + 1.5} L${x - 5} ${y} L${x - 1.5} ${y - 1.5} Z`} fill="#fff" />
        ))}
      </>
    )
  else if (el === 'W')
    art = sig ? (
      // Tidal Wave: a glowing curl of water, bright at the crest, foam spraying off.
      <>
        <defs>
          <filter id={`${id}b`} x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation="4" />
          </filter>
          <linearGradient id={`${id}w`} x1="0" y1="1" x2="0.4" y2="0">
            <stop offset="0" stopColor="#1f5fd0" stopOpacity="0.2" />
            <stop offset="0.6" stopColor="#3d8bff" />
            <stop offset="1" stopColor="#bfe0ff" />
          </linearGradient>
        </defs>
        <path d="M2 98 L2 70 Q10 40 34 26 Q62 8 84 20 Q98 30 90 46 Q84 34 70 36 Q56 40 60 56 Q66 72 98 74 L98 98 Z" fill="#3d8bff" filter={blur} />
        <path d="M2 98 L2 70 Q10 40 34 26 Q62 8 84 20 Q98 30 90 46 Q84 34 70 36 Q56 40 60 56 Q66 72 98 74 L98 98 Z" fill={`url(#${id}w)`} />
        <path d="M30 28 Q60 8 84 20 Q98 30 90 46" fill="none" stroke="#fff" strokeWidth="5" strokeLinecap="round" />
        {[[94, 14, 4], [86, 8, 3], [98, 26, 2.5]].map(([x, y, r]) => (
          <circle key={x} cx={x} cy={y} r={r} fill="#fff" />
        ))}
      </>
    ) : (
      // Water orb: a shining bubble of water with a ripple ring and droplets.
      <>
        {defs('#2f7bff', '#9fd0ff')}
        <path d="M0 50 Q30 30 60 36 L60 64 Q30 70 0 50 Z" fill={trail} filter={blur} />
        <circle cx="64" cy="50" r="34" fill="#3d8bff" opacity="0.6" filter={blur} />
        <circle cx="64" cy="50" r="28" fill={core} />
        <circle cx="64" cy="50" r="30" fill="none" stroke="#cfe6ff" strokeWidth="2.5" opacity="0.8" />
        <ellipse cx="72" cy="38" rx="9" ry="5" fill="#fff" transform="rotate(-20 72 38)" />
        <circle cx="20" cy="40" r="4" fill="#bfe0ff" />
        <circle cx="30" cy="62" r="5" fill="#bfe0ff" />
      </>
    )
  else if (el === 'E' && sig) return null // Earthquake doesn't fly: their half just shakes
  else if (el === 'E')
    // Boulder: a solid rock with an amber energy glow and a dust trail.
    art = (
      <>
        {defs('#b58a4c', '#ffd28a')}
        <path d="M0 50 Q30 32 56 36 L56 64 Q30 68 0 50 Z" fill={trail} opacity="0.7" filter={blur} />
        <path d="M26 30 L58 16 L92 34 L94 66 L64 84 L30 72 Z" fill="#ffb84d" opacity="0.8" filter={blur} />
        <path d="M30 32 L58 20 L88 36 L90 64 L64 80 L34 70 Z" fill="#a07840" />
        <path d="M58 20 L88 36 L90 64 L66 52 Z" fill="#8a6634" />
        <path d="M90 64 L64 80 L34 70 L66 52 Z" fill="#6e5128" />
        <path d="M30 32 L58 20 L66 52 L34 70 Z" fill="#c69a5a" />
        <ellipse cx="48" cy="40" rx="5" ry="4" fill="#8a6634" />
        <ellipse cx="76" cy="44" rx="4" ry="3" fill="#6e5128" />
        <ellipse cx="62" cy="68" rx="4" ry="3" fill="#57401f" />
        <circle cx="42" cy="56" r="1.8" fill="#8a6634" />
        <circle cx="80" cy="60" r="1.6" fill="#57401f" />
        <circle cx="56" cy="30" r="1.4" fill="#e2bd80" />
      </>
    )
  else if ((el === 'L' && sig) || b.el === 'storm') return null // Thunderbolt and Storm don't fly: a storm forms over them and strikes
  else if (el === 'L')
    // Lightning: a white-hot zigzag bolt in a crackling yellow glow.
    art = (
      <>
        {defs('#ffd23f', '#fff6a8')}
        <circle cx="62" cy="50" r="38" fill={core} opacity="0.6" />
        <path d="M2 54 L34 36 L40 52 L70 32 L66 50 L98 42 L64 68 L60 54 L34 70 L36 58 Z" fill="#ffe14d" filter={blur} />
        <path d="M6 54 L34 40 L40 54 L68 36 L64 51 L92 45 L62 64 L58 52 L36 66 L37 57 Z" fill="#fffbe0" />
        <path d="M40 54 L44 70 M68 36 L72 22 M20 48 L16 38" stroke="#fff" strokeWidth="2.5" strokeLinecap="round" />
      </>
    )
  else if (b.shape === 'blade')
    // Execute: a steel guillotine blade (wood back, sharp edge first) wrapped in a violet glow.
    art = (
      <>
        {defs('#a05cd6', '#e6c2ff')}
        <path d="M0 50 Q20 30 40 34 L40 66 Q20 70 0 50 Z" fill={trail} filter={blur} />
        <rect x="24" y="16" width="70" height="68" rx="4" fill="#a05cd6" opacity="0.7" filter={blur} />
        <rect x="26" y="18" width="14" height="64" rx="2" fill="#6b4a32" />
        <rect x="40" y="22" width="50" height="56" fill="#cfc8e0" />
        <path d="M40 22 H90 V44 H40 Z" fill="#ece8f6" />
        <path d="M86 24 V76" stroke="#fff" strokeWidth="4" strokeLinecap="round" />
      </>
    )
  else if (el === 'U')
    // Doom: a pale skull in a ghostly violet fire.
    art = (
      <>
        {defs('#8a3fd6', '#e6c2ff')}
        <path d="M0 50 Q26 24 50 30 L50 70 Q26 76 0 50 Z" fill={trail} filter={blur} />
        <g className="upright">
        <circle cx="64" cy="48" r="38" fill={core} opacity="0.55" filter={blur} />
        <path d="M64 16 Q90 16 92 42 Q93 55 83 59 L82 72 Q74 80 64 80 Q54 80 46 72 L45 59 Q35 55 36 42 Q38 16 64 16 Z" fill="#f2eefc" />
        <ellipse cx="54" cy="44" rx="7.5" ry="8.5" fill="#3a1f5a" />
        <ellipse cx="74" cy="44" rx="7.5" ry="8.5" fill="#3a1f5a" />
        <circle cx="54" cy="45" r="3.5" fill="#d9a6ff" />
        <circle cx="74" cy="45" r="3.5" fill="#d9a6ff" />
        <path d="M61 59 L64 52 L67 59 Z" fill="#3a1f5a" />
        <path d="M52 69 h24 M57 65 v8 M62 65 v8 M67 65 v8 M72 65 v8" stroke="#3a1f5a" strokeWidth="2.5" />
        </g>
      </>
    )
  else
    art = (
      <>
        {defs(b.color, '#fff')}
        <circle cx="60" cy="50" r="26" fill={core} />
      </>
    )
  return (
    <svg className="projectile" viewBox="0 0 100 100" aria-hidden="true">
      {art}
    </svg>
  )
}

/** Parry timing: a ring per spell flying at `side` that closes on impact and lights up when the parry
 *  window opens (the last PARRY_WINDOW_MS). Pure CSS timing from the moment it appears. */
export function ParryRings({ side, bolts, windowMs }: { side: Side; bolts: Bolt[]; windowMs: number }) {
  return (
    <>
      {bolts
        .filter((b) => b.from !== side && b.parryable && !b.parried && !b.landed)
        .map((b) => (
          <div key={b.id} className="parry-ring" style={{ color: b.color, '--fly': `${b.fly}ms`, '--open': `${Math.max(0, b.fly - windowMs)}ms`, '--win': `${windowMs}ms` } as Vars} />
        ))}
    </>
  )
}

/** Shake the half a spell lands on, harder for stronger spells (Earth shakes up and down). */
export function useShake(bolts: Bolt[], refs: Record<Side, RefObject<HTMLDivElement | null>>) {
  const done = useRef(new Set<number>())
  useEffect(() => {
    for (const b of bolts) {
      if (done.current.has(b.id)) continue
      if (b.kind === 'counter' && !b.landed) continue // wait to see if it hits
      done.current.add(b.id)
      if (b.kind !== 'hit' && b.kind !== 'counter') continue
      const target = b.from === 'player' ? 'enemy' : 'player'
      const { px, ms } = SHAKE[b.tier]
      const vert = b.el === 'E'
      const at = (k: number) => (vert ? `translate(0, ${k * px}px)` : `translate(${k * px}px, ${k * px * 0.35}px)`)
      refs[target].current?.animate(
        [0, -1, 0.8, -0.6, 0.4, -0.2, 0].map((k) => ({ transform: at(k) })),
        { duration: ms, delay: b.landed ? 0 : Math.max(0, b.fly - (localClock ? performance.now() - b.t : 0)), easing: 'ease-out' },
      )
    }
  }, [bolts, refs])
}

/** What lands on one half. */
export function Impacts({ side, bolts }: { side: Side; bolts: Bolt[] }) {
  return (
    <>
      {bolts.map((b) => {
        const onTarget = b.from !== side
        if (b.parried) return null
        if (onTarget && b.kind === 'hit') return <Impact key={b.id} b={b} />
        if (onTarget && b.kind === 'counter' && b.landed) return <Impact key={b.id} b={b} landed />
        if (!onTarget && b.kind === 'heal') return <Impact key={b.id} b={b} />
        if (onTarget && b.kind === 'missed')
          return (
            <div key={b.id} className="impact fizzle" style={{ color: '#999' }}>
              <span className="impact-name">Missed</span>
            </div>
          )
        if (!onTarget && b.kind === 'fizzle')
          return (
            <div key={b.id} className="impact fizzle" style={{ color: b.color }}>
              <span className="impact-name">{b.name}</span>
            </div>
          )
        return null
      })}
    </>
  )
}

function Impact({ b, landed = false }: { b: Bolt; landed?: boolean }) {
  const r = rng(b.id)
  const n = COUNT[b.tier]
  const since = useSinceThrow(b)
  const delay = b.kind === 'heal' || landed ? 0 : Math.max(0, b.fly - since)
  const el = b.kind === 'counter' ? 'counter' : b.el
  const els = partsOf(el) ?? [el]
  const parts: ReactElement[] = []
  const add = (cls: string, v: Vars) => parts.push(<i key={parts.length} className={cls} style={v} />)
  const d = (extra = 0) => `${delay + extra}ms`

  if (els.includes('F'))
    for (let i = 0; i < n; i++) {
      const a = r() * Math.PI * 2
      const dist = 60 + r() * (b.tier === 'signature' ? 380 : 200)
      add('p ember', { '--dx': `${Math.cos(a) * dist}px`, '--dy': `${Math.sin(a) * dist * 0.7 - 60 - r() * 80}px`, '--s': `${5 + r() * 9}px`, '--d': d(r() * 80), '--t': `${600 + r() * 500}ms` })
    }
  if (els.includes('I') || el === 'counter') {
    for (let i = 0; i < n; i++) {
      const a = r() * Math.PI * 2
      const dist = 70 + r() * (b.tier === 'signature' ? 340 : 180)
      add('p shard', { '--dx': `${Math.cos(a) * dist}px`, '--dy': `${Math.sin(a) * dist}px`, '--rot': `${(a * 180) / Math.PI}deg`, '--s': `${10 + r() * 16}px`, '--d': d(r() * 40), '--t': `${500 + r() * 300}ms` })
    }
    if (els.includes('I') && b.tier !== 'light') add('frost', { '--d': d(), '--t': b.tier === 'signature' ? '1800ms' : '900ms' })
  }
  if (els.includes('W')) {
    const rings = b.tier === 'light' ? 1 : b.tier === 'heavy' ? 2 : 4
    for (let i = 0; i < rings; i++) add('ring', { '--d': d(i * 140), '--t': `${700 + i * 60}ms`, '--end': b.tier === 'signature' ? 40 : 22 })
    for (let i = 0; i < n / 2; i++) {
      const a = -Math.PI * (0.15 + r() * 0.7)
      const dist = 60 + r() * 160
      add('p drop', { '--dx': `${Math.cos(a) * dist}px`, '--dy': `${Math.sin(a) * dist}px`, '--s': `${5 + r() * 7}px`, '--d': d(r() * 60), '--t': `${600 + r() * 300}ms` })
    }
  }
  if (els.includes('E'))
    for (let i = 0; i < n; i++)
      add('p rock', { '--x': `${(r() - 0.5) * 90}%`, '--s': `${8 + r() * (b.tier === 'signature' ? 26 : 14)}px`, '--rot': `${r() * 360}deg`, '--d': d(r() * 200), '--t': `${500 + r() * 400}ms` })
  if (els.includes('L')) {
    const bolts = b.tier === 'light' ? 3 : b.tier === 'heavy' ? 5 : 0
    add('lflash', { '--d': d(), '--t': b.tier === 'heavy' ? '420ms' : '300ms' })
    for (let k = 0; k < bolts; k++) {
      let x = 20 + r() * 60
      const pts = [`${x},0`]
      for (let y = 10; y <= 100; y += 10) pts.push(`${(x = Math.max(2, Math.min(98, x + (r() - 0.5) * 22)))},${y}`)
      parts.push(
        <svg key={parts.length} className="crack" viewBox="0 0 100 100" preserveAspectRatio="none" style={{ '--d': d(k * 70), '--t': '420ms' } as Vars}>
          <polyline points={pts.join(' ')} />
        </svg>,
      )
    }
  }
  if (els.includes('H'))
    for (let i = 0; i < n; i++)
      add('p sparkle', { '--x': `${(r() - 0.5) * 70}%`, '--s': `${4 + r() * 7}px`, '--d': d(r() * 400), '--t': `${800 + r() * 500}ms` })

  if (els.includes('U'))
    // Curses: violet wisps curl up and away.
    for (let i = 0; i < n; i++) {
      const a = -Math.PI * (0.1 + r() * 0.8)
      const dist = 60 + r() * 220
      add('p wisp', { '--dx': `${Math.cos(a) * dist}px`, '--dy': `${Math.sin(a) * dist}px`, '--s': `${8 + r() * 14}px`, '--d': d(r() * 150), '--t': `${900 + r() * 600}ms` })
    }

  if (b.tier === 'signature' && b.kind === 'hit') signature(b, r, parts)
  if (b.kind !== 'counter') special(b, r, parts, delay)

  return (
    <div className={`impact ${b.kind} tier-${b.tier}`} style={{ color: b.color, '--d': d(), '--fly': d() } as Vars}>
      <div className="impact-flash" />
      {parts}
      <span className="impact-name">{b.kind === 'counter' ? 'Interrupted!' : b.name}</span>
    </div>
  )
}

/** Ongoing effects on one half: silence greys it out, static crackles the edges, chill frosts them,
 *  burn flickers from below, regen pulses green, and a knock-off drops rubble. */
export function StatusFx({ side, view }: { side: Fid; view: CombatView }) {
  const silenced = view.silenced[side]
  const knocks = view.knocked[side]
  const seenKnocks = useRef(knocks)
  const [knockId, setKnockId] = useState<number | null>(null)
  useEffect(() => {
    if (knocks > seenKnocks.current) setKnockId(knocks)
    seenKnocks.current = knocks
  }, [knocks])
  const r = rng(side === 'player' ? 7 : 13)
  const st = view.static[side]
  return (
    <div className="status-fx">
      {view.burning[side] && <div className="st-burn" />}
      {view.regen[side] && <div className="st-regen" />}
      {view.chill[side] > 0 && <div className="st-chill" />}
      {view.shield[side] > 0 && <div className="st-aegis" />}
      {view.mirror[side] > 0 && <div className="st-mirror" />}
      {view.shroud[side] > 0 && <div className="st-shroud" />}
      {view.fog[side] > 0 && <div className="st-steam" />}
      {view.storm[side] && (
        <div className={`st-storm ${st}`}>
          {st === 'on' && (
            <svg viewBox="0 0 100 100" preserveAspectRatio="none">
              <polyline points={`${20 + r() * 60},0 ${30 + r() * 40},30 ${20 + r() * 60},55 ${30 + r() * 40},100`} />
            </svg>
          )}
        </div>
      )}
      {view.doom[side] > 0 && <div className="st-doom" />}
      <Timers view={view} side={side} />
      {st && (
        <div className={`st-static ${st}`}>
          {st === 'on' &&
            Array.from({ length: 10 }, (_, i) => {
              const edge = i % 4
              const at = `${8 + r() * 84}%`
              const pos: Vars = edge === 0 ? { top: 0, left: at } : edge === 1 ? { bottom: 0, left: at } : edge === 2 ? { left: 0, top: at } : { right: 0, top: at }
              return <i key={i} style={{ ...pos, '--rot': `${r() * 360}deg`, '--d': `${r() * 150}ms` } as Vars} />
            })}
        </div>
      )}
      {silenced > 0 && <div className="st-silence" />}
      {knockId !== null && (
        <div key={knockId} className="st-knock" onAnimationEnd={() => setKnockId(null)}>
          {Array.from({ length: 10 }, (_, i) => (
            <i key={i} style={{ '--x': `${r() * 160}px`, '--rot': `${r() * 400 - 200}deg`, '--s': `${6 + r() * 10}px`, '--d': `${r() * 120}ms` } as Vars} />
          ))}
          <span>Knocked down!</span>
        </div>
      )}
    </div>
  )
}

/** Each signature's own big visual, on top of its element's burst. Pieces with --d: 0ms start
 *  while the name is still flying, so they arrive together. */
function signature(b: Bolt, r: () => number, parts: ReactElement[]) {
  const k = () => parts.length
  const fromLeft = b.from === 'player' // the caster's side, as the target sees it
  if (b.el === 'F') parts.push(<div key={k()} className="sig-scorch" />) // Meteor: the rock itself flies over
  if (b.el === 'I')
    // Frozen Prison: ice bars slam down over the half and hold for the silence, then shatter.
    // Four thin bars, kept toward the edges so the middle (where they draw) stays clear.
    [6, 22, 76, 92].forEach((x, i) => parts.push(<div key={k()} className="sig-bar" style={{ '--x': `${x}%`, '--d2': `${i * 40}ms` } as Vars} />))
  if (b.el === 'L') {
    // Thunderbolt: no projectile. A storm cloud gathers over them while it would fly, then one huge
    // bolt strikes and their whole half flashes white.
    parts.push(
      <div key={k()} className="sig-cloud" style={{ '--d': '0ms', '--t': `${b.fly}ms` } as Vars}>
        {Array.from({ length: 8 }, (_, i) => (
          <i key={i} style={{ '--x': `${8 + r() * 84}%`, '--d': `${r() * b.fly * 0.8}ms` } as Vars} />
        ))}
      </div>,
    )
    parts.push(<div key={k()} className="sig-dark" />)
    for (let n = 0; n < 3; n++) {
      let x = 30 + r() * 40
      const pts = [`${x},-2`]
      const forks: string[] = []
      for (let y = 7; y <= 100; y += 7) {
        pts.push(`${(x = Math.max(10, Math.min(90, x + (r() - 0.5) * 26)))},${y}`)
        if (n === 0 && r() < 0.3) forks.push(`${x},${y} ${x + (r() - 0.5) * 30},${y + 10 + r() * 10}`)
      }
      parts.push(
        <svg key={k()} className={`sig-bolt ${n ? 'thin' : ''}`} viewBox="0 0 100 100" preserveAspectRatio="none">
          <polyline points={pts.join(' ')} />
          {forks.map((f, i) => (
            <polyline key={i} className="fork" points={f} />
          ))}
        </svg>,
      )
    }
    parts.push(<div key={k()} className="sig-whiteout" />)
  }
  if (b.el === 'storm')
    // Storm (Water + Lightning): not one big strike but weather. A blue-grey rain front rolls in
    // over their half and sets in; the 5 pulses then strike one by one (StatusFx, st-storm).
    parts.push(
      <div key={k()} className="sig-cloud storm" style={{ '--d': '0ms', '--t': `${b.fly}ms` } as Vars}>
        {Array.from({ length: 14 }, (_, i) => (
          <i key={i} style={{ '--x': `${4 + r() * 92}%`, '--d': `${r() * b.fly * 0.8}ms` } as Vars} />
        ))}
      </div>,
      <div key={k() + 1} className="sig-rainwash" />,
    )
  if (b.el === 'E')
    // Earthquake: cracks run up from the ground.
    for (let c = 0; c < 4; c++) {
      let x = 10 + c * 26 + r() * 10
      const pts = [`${x},100`]
      for (let y = 88; y >= 30 + r() * 30; y -= 8) pts.push(`${(x += (r() - 0.5) * 14)},${y}`)
      parts.push(
        <svg key={k()} className="sig-crack" viewBox="0 0 100 100" preserveAspectRatio="none" style={{ '--d2': `${c * 60}ms` } as Vars}>
          <polyline points={pts.join(' ')} />
        </svg>,
      )
    }
  if (b.el === 'W')
    // Tidal Wave: the wave that flew over crashes through the half.
    parts.push(
      <div key={k()} className={`sig-wave ${fromLeft ? 'from-left' : 'from-right'}`}>
        <svg viewBox="0 0 100 100" preserveAspectRatio="none">
          <path d="M0,100 L0,30 Q10,10 20,28 T40,26 T60,24 T80,28 T100,22 L100,100 Z" />
        </svg>
      </div>,
    )
}

/** Holy, Unholy and combo spells: one look each, on top of their particles. */
function special(b: Bolt, r: () => number, parts: ReactElement[], delay: number) {
  const k = () => parts.length
  const d = (extra = 0) => `${delay + extra}ms`
  switch (b.shape) {
    case 'aegis': // a dome of light settles over the caster
      parts.push(<div key={k()} className="fx-aegis" style={{ '--d': d() } as Vars} />)
      break
    case 'mirror': // a glassy sheen sweeps across
      parts.push(<div key={k()} className="fx-mirror" style={{ '--d': d() } as Vars} />)
      break
    case 'veil': // dark fog rolls over the caster
      parts.push(<div key={k()} className="fx-shroud" style={{ '--d': d() } as Vars} />)
      break
    case 'volcano': // lava wells up from below
      parts.push(<div key={k()} className="fx-lava" style={{ '--d': d() } as Vars} />)
      break
    case 'iceberg': // the glacier crushes in, snow everywhere
    case 'thermo': // hot and cold at once
      for (let i = 0; i < 26; i++)
        parts.push(<i key={k()} className="p snow" style={{ '--x': `${(r() - 0.5) * 100}%`, '--s': `${4 + r() * 6}px`, '--d': d(r() * 500), '--t': `${900 + r() * 700}ms` } as Vars} />)
      break
    case 'puff': // steam rolls over them
      parts.push(<div key={k()} className="fx-steam" style={{ '--d': d() } as Vars} />)
      break
    case 'sun': // a blaze of sunlight
      parts.push(<div key={k()} className="fx-sun" style={{ '--d': d() } as Vars} />)
      break
    case 'tomb': // a grave's gloom
      parts.push(<div key={k()} className="fx-shroud" style={{ '--d': d() } as Vars} />)
      break
    case 'plasma': {
      parts.push(<div key={k()} className="sig-dark" style={{ '--d': d(100) } as Vars} />)
      let x = 50
      const pts = [`${x},-2`]
      for (let y = 8; y <= 100; y += 8) pts.push(`${(x = Math.max(15, Math.min(85, x + (r() - 0.5) * 40)))},${y}`)
      parts.push(
        <svg key={k()} className="sig-bolt" viewBox="0 0 100 100" preserveAspectRatio="none" style={{ '--d': d(150) } as Vars}>
          <polyline points={pts.join(' ')} />
        </svg>,
      )
      break
    }
    case 'yinyang': // light and dark split the half and spin
      parts.push(<div key={k()} className="fx-twilight" style={{ '--d': d() } as Vars} />)
      break
  }
}

/** Every effect with a clock, in one row of pills: a label with the seconds left and a bar that runs down. */
function Timers({ view, side }: { view: CombatView; side: Fid }) {
  const silenced = view.silenced[side]
  const longest = useRef(0) // how long this silence was at its start (silences vary in length)
  if (silenced <= 0) longest.current = 0
  else if (silenced > longest.current) longest.current = silenced
  const items = [
    view.doom[side] > 0 && { k: 'doom', label: `Doom ${(view.doom[side] / 1000).toFixed(1)} s`, f: view.doom[side] / DOOM_MS },
    silenced > 0 && { k: 'silence', label: `Silenced ${(silenced / 1000).toFixed(1)} s`, f: silenced / (longest.current || 1) },
    // Aegis armor isn't listed: the health bar already shows it (+N and the armor segment).
    view.mirror[side] > 0 && { k: 'mirror', label: `Mirror ${(view.mirror[side] / 1000).toFixed(1)} s`, f: view.mirror[side] / MIRROR_MS },
    view.shroud[side] > 0 && { k: 'shroud', label: `Shroud ${(view.shroud[side] / 1000).toFixed(1)} s`, f: view.shroud[side] / SHROUD_MS },
    view.guard[side] > 0 && { k: 'guard', label: `Guarded ${(view.guard[side] / 1000).toFixed(1)} s`, f: view.guard[side] / TWILIGHT_MS },
    view.exposed[side] > 0 && { k: 'exposed', label: `Exposed ${(view.exposed[side] / 1000).toFixed(1)} s`, f: view.exposed[side] / TWILIGHT_MS },
    view.fog[side] > 0 && { k: 'fog', label: `Steam ${(view.fog[side] / 1000).toFixed(1)} s`, f: view.fog[side] / STEAM_MS },
    view.noHeal[side] > 0 && { k: 'noheal', label: `No healing ${(view.noHeal[side] / 1000).toFixed(1)} s`, f: view.noHeal[side] / GRAVE.ms },
    view.glacier[side] > 0 && { k: 'glacier', label: `Glacier ${(view.glacier[side] / 1000).toFixed(1)} s`, f: view.glacier[side] / GLACIER_MS },
  ].filter((x): x is { k: string; label: string; f: number } => !!x)
  if (!items.length) return null
  return (
    <div className={`st-timers ${side === 'player' ? 'mine' : ''}`}>
      {items.map((t) => (
        <span key={t.k} className={`st-timer ${t.k}`}>
          <i style={{ width: `${Math.min(1, t.f) * 100}%` }} />
          <span>{t.label}</span>
        </span>
      ))}
    </div>
  )
}
