// Accounts: sign in with Google or Discord (no passwords), sessions, and the player's name and portrait.
// Design and the reasons: plans/accounts.md ("Signing in", "Sessions").
//
// Session: 32 random bytes in an HttpOnly cookie (page scripts can't read it), Secure on HTTPS, SameSite=Lax.
// The database keeps only its SHA-256. Requests that change anything (POST) must come from our own page
// (Origin check), so another site can't act with your cookie.
import { createHash, randomBytes } from 'node:crypto'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { Discord, Google, decodeIdToken, generateCodeVerifier, generateState, type OAuth2Tokens } from 'arctic'
import { db } from './db.ts'
import { totalsOf } from './totals.ts'
import { PLACEMENTS } from '../apps/web/src/ranks.ts'
import { LADDER } from '../apps/web/src/battle.ts'

const PUBLIC_URL = (process.env.PUBLIC_URL || 'http://localhost:8787').replace(/\/$/, '')
const SECURE = PUBLIC_URL.startsWith('https:')
const SID = 'sid'
const SESSION_DAYS = 30
const RENEW_DAYS = 15 // a session with less than this left is extended when used
const NAME_RE = /^[A-Za-z0-9_]{3,16}$/
const NAME_CHANGE_DAYS = 30
const TOWER = LADDER.map((l) => l.id as string)
const DEFAULT_PORTRAIT = 'apprentice'
/** Portraits a player may use: the Apprentice, and each Tower wizard they've beaten. */
const portraitOk = (p: string, beaten: string[]) => p === DEFAULT_PORTRAIT || beaten.includes(p)
const MAX_BODY = 2048
// Local testing without OAuth keys: DEV_LOGIN=1 in server/.env, and only on a localhost PUBLIC_URL.
const DEV_LOGIN = process.env.DEV_LOGIN === '1' && /^http:\/\/localhost(:\d+)?$/.test(PUBLIC_URL)

const env = (k: string) => process.env[k] || ''
const google = env('GOOGLE_CLIENT_ID') && env('GOOGLE_CLIENT_SECRET') ? new Google(env('GOOGLE_CLIENT_ID'), env('GOOGLE_CLIENT_SECRET'), `${PUBLIC_URL}/auth/google/callback`) : null
const discord = env('DISCORD_CLIENT_ID') && env('DISCORD_CLIENT_SECRET') ? new Discord(env('DISCORD_CLIENT_ID'), env('DISCORD_CLIENT_SECRET'), `${PUBLIC_URL}/auth/discord/callback`) : null

export interface Account {
  id: string
  username: string | null // null until they pick one
  portrait: string
  beaten: string[] // Tower wizards beaten (ids)
}

const sha256 = (t: string) => createHash('sha256').update(t).digest('hex')

function cookies(req: IncomingMessage): Record<string, string> {
  const out: Record<string, string> = {}
  for (const part of (req.headers.cookie ?? '').split(';')) {
    const i = part.indexOf('=')
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim())
  }
  return out
}
const setCookie = (name: string, value: string, maxAgeSec: number, path = '/') =>
  `${name}=${encodeURIComponent(value)}; Path=${path}; Max-Age=${maxAgeSec}; HttpOnly; SameSite=Lax${SECURE ? '; Secure' : ''}`

function json(res: ServerResponse, status: number, body: unknown, headers: Record<string, string | string[]> = {}) {
  res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...headers }).end(JSON.stringify(body))
}
function redirect(res: ServerResponse, to: string, headers: Record<string, string | string[]> = {}) {
  res.writeHead(302, { Location: to, 'Cache-Control': 'no-store', ...headers }).end()
}

/** The page that sent this request (or opened this socket) is ours: same host, or the public site. */
export function sameOrigin(req: IncomingMessage) {
  const o = req.headers.origin
  return !!o && (o === PUBLIC_URL || o === `http://${req.headers.host}` || o === `https://${req.headers.host}`)
}

// A small per-address limit on sign-in and API requests (the socket has its own, in index.ts).
const hits = new Map<string, { n: number; since: number }>()
function tooMany(req: IncomingMessage) {
  const fwd = req.headers['x-forwarded-for']
  const ip = (Array.isArray(fwd) ? fwd[0] : fwd)?.split(',')[0].trim() || req.socket.remoteAddress || '?'
  const now = Date.now()
  const h = hits.get(ip)
  if (!h || now - h.since > 60_000) {
    if (hits.size > 10_000) hits.clear()
    hits.set(ip, { n: 1, since: now })
    return false
  }
  return ++h.n > 60
}

