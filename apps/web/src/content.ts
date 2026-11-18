// Test words. Every letter appears at least once (J and Z are checked by motion, see motion.ts).
export const WORDS = [
  'zap', 'zone', 'maze', 'blaze', 'haze', 'jet', 'joy', 'jump', 'jade', 'jinx',
  'fire', 'stone', 'water', 'light', 'storm', 'ice', 'wall', 'heal', 'book', 'tree',
  'cat', 'dog', 'sun', 'rain', 'wind', 'rock', 'bird', 'fish', 'moon', 'star',
  'cold', 'hot', 'blue', 'red', 'leaf', 'cloud', 'sky', 'wave', 'mist', 'frost',
  'spark', 'plant', 'quake', 'quest', 'axe', 'fox', 'box', 'hex', 'deep', 'pixel',
]

export function randomWords(count: number): string[] {
  const out: string[] = []
  for (let i = 0; i < count; i++) out.push(WORDS[Math.floor(Math.random() * WORDS.length)])
  return out
}

// Short handshape descriptions (placeholder until we have properly licensed pictures).
export const GUIDE: Record<string, string> = {
  A: 'Fist, thumb resting against the side of your index finger.',
  B: 'Flat hand, fingers together and pointing up, thumb folded across the palm.',
  C: 'Curve your fingers and thumb into a C shape.',
  D: 'Index finger up; other fingertips curve to touch the thumb.',
  E: 'Fingers bent down so the fingertips rest on the thumb tucked underneath.',
  F: 'Index fingertip touches the thumb; other three fingers up and spread.',
  G: 'Index finger and thumb point sideways, parallel; palm facing you.',
  H: 'Index and middle fingers together, pointing sideways.',
  I: 'Fist with the pinky pointing up.',
  J: 'Make I (pinky up), then draw a J with your pinky: move it down and hook it to the side.',
  K: 'Index and middle fingers up in a V, thumb touching the middle finger.',
  L: 'Index finger up and thumb out: an L shape.',
  M: 'Thumb tucked under your first three fingers. Tip: angle your palm slightly sideways so the camera can see your thumb.',
  N: 'Thumb tucked under your first two fingers. Tip: angle your palm slightly sideways so the camera can see your thumb.',
  O: 'All fingertips curve to touch the thumb, making an O.',
  P: 'Like K, but pointing down. Tip: really point your middle finger toward the floor, or it looks like K.',
  Q: 'Like G, but pointing down.',
  R: 'Cross your middle finger over your index finger, pointing up.',
  S: 'Fist with the thumb across the front of your fingers.',
  T: 'Fist with the thumb tucked between your index and middle fingers. Tip: turn your palm slightly sideways (about 45°) so the camera can see your thumb.',
  U: 'Index and middle fingers up, held together.',
  V: 'Index and middle fingers up, spread apart.',
  W: 'Index, middle and ring fingers up and spread.',
  X: 'Index finger bent into a hook; other fingers in a fist.',
  Y: 'Thumb and pinky out; other fingers folded.',
  Z: 'Point your index finger up, then draw a Z in the air: across, diagonally back down, across again.',
}
