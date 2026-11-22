// Player settings saved between visits (home Settings panel and the in-game Esc menu).
import type { Hand } from './recognition'

export const TWO_HANDS_KEY = 'spells-two-hands'
export const DRAW_HAND_KEY = 'spells-draw-hand'
export function loadDrawHand(): Hand {
  try {
    const v = localStorage.getItem(DRAW_HAND_KEY)
    if (v === 'left' || v === 'right') return v
  } catch {
    /* fall through */
  }
  return 'right' // most players are right-handed: the right hand draws, the left signs
}
export function loadTwoHands() {
  try {
    return localStorage.getItem(TWO_HANDS_KEY) !== '0'
  } catch {
    return true
  }
}