async function readJson(req: IncomingMessage): Promise<Record<string, unknown> | null> {
  let size = 0
  const chunks: Buffer[] = []
  for await (const c of req) {
    size += (c as Buffer).length
    if (size > MAX_BODY) return null
    chunks.push(c as Buffer)
  }
  try {
    const v = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')
    return v && typeof v === 'object' ? v : null
  } catch {
    return null
  }
}

/** The signed-in account for a request (an API call, or the WebSocket upgrade), or null. */
export async function accountOf(req: IncomingMessage): Promise<(Account & { renew: boolean }) | null> {
  const token = cookies(req)[SID]
  if (!token || token.length > 64) return null
  const r = await db.query(
    `SELECT u.id, u.username, u.portrait, u.tower_beaten, s.expires_at FROM sessions s JOIN users u ON u.id = s.user_id
     WHERE s.token_hash = $1 AND s.expires_at > now()`,
    [sha256(token)],
  )
  const row = r.rows[0]
  if (!row) return null
  const renew = new Date(row.expires_at).getTime() - Date.now() < RENEW_DAYS * 86400_000
  if (renew) await db.query(`UPDATE sessions SET expires_at = now() + interval '${SESSION_DAYS} days' WHERE token_hash = $1`, [sha256(token)])
  return { id: String(row.id), username: row.username, portrait: row.portrait, beaten: row.tower_beaten ?? [], renew }
}

/** A new session for `userId`, as its cookie. Signing in always makes a new token (and drops the old one). */
async function newSession(req: IncomingMessage, userId: string) {
  const old = cookies(req)[SID]
  if (old) await db.query('DELETE FROM sessions WHERE token_hash = $1', [sha256(old)])
  const token = randomBytes(32).toString('base64url')
  await db.query(`INSERT INTO sessions (token_hash, user_id, expires_at) VALUES ($1, $2, now() + interval '${SESSION_DAYS} days')`, [sha256(token), userId])
  return setCookie(SID, token, SESSION_DAYS * 86400)
}

/** The user for this sign-in account, made on first sign-in (no name yet: they pick it next). */
async function userFor(provider: string, providerId: string, email: string | null, displayName: string | null): Promise<string> {
  const found = await db.query('SELECT user_id FROM identities WHERE provider = $1 AND provider_user_id = $2', [provider, providerId])
  if (found.rows[0]) return String(found.rows[0].user_id)
  const client = await db.connect()
  try {
    await client.query('BEGIN')
    const u = await client.query('INSERT INTO users DEFAULT VALUES RETURNING id')
    const id = String(u.rows[0].id)
    await client.query('INSERT INTO identities (provider, provider_user_id, user_id, email, display_name) VALUES ($1, $2, $3, $4, $5)', [provider, providerId, id, email, displayName])
    await client.query('COMMIT')
    return id
  } catch (err) {
    await client.query('ROLLBACK')
    throw err
  } finally {
    client.release()
  }
}

/** A name to offer on the "Make your wizard" screen, from the sign-in account's display name. */
async function suggestedName(userId: string) {
  const r = await db.query('SELECT display_name FROM identities WHERE user_id = $1 ORDER BY created_at LIMIT 1', [userId])
  const base = String(r.rows[0]?.display_name ?? '').replace(/[^A-Za-z0-9_]/g, '').slice(0, 16)
  return base.length >= 3 ? base : ''
}

type Provider = 'google' | 'discord'
const providers = { google, discord }

function startSignIn(res: ServerResponse, p: Provider) {
  const state = generateState()
  const verifier = generateCodeVerifier()
  const url = p === 'google' ? google!.createAuthorizationURL(state, verifier, ['openid', 'profile', 'email']) : discord!.createAuthorizationURL(state, verifier, ['identify', 'email'])
  // The state and PKCE verifier ride in short-lived cookies; the callback must bring back the same state.
  redirect(res, url.toString(), { 'Set-Cookie': [setCookie('oauth_state', state, 600, '/auth'), setCookie('oauth_verifier', verifier, 600, '/auth')] })
}

