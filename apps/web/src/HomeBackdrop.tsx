// Home and reading-page background (Nov 25): a night meadow and a dirt trail leading to the tower
// far off on the horizon. You're on the way to the tower.
// One thin horizon, no walls or perspective lines.

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

/** Meadow texture: grass tufts (three blades each), smaller and fainter toward the horizon, and a few small
 *  rocks. No lines, so nothing has to follow a vanishing point. */
function Grass({ w, top, near, n, unit }: { w: number; top: number; near: number; n: number; unit: number }) {
  const r = seeded(11)
  return (
    <g strokeLinecap="round" fill="none">
      {Array.from({ length: n }, (_, i) => {
        const t = Math.pow(r(), 1.6) // more near the horizon, where they are small
        const y = top + 4 * unit + t * (near - top) * 1.3 // full size by `near`, the bottom of the visible ground
        const x = (r() * 3 - 1) * w
        const s = (1.2 + t * 7) * unit * (0.7 + r() * 0.6)
        const light = r() < 0.55
        const op = 0.45 + Math.min(t, 1) * 0.5
        if (r() < 0.06) return <ellipse key={i} cx={x} cy={y} rx={s * 1.1} ry={s * 0.5} fill="#2a2a4c" opacity={op} />
        return (
          <path key={i} d={`M${x - s * 0.6} ${y} q${s * 0.1} ${-s * 0.8} ${-s * 0.4} ${-s * 1.3} M${x} ${y} l0 ${-s * 1.6} M${x + s * 0.6} ${y} q${-s * 0.1} ${-s * 0.8} ${s * 0.4} ${-s * 1.3}`}
            stroke={light ? '#5d6a9a' : '#28304f'} strokeWidth={Math.max(1, s * 0.22)} opacity={op} />
        )
      })}
    </g>
  )
}

type Scene = { pre: string; w: number; h: number; top: number; near: number; tower: [number, number]; path: [number, number] }

/** The ground meeting the night sky at one thin horizon line (`top`), the tower standing on it, and a soft path
 *  from the bottom of the picture (`path`: its centre and width there) up to the tower's door. */
function Ground({ pre, w, h, top, near, tower: [tx, th], path: [pc, pw] }: Scene) {
  const k = th / 286 // the tower art is 286 tall (y 14 to 300 in its 200x300 box)
  const door = tx + 100 * k, dw = 30 * k
  const bottom = h // the path runs on under the menu
  return (
    <g>
      <Stars w={w} top={top} n={Math.round(w / 3.3)} unit={Math.max(1, w / 800)} />
      <rect x={-w} y={top - h * 0.08} width={w * 3} height={h * 0.08} fill={`url(#${pre}-haze)`} />
      <g transform={`translate(${tx} ${top - 300 * k}) scale(${k})`}>
        <path d="M38 300 L42 104 L24 104 L100 14 L176 104 L158 104 L162 300 Z M100 14 L104 2 L100 -2 L96 2 Z" fill="#120d2b" />
        <path d="M38 104 h124 v8 h-124 Z" fill="#0c0920" />
        <rect x="50" y="140" width="12" height="20" rx="6" fill="#ffb04a" opacity=".75" />
        <rect x="138" y="176" width="12" height="20" rx="6" fill="#ffb04a" opacity=".6" />
        <rect x="52" y="236" width="12" height="20" rx="6" fill="#ffb04a" opacity=".5" />
      </g>
      <rect x={-w} y={top} width={w * 3} height={h * 2 - top} fill="#333a5e" />
      <Grass w={w} top={top} near={near} n={Math.round(w / 1.6)} unit={Math.max(1, w / 800)} />
      <path
        d={`M${door - dw / 2} ${top} C${door - dw} ${top + (bottom - top) * 0.4} ${pc - pw / 2} ${top + (bottom - top) * 0.6} ${pc - pw / 2} ${bottom}
            L${pc + pw / 2} ${bottom} C${pc + pw / 2} ${top + (bottom - top) * 0.6} ${door + dw} ${top + (bottom - top) * 0.4} ${door + dw / 2} ${top} Z`}
        fill={`url(#${pre}-path)`}
      />
      <rect x={-w} y={top} width={w * 3} height={h * 2 - top} fill={`url(#${pre}-floor)`} />
      <rect x={-w} y={top} width={w * 3} height={Math.max(1.5, h * 0.002)} fill="#4a5583" opacity="0.6" />
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
      {/* The trail: dusty, a little lighter than the grass, fading out toward the tower. */}
      <linearGradient id={`${pre}-path`} x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stopColor="#8a7a9a" stopOpacity="0.08" />
        <stop offset="1" stopColor="#8a7a9a" stopOpacity="0.32" />
      </linearGradient>
    </defs>
  )
}

const WIDE: Scene = { pre: 'hbw', w: 1600, h: 900, top: 510, near: 900, tower: [1340, 260], path: [1040, 520] }
const TALL: Scene = { pre: 'hbt', w: 375, h: 812, top: 246, near: 380, tower: [230, 110], path: [187, 230] }

export function HomeBackdrop() {
  return (
    <div className="home-backdrop" aria-hidden>
      {/* Wide screens: the menu on the left, the tower on the right. Pinned right, so narrower windows lose the empty left side. */}
      <svg className="hb-wide" viewBox="0 0 1600 900" preserveAspectRatio="xMaxYMax slice">
        <Defs pre="hbw" />
        <Ground {...WIDE} />
        <rect width="1600" height="900" fill="#0c091e" opacity="0.3" />
      </svg>
      {/* Phones upright: brand row on top, menu at the bottom, the horizon in the band between. Fit, not fill, and
          pinned to the top, so the band stays put; the ground and sky run on past the sides. */}
      <svg className="hb-tall" viewBox="0 0 375 812" preserveAspectRatio="xMidYMin meet">
        <Defs pre="hbt" />
        <Ground {...TALL} />
        <rect x="-375" width="1125" height="1624" fill="#0c091e" opacity="0.3" />
      </svg>
    </div>
  )
}
