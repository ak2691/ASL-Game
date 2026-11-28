// Ranked tiers (decided Nov 27, plans/accounts.md "Rating"): wizard names that climb in plain English, on badges
// in the familiar metal order. Each tier has divisions 1 < 2 < 3. Glicko-2 runs underneath (server/glicko.ts);
// this is only how a rating is shown. Shared by the browser and the server.

export const PLACEMENTS = 5 // Ranked matches before a tier shows
export const RANKED_UNLOCK = 5 // Casual matches before Ranked opens (keeps fresh accounts out)
export const START_RATING = 1500

export const TIERS = [
  { name: 'Novice', color: '#c98a4b' }, // bronze
  { name: 'Apprentice', color: '#c7ccd8' }, // silver
  { name: 'Mage', color: '#ffd23f' }, // gold
  { name: 'High Mage', color: '#7fe3d6' }, // platinum
  { name: 'Archmage', color: '#9cc4ff' }, // diamond
] as const
const FIRST = 1000 // Novice 2 starts here; below is Novice 1
const STEP = 100 // points per division (a settled player gains or loses ~10 a match; a new one far more)

export interface Rank {
  tier: (typeof TIERS)[number]['name']
  division: 1 | 2 | 3
  color: string
  label: string // "Mage 3"
  next: number | null // rating the next division starts at (null at the top)
}

/** The tier and division for a rating: 100 points a division, Novice 1 below 1,000, Mage 1 at the 1,500 start,
 *  Archmage 3 from 2,300. */
export function rankOf(rating: number): Rank {
  const step = Math.max(0, Math.min(TIERS.length * 3 - 1, Math.floor((rating - FIRST) / STEP) + 1))
  const t = TIERS[Math.floor(step / 3)]
  const division = ((step % 3) + 1) as 1 | 2 | 3
  const top = step === TIERS.length * 3 - 1
  return { tier: t.name, division, color: t.color, label: `${t.name} ${division}`, next: top ? null : FIRST + step * STEP }
}