async function finishSignIn(req: IncomingMessage, res: ServerResponse, p: Provider, query: URLSearchParams) {
  const c = cookies(req)
  const clear = [setCookie('oauth_state', '', 0, '/auth'), setCookie('oauth_verifier', '', 0, '/auth')]
  const code = query.get('code')
  if (!code || !c.oauth_state || query.get('state') !== c.oauth_state || !c.oauth_verifier) return redirect(res, `${PUBLIC_URL}/?signin=failed`, { 'Set-Cookie': clear })
  try {
    let tokens: OAuth2Tokens
    let id: string, email: string | null, name: string | null
    if (p === 'google') {
      tokens = await google!.validateAuthorizationCode(code, c.oauth_verifier)
      // The ID token came straight from Google over TLS with our secret, so its claims can be read as is.
      const claims = decodeIdToken(tokens.idToken()) as { sub: string; email?: string; name?: string }
      ;[id, email, name] = [claims.sub, claims.email ?? null, claims.name ?? null]
    } else {
      tokens = await discord!.validateAuthorizationCode(code, c.oauth_verifier)
      const r = await fetch('https://discord.com/api/users/@me', { headers: { Authorization: `Bearer ${tokens.accessToken()}` } })
      if (!r.ok) throw new Error(`Discord /users/@me ${r.status}`)
      const me = (await r.json()) as { id: string; email?: string; username?: string; global_name?: string }
      ;[id, email, name] = [me.id, me.email ?? null, me.global_name ?? me.username ?? null]
    }
    const userId = await userFor(p, id, email, name)
    redirect(res, `${PUBLIC_URL}/`, { 'Set-Cookie': [...clear, await newSession(req, userId)] })
  } catch (err) {
    console.error(`${p} sign-in failed`, (err as Error).message)
    redirect(res, `${PUBLIC_URL}/?signin=failed`, { 'Set-Cookie': clear })
  }
}

