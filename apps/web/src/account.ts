// The signed-in player (or none), from the game server's /api/me. Sign-in itself is a full page visit to
// /auth/google or /auth/discord; the server sets an HttpOnly session cookie this code never sees.
import { useSyncExternalStore } from 'react'

export interface Account {
  id: string
  username: string | null // null until picked ("Make your wizard")
  portrait: string // 'apprentice', or a beaten Tower wizard's id
  beaten: string[] // Tower wizards beaten
}
export interface Me {
  on: boolean // accounts work on this server (false: guests only, no sign-in shown)
  account: Account | null
  suggested?: string // a name to offer, from the sign-in account
  ranked?: Standing | null // Ranked 1v1 (signed in)
  ranked2?: Standing | null // Ranked 2v2
  signIn: { google: boolean; discord: boolean; dev: boolean } // which sign-in buttons work here
}

/** Your Ranked 1v1 standing. rating: null until your first Ranked match. */
export interface Standing {
  rating: number | null
  games: number // placements included
  wins: number
  peak: number | null
  casualPlayed: number // Casual matches played (Ranked opens at RANKED_UNLOCK)
}

const OFF: Me = { on: false, account: null, signIn: { google: false, discord: false, dev: false } }
let me: Me | null = null // null = still asking
const subs = new Set<() => void>()
const set = (m: Me) => {
  me = m
  subs.forEach((f) => f())
}

export async function loadMe() {
  try {
    const r = await fetch('/api/me', { credentials: 'same-origin' })
    set(r.ok ? { on: true, ...(await r.json()) } : OFF)
  } catch {
    set(OFF)
  }
  // Wizards beaten in this browser before signing in go to the account too.
  const a = me?.account
  if (a && localBeaten().some((id) => !a.beaten.includes(id))) await sendBeaten(localBeaten())
}

// ---- Tower progress: wizards beaten (their portraits unlock). Kept in this browser for everyone, and on the
// account when signed in, so it follows you to other devices.
const BEATEN_KEY = 'tower-beaten'
function localBeaten(): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(BEATEN_KEY) ?? '[]')
    return Array.isArray(v) ? v.map(String) : []
  } catch {
    return []
  }
}
let beatenHere = localBeaten()
async function sendBeaten(ids: string[]) {
  const { ok, data } = await post('/api/progress', { beaten: ids })
  if (ok && me?.account) set({ ...me, account: { ...me.account, beaten: data.beaten as string[] } })
}

/** Records a Tower win (an id from LADDER). */
export async function markBeaten(id: string) {
  if (!beatenHere.includes(id)) {
    beatenHere = [...beatenHere, id]
    try {
      localStorage.setItem(BEATEN_KEY, JSON.stringify(beatenHere))
    } catch {
      /* not saved here: the account still gets it */
    }
    if (me) set({ ...me }) // a new value, so pages showing portraits redraw
  }
  if (me?.account && !me.account.beaten.includes(id)) await sendBeaten([id])
}

/** Every Tower wizard you've beaten: this browser's and your account's. */
export function useBeaten(): string[] {
  const m = useMe()
  const a = m?.account?.beaten ?? []
  return [...new Set([...a, ...beatenHere])]
}

/** The current player, kept fresh across the app (null while the first check is still out). */
export function useMe() {
  return useSyncExternalStore(
    (f) => (subs.add(f), () => subs.delete(f)),
    () => me,
  )
}

async function post(path: string, body?: object): Promise<{ ok: boolean; data: Record<string, unknown> }> {
  try {
    const r = await fetch(path, { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body ?? {}) })
    return { ok: r.ok, data: await r.json().catch(() => ({})) }
  } catch {
    return { ok: false, data: { error: "Can't reach the server." } }
  }
}

/** Saves the name and/or portrait. Returns an error to show, or null. */
export async function saveProfile(p: { username?: string; portrait?: string }): Promise<string | null> {
  const { ok, data } = await post('/api/me', p)
  if (!ok) return String(data.error ?? 'Something went wrong.')
  if (me) set({ ...me, account: data.account as Account })
  return null
}

export async function signOut(everywhere = false) {
  await post(everywhere ? '/auth/logout-all' : '/auth/logout')
  await loadMe()
}

/** Local testing only (the server allows it on localhost with DEV_LOGIN=1). */
export async function devSignIn(name: string) {
  const { ok, data } = await post('/auth/dev', { name })
  await loadMe()
  return ok ? null : String(data.error ?? 'Dev sign-in failed.')
}

// ---- Profiles (public; plans/accounts.md "Profile")
export interface Profile {
  username: string
  portrait: string
  since: string
  towerBeaten: number
  towerTotal: number
  ranked: { rating: number | null; games: number; wins: number; peak: number | null }
  ranked2: { rating: number | null; games: number; wins: number; peak: number | null }
  record: { ranked: { wins: number; losses: number }; casual: { wins: number; losses: number }; bestStreak: number }
  casting: { casts: number; drawings: number; readRate: number | null; parries: number; silences: number }
  recent: { id: string; mode: string; size: string; at: string; won: boolean; change: number | null; finisher: string | null; foes: { name: string; guest: boolean }[]; mates: { name: string; guest: boolean }[] }[]
}

/** A wizard's profile by name, or an error to show. */
export async function loadProfile(name: string): Promise<Profile | string> {
  try {
    const r = await fetch(`/api/profile?name=${encodeURIComponent(name)}`, { credentials: 'same-origin' })
    const data = await r.json().catch(() => ({}))
    return r.ok ? (data as Profile) : String(data.error ?? 'Something went wrong.')
  } catch {
    return "Can't reach the server."
  }
}

// ---- Name search (public): wizards whose names start with q, SUGGEST while typing, FULL after Enter. Recent
// answers are kept (a full list also answers suggestions), so typing back over a name doesn't ask again.
export interface Found {
  name: string
  portrait: string
  rating: number | null // Ranked 1v1, once placed
}
const found = new Map<string, Found[]>()
export const SUGGEST = 5
export const FULL = 20
export async function searchWizards(q: string, full: boolean, signal?: AbortSignal): Promise<Found[]> {
  const key = q.toLowerCase().replace(/[^a-z0-9_]/g, '')
  if (key.length < 2) return []
  const want = full ? FULL : SUGGEST
  const hit = found.get(key)
  // A cached list answers if it has enough, or if it was short because that's every match.
  if (hit && (hit.length >= want || hit.length < SUGGEST)) return hit.slice(0, want)
  const r = await fetch(`/api/search?q=${encodeURIComponent(key)}&limit=${want}`, { credentials: 'same-origin', signal })
  const results: Found[] = r.ok ? ((await r.json()).results ?? []) : []
  if (!hit || results.length > hit.length) found.set(key, results)
  if (found.size > 50) found.delete(found.keys().next().value!)
  return results
}
