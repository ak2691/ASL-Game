// Per-player running totals (Nov 27): the profile's record, casting stats and badges, kept up to date as each
// match is saved, so a profile is one row to read instead of every match a player ever played.
import { db } from './db.ts'

interface Stats {
  casts?: number
  castMsTotal?: number
  fastestMs?: number | null
  drawings?: number
  fizzles?: number
  parries?: number
  silences?: number
  healed?: number
  byElement?: Record<string, number>
  bySpell?: Record<string, number>
}
export interface Totals {
  casual_wins: number
  casual_losses: number
  ranked_wins: number
  ranked_losses: number
  streak: number
  best_streak: number
  casts: number
  cast_ms_total: number
  fastest_ms: number | null
  drawings: number
  fizzles: number
  parries: number
  silences: number
  by_element: Record<string, number>
  by_spell: Record<string, number>
  badges: string[]
}
const EMPTY: Totals = { casual_wins: 0, casual_losses: 0, ranked_wins: 0, ranked_losses: 0, streak: 0, best_streak: 0, casts: 0, cast_ms_total: 0, fastest_ms: null, drawings: 0, fizzles: 0, parries: 0, silences: 0, by_element: {}, by_spell: {}, badges: [] }

/** One match into the totals (pure: used by saving and by the backfill). */
function add(t: Totals, mode: string, won: boolean, _endedBy: string, st: Stats): Totals {
  const n = (x: unknown) => (Number.isFinite(Number(x)) ? Number(x) : 0)
  const merge = (a: Record<string, number>, b: Record<string, number> | undefined) => {
    const out = { ...a }
    for (const [k, v] of Object.entries(b ?? {})) out[k] = (out[k] ?? 0) + n(v)
    return out
  }
  const streak = won ? t.streak + 1 : 0
  const fast = st.fastestMs == null ? null : n(st.fastestMs)
  return {
    casual_wins: t.casual_wins + (mode === 'casual' && won ? 1 : 0),
    casual_losses: t.casual_losses + (mode === 'casual' && !won ? 1 : 0),
    ranked_wins: t.ranked_wins + (mode === 'ranked' && won ? 1 : 0),
    ranked_losses: t.ranked_losses + (mode === 'ranked' && !won ? 1 : 0),
    streak,
    best_streak: Math.max(t.best_streak, streak),
    casts: t.casts + n(st.casts),
    cast_ms_total: t.cast_ms_total + n(st.castMsTotal),
    fastest_ms: fast == null ? t.fastest_ms : t.fastest_ms == null ? fast : Math.min(t.fastest_ms, fast),
    drawings: t.drawings + n(st.drawings),
    fizzles: t.fizzles + n(st.fizzles),
    parries: t.parries + n(st.parries),
    silences: t.silences + n(st.silences),
    by_element: merge(t.by_element, st.byElement),
    by_spell: merge(t.by_spell, st.bySpell),
    badges: t.badges, // unused since Nov 28 (no badges for now)
  }
}

const COLS = Object.keys(EMPTY) as (keyof Totals)[]
async function write(q: { query: typeof db.query }, userId: string, t: Totals) {
  const vals = COLS.map((k) => (k === 'by_element' || k === 'by_spell' ? JSON.stringify(t[k]) : t[k]))
  await q.query(
    `INSERT INTO player_totals (user_id, ${COLS.join(', ')}) VALUES ($1, ${COLS.map((_, i) => `$${i + 2}`).join(', ')})
     ON CONFLICT (user_id) DO UPDATE SET ${COLS.map((k) => `${k} = EXCLUDED.${k}`).join(', ')}`,
    [userId, ...vals],
  )
}

/** A saved match into this player's totals (row locked, so two matches ending at once both count). */
export async function addMatchToTotals(userId: string, mode: string, won: boolean, endedBy: string, stats: Stats) {
  const client = await db.connect()
  try {
    await client.query('BEGIN')
    await client.query('INSERT INTO player_totals (user_id) VALUES ($1) ON CONFLICT DO NOTHING', [userId])
    const r = await client.query('SELECT * FROM player_totals WHERE user_id = $1 FOR UPDATE', [userId])
    await write(client, userId, add({ ...EMPTY, ...r.rows[0] }, mode, won, endedBy, stats))
    await client.query('COMMIT')
  } catch (err) {
    await client.query('ROLLBACK')
    throw err
  } finally {
    client.release()
  }
}

export async function totalsOf(userId: string): Promise<Totals> {
  const r = await db.query('SELECT * FROM player_totals WHERE user_id = $1', [userId])
  return r.rows[0] ? { ...EMPTY, ...r.rows[0], cast_ms_total: Number(r.rows[0].cast_ms_total) } : EMPTY
}

/** Matches saved before this table existed: players with matches and no totals row get one (oldest first). */
export async function backfillTotals() {
  const users = await db.query(`SELECT DISTINCT mp.user_id FROM match_players mp LEFT JOIN player_totals t ON t.user_id = mp.user_id WHERE mp.user_id IS NOT NULL AND t.user_id IS NULL`)
  for (const { user_id } of users.rows) {
    const rows = await db.query(`SELECT m.mode, m.ended_by, mp.won, mp.stats FROM match_players mp JOIN matches m ON m.id = mp.match_id WHERE mp.user_id = $1 ORDER BY mp.match_id`, [user_id])
    let t = EMPTY
    for (const x of rows.rows) t = add(t, x.mode, x.won, x.ended_by, x.stats ?? {})
    await write(db, String(user_id), t)
  }
  if (users.rowCount) console.log(`player totals: filled in ${users.rowCount} players`)
}