/** Handles /auth/* and /api/*; false = not ours (the caller serves the page). */
export async function handleAuth(req: IncomingMessage, res: ServerResponse, enabled: boolean): Promise<boolean> {
  const url = new URL(req.url ?? '/', 'http://x')
  const path = url.pathname
  if (!path.startsWith('/auth/') && !path.startsWith('/api/')) return false
  if (tooMany(req)) return json(res, 429, { error: 'Too many requests. Try again in a minute.' }), true
  if (!enabled) return json(res, 503, { error: 'Accounts are off on this server.' }), true
  const method = req.method ?? 'GET'
  if (method === 'POST' && !sameOrigin(req)) return json(res, 403, { error: 'Bad origin.' }), true

  // Sign-in start and the provider's redirect back.
  const m = path.match(/^\/auth\/(google|discord)(\/callback)?$/)
  if (m && method === 'GET') {
    const p = m[1] as Provider
    if (!providers[p]) return json(res, 503, { error: `${p} sign-in isn't set up on this server.` }), true
    if (m[2]) await finishSignIn(req, res, p, url.searchParams)
    else startSignIn(res, p)
    return true
  }

  if (path === '/auth/dev' && method === 'POST' && DEV_LOGIN) {
    const body = await readJson(req)
    const name = String(body?.name ?? 'Tester').replace(/[^A-Za-z0-9_]/g, '').slice(0, 16) || 'Tester'
    const userId = await userFor('dev', name.toLowerCase(), null, name)
    json(res, 200, { ok: true }, { 'Set-Cookie': await newSession(req, userId) })
    return true
  }

  if (path === '/auth/logout' && method === 'POST') {
    const token = cookies(req)[SID]
    if (token) await db.query('DELETE FROM sessions WHERE token_hash = $1', [sha256(token)])
    json(res, 200, { ok: true }, { 'Set-Cookie': setCookie(SID, '', 0) })
    return true
  }

  const me = await accountOf(req)
  const renewCookie: Record<string, string> = me?.renew ? { 'Set-Cookie': setCookie(SID, cookies(req)[SID], SESSION_DAYS * 86400) } : {}

  if (path === '/api/me' && method === 'GET') {
    const account = me && { id: me.id, username: me.username, portrait: me.portrait, beaten: me.beaten }
    const suggested = me && !me.username ? await suggestedName(me.id) : undefined
    // Ranked 1v1: your rating (or none yet), and the Casual matches that unlock it.
    let ranked = null
    let ranked2 = null
    if (me) {
      const [t, r1, r2] = await Promise.all([totalsOf(me.id), standing(me.id, 'ranked1v1'), standing(me.id, 'ranked2v2')])
      const casualPlayed = t.casual_wins + t.casual_losses
      ranked = { ...r1, casualPlayed }
      ranked2 = { ...r2, casualPlayed }
    }
    json(res, 200, { account, suggested, ranked, ranked2, signIn: { google: !!google, discord: !!discord, dev: DEV_LOGIN } }, renewCookie)
    return true
  }
  // A wizard's profile (public: anyone can look, signed in or not). Never the email or sign-in provider.
  if (path === '/api/profile' && method === 'GET') {
    const name = String(url.searchParams.get('name') ?? '').toLowerCase()
    const u = await db.query('SELECT id, username, portrait, created_at, tower_beaten FROM users WHERE username_lower = $1', [name])
    const user = u.rows[0]
    if (!user) return json(res, 404, { error: 'No wizard by that name.' }), true
    json(res, 200, await profileOf(user), renewCookie)
    return true
  }
  // Find wizards by name (public): names starting with what was typed, closest first. limit: SUGGEST_MAX while
  // typing, SEARCH_MAX after Enter.
  if (path === '/api/search' && method === 'GET') {
    const q = String(url.searchParams.get('q') ?? '').toLowerCase().replace(/[^a-z0-9_]/g, '').slice(0, 16)
    if (q.length < 2) return json(res, 200, { results: [] }), true
    const limit = Math.min(SEARCH_MAX, Math.max(1, Number(url.searchParams.get('limit')) || SUGGEST_MAX))
    const r = await db.query(
      `SELECT u.username, u.portrait, r.rating, r.games FROM users u LEFT JOIN ratings r ON r.user_id = u.id AND r.queue = 'ranked1v1'
       WHERE u.username_lower LIKE $1 ORDER BY u.username_lower LIMIT ${limit}`,
      [q.replace(/_/g, '\\_') + '%'],
    )
    const results = r.rows.map((x) => ({ name: x.username, portrait: x.portrait, rating: x.games >= PLACEMENTS ? Math.round(x.rating) : null }))
    json(res, 200, { results }, renewCookie)
    return true
  }
  if (!me) return json(res, 401, { error: 'Not signed in.' }), true

  if (path === '/auth/logout-all' && method === 'POST') {
    await db.query('DELETE FROM sessions WHERE user_id = $1', [me.id])
    json(res, 200, { ok: true }, { 'Set-Cookie': setCookie(SID, '', 0) })
    return true
  }

  // Tower progress: wizards beaten, added to what the account has (the browser reports it; the Tower runs
  // in the browser, so this is trusted like a high score; it only unlocks portraits).
  if (path === '/api/progress' && method === 'POST') {
    const body = await readJson(req)
    const add = Array.isArray(body?.beaten) ? body.beaten.map(String).filter((id) => TOWER.includes(id)) : []
    const r = await db.query(
      `UPDATE users SET tower_beaten = ARRAY(SELECT DISTINCT unnest(tower_beaten || $2::text[])) WHERE id = $1 RETURNING tower_beaten`,
      [me.id, add],
    )
    json(res, 200, { beaten: r.rows[0]?.tower_beaten ?? me.beaten }, renewCookie)
    return true
  }

  // Your recent matches (newest first): result, mode, who else played, your stats.
  if (path === '/api/matches' && method === 'GET') {
    const r = await db.query(
      `SELECT m.id, m.mode, m.size, m.started_at, m.ended_at, m.ended_by, m.finisher, me.won, me.team, me.stats,
         (SELECT json_agg(json_build_object('name', o.name, 'team', o.team, 'guest', o.user_id IS NULL) ORDER BY o.team, o.name)
            FROM match_players o WHERE o.match_id = m.id AND o.user_id IS DISTINCT FROM me.user_id) AS others
       FROM match_players me JOIN matches m ON m.id = me.match_id
       WHERE me.user_id = $1 ORDER BY me.match_id DESC LIMIT 20`,
      [me.id],
    )
    json(res, 200, { matches: r.rows }, renewCookie)
    return true
  }

  // Name and portrait. The first name is free; after that, one change every NAME_CHANGE_DAYS.
  if (path === '/api/me' && method === 'POST') {
    const body = await readJson(req)
    if (!body) return json(res, 400, { error: 'Bad request.' }), true
    const portrait = body.portrait === undefined ? me.portrait : String(body.portrait)
    if (portrait !== me.portrait && !portraitOk(portrait, me.beaten)) return json(res, 400, { error: 'Beat that wizard in the Tower to use their portrait.' }), true
    let username = me.username
    if (body.username !== undefined && String(body.username) !== me.username) {
      const name = String(body.username)
      if (!NAME_RE.test(name)) return json(res, 400, { error: 'Use 3 to 16 letters, numbers or _.' }), true
      if (me.username) {
        const r = await db.query('SELECT username_changed_at FROM users WHERE id = $1', [me.id])
        const at = r.rows[0]?.username_changed_at ? new Date(r.rows[0].username_changed_at).getTime() : 0
        const next = at + NAME_CHANGE_DAYS * 86400_000
        if (Date.now() < next) return json(res, 429, { error: `You can change your name again on ${new Date(next).toDateString()}.` }), true
      }
      username = name
    }
    try {
      const changed = username !== me.username
      await db.query(
        `UPDATE users SET username = $2, username_lower = lower($2), portrait = $3,
           username_changed_at = CASE WHEN $4 AND $5 THEN now() ELSE username_changed_at END WHERE id = $1`,
        [me.id, username, portrait, changed, me.username !== null],
      )
    } catch (err) {
      if ((err as { code?: string }).code === '23505') return json(res, 409, { error: 'That name is taken.' }), true
      throw err
    }
    json(res, 200, { account: { id: me.id, username, portrait, beaten: me.beaten } }, renewCookie)
    return true
  }

  json(res, 404, { error: 'Not found.' })
  return true
}

