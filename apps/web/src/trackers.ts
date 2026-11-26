// Hand tracking: MediaPipe Tasks "Hand Landmarker" turns a video frame into 21 hand points.
import { FilesetResolver, HandLandmarker, type Landmark, type NormalizedLandmark } from '@mediapipe/tasks-vision'

export interface HandTracker {
  /** Returns the hand's 21 points for this frame, or null if no hand was found. */
  detect(frame: HTMLVideoElement | HTMLCanvasElement, now: number): Promise<NormalizedLandmark[] | null>
  /** Every hand found this frame (up to the tracker's hand count): screen points, and the same points
   *  in true 3D (meters, around the hand), which don't flatten when a finger points at the camera. */
  detectAll(frame: HTMLVideoElement | HTMLCanvasElement, now: number): Promise<{ image: NormalizedLandmark[][]; world: Landmark[][]; handed: Handed[] }>
}
/** Which hand MediaPipe thinks it is, as it labels it ('Left' / 'Right'), and how sure (0..1). MediaPipe
 *  assumes a mirrored (selfie) image; ours isn't, so its label is the player's other hand (see SpellPage). */
export interface Handed {
  label: 'Left' | 'Right' | null
  score: number
}

const TASKS_WASM = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm'
const TASKS_MODEL =
  'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task'

async function createNewTracker(numHands: number): Promise<HandTracker> {
  const fileset = await FilesetResolver.forVisionTasks(TASKS_WASM)
  const landmarker = await HandLandmarker.createFromOptions(fileset, {
    baseOptions: { modelAssetPath: TASKS_MODEL, delegate: 'GPU' },
    runningMode: 'VIDEO',
    numHands,
    // Finding a hand from scratch needs a visible palm, so once we have a hand we want to keep it.
    // Detection stays moderate (avoids "hands" in the background), but the "still a hand?"
    // thresholds are low so tracking holds on through fast moves and rotations.
    minHandDetectionConfidence: 0.3,
    // Nov 25: were 0.15. That low, after a fast blurred move tracking could latch onto a ghost (a copy of
    // the other hand, a smudge) and never look for the real hand again until it moved. A lost hand is
    // found again within a frame or two anyway.
    minHandPresenceConfidence: 0.3,
    minTrackingConfidence: 0.3,
  })
  return {
    detect: async (frame, now) => landmarker.detectForVideo(frame, now).landmarks[0] ?? null,
    detectAll: async (frame, now) => {
      const r = landmarker.detectForVideo(frame, now)
      const handed = r.landmarks.map((_, i): Handed => {
        const c = r.handedness?.[i]?.[0]
        return { label: c?.categoryName === 'Left' || c?.categoryName === 'Right' ? c.categoryName : null, score: c?.score ?? 0 }
      })
      return { image: r.landmarks, world: r.worldLandmarks, handed }
    },
  }
}

const cache: Record<number, Promise<HandTracker>> = {}
/** One hand (letter practice, one-hand casting) or two (sign with one, draw with the other). */
export const getTracker = (numHands: 1 | 2 = 1) => (cache[numHands] ??= createNewTracker(numHands))
