// Home background (Nov 25): a duel on open ground under the night sky, seen over your shoulder. You've
// just signed W and drawn Tidal Wave's spiral; the enemy across from you has signed F and drawn Meteor. Both draw with the player's
// drawing hand (you from behind: on its own side; the enemy faces you: on the other side), so the picture
// also shows what the Draw with setting does. One thin horizon with the tower far off on it; no walls or perspective lines.
import type { Hand } from './recognition'
import { SHAPE_PATHS } from './shapePaths'
import { ELEMENTS } from './spells'

const W = ELEMENTS.W.color
const F = ELEMENTS.F.color
const ONE = 13.2 / 25.9 // asl-one.svg width / height
const TIP: [number, number] = [0.47, 0.03] // its fingertip, as a fraction of its box
// Where each drawing ends, in its 40x40 box: the finger sits there.
const END: Record<string, [number, number]> = { spiral: [36, 20], flame: [31.3, 21.9] }

/** Same random numbers every load, so the stars and stones never jump around. */
function seeded(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** Extra stars above the horizon, a few warm ones among them. */
function Stars({ w, top, n, unit }: { w: number; top: number; n: number; unit: number }) {
  const r = seeded(7)
  return (
    <g>
      {Array.from({ length: n }, (_, i) => {
        const big = r() < 0.12
        return <circle key={i} cx={(r() * 3 - 1) * w} cy={r() * (top - 12 * unit)} r={(big ? 1.6 : 0.6 + r() * 0.7) * unit} fill={r() < 0.2 ? '#ffe9a8' : '#fff'} opacity={0.35 + r() * 0.6} />
      })}
    </g>
  )
}

/** Flat ground texture: scattered stones and pebbles, smaller and fainter toward the horizon. No lines, so
 *  nothing has to follow a vanishing point. */
function Stones({ w, top, near, n, unit }: { w: number; top: number; near: number; n: number; unit: number }) {
  const r = seeded(11)
  return (
    <g>
      {Array.from({ length: n }, (_, i) => {
        const t = Math.pow(r(), 1.6) // more near the horizon, where they are small
        const y = top + 4 * unit + t * (near - top) * 1.3 // full size by `near`, the bottom of the visible ground
        const rx = (1.5 + t * 9) * unit * (0.6 + r() * 0.8)
        const light = r() < 0.5
        return (
          <g key={i} opacity={0.5 + Math.min(t, 1) * 0.5}>
            <ellipse cx={(r() * 3 - 1) * w} cy={y} rx={rx} ry={rx * 0.38} fill={light ? '#6a5ba3' : '#2c2350'} />
          </g>
        )
      })}
    </g>
  )
}

/** The ground: open stone under the page's own night sky, meeting it at one thin horizon line (`top`).
 *  A faint glow sits on the horizon so the edge reads without a heavy line. */
function Ground({ pre, w, h, top, near, tower: [tx, th] }: { pre: string; w: number; h: number; top: number; near: number; tower: [number, number] }) {
  const k = th / 286 // the tower art is 286 tall (y 14 to 300 in its 200x300 box)
  return (
    <g>
      <Stars w={w} top={top} n={Math.round(w / 3.3)} unit={Math.max(1, w / 800)} />
      <rect x={-w} y={top - h * 0.08} width={w * 3} height={h * 0.08} fill={`url(#${pre}-haze)`} />
      {/* The tower far off, standing on the horizon (same shape as on the Spellbook pages). */}
      <g transform={`translate(${tx} ${top - 300 * k}) scale(${k})`} opacity="0.85">
        <path d="M38 300 L42 104 L24 104 L100 14 L176 104 L158 104 L162 300 Z M100 14 L104 2 L100 -2 L96 2 Z" fill="#120d2b" />
        <path d="M38 104 h124 v8 h-124 Z" fill="#0c0920" />
        <rect x="50" y="140" width="12" height="20" rx="6" fill="#ffb04a" opacity=".75" />
        <rect x="138" y="176" width="12" height="20" rx="6" fill="#ffb04a" opacity=".6" />
        <rect x="52" y="236" width="12" height="20" rx="6" fill="#ffb04a" opacity=".5" />
      </g>
      <rect x={-w} y={top} width={w * 3} height={h * 2 - top} fill="#43376b" />
      <Stones w={w} top={top} near={near} n={Math.round(w / 2)} unit={Math.max(1, w / 800)} />
      <rect x={-w} y={top} width={w * 3} height={h * 2 - top} fill={`url(#${pre}-floor)`} />
      <rect x={-w} y={top} width={w * 3} height={Math.max(1.5, h * 0.002)} fill="#6a5a9e" opacity="0.7" />
    </g>
  )
}

/** One wizard, signing with one hand and drawing with the other. x, y: top-left of the body; s: body width.
 *  The layout is written for a right-handed drawer seen from behind (`front` false) or from the front. */
function Caster(p: { pre: string; id: string; k: 'w' | 'f'; x: number; y: number; s: number; c: string; letter: string; shape: string; sign: [number, number, number]; draw: [number, number, number]; mirror: boolean; floorY?: number }) {
  const { x, y, s, c } = p
  const cx = x + s / 2
  const [sx, sy, sh] = p.sign // sign image: left, top, height
  const [dx, dy, ds] = p.draw // drawing box: left, top, size
  const [ex, ey] = END[p.shape]
  const fh = ds * 0.62, fw = fh * ONE
  const tipX = dx + (ex * ds) / 40, tipY = dy + (ey * ds) / 40
  const rimTo = (dx > cx) !== p.mirror ? 1 : 0 // the side the spell is on lights the body's edge
  return (
    <g transform={p.mirror ? `translate(${2 * cx} 0) scale(-1 1)` : undefined}>
      <defs>
        <linearGradient id={`hb-rim-${p.id}`} x1={1 - rimTo} x2={rimTo}>
          <stop offset="0.55" stopColor="#140f2c" />
          <stop offset="1" stopColor={c} stopOpacity="0.5" />
        </linearGradient>
      </defs>
      <ellipse className={`${p.pre}-soft`} cx={dx + ds / 2} cy={p.floorY ?? y + s * 1.4} rx={ds * 1.1} ry={ds * 0.22} fill={c} opacity="0.35" />
      {p.floorY !== undefined && <ellipse cx={cx} cy={p.floorY} rx={s * 0.45} ry={s * 0.08} fill="#0c0920" opacity="0.6" />}
      <g transform={`translate(${x} ${y}) scale(${s / 100})`} fill={`url(#hb-rim-${p.id})`} stroke={c} strokeOpacity="0.45" strokeWidth="1.2">
        <path d="M5 140 Q10 78 40 70 L60 70 Q90 78 95 140Z" />
        <circle cx="50" cy="54" r="17" />
        <path d="M26 50 Q50 36 74 50 L62 40 L50 0 L38 40Z" />
      </g>
      <image href={`/asl/${p.letter}.svg`} x={sx} y={sy} height={sh} width={sh * 0.6} className={`${p.pre}-inv-${p.k}`} />
      <g transform={`translate(${dx} ${dy}) scale(${ds / 40})`} className={`${p.pre}-glow-${p.k}`}>
        <path d={SHAPE_PATHS[p.shape]} fill="none" stroke={c} strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
      </g>
      <image href="/hands/asl-one.svg" x={tipX - fw * TIP[0]} y={tipY - fh * TIP[1]} width={fw} height={fh} className={`${p.pre}-glow-${p.k}`} />
    </g>
  )
}

function Defs({ pre }: { pre: string }) {
  return (
    <defs>
      {/* The ground darkens into the distance; a soft haze rises off the horizon. */}
      <linearGradient id={`${pre}-floor`} x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stopColor="#1a1438" stopOpacity="0.55" />
        <stop offset="0.6" stopColor="#1a1438" stopOpacity="0" />
      </linearGradient>
      <linearGradient id={`${pre}-haze`} x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stopColor="#7a68c0" stopOpacity="0" />
        <stop offset="1" stopColor="#7a68c0" stopOpacity="0.18" />
      </linearGradient>
      <filter id={`${pre}-soft`} x="-50%" y="-50%" width="200%" height="200%">
        <feGaussianBlur stdDeviation="18" />
      </filter>
      {([['w', W], ['f', F]] as const).map(([k, c]) => (
        <g key={k}>
          <filter id={`${pre}-glow-${k}`} x="-50%" y="-50%" width="200%" height="200%">
            <feDropShadow dx="0" dy="0" stdDeviation="4" floodColor={c} />
          </filter>
          <filter id={`${pre}-inv-${k}`} x="-50%" y="-50%" width="200%" height="200%">
            <feColorMatrix type="matrix" values="-1 0 0 0 1  0 -1 0 0 1  0 0 -1 0 1  0 0 0 1 0" />
            <feDropShadow dx="0" dy="0" stdDeviation="4" floodColor={c} />
          </filter>
        </g>
      ))}
    </defs>
  )
}

export function HomeBackdrop({ hand }: { hand: Hand }) {
  const L = hand === 'left'
  return (
    <div className="home-backdrop" aria-hidden>
      {/* Wide screens: the menu on the left, the duel on the right. Pinned right, so narrower windows lose the empty left side, not the duel. */}
      <svg className="hb-wide" viewBox="0 0 1600 900" preserveAspectRatio="xMaxYMax slice">
        <Defs pre="hbw" />
        <Ground pre="hbw" w={1600} h={900} top={510} near={900} tower={[1340, 230]} />
        <Caster pre="hbw" id="wf" k="f" x={1066} y={384} s={128} c={F} letter="F" shape="flame" sign={[1212, 424, 64]} draw={[976, 388, 80]} mirror={L} floorY={564} />
        <Caster pre="hbw" id="wm" k="w" x={860} y={600} s={420} c={W} letter="W" shape="spiral" sign={[800, 672, 140]} draw={[1180, 636, 176]} mirror={L} />
        <rect width="1600" height="900" fill="#0c091e" opacity="0.3" />
      </svg>
      {/* Phones upright: brand row on top, menu at the bottom; the duel fills the band between them, and the
          menu's top edge is the bottom of the picture. Pinned to the top so the band stays put. */}
      {/* Fit, not fill: a wide portrait screen (a tablet) keeps the duel phone-sized above the menu, and the
          ground and sky run on past the sides. */}
      <svg className="hb-tall" viewBox="0 0 375 812" preserveAspectRatio="xMidYMin meet">
        <Defs pre="hbt" />
        <Ground pre="hbt" w={375} h={812} top={246} near={380} tower={[286, 92]} />
        <Caster pre="hbt" id="tf" k="f" x={183} y={221} s={34} c={F} letter="F" shape="flame" sign={[220, 227, 22]} draw={[142, 215, 28]} mirror={L} floorY={268} />
        <Caster pre="hbt" id="tm" k="w" x={98} y={270} s={150} c={W} letter="W" shape="spiral" sign={[48, 290, 58]} draw={[248, 278, 66]} mirror={L} />
        <rect x="-375" width="1125" height="1624" fill="#0c091e" opacity="0.3" />
      </svg>
    </div>
  )
}