// ---- Profile: the player's running totals (server/totals.ts), ranks, and their last RECENT matches.
const RECENT = 20
const SEARCH_MAX = 20 // after Enter
const SUGGEST_MAX = 5 // while typing
interface Row { id: string; mode: string; size: string; ended_at: string; finisher: string | null; won: boolean; rating_before: number | null; rating_after: number | null; others: { name: string; guest: boolean; mine: boolean }[] | null }
async function profileOf(user: { id: string; username: string; portrait: string; created_at: string; tower_beaten: string[] }) {
  const [t, ranked, ranked2, r] = await Promise.all([
    totalsOf(user.id),
    standing(user.id, 'ranked1v1'),
    standing(user.id, 'ranked2v2'),
    // Newest first by match id (the (user_id, match_id) index), RECENT at most.
    db.query(
      `SELECT m.id, m.mode, m.size, m.ended_at, m.finisher, me.won, me.rating_before, me.rating_after,
         (SELECT json_agg(json_build_object('name', o.name, 'guest', o.user_id IS NULL, 'mine', o.team = me.team) ORDER BY o.team, o.name)
            FROM match_players o WHERE o.match_id = me.match_id AND o.user_id IS DISTINCT FROM me.user_id) AS others
       FROM match_players me JOIN matches m ON m.id = me.match_id
       WHERE me.user_id = $1 ORDER BY me.match_id DESC LIMIT ${RECENT}`,
      [user.id],
    ),
  ])
  const rows = r.rows as Row[]
  return {
    username: user.username,
    portrait: user.portrait,
    since: user.created_at,
    towerBeaten: user.tower_beaten.length,
    towerTotal: TOWER.length,
    ranked,
    ranked2,
    record: { ranked: { wins: t.ranked_wins, losses: t.ranked_losses }, casual: { wins: t.casual_wins, losses: t.casual_losses }, bestStreak: t.best_streak },
    casting: {
      casts: t.casts,
      drawings: t.drawings,
      readRate: t.drawings + t.fizzles ? t.drawings / (t.drawings + t.fizzles) : null,
      parries: t.parries,
      silences: t.silences,
    },
    recent: rows.map((x) => ({
      id: x.id,
      mode: x.mode,
      size: x.size,
      at: x.ended_at,
      won: x.won,
      change: x.rating_before != null && x.rating_after != null ? x.rating_after - x.rating_before : null,
      finisher: x.finisher,
      foes: (x.others ?? []).filter((o) => !o.mine).map((o) => ({ name: o.name, guest: o.guest })),
      mates: (x.others ?? []).filter((o) => o.mine).map((o) => ({ name: o.name, guest: o.guest })),
    })),
  }
}

/** A Ranked queue's standing: rating (null until the first match), games, wins, peak. */
async function standing(userId: string, queue: 'ranked1v1' | 'ranked2v2') {
  const r = await db.query(`SELECT rating, games, wins, peak FROM ratings WHERE user_id = $1 AND queue = $2`, [userId, queue])
  const row = r.rows[0]
  return { rating: row ? Math.round(row.rating) : null, games: row?.games ?? 0, wins: row?.wins ?? 0, peak: row?.peak ? Math.round(row.peak) : null }
}
