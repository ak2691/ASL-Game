// Status icons: one small line drawing each (24×24, stroked, round caps), used everywhere a status shows:
// on your hand (canvas, Path2D) and in the status row under every health bar (SVG). Pictures first; the only
// words are the short cause under a "can't act" ring. The Info page and the tutorial's Status card list them.

/** "Can't act": one symbol for every cause (a circle with a slash), a ring that drains as the timer, and a
 *  word under it saying why. Recovering after a good parry is the one exception: a green shield, no word. */
const BLOCKED = 'M12 3a9 9 0 1 0 0 18a9 9 0 1 0 0-18 M5.6 5.6l12.8 12.8'
export const HAND_ICONS = {
  fizzled: BLOCKED,
  staggered: BLOCKED,
  interrupted: BLOCKED,
  whiffed: BLOCKED,
  silenced: BLOCKED,
  recover: 'M12 3l7 3v5c0 5-3 8.5-7 10-4-1.5-7-5-7-10V6z M9 12l2 2 4-4',
} as const
/** The word under the ring (none for a parry's recovery). */
export const HAND_WORDS: Record<keyof typeof HAND_ICONS, string> = {
  fizzled: 'FIZZLED',
  staggered: 'STAGGERED',
  interrupted: 'INTERRUPTED',
  whiffed: 'WHIFFED',
  silenced: 'SILENCED',
  recover: '',
}
export type HandState = keyof typeof HAND_ICONS

/** Passive effects (and buffs) in the status row. */
export const ROW_ICONS = {
  chill: 'M12 3v18 M4.2 7.5l15.6 9 M4.2 16.5l15.6-9 M9.5 4.5L12 7l2.5-2.5 M9.5 19.5L12 17l2.5 2.5',
  static: 'M13 2L6 13h5l-2 9 8-12h-5z',
  storm: 'M7 15a4 4 0 0 1 0-8 5 5 0 0 1 9.6-1.2A4 4 0 1 1 17 15z M11 17l-2 4 M15 17l-2 4',
  burn: 'M12 3c3 4 6 6 6 11a6 6 0 0 1-12 0c0-3 2-4 2-6 1 2 2 3 3 3 0-3 0-5 1-8z',
  regen: 'M12 20s-7-4.5-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.5-7 10-7 10z M12 9v6 M9 12h6',
  aegis: 'M12 3l7 3v5c0 5-3 8.5-7 10-4-1.5-7-5-7-10V6z',
  mirror: 'M8 3h8l3 9-3 9H8l-3-9z M10 8l4 4 M10 12l2 2',
  shroud: 'M3 12s3.5-6 9-6 9 6 9 6-3.5 6-9 6-9-6-9-6z M12 10a2 2 0 1 0 0 4a2 2 0 1 0 0-4 M4 4l16 16',
  guard: 'M15 4a8 8 0 1 0 5 13 7 7 0 0 1-5-13z',
  exposed: 'M12 5a7 7 0 1 0 0 14a7 7 0 1 0 0-14 M12 2v5 M12 17v5 M2 12h5 M17 12h5',
  fog: 'M4 8c2-2 4 2 6 0s4 2 6 0 3 1 4 1 M4 13c2-2 4 2 6 0s4 2 6 0 3 1 4 1 M4 18c2-2 4 2 6 0s4 2 6 0 3 1 4 1',
  noHeal: 'M12 20s-7-4.5-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.5-7 10-7 10z M4 4l16 16',
  doom: 'M12 3a7 7 0 0 0-7 7c0 2.5 1.2 4 2.5 5v3.5h9V15c1.3-1 2.5-2.5 2.5-5a7 7 0 0 0-7-7z M8.7 10.5a1.3 1.3 0 1 0 2.6 0a1.3 1.3 0 1 0-2.6 0 M12.7 10.5a1.3 1.3 0 1 0 2.6 0a1.3 1.3 0 1 0-2.6 0 M10.5 18.5v2 M13.5 18.5v2',
  glacier: 'M3 19l6-10 3 4 3-6 6 12z',
} as const
export type RowIcon = keyof typeof ROW_ICONS | HandState

export const iconPath = (k: RowIcon): string => (k in HAND_ICONS ? HAND_ICONS[k as HandState] : ROW_ICONS[k as keyof typeof ROW_ICONS])

/** The one "can't act" symbol, for the legends (every cause shares it). */
export const CANT_ACT_NAME = "Can't act: the word under it says why (fizzled, staggered, interrupted, whiffed, silenced)"
export const LEGEND_HAND: RowIcon[] = ['fizzled', 'recover']

/** What each one means, for the Info page legend and the tutorial's Status card. */
export const ICON_NAMES: Record<RowIcon, string> = {
  fizzled: 'Fizzled: your spell fell apart',
  staggered: 'Staggered: a missed parry',
  interrupted: 'Interrupted: their interrupt hit you',
  whiffed: 'Whiffed: your interrupt missed',
  silenced: 'Silenced: no casting',
  recover: 'Parried: a moment to recover',
  chill: 'Chilled: the next hit does more (the number)',
  static: 'Static: throwing while it’s lit fizzles',
  storm: 'Storm: static that hurts',
  burn: 'Burning',
  regen: 'Regenerating',
  aegis: 'Aegis: armor (the number)',
  mirror: 'Mirror: the next hit goes back',
  shroud: 'Shroud: your spell is hidden',
  guard: 'Guarded: take less damage',
  exposed: 'Exposed: take more damage',
  fog: 'Steam: your next attacks miss',
  noHeal: 'Grave: no healing or armor',
  doom: 'Doom: before it ends, throw a spell at 70% power or higher',
  glacier: 'Glacier on its way',
}
