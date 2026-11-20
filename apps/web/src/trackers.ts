// Hand tracking: MediaPipe Tasks "Hand Landmarker" turns a video frame into 21 hand points.
import { FilesetResolver, HandLandmarker, type NormalizedLandmark } from '@mediapipe/tasks-vision'

export interface HandTracker {
  /** Returns the hand's 21 points for this frame, or null if no hand was found. */
  detect(frame: HTMLVideoElement | HTMLCanvasElement, now: number): Promise<NormalizedLandmark[] | null>
}

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

let cache: Promise<HandTracker> | null = null
export const getTracker = () => (cache ??= createNewTracker())
