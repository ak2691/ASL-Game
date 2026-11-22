// Every spell shape as a 40×40 SVG path (y down), plus a suggested start point. Used by the cast
// guide, the tutorial, and the AI's drawing (sampled along the path). Must match how
// ml/synth_shapes.py draws each shape.

/** Three-petal rose (r = cos 3θ), one petal pointing up. */
function trefoilPath() {
  const pts: string[] = []
  for (let i = 0; i <= 90; i++) {
    const th = (Math.PI * i) / 90
    const r = 16 * Math.cos(3 * th)
    pts.push(`${(20 + r * Math.cos(th - Math.PI / 2)).toFixed(1)} ${(21 + r * Math.sin(th - Math.PI / 2)).toFixed(1)}`)
  }
  return `M${pts.join(' L')}`
}

/** Shroud: three cursive loops (a prolate cycloid), fitted into the box. Returns the path and its start. */
function veilPath(): [string, [number, number]] {
  const raw: [number, number][] = []
  for (let i = 0; i <= 160; i++) {
    const t = -0.6 + ((2 * Math.PI * 2.5 + 1.6) * i) / 160
    raw.push([t - 2 * Math.sin(t), 2 * Math.cos(t)])
  }
  const xs = raw.map((p) => p[0]), ys = raw.map((p) => p[1])
  const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)]
  const k = 36 / (x1 - x0)
  const pts = raw.map(([x, y]): [number, number] => [2 + (x - x0) * k, 20 - ((y0 + y1) / 2) * k + y * k])
  return [`M${pts.map((p) => `${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join(' L')}`, pts[0]]
}
const VEIL = veilPath()

export const SHAPE_PATHS: Record<string, string> = {
  line: 'M6 34 L34 6',
  w: 'M4 8 L12 32 L20 14 L28 32 L36 8',
  hourglass: 'M8 6 L32 6 L8 34 L32 34 Z',
  star: 'M20 4 L29.4 32.9 L4.8 15.1 L35.2 15.1 L10.6 32.9 Z',
  flame: 'M8.7 21.9 A12 12 0 1 0 31.3 21.9 A12 12 0 0 0 8.7 21.9 L11 6 L15 14.5 L18.5 4 L22 14 L25.5 4 L29 14.5 L32 6 L31.3 21.9',
  cage: 'M8 8 L32 8 L32 32 L8 32 L8 8 L32 32 L32 8 L8 32',
  zigzag7: 'M3 8 L8 32 L13 14 L18 32 L23 14 L28 32 L33 14 L38 32',
  battlements: 'M3 30 L3 14 L9 14 L9 30 L15 30 L15 14 L21 14 L21 30 L27 30 L27 14 L33 14 L33 30',
  circle: 'M20 6 A14 14 0 1 1 19.9 6',
  spiral: 'M20 20 A2 2 0 0 1 24 20 A4 4 0 0 1 16 20 A6 6 0 0 1 28 20 A8 8 0 0 1 12 20 A10 10 0 0 1 32 20 A12 12 0 0 1 8 20 A14 14 0 0 1 36 20',
  // Holy
  aegis: 'M20 36 L20 5 L34 5 C34 20 29 29 20 36 C11 29 6 20 6 5 L20 5',
  mirror: 'M20 20 C25 11 37 11 37 20 C37 29 25 29 20 20 C15 11 3 11 3 20 C3 29 15 29 20 20',
  // Unholy
  scythe: 'M12 39 L18 4 C28 0 39 8 35 21 C33 14 26 10 20 13 L7 25 L25 26.5',
  veil: VEIL[0],
  blade: 'M6 24 L34 37 L34 24 L6 24 L6 12 L20 12 L20 3 L20 12 L34 12 L34 24',
  // Combos
  volcano: 'M3 36 L14 20 L17 20 L18 11 A4 4 0 1 1 22 11 L23 20 L26 20 L37 36',
  cloud: 'M19 22 L35 22 A4 6 0 0 0 27 22 A6 9 0 0 0 15 22 A4 6 0 0 0 5 22 L19 22 L14 29 L22 29 L16 38',
  trefoil: trefoilPath(),
  yinyang: 'M20 4 A16 16 0 1 1 19.9 4 A8 8 0 0 1 20 20 A8 8 0 0 0 20 36',
}

export const SHAPE_STARTS: Record<string, [number, number]> = {
  line: [6, 34],
  w: [4, 8],
  hourglass: [8, 6],
  star: [20, 4],
  flame: [8.7, 21.9],
  cage: [8, 8],
  zigzag7: [3, 8],
  battlements: [3, 30],
  spiral: [20, 20],
  circle: [20, 6],
  aegis: [20, 36],
  mirror: [20, 20],
  scythe: [12, 39],
  veil: VEIL[1],
  blade: [6, 24],
  volcano: [3, 36],
  cloud: [19, 22],
  trefoil: [20, 21],
  yinyang: [20, 4],
}

/** Points along a shape's guide path, in drawing order (browser only: uses an SVG element). */
export function samplePath(shape: string, n = 120): { x: number; y: number }[] {
  const el = document.createElementNS('http://www.w3.org/2000/svg', 'path')
  el.setAttribute('d', SHAPE_PATHS[shape])
  const L = el.getTotalLength()
  return Array.from({ length: n + 1 }, (_, i) => {
    const p = el.getPointAtLength((L * i) / n)
    return { x: p.x / 40, y: p.y / 40 }
  })
}
