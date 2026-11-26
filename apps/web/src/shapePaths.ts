// Every spell shape as a 40×40 SVG path (y down), plus a suggested start point. Used by the cast
// guide, the tutorial, and the AI's drawing (sampled along the path). Must match how
// ml/synth_shapes.py draws each shape.

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
  h: 'M9 5 L9 35 L9 20 L31 20 L31 5 L31 35',
  hourglass: 'M8 6 L32 6 L8 34 L32 34 Z',
  star: 'M20 4 L29.4 32.9 L4.8 15.1 L35.2 15.1 L10.6 32.9 Z',
  flame: 'M8.7 21.9 A12 12 0 1 0 31.3 21.9 A12 12 0 0 0 8.7 21.9 L11 6 L15 14.5 L18.5 4 L22 14 L25.5 4 L29 14.5 L32 6 L31.3 21.9',
  cage: 'M8 8 L32 8 L32 32 L8 32 L8 8 L32 32 L32 8 L8 32',
  zigzag7: 'M3 8 L8 32 L13 14 L18 32 L23 14 L28 32 L33 14 L38 32',
  battlements: 'M3 30 L3 14 L9 14 L9 30 L15 30 L15 14 L21 14 L21 30 L27 30 L27 14 L33 14 L33 30',
  circle: 'M29.9 10.1 A14 14 0 1 1 29.8 10 L8.5 31.5', // null sign: the circle, then a diagonal line through it
  spiral: 'M20 20 A2 2 0 0 1 24 20 A4 4 0 0 1 16 20 A6 6 0 0 1 28 20 A8 8 0 0 1 12 20 A10 10 0 0 1 32 20 A12 12 0 0 1 8 20 A14 14 0 0 1 36 20',
  // Angelic
  aegis: 'M20 36 L20 5 L34 5 C34 20 29 29 20 36 C11 29 6 20 6 5 L20 5',
  mirror: 'M20 20 C25 11 37 11 37 20 C37 29 25 29 20 20 C15 11 3 11 3 20 C3 29 15 29 20 20',
  // Unholy
  scythe: 'M12 39 L18 4 C28 0 39 8 35 21 C33 14 26 10 20 13 L7 25 L25 26.5',
  veil: VEIL[0],
  blade: 'M6 24 L34 37 L34 24 L6 24 L6 12 L20 12 L20 3 L20 12 L34 12 L34 24',
  // Combos (plans/combos.md)
  volcano: 'M3 36 L14 20 L17 20 L18 11 A4 4 0 1 1 22 11 L23 20 L26 20 L37 36 L3 36',
  cloud: 'M19 22 L35 22 A3.5 5 0 0 0 28 22 A4 7 0 0 0 20 22 A4 8 0 0 0 12 22 A3.5 5 0 0 0 5 22 L19 22 L14 29 L22 29 L16 38', // Nov 25: four bumps (was three)
  iceberg: 'M2 18 L38 18 L30 18 L24 5 L19 11 L15 7 L9 18 L13 37 L27 37 L31 18',
  yinyang: 'M20 4 A16 16 0 1 1 19.9 4 A8 8 0 0 1 20 20 A8 8 0 0 0 20 36 L20 30.5 A2.5 2.5 0 1 1 19.9 30.5 L20 14.5 A2.5 2.5 0 1 1 19.9 14.5',
  puff: 'M5 15 A5 5 0 0 1 15 15 A5 5 0 0 1 25 15 A5 5 0 0 1 35 15 A5 5 0 0 1 35 25 A5 5 0 0 1 25 25 A5 5 0 0 1 15 25 A5 5 0 0 1 5 25 A5 5 0 0 1 5 15',
  thermo: 'M17 26 L17 6 A3 3 0 0 1 23 6 L23 26 A7 7 0 1 1 17 26 L10 22 L30 17 L11 12 L29 7',
  plasma: 'M20 20 C15 14 15 8 20 6 C25 8 25 14 20 20 C14 22 8 26 7 31 C11 33 17 28 20 20 C23 28 29 33 33 31 C32 26 26 22 20 20 L20 2 A18 18 0 1 1 19.9 2',
  sun: 'M20 4 L22.3 14.7 L32.5 6.2 L26.5 17.3 L37.5 19.4 L26.3 22.6 L34 31.7 L22.7 26.6 L20 37 L17.4 26.4 L6 31.7 L13.7 22.6 L2.5 19.4 L13.5 17.3 L7.5 6.2 L17.7 14.7 L20 4',
  tomb: 'M8 36 L32 36 L32 16 A12 12 0 0 0 8 16 L8 36 L20 36 L20 12 L20 18 L14 18 L26 18',
}

export const SHAPE_STARTS: Record<string, [number, number]> = {
  line: [6, 34],
  h: [9, 5],
  hourglass: [8, 6],
  star: [20, 4],
  flame: [8.7, 21.9],
  cage: [8, 8],
  zigzag7: [3, 8],
  battlements: [3, 30],
  spiral: [20, 20],
  circle: [29.9, 10.1],
  aegis: [20, 36],
  mirror: [20, 20],
  scythe: [12, 39],
  veil: VEIL[1],
  blade: [6, 24],
  volcano: [3, 36],
  cloud: [19, 22],
  iceberg: [2, 18],
  yinyang: [20, 4],
  puff: [5, 15],
  thermo: [17, 26],
  plasma: [20, 20],
  sun: [20, 4],
  tomb: [8, 36],
}

/** Points along a shape's guide path, in drawing order (browser only: uses an SVG element). */
const sampled = new Map<string, { x: number; y: number }[]>()
export function samplePath(shape: string, n = 120): { x: number; y: number }[] {
  // Measuring an SVG path is slow (one walk per point): each shape is measured once, then reused.
  const key = `${shape}:${n}`
  const hit = sampled.get(key)
  if (hit) return hit.map((p) => ({ ...p }))
  const pts = measurePath(shape, n)
  sampled.set(key, pts)
  return pts.map((p) => ({ ...p }))
}
function measurePath(shape: string, n: number): { x: number; y: number }[] {
  const el = document.createElementNS('http://www.w3.org/2000/svg', 'path')
  el.setAttribute('d', SHAPE_PATHS[shape])
  const L = el.getTotalLength()
  return Array.from({ length: n + 1 }, (_, i) => {
    const p = el.getPointAtLength((L * i) / n)
    return { x: p.x / 40, y: p.y / 40 }
  })
}
