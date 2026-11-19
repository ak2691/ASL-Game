// Hand trackers: both turn a video frame into 21 hand points (same format), so the rest
// of the app doesn't care which one runs. Switchable in the header for side-by-side testing.
//   new: MediaPipe Tasks "Hand Landmarker" (current library)
//   old: MediaPipe "Hands" (older library, 2021-2023, likely what fingerspelling.xyz uses)
import { FilesetResolver, HandLandmarker, type NormalizedLandmark } from '@mediapipe/tasks-vision'

export type TrackerKind = 'new' | 'old'

export interface HandTracker {
  /** Returns the hand's 21 points for this frame, or null if no hand was found. */
  detect(frame: HTMLVideoElement | HTMLCanvasElement, now: number): Promise<NormalizedLandmark[] | null>
}

// ---- New: MediaPipe Tasks Hand Landmarker ---------------------------------------------

const TASKS_WASM = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm'
const TASKS_MODEL =
  'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task'

async function createNewTracker(): Promise<HandTracker> {
  const fileset = await FilesetResolver.forVisionTasks(TASKS_WASM)
  const landmarker = await HandLandmarker.createFromOptions(fileset, {
    baseOptions: { modelAssetPath: TASKS_MODEL, delegate: 'GPU' },
    runningMode: 'VIDEO',
    numHands: 1,
    // Finding a hand from scratch needs a visible palm, so once we have a hand we want to keep it.
    // Detection stays moderate (avoids "hands" in the background), but the "still a hand?"
    // thresholds are low so tracking holds on through fast moves and rotations.
    minHandDetectionConfidence: 0.3,
    minHandPresenceConfidence: 0.15,
    minTrackingConfidence: 0.15,
  })
  return {
    detect: async (frame, now) => landmarker.detectForVideo(frame, now).landmarks[0] ?? null,
  }
}

// ---- Old: MediaPipe Hands (loaded as a classic script from the CDN) --------------------

const HANDS_VERSION = '0.4.1675469240'
const HANDS_BASE = `https://cdn.jsdelivr.net/npm/@mediapipe/hands@${HANDS_VERSION}`

interface LegacyResults {
  multiHandLandmarks?: NormalizedLandmark[][]
}
interface LegacyHands {
  setOptions(o: Record<string, unknown>): void
  onResults(cb: (r: LegacyResults) => void): void
  initialize(): Promise<void>
  send(input: { image: HTMLVideoElement | HTMLCanvasElement }): Promise<void>
}
declare global {
  interface Window {
    Hands?: new (config: { locateFile: (file: string) => string }) => LegacyHands
  }
}

function loadScript(src: string) {
  return new Promise<void>((resolve, reject) => {
    const s = document.createElement('script')
    s.src = src
    s.crossOrigin = 'anonymous'
    s.onload = () => resolve()
    s.onerror = () => reject(new Error(`Couldn't load ${src}`))
    document.head.appendChild(s)
  })
}

async function createOldTracker(): Promise<HandTracker> {
  if (!window.Hands) await loadScript(`${HANDS_BASE}/hands.js`)
  const hands = new window.Hands!({ locateFile: (file) => `${HANDS_BASE}/${file}` })
  hands.setOptions({
    maxNumHands: 1,
    modelComplexity: 1, // 0 = lite (faster), 1 = full (more accurate)
    minDetectionConfidence: 0.5, // the old library's defaults
    minTrackingConfidence: 0.5,
  })
  let latest: NormalizedLandmark[] | null = null
  hands.onResults((r) => {
    latest = r.multiHandLandmarks?.[0] ?? null
  })
  await hands.initialize()
  return {
    detect: async (frame) => {
      await hands.send({ image: frame }) // results arrive via onResults before this resolves
      return latest
    },
  }
}

// ---- Shared ------------------------------------------------------------------------------

const cache: Partial<Record<TrackerKind, Promise<HandTracker>>> = {}
export function getTracker(kind: TrackerKind): Promise<HandTracker> {
  return (cache[kind] ??= kind === 'new' ? createNewTracker() : createOldTracker())
}
