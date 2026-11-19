// Our own letter classifier (trained by ml/train_letters.py). Hand tracking lives in trackers.ts.
import type { NormalizedLandmark } from '@mediapipe/tasks-vision'

const LETTER_MODEL_URL = '/models/letters.json'

export type Hand = 'right' | 'left'

/** One dense layer: out = activation(in · W + b). W is stored row-major [inputs × outputs]. */
export interface Dense {
  w: Float32Array
  b: Float32Array
  inputs: number
  outputs: number
  activation: 'relu' | 'softmax'
}

export interface Recognizer {
  layers: Dense[]
  labels: string[]
  pairs: [number, number][] // point pairs whose distances are extra features
  dims: number // 3 = x/y/z per point; 2 = x/y only (no depth: live-webcam depth differs from the training photos)
}

interface ModelJson {
  labels: string[]
  pairs: [number, number][]
  dims?: number
  layers: { inputs: number; outputs: number; activation: Dense['activation']; w: number[]; b: number[] }[]
}

// The model is a tiny 77 → 128 → 64 → 24 network, so we run it in plain TypeScript.
export async function loadRecognizer(): Promise<Recognizer> {
  const model = (await fetch(LETTER_MODEL_URL).then((r) => r.json())) as ModelJson
  const layers = model.layers.map((l) => ({ ...l, w: Float32Array.from(l.w), b: Float32Array.from(l.b) }))
  return { layers, labels: model.labels, pairs: model.pairs, dims: model.dims ?? 3 }
}

export function runLayer(layer: Dense, input: Float32Array): Float32Array {
  const out = new Float32Array(layer.outputs)
  for (let o = 0; o < layer.outputs; o++) {
    let sum = layer.b[o]
    for (let i = 0; i < layer.inputs; i++) sum += input[i] * layer.w[i * layer.outputs + o]
    out[o] = sum
  }
  if (layer.activation === 'relu') {
    for (let o = 0; o < out.length; o++) if (out[o] < 0) out[o] = 0
  } else {
    let max = -Infinity
    for (const v of out) max = Math.max(max, v)
    let total = 0
    for (let o = 0; o < out.length; o++) total += out[o] = Math.exp(out[o] - max)
    for (let o = 0; o < out.length; o++) out[o] /= total
  }
  return out
}

export interface Prediction {
  letter: string // most likely letter
  confidence: number // its probability
  prob: (letter: string) => number // probability of any letter (0 if the model doesn't know it)
  top: (n: number) => { letter: string; prob: number }[] // the n most likely letters
}

export function classify(rec: Recognizer, landmarks: NormalizedLandmark[], hand: Hand): Prediction {
  // Same normalization as training: wrist at the origin, scaled so wrist → middle knuckle = 1.
  // The model was trained on mirrored copies too, so both hands work; for left-handed
  // players we still mirror to the side most of the training data came from.
  const w = landmarks[0]
  const flip = hand === 'left' ? -1 : 1
  const scale = Math.hypot(landmarks[9].x - w.x, landmarks[9].y - w.y) || 1
  const d = rec.dims
  let x = new Float32Array(21 * d + rec.pairs.length)
  landmarks.forEach((p, i) => {
    x[i * d] = (flip * (p.x - w.x)) / scale
    x[i * d + 1] = (p.y - w.y) / scale
    if (d === 3) x[i * d + 2] = (p.z - w.z) / scale
  })
  // Extra features: distances between fingertips, and from the thumb tip to each knuckle.
  rec.pairs.forEach(([a, b], k) => {
    const dz = d === 3 ? x[a * 3 + 2] - x[b * 3 + 2] : 0
    x[21 * d + k] = Math.hypot(x[a * d] - x[b * d], x[a * d + 1] - x[b * d + 1], dz)
  })
  for (const layer of rec.layers) x = runLayer(layer, x)

  let best = 0
  for (let i = 1; i < x.length; i++) if (x[i] > x[best]) best = i
  const probs = x
  return {
    letter: rec.labels[best],
    confidence: probs[best],
    prob: (letter) => {
      const i = rec.labels.indexOf(letter)
      return i < 0 ? 0 : probs[i]
    },
    top: (n) =>
      Array.from(probs, (prob, i) => ({ letter: rec.labels[i], prob }))
        .sort((a, b) => b.prob - a.prob)
        .slice(0, n),
  }
}
