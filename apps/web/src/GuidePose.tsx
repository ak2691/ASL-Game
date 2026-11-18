import { useEffect, useState } from 'react'
import { HandLandmarker } from '@mediapipe/tasks-vision'
import type { Hand } from './recognition'

type Poses = Record<string, [number, number][]>
let posesPromise: Promise<Poses> | null = null
const loadPoses = () =>
  (posesPromise ??= fetch('/models/guide-poses.json').then((r) => r.json() as Promise<Poses>))

/** A skeleton picture of a typical example of the letter, drawn like the camera's mirror view. */
export function GuidePose({ letter, hand }: { letter: string; hand: Hand }) {
  const [poses, setPoses] = useState<Poses | null>(null)
  useEffect(() => {
    loadPoses().then(setPoses).catch(() => setPoses({}))
  }, [])

  const pose = poses?.[letter]
  if (!pose) return null

  // Mirror x like the camera view (and back again for left-handed players).
  const sx = hand === 'left' ? 1 : -1
  const pts = pose.map(([x, y]) => [sx * x, y])
  const xs = pts.map((p) => p[0])
  const ys = pts.map((p) => p[1])
  const pad = 0.25
  const minX = Math.min(...xs) - pad
  const minY = Math.min(...ys) - pad
  const size = Math.max(Math.max(...xs) - minX, Math.max(...ys) - minY) + pad

  return (
    <svg className="guide-pose" viewBox={`${minX} ${minY} ${size} ${size}`} role="img" aria-label={`Hand shape for ${letter}`}>
      {HandLandmarker.HAND_CONNECTIONS.map(({ start, end }, i) => (
        <line
          key={i}
          x1={pts[start][0]}
          y1={pts[start][1]}
          x2={pts[end][0]}
          y2={pts[end][1]}
          stroke="var(--main)"
          strokeWidth={size * 0.025}
          strokeLinecap="round"
        />
      ))}
      {pts.map(([x, y], i) => (
        <circle key={i} cx={x} cy={y} r={size * (i === 4 ? 0.035 : 0.022)} fill={i === 4 ? 'var(--thumb)' : 'var(--text)'} />
      ))}
    </svg>
  )
}
