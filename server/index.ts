// Game server: rooms with join codes, and the authoritative fight (HP, shields, traps, timing).
// One WebSocket per player at /ws. Also serves the built web app (apps/web/dist) so one Render
// service hosts everything.
//
// A room holds up to 4 players on two teams (1v1, 1v2, 2v2). The first player is the host and sets
// each player's HP. Players are identified by a token their browser keeps across refreshes (not by the
// socket), so a dropped connection or a refresh can rejoin the same seat within GRACE_MS. If a whole
// team is away the fight pauses; if a teammate is still fighting, it goes on without them. A player
// who doesn't come back in time is out of the match and the room.
import './env.ts' // first: loads server/.env before anything reads process.env
import { createServer } from 'node:http'
import { readFileSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { extname, join, normalize } from 'node:path'
import { fileURLToPath } from 'node:url'
import { monitorEventLoopDelay } from 'node:perf_hooks'
import { WebSocketServer, type WebSocket } from 'ws'
import { Combat, MAX_HP, type Fid, type Side } from '../apps/web/src/combat.ts'
import { COUNTDOWNS, QUICK_CHAT, HP_MAX, HP_MIN, ROOM_MAX, TEAM_MAX, type ClientMsg, type OppEvent, type PartyInfo, type Presence, type QueueInfo, type ServerMsg, type SocialMsg, type StateFields } from '../apps/web/src/protocol.ts'
import { hideShrouded, idsFor, viewFor } from '../apps/web/src/teamView.ts'
import { DuoBots, DUO_HP, DUO_TOP } from '../apps/web/src/duo.ts'
import { readStroke, type Pt, type ShapeModel } from '../apps/web/src/shapes.ts'
import { db, setupDatabase, startCleanup } from './db.ts'
import { addMatchToTotals, backfillTotals, totalsOf } from './totals.ts'
import { NEW_PLAYER, rate, type Glicko } from './glicko.ts'
import { PLACEMENTS, RANKED_UNLOCK } from '../apps/web/src/ranks.ts'
import { accountOf, handleAuth, sameOrigin, type Account } from './auth.ts'
import { createSocial } from './social.ts'

const PORT = Number(process.env.PORT ?? 8787)
const SETUP_MS = 20_000 // every online match (Nov 28: Custom and Duo Tower too): time to turn the camera on...
const ALL_READY_MS = 3_000 // ...cut to this once everyone has pressed Ready
const TICK_MS = 25 // how often a running fight is advanced (spells landing, ticks); local play redraws every frame
const GRACE_MS = 15000 // a disconnected player keeps their seat this long
const MAX_STROKE_PTS = 200 // per message
const MAX_MSG_BYTES = 64 * 1024
// Heartbeat: a connection that dies without closing (phone loses signal) would otherwise keep its
// seat "connected" forever (no pause, no grace timer). Browsers answer pings on their own.
const PING_MS = 20000
const DIST = fileURLToPath(new URL('../apps/web/dist/', import.meta.url))
// Rate limit, per socket: RATE messages a second on average, bursts up to BURST. Extra messages are dropped;
// a socket that keeps flooding (KICK_AT over) is closed. A drawing player sends ~20 a second.
const RATE = 60
const BURST = 120
const KICK_AT = 600
const MAX_PER_IP = 12 // open sockets from one address (a household or a LAN party shares one)
const MAX_INK = 3000 // stroke points kept per drawing
// Drawings: the browser says which spell shape it read, but the server reads the stroke points itself and
// its reading decides (so a spell can't be claimed without drawing it). `npm run dev` passes
// --trust-drawings, so the ?debug cast buttons (example paths, not real strokes) work locally.
const TRUST_DRAWINGS = process.argv.includes('--trust-drawings')
const SHAPES: ShapeModel = (() => {
  const m = JSON.parse(readFileSync(new URL('../apps/web/public/models/shapes.json', import.meta.url), 'utf8'))
  return { labels: m.labels, layers: m.layers.map((l: { w: number[]; b: number[] }) => ({ ...l, w: Float32Array.from(l.w), b: Float32Array.from(l.b) })) }
})()
const drawings = { agreed: 0, overruled: 0 } // for STATS: claimed spell shapes the server's reading agreed with, or not

type Phase = 'lobby' | 'countdown' | 'fighting' | 'over'
interface Seat {
  token: string
  ws: WebSocket | null // null while disconnected
  awayTimer: ReturnType<typeof setTimeout> | null
  team: Side
  ready: boolean
  hp: number // max HP for the next match
  fid: Fid | null // fighter id in the current match (null = not in it)
  forfeit: boolean // voted to forfeit this match
  progress: number // Duo Tower floors this player has cleared (their browser remembers it)
  sent: Record<string, string> // each state field as last sent to this socket (JSON), so only changes go out
  ink: Pt[] // the stroke being drawn, as the browser's recognizer sees it (camera pixels, up to scale)
  player: { userId: string; name: string; portrait: string } | null // signed in (null = a guest)
  chatAt: number // last quick chat line (rate limit)
}
interface Room {
  code: string
  seats: Seat[] // join order; seats[0] is the host
  phase: Phase
  combat: Combat
  timer: ReturnType<typeof setTimeout> | null // countdown or tick
  pausedAt: number | null
  duo: { floor: number } | null // a Duo Tower room: the players (up to 2) against a pair of bots
  bots: DuoBots | null // the pair, during a Duo Tower match
  raw: Record<string, string> // each state field as last built, on the server's ids (JSON): unchanged = nobody needs an update
  quick: boolean // made by quick match (no host settings; a title of its own)
  ranked: boolean // a Ranked match: rated when it ends, and no rematch
  match: MatchRecord | null // the match being played, to save when it ends (not Duo Tower)
  countdownEnds: number // server time the countdown ends (0 = none)
}
/** Who played (taken at the start: a player who leaves is still in the result) and how it ended. */
interface MatchRecord {
  startedAt: Date | null
  players: { fid: Fid; team: Side; userId: string | null; name: string }[]
  endedBy: 'knockout' | 'forfeit' | 'left'
}
const BOT_IDS: [Fid, Fid] = ['b0', 'b1']
const isBot = (id: Fid) => (BOT_IDS as Fid[]).includes(id)
/** The highest Duo Tower floor this room may pick: one past the best anyone here has cleared. */
const unlocked = (room: Room) => Math.min(DUO_TOP, Math.max(0, ...room.seats.map((s) => s.progress)) + 1)

const rooms = new Map<string, Room>()
const seatOfToken = new Map<string, { room: Room; seat: Seat }>()
const tokenOfWs = new Map<WebSocket, string>()
const wsOfToken = new Map<string, Set<WebSocket>>() // the reverse, so finding someone's sockets isn't a scan
function bindToken(ws: WebSocket, token: string) {
  unbindWs(ws)
  tokenOfWs.set(ws, token)
  let set = wsOfToken.get(token)
  if (!set) wsOfToken.set(token, (set = new Set()))
  set.add(ws)
}
function unbindWs(ws: WebSocket) {
  const token = tokenOfWs.get(ws)
  if (token === undefined) return
  tokenOfWs.delete(ws)
  const set = wsOfToken.get(token)
  set?.delete(ws)
  if (set && !set.size) wsOfToken.delete(token)
}

const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789' // no 0/O, 1/I
function newCode() {
  for (;;) {
    const c = Array.from({ length: 4 }, () => CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)]).join('')
    if (!rooms.has(c)) return c
  }
}

/** A player's Duo Tower progress, as their browser reports it (floors cleared, 0..DUO_TOP). */
const progressOf = (n: unknown) => Math.min(DUO_TOP, Math.max(0, Math.round(Number(n) || 0)))
const send = (ws: WebSocket | null | undefined, msg: ServerMsg) => {
  if (ws && ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg))
}
const others = (room: Room, seat: Seat) => room.seats.filter((s) => s !== seat)
const teamSize = (room: Room, t: Side) => room.seats.filter((s) => s.team === t).length

function sendLobby(room: Room) {
  const seats = room.seats.map((s) => ({ team: s.team, ready: s.ready, hp: s.hp, here: !!s.ws, name: s.player?.name ?? guestName(s.token), portrait: s.player?.portrait }))
  const duo = room.duo && { floor: room.duo.floor, unlocked: unlocked(room) }
  room.seats.forEach((s, i) => send(s.ws, { t: 'lobby', code: room.code, seats, you: i, host: 0, duo, quick: room.quick, ranked: room.ranked, counting: room.phase === 'countdown' }))
}

/** Each countdown (ms left) as its end time on the server's clock, so it holds still between events. */
const endTimes = (r: Record<Fid, number>, at: number) => Object.fromEntries(Object.entries(r).map(([id, ms]) => [id, ms > 0 ? at + ms : 0]))

/** The fight, to each player from their side: only the fields that changed since their last update (none = no message). */
const load = { states: 0, stateMs: 0, sent: 0 } // for STATS: sendState calls, time spent in them, messages sent
function sendState(room: Room) {
  const t0 = performance.now()
  load.states++
  const at = room.pausedAt ?? Date.now()
  const view = room.combat.view(at)
  const paused = room.pausedAt !== null
  // Who's disconnected (seat held) or gone (seat removed), so their cards can say so.
  const conn: Record<Fid, 'away' | 'left'> = {}
  for (const f of view.fighters) {
    if (isBot(f.id)) continue
    const seat = room.seats.find((s) => s.fid === f.id)
    if (!seat) conn[f.id] = 'left'
    else if (!seat.ws) conn[f.id] = 'away'
  }
  const botInfo = room.bots?.info(at)
  // Most ticks nothing changed (countdowns are end times, so they hold still): then there's nothing to
  // work out per player, unless someone needs the whole state (just started, or a new socket).
  const raw: Record<string, unknown> = { ...view, paused, conn, bots: botInfo ?? {} }
  for (const k of COUNTDOWNS) raw[k] = endTimes(view[k], at)
  const powerEnds = room.combat.powerEnds(at) // like the countdowns: when each weakened element is back to full power
  raw.power = powerEnds
  let changed = false
  for (const [k, v] of Object.entries(raw)) {
    const j = JSON.stringify(v)
    if (room.raw[k] !== j) {
      room.raw[k] = j
      changed = true
    }
  }
  if (!changed && room.seats.every((s) => !s.fid || s.sent.fighters)) return void (load.stateMs += performance.now() - t0)
  for (const s of room.seats) {
    if (!s.fid || !s.ws || s.ws.readyState !== s.ws.OPEN) continue
    const map = idsFor(view.fighters, s.fid)
    const mine = Object.fromEntries(Object.entries(conn).map(([id, c]) => [map[id] ?? id, c]))
    const bots = botInfo ? Object.fromEntries(Object.entries(botInfo).map(([id, b]) => [map[id] ?? id, b.cast && view.shroud[id] > 0 ? { ...b, cast: null } : b])) : {}
    const names = Object.fromEntries(room.seats.filter((x) => x.fid).map((x) => [map[x.fid!] ?? x.fid!, x.player?.name ?? guestName(x.token)]))
    const fields: StateFields = { ...hideShrouded(viewFor(view, s.fid)), paused, conn: mine, bots, names }
    for (const k of COUNTDOWNS) fields[k] = endTimes(fields[k], at)
    fields.power = Object.fromEntries(Object.entries(powerEnds).map(([id, r]) => [map[id] ?? id, r]))
    // The message is put together from each field's JSON, which is also what's compared.
    let d = ''
    for (const [k, v] of Object.entries(fields)) {
      const j = JSON.stringify(v)
      if (s.sent[k] === j) continue
      s.sent[k] = j
      d += `${d ? ',' : ''}"${k}":${j}`
    }
    if (d) {
      s.ws.send(`{"t":"state","at":${at},"d":{${d}}}`)
      load.sent++
    }
  }
  load.stateMs += performance.now() - t0
}

/** The finished match, into the database (accounts on, not Duo Tower). Runs once: the record is taken off the
 *  room first. A failure is logged and never touches the game. */
async function saveMatch(room: Room) {
  const m = room.match
  room.match = null
  if (!m || !accountsOn || !room.combat.winner) return
  const combat = room.combat
  const count = (t: Side) => m.players.filter((p) => p.team === t).length
  try {
    const mode = room.ranked ? 'ranked' : room.quick ? 'casual' : 'custom'
    const r = await db.query(
      `INSERT INTO matches (mode, size, started_at, ended_by, winner_team, finisher) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
      [mode, `${count('player')}v${count('enemy')}`, m.startedAt, m.endedBy, combat.winner, m.endedBy === 'knockout' ? combat.finisher : null],
    )
    const id = r.rows[0].id
    const ratings = room.ranked ? await rateMatch(m, combat.winner) : new Map<string, { before: number; after: number; games: number }>()
    // Casual from the queue: a hidden rating, only to find closer opponents (never shown, nothing stored per match).
    if (room.quick && !room.ranked) await rateMatch(m, combat.winner, 'casual')
    for (const p of m.players) {
      const rt = p.userId ? ratings.get(p.userId) : undefined
      await db.query(`INSERT INTO match_players (match_id, user_id, name, team, won, rating_before, rating_after, stats) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`, [
        id,
        p.userId,
        p.name,
        p.team,
        p.team === combat.winner,
        rt ? Math.round(rt.before) : null,
        rt ? Math.round(rt.after) : null,
        JSON.stringify(combat.stats[p.fid] ?? {}),
      ])
      if (p.userId) await addMatchToTotals(p.userId, mode, p.team === combat.winner, m.endedBy, combat.stats[p.fid] ?? {})
      // Tell them (any socket they're on now).
      if (rt) for (const s of room.seats) if (s.player?.userId === p.userId) send(s.ws, { t: 'rated', before: Math.round(rt.before), after: Math.round(rt.after), games: rt.games, won: p.team === combat.winner })
    }
  } catch (err) {
    console.error('saving a match failed', (err as Error).message)
  }
}

/** A Ranked result: every rating updated together (Glicko-2, from ratings before the match). 2v2: your own rating,
 *  against the other team's average (plans/accounts.md "Rating"). */
async function rateMatch(m: MatchRecord, winner: Side, hidden?: 'casual') {
  const out = new Map<string, { before: number; after: number; games: number }>()
  const ps = m.players
  const two = ps.filter((p) => p.team === 'player').length
  if (ps.some((p) => !p.userId) || two < 1 || two === ps.length) return out
  const queue = hidden ?? (ps.length === 4 ? 'ranked2v2' : 'ranked1v1')
  const ids = ps.map((p) => p.userId!)
  const client = await db.connect()
  try {
    await client.query('BEGIN')
    for (const id of ids) await client.query(`INSERT INTO ratings (user_id, queue) VALUES ($1, $2) ON CONFLICT DO NOTHING`, [id, queue])
    const rows = await client.query(`SELECT user_id, rating, rd, vol, games FROM ratings WHERE queue = $1 AND user_id = ANY($2) FOR UPDATE`, [queue, ids])
    const cur = new Map<string, Glicko & { games: number }>(rows.rows.map((r) => [String(r.user_id), { rating: r.rating, rd: r.rd, vol: r.vol, games: r.games }]))
    const teamAvg = (t: Side): Glicko => {
      const g = ps.filter((p) => p.team === t).map((p) => cur.get(p.userId!)!)
      const mean = (k: 'rating' | 'rd' | 'vol') => g.reduce((n, x) => n + x[k], 0) / g.length
      return { rating: mean('rating'), rd: mean('rd'), vol: mean('vol') }
    }
    for (const p of ps) {
      const mine = cur.get(p.userId!)!
      const won = p.team === winner
      const next = rate(mine, teamAvg(p.team === 'player' ? 'enemy' : 'player'), won ? 1 : 0)
      const games = mine.games + 1
      await client.query(
        `UPDATE ratings SET rating = $3, rd = $4, vol = $5, games = games + 1, wins = wins + $6,
           peak = CASE WHEN $7 THEN GREATEST(COALESCE(peak, 0), $3) ELSE peak END WHERE user_id = $1 AND queue = $2`,
        [p.userId, queue, next.rating, next.rd, next.vol, won ? 1 : 0, games >= PLACEMENTS],
      )
      out.set(p.userId!, { before: mine.rating, after: next.rating, games })
    }
    await client.query('COMMIT')
  } catch (err) {
    await client.query('ROLLBACK')
    throw err
  } finally {
    client.release()
  }
  return out
}

function stopTimer(room: Room) {
  if (room.timer) clearTimeout(room.timer)
  room.timer = null
}

/** Ready to go: everyone here and ready, and both teams have someone (at most TEAM_MAX each). */
function canStart(room: Room) {
  if (room.duo) return room.seats.length >= 1 && room.seats.length <= TEAM_MAX && room.seats.every((s) => s.ws && s.ready)
  const a = teamSize(room, 'player')
  const b = teamSize(room, 'enemy')
  return a >= 1 && b >= 1 && a <= TEAM_MAX && b <= TEAM_MAX && room.seats.every((s) => s.ws && s.ready)
}

function startCountdown(room: Room) {
  room.phase = 'countdown'
  room.seats.forEach((s) => touchToken(s.token))
  room.seats.forEach((s, i) => {
    s.fid = `f${i}`
    s.forfeit = false
    s.sent = {} // the browser starts the match from a blank view: send everything
    s.ink = []
  })
  if (room.duo) {
    // Duo Tower: the players (fixed HP) against the floor's pair (a little tougher).
    room.combat = new Combat({ fighters: [...room.seats.map((s) => ({ id: s.fid!, team: 'player' as Side, maxHp: MAX_HP })), ...BOT_IDS.map((id) => ({ id, team: 'enemy' as Side, maxHp: DUO_HP }))] })
    room.bots = new DuoBots(room.combat, room.duo.floor, BOT_IDS, room.seats.map((s) => s.fid!))
  } else {
    room.combat = new Combat({ fighters: room.seats.map((s) => ({ id: s.fid!, team: s.team, maxHp: s.hp })) })
    room.bots = null
  }
  room.pausedAt = null
  room.match = room.duo
    ? null
    : { startedAt: null, endedBy: 'knockout', players: room.seats.map((s) => ({ fid: s.fid!, team: s.team, userId: s.player?.userId ?? null, name: s.player?.name ?? guestName(s.token) })) }
  // Setup: everyone sees the arena (HP, opponents) and can try signing and drawing, which counts for nothing;
  // each presses Ready once their camera is on, and the countdown then drops to ALL_READY_MS.
  room.seats.forEach((s) => (s.ready = false))
  const ms = SETUP_MS
  sendLobby(room)
  room.seats.forEach((s) => send(s.ws, { t: 'countdown', ms }))
  sendState(room) // the fighters as they'll start (HP, who's where), shown during the countdown
  room.countdownEnds = Date.now() + ms
  room.timer = setTimeout(() => beginFight(room), ms)
}

function beginFight(room: Room) {
  room.timer = null
  room.bots?.start(Date.now())
  if (room.match) room.match.startedAt = new Date()
  room.phase = 'fighting'
  room.seats.forEach((s) => send(s.ws, { t: 'start' }))
  tick(room)
}

/** Before the fight: this player's camera is on. Everyone ready: start in ALL_READY_MS. */
function readyUp(room: Room, seat: Seat) {
  if (room.phase !== 'countdown' || seat.ready) return
  seat.ready = true
  sendLobby(room)
  if (!room.seats.every((s) => s.ready) || room.countdownEnds - Date.now() <= ALL_READY_MS) return
  stopTimer(room)
  room.countdownEnds = Date.now() + ALL_READY_MS
  room.seats.forEach((s) => {
    send(s.ws, { t: 'countdown', ms: ALL_READY_MS })
    s.sent = {} // the browser clears its view on each countdown: send everything again
  })
  sendState(room)
  room.timer = setTimeout(() => beginFight(room), ALL_READY_MS)
}

function endFight(room: Room) {
  room.seats.forEach((s) => touchToken(s.token))
  stopTimer(room)
  void saveMatch(room)
  room.bots?.update(Date.now()) // their last words
  // Duo Tower: a win clears the floor for everyone in the room, and the next one is up.
  if (room.duo && room.bots && room.combat.winner === 'player') {
    room.seats.forEach((s) => (s.progress = Math.max(s.progress, room.duo!.floor)))
    room.duo.floor = Math.min(DUO_TOP, room.duo.floor + 1)
  }
  sendState(room)
  room.bots = null
  room.phase = 'over'
  room.seats.forEach((s) => (s.ready = false))
  room.pausedAt = null
  sendLobby(room)
}

function tick(room: Room) {
  room.timer = null
  try {
    if (room.pausedAt === null) {
      const now = Date.now()
      room.combat.update(now)
      room.bots?.update(now)
    }
    sendState(room)
    if (room.combat.winner) return endFight(room)
  } catch (err) {
    console.error(`room ${room.code}: tick failed`, err)
  }
  if (rooms.get(room.code) === room && room.phase === 'fighting') room.timer = setTimeout(() => tick(room), TICK_MS)
}

/** Paused while a whole team is away (nobody left on it who's connected and still in). */
function updatePause(room: Room) {
  if (room.phase !== 'fighting') return
  const stuck = (['player', 'enemy'] as Side[]).some((t) => {
    const team = room.seats.filter((s) => s.fid && s.team === t && !room.combat.isOut(s.fid))
    return team.length > 0 && team.every((s) => !s.ws)
  })
  if (stuck && room.pausedAt === null) room.pausedAt = Date.now()
  else if (!stuck && room.pausedAt !== null) {
    room.combat.shift(Date.now() - room.pausedAt)
    room.pausedAt = null
  }
}

/** Forfeit is a team vote: everyone on the team still fighting and connected must vote (a teammate who
 *  left, is away or is out doesn't count). When they all have, the team loses. Returns true if it ended. */
function checkForfeit(room: Room): boolean {
  if (room.phase !== 'fighting') return false
  for (const t of ['player', 'enemy'] as Side[]) {
    const team = room.seats.filter((s) => s.fid && s.team === t)
    const voters = team.filter((s) => s.forfeit)
    if (!voters.length) continue
    const needed = team.filter((s) => s.ws && !room.combat.isOut(s.fid!))
    if (needed.every((s) => s.forfeit)) {
      room.combat.forfeit(voters[0].fid!)
      if (room.match) room.match.endedBy = 'forfeit'
      endFight(room)
      return true
    }
    for (const s of team) send(s.ws, { t: 'forfeitVote', votes: needed.filter((x) => x.forfeit).length, needed: needed.length, mine: s.forfeit })
  }
  return false
}

/** Remove a seat for good. Mid-fight, they're out of the match (their team fights on, if anyone's left). */
function removeSeat(room: Room, seat: Seat, forfeited: boolean) {
  if (!room.seats.includes(seat)) return
  if (seat.awayTimer) clearTimeout(seat.awayTimer)
  seatOfToken.delete(seat.token)
  const fighting = room.phase === 'fighting'
  room.seats = room.seats.filter((s) => s !== seat)
  if (!room.seats.length) {
    stopTimer(room)
    rooms.delete(room.code)
    return
  }
  room.seats.forEach((s) => send(s.ws, { t: 'left', forfeited: forfeited || fighting }))
  if (fighting && seat.fid) {
    if (room.match) room.match.endedBy = 'left'
    room.combat.leave(seat.fid, Date.now())
    updatePause(room)
    if (room.combat.winner) return endFight(room)
    if (checkForfeit(room)) return // they were the vote still missing
    sendState(room)
  } else if (room.phase === 'countdown') {
    stopTimer(room)
    room.phase = 'lobby'
  }
  if (room.phase !== 'fighting') room.seats.forEach((s) => (s.ready = false))
  sendLobby(room)
}

/** A seat's connection dropped (refresh, network): hold it for GRACE_MS. */
function onDisconnect(ws: WebSocket) {
  const token = tokenOfWs.get(ws)
  unbindWs(ws)
  const at = token ? seatOfToken.get(token) : null
  if (!at || at.seat.ws !== ws) return
  const { room, seat } = at
  seat.ws = null
  if (room.phase === 'countdown') {
    // Not started yet: back to the lobby rather than starting with someone missing.
    stopTimer(room)
    room.phase = 'lobby'
    room.seats.forEach((s) => (s.ready = false))
  }
  updatePause(room)
  if (checkForfeit(room)) return
  others(room, seat).forEach((s) => send(s.ws, { t: 'away', ms: GRACE_MS }))
  sendLobby(room)
  seat.awayTimer = setTimeout(() => removeSeat(room, seat, false), GRACE_MS)
}

// ---- Quick match: Casual and Ranked, 1v1 and 2v2, solo or as a party (plans/accounts.md "Matchmaking") ---
// The queue holds entries: a solo player, or a party of 2 (2v2 only). Casual matches in arrival order; Ranked
// by rating, in a window that widens while you wait. 2v2 prefers party vs party, then a party vs two solos,
// then four solos. Everyone gets "Match found" and ACCEPT_MS to Accept; then a room is made and its countdown
// starts. Missing or declining MISS_LIMIT times in a row puts you out for MISS_COOLDOWN_MS; entries that did
// accept go back to the front of the queue.
const ACCEPT_MS = 10_000
const MISS_LIMIT = 2
const MISS_COOLDOWN_MS = 120_000
type Size = '1v1' | '2v2'
type Mode = 'casual' | 'ranked'
interface Member {
  ws: WebSocket
  token: string
  rating: number // Ranked: this queue's rating; Casual: unused
}
interface Entry {
  members: Member[] // 1, or a party of 2
  since: number
  guest: boolean // guests only meet guests; signed-in players only meet signed-in players
  mode: Mode
  size: Size
}
interface Proposal {
  teams: [Entry[], Entry[]]
  accepted: Set<string>
  endsAt: number
  timer: ReturnType<typeof setTimeout>
}
// One line per (mode, size, guests or accounts), oldest first; and each queued token's entry, so lookups are O(1).
const lines = new Map<string, Entry[]>()
const entryByToken = new Map<string, Entry>()
const lineKey = (e: { mode: Mode; size: Size; guest: boolean }) => `${e.mode}|${e.size}|${e.guest ? 'guest' : 'account'}`
function addEntry(e: Entry, front = false) {
  const k = lineKey(e)
  let line = lines.get(k)
  if (!line) lines.set(k, (line = []))
  if (front) line.unshift(e)
  else line.push(e)
  for (const m of e.members) entryByToken.set(m.token, e)
}
function removeEntry(e: Entry) {
  const line = lines.get(lineKey(e))
  const i = line ? line.indexOf(e) : -1
  if (i >= 0) line!.splice(i, 1)
  for (const m of e.members) if (entryByToken.get(m.token) === e) entryByToken.delete(m.token)
}
const proposals = new Map<string, Proposal>() // by each player's token
const misses = new Map<string, { n: number; until: number }>() // n misses in a row; until = cooldown end (0 = none)

const sendQueue = (ws: WebSocket, queue: QueueInfo) => send(ws, { t: 'queue', queue })
const entryOf = (token: string) => entryByToken.get(token)
const tellEntry = (e: Entry, q: QueueInfo) => e.members.forEach((m) => sendQueue(m.ws, q))
const avg = (ms: Member[]) => ms.reduce((n, m) => n + m.rating, 0) / ms.length
const playersOf = (es: Entry[]) => es.flatMap((e) => e.members)
/** Takes your whole entry (your party too) out of the line. */
const dequeue = (token: string) => {
  const e = entryOf(token)
  if (e) removeEntry(e)
  return e
}

/** Ranked: signed in, past the Casual matches that unlock it, then the queue's rating. null = refused (told). */
async function rankedRating(ws: WebSocket, size: Size, tell: WebSocket[]): Promise<number | null> {
  const p = playerOf(ws)
  const refuse = (note: string) => (tell.forEach((w) => sendQueue(w, { state: 'off', note })), null)
  if (!p || !accountsOn) return refuse(tell.length > 1 ? 'Everyone in the party must be signed in for Ranked.' : 'Sign in to play Ranked.')
  const t = await totalsOf(p.userId)
  const n = t.casual_wins + t.casual_losses
  if (n < RANKED_UNLOCK) return refuse(tell.length > 1 ? `${p.name} needs ${RANKED_UNLOCK - n} more Casual matches to unlock Ranked.` : `Play ${RANKED_UNLOCK} Casual matches to unlock Ranked (${n} of ${RANKED_UNLOCK}).`)
  const r = await db.query(`SELECT rating FROM ratings WHERE user_id = $1 AND queue = $2`, [p.userId, size === '2v2' ? 'ranked2v2' : 'ranked1v1'])
  return r.rows[0]?.rating ?? NEW_PLAYER.rating
}

/** Casual's hidden rating (one for 1v1 and 2v2; guests and new players: the start). Only used to match. */
async function casualRating(ws: WebSocket) {
  const p = playerOf(ws)
  if (!p || !accountsOn) return NEW_PLAYER.rating
  const r = await db.query(`SELECT rating FROM ratings WHERE user_id = $1 AND queue = 'casual'`, [p.userId])
  return r.rows[0]?.rating ?? NEW_PLAYER.rating
}

/** Find match, from you or (in a party) your party's leader. */
async function enqueue(ws: WebSocket, token: string, mode: Mode, size: Size) {
  const party = partyOf.get(token)
  if (party && party.tokens.length > 1) {
    if (party.tokens[0] !== token) return sendQueue(ws, { state: 'off', note: 'Your party leader finds matches.' })
    if (size !== '2v2') return sendQueue(ws, { state: 'off', note: 'A party of 2 plays 2v2.' })
  }
  const tokens = party ? party.tokens : [token]
  const found = tokens.map((t) => (t === token ? ws : liveWs(t)))
  if (found.some((s) => !s)) return sendQueue(ws, { state: 'off', note: 'Your teammate is offline.' })
  const socks = found as WebSocket[]
  for (const t of tokens) {
    const m = misses.get(t)
    if (m && m.until > Date.now()) return socks.forEach((w) => sendQueue(w, { state: 'off', note: `${tokens.length > 1 ? 'Your party' : 'You'} missed two matches. Queue again in ${Math.ceil((m.until - Date.now()) / 1000)} s.` }))
    if (proposals.has(t)) return // already answering a match
    const at = seatOfToken.get(t)
    if (at && (at.room.phase === 'fighting' || at.room.phase === 'countdown')) return sendQueue(ws, { state: 'off', note: 'Your teammate is in a match.' })
  }
  const guest = socks.some((w) => !playerOf(w))
  if (guest && mode === 'ranked') return socks.forEach((w) => sendQueue(w, { state: 'off', note: tokens.length > 1 ? 'Everyone in the party must be signed in for Ranked.' : 'Sign in to play Ranked.' }))
  const members: Member[] = []
  try {
    for (let i = 0; i < tokens.length; i++) {
      const rating = mode === 'ranked' ? await rankedRating(socks[i], size, socks) : await casualRating(socks[i])
      if (rating === null) return
      members.push({ ws: socks[i], token: tokens[i], rating })
    }
  } catch (err) {
    console.error('ranked queue failed', (err as Error).message)
    return sendQueue(ws, { state: 'off', note: "Couldn't join Ranked. Try again." })
  }
  // Ranked 2v2: teammates can't be far apart (a strong player carrying a weak one up the ladder).
  if (mode === 'ranked' && members.length === 2) {
    const gap = Math.round(Math.abs(members[0].rating - members[1].rating))
    if (gap > TEAM_GAP) return socks.forEach((w) => sendQueue(w, { state: 'off', note: `Your ratings are ${gap} apart. A Ranked party can be ${TEAM_GAP} apart at most.` }))
  }
  // A second tab on the same account takes the first one's place in line (and that tab is told).
  for (const t of tokens) {
    const before = dequeue(t)
    if (before) for (const m of before.members) if (!socks.includes(m.ws)) sendQueue(m.ws, { state: 'off', note: m.token === t ? 'You queued from another tab.' : undefined })
  }
  const e: Entry = { members, since: Date.now(), guest, mode, size }
  addEntry(e)
  tellEntry(e, { state: 'searching', since: e.since, mode, size })
  tokens.forEach(touchToken)
  matchUp(lineKey(e))
}

/** Ranked: how far apart two ratings may be after waiting `ms`. Starts at ±WINDOW_START, grows WINDOW_STEP every
 *  WINDOW_EVERY_MS, and stops at ±WINDOW_MAX (no anyone-goes: you keep waiting rather than get a mismatch). The
 *  closest rating inside the window is always picked first. */
const WINDOW_START = 50
const WINDOW_STEP = 50
const WINDOW_EVERY_MS = 10_000
const WINDOW_MAX = 400 // reached after 70 s
const window = (ms: number) => Math.min(WINDOW_MAX, WINDOW_START + WINDOW_STEP * Math.floor(ms / WINDOW_EVERY_MS))
/** Casual: the same idea, much looser and faster (speed first): ±200, +100 every 5 s, anyone after 20 s. */
const CASUAL_START = 200
const CASUAL_STEP = 100
const CASUAL_EVERY_MS = 5_000
const CASUAL_ANYONE_MS = 20_000
const casualWindow = (ms: number) => (ms >= CASUAL_ANYONE_MS ? Infinity : CASUAL_START + CASUAL_STEP * Math.floor(ms / CASUAL_EVERY_MS))
// Windows widen with time, so Ranked looks again every couple of seconds while anyone waits.
setInterval(() => {
  for (const [k, line] of lines) if (line.length > 1) matchUp(k)
}, 2000)

/** Ranked 2v2: the most two teammates' ratings may differ (a party, or two solos put together). Nov 27: 400, was 300. */
const TEAM_GAP = 400
const NEAREST = 7 // 2v2: rating neighbours tried around each anchor (C(7,3) = 35 tries, not every 4 of the line)
const ANCHORS = 10 // 2v2: oldest entries tried as anchors per pass

/** The k entries nearest `rating` in a rating-sorted array (binary search, then outwards). */
function nearest(sorted: Entry[], rating: number, k: number, skip: Set<Entry>) {
  let lo = 0
  let hi = sorted.length
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (avg(sorted[mid].members) < rating) lo = mid + 1
    else hi = mid
  }
  const out: Entry[] = []
  let l = lo - 1
  let r = lo
  while (out.length < k && (l >= 0 || r < sorted.length)) {
    const gl = l >= 0 ? rating - avg(sorted[l].members) : Infinity
    const gr = r < sorted.length ? avg(sorted[r].members) - rating : Infinity
    const e = gl <= gr ? sorted[l--] : sorted[r++]
    if (!skip.has(e)) out.push(e)
  }
  return out
}

/** Two teams from one line (oldest first), or null. Casual: the oldest who fit. Ranked: team averages inside
 *  everyone's window, searched by rating (sorted + nearest neighbours) instead of trying every pair. */
function makeTeams(line: Entry[], size: Size, ranked: boolean): [Entry[], Entry[]] | null {
  const now = Date.now()
  const win = (e: Entry) => (ranked ? window : casualWindow)(now - e.since)
  const teamOk = (t: Entry[]) => {
    if (!ranked) return true
    const rs = playersOf(t).map((m) => m.rating)
    return Math.max(...rs) - Math.min(...rs) <= TEAM_GAP
  }
  const fits = (a: Entry[], b: Entry[]) => teamOk(a) && teamOk(b) && Math.abs(avg(playersOf(a)) - avg(playersOf(b))) <= Math.min(...[...a, ...b].map(win))
  const byRating = (es: Entry[]) => [...es].sort((x, y) => avg(x.members) - avg(y.members))
  if (size === '1v1') {
    if (line.length < 2) return null
    // Oldest first: their closest rating neighbour inside both windows (walk out from them; stop past their window).
    const sorted = byRating(line)
    const at = new Map(sorted.map((e, i) => [e, i]))
    for (const a of line) {
      const i = at.get(a)!
      const ra = avg(a.members)
      let best: Entry | null = null
      let gap = Infinity
      for (const dir of [-1, 1]) {
        for (let j = i + dir; j >= 0 && j < sorted.length; j += dir) {
          const g = Math.abs(avg(sorted[j].members) - ra)
          if (g > win(a) || g >= gap) break
          if (g <= win(sorted[j])) {
            best = sorted[j]
            gap = g
            break
          }
        }
      }
      if (best) return [[a], [best]]
    }
    return null
  }
  const parties = line.filter((e) => e.members.length === 2)
  const solos = line.filter((e) => e.members.length === 1)
  // Party vs party: each party (oldest first) against its nearest-rated parties.
  const partiesSorted = byRating(parties)
  for (const p of parties.slice(0, ANCHORS)) for (const q of nearest(partiesSorted, avg(p.members), NEAREST, new Set([p]))) if (fits([p], [q])) return [[p], [q]]
  // A party vs two solos near its rating.
  const solosSorted = byRating(solos)
  for (const p of parties.slice(0, ANCHORS)) {
    const near = nearest(solosSorted, avg(p.members), NEAREST, new Set())
    for (let i = 0; i < near.length; i++) for (let j = i + 1; j < near.length; j++) if (fits([p], [near[i], near[j]])) return [[p], [near[i], near[j]]]
  }
  // Four solos: an anchor (oldest first) and three of its nearest, split the fairest way that keeps teammates close.
  for (const a of solos.slice(0, ANCHORS)) {
    const near = nearest(solosSorted, avg(a.members), NEAREST, new Set([a]))
    for (let i = 0; i < near.length; i++)
      for (let j = i + 1; j < near.length; j++)
        for (let k = j + 1; k < near.length; k++) {
          const q = byRating([a, near[i], near[j], near[k]])
          const splits: [Entry[], Entry[]][] = [
            [[q[0], q[3]], [q[1], q[2]]],
            [[q[0], q[2]], [q[1], q[3]]],
            [[q[0], q[1]], [q[2], q[3]]],
          ]
          const gap = ([x, y]: [Entry[], Entry[]]) => Math.abs(avg(playersOf(x)) - avg(playersOf(y)))
          const best = splits.filter(([x, y]) => fits(x, y)).sort((p, r) => gap(p) - gap(r))[0]
          if (best) return best
        }
  }
  return null
}

/** Makes every match a line allows (one line, or all of them). Entries with a closed socket are dropped. */
function matchUp(only?: string) {
  for (const [k, line] of lines) {
    if (only && k !== only) continue
    for (const e of [...line]) if (!e.members.every((m) => m.ws.readyState === m.ws.OPEN)) removeEntry(e)
    const [mode, size] = k.split('|') as [Mode, Size]
    for (;;) {
      const teams = makeTeams(line, size, mode === 'ranked')
      if (!teams) break
      for (const e of [...teams[0], ...teams[1]]) removeEntry(e)
      propose(teams)
    }
  }
}

const who = (m: Member) => {
  const p = playerOf(m.ws)
  return { name: p?.name ?? guestName(m.token), portrait: p?.portrait ?? null }
}
function tellProposal(p: Proposal) {
  const ms = Math.max(0, p.endsAt - Date.now())
  p.teams.forEach((team, ti) => {
    for (const me of playersOf(team)) {
      const others = [0, 1].flatMap((tj) =>
        playersOf(p.teams[tj])
          .filter((m) => m !== me)
          .map((m) => ({ ...who(m), ally: tj === ti, accepted: p.accepted.has(m.token) })),
      )
      sendQueue(me.ws, { state: 'found', ms, others, you: p.accepted.has(me.token) })
    }
  })
}

function propose(teams: [Entry[], Entry[]]) {
  const all = playersOf([...teams[0], ...teams[1]])
  const p: Proposal = { teams, accepted: new Set(), endsAt: Date.now() + ACCEPT_MS, timer: setTimeout(() => endProposal(all[0].token, 'missed'), ACCEPT_MS) }
  for (const m of all) proposals.set(m.token, p)
  tellProposal(p)
}

function acceptMatch(token: string) {
  const p = proposals.get(token)
  if (!p) return
  p.accepted.add(token)
  const all = playersOf([...p.teams[0], ...p.teams[1]])
  if (p.accepted.size < all.length) return tellProposal(p)
  clearTimeout(p.timer)
  for (const m of all) {
    proposals.delete(m.token)
    misses.delete(m.token)
  }
  startQuickMatch(p)
}

/** A found match that won't happen. Whoever didn't accept (time ran out), or declined, is out of the queue with a
 *  miss ('left': closed the page or went to a room, no miss), with their party; every other entry goes back to
 *  the front of the queue. */
function endProposal(token: string, why: 'declined' | 'missed' | 'left') {
  const p = proposals.get(token)
  if (!p) return
  clearTimeout(p.timer)
  const entries = [...p.teams[0], ...p.teams[1]]
  for (const m of playersOf(entries)) proposals.delete(m.token)
  const culprits = why === 'missed' ? playersOf(entries).filter((m) => !p.accepted.has(m.token)).map((m) => m.token) : [token]
  const back: Entry[] = []
  for (const e of entries) {
    if (!e.members.some((m) => culprits.includes(m.token))) {
      const again = { ...e, since: Date.now() }
      back.push(again)
      tellEntry(again, { state: 'searching', since: again.since, mode: e.mode, size: e.size })
      continue
    }
    for (const m of e.members) {
      if (!culprits.includes(m.token)) {
        sendQueue(m.ws, { state: 'off', note: "Your teammate didn't accept." })
        continue
      }
      if (why === 'left') continue
      const n = (misses.get(m.token)?.n ?? 0) + 1
      const cooled = n >= MISS_LIMIT
      misses.set(m.token, cooled ? { n: 0, until: Date.now() + MISS_COOLDOWN_MS } : { n, until: 0 })
      sendQueue(m.ws, { state: 'off', note: cooled ? 'You missed two matches. Out of the queue for 2 minutes.' : why === 'missed' ? "You didn't accept in time." : undefined })
    }
  }
  for (const e of back.reverse()) addEntry(e, true) // back to the front, in their old order
  for (const k of new Set(back.map(lineKey))) matchUp(k)
}

/** Out of quick match (closed the page, made or joined a room, cancelled), with your party. */
function leaveQueue(ws: WebSocket, token: string) {
  const e = dequeue(token)
  if (proposals.has(token)) endProposal(token, 'left')
  if (e) for (const m of e.members) if (m.token !== token) sendQueue(m.ws, { state: 'off' })
  if (e) e.members.forEach((m) => touchToken(m.token))
  sendQueue(ws, { state: 'off' })
}

/** Everyone accepted: a room of their own, straight into the countdown (any room they were sitting in is left). */
function startQuickMatch(p: Proposal) {
  const entries = [...p.teams[0], ...p.teams[1]]
  for (const m of playersOf(entries)) {
    const at = seatOfToken.get(m.token)
    if (at) removeSeat(at.room, at.seat, false)
    sendQueue(m.ws, { state: 'off' })
  }
  const seat = (m: Member, team: Side): Seat => ({ token: m.token, ws: m.ws, awayTimer: null, team, ready: true, hp: MAX_HP, fid: null, forfeit: false, progress: 0, sent: {}, ink: [], player: playerOf(m.ws), chatAt: 0 })
  const seats = [...playersOf(p.teams[0]).map((m) => seat(m, 'player')), ...playersOf(p.teams[1]).map((m) => seat(m, 'enemy'))]
  const r: Room = { code: newCode(), seats, phase: 'lobby', combat: new Combat(), timer: null, pausedAt: null, duo: null, bots: null, raw: {}, quick: true, ranked: entries[0].mode === 'ranked', match: null, countdownEnds: 0 }
  rooms.set(r.code, r)
  r.seats.forEach((s) => seatOfToken.set(s.token, { room: r, seat: s }))
  sendLobby(r)
  startCountdown(r)
}

// ---- Parties (2 players): a 4-letter code to share; the leader (first in) finds 2v2 matches for both. A
// member whose tab is gone for PARTY_GRACE_MS is taken out. Any change takes the party out of the queue.
const PARTY_MAX = 2
const PARTY_GRACE_MS = 60_000
interface Party {
  code: string
  tokens: string[] // [0] leads
}
const parties = new Map<string, Party>()
const partyOf = new Map<string, Party>()
const liveWs = (token: string) => {
  for (const ws of wsOfToken.get(token) ?? []) if (ws.readyState === ws.OPEN) return ws
  return null
}
function sendParty(party: Party | null, to: string[]) {
  for (const t of to) {
    const ws = liveWs(t)
    if (!ws) continue
    const info: PartyInfo | null = party && {
      code: party.code,
      members: party.tokens.map((m, i) => {
        const w = liveWs(m)
        const p = w ? playerOf(w) : null
        return { name: p?.name ?? guestName(m), portrait: p?.portrait ?? null, leader: i === 0, you: m === t, here: !!w }
      }),
    }
    send(ws, { t: 'party', party: info })
  }
}
/** The party changed: out of the queue (its members are told), and everyone sees the new party. */
function partyChanged(party: Party) {
  for (const t of party.tokens) {
    if (!entryOf(t) && !proposals.has(t)) continue
    const ws = liveWs(t)
    if (ws) leaveQueue(ws, t)
    else dequeue(t)
  }
  sendParty(party, party.tokens)
}
function leaveParty(token: string) {
  const party = partyOf.get(token)
  if (!party) return
  partyChanged(party) // out of the queue first, while they're still in it
  partyOf.delete(token)
  party.tokens = party.tokens.filter((t) => t !== token)
  sendParty(null, [token])
  // Whoever's left keeps the party and its code (a friend can join again); empty, it's gone.
  if (!party.tokens.length) parties.delete(party.code)
  else sendParty(party, party.tokens)
}
function onPartyMsg(ws: WebSocket, token: string, msg: Extract<ClientMsg, { t: 'party' }>) {
  if (msg.op === 'leave') return leaveParty(token)
  if (msg.op === 'create') {
    const had = partyOf.get(token)
    if (had) return sendParty(had, [token])
    leaveQueue(ws, token)
    const party: Party = { code: newCode(), tokens: [token] }
    parties.set(party.code, party)
    partyOf.set(token, party)
    return sendParty(party, [token])
  }
  const party = parties.get(String(msg.code ?? '').toUpperCase().trim())
  if (!party) return send(ws, { t: 'error', msg: 'No party with that code.' })
  if (party.tokens.includes(token)) return
  if (party.tokens.length >= PARTY_MAX) return send(ws, { t: 'error', msg: 'That party is full.' })
  leaveParty(token)
  leaveQueue(ws, token)
  partyChanged(party)
  party.tokens.push(token)
  partyOf.set(token, party)
  sendParty(party, party.tokens)
}
/** A tab closed: a party member has PARTY_GRACE_MS to come back (a refresh keeps the party). */
function partyAway(token: string) {
  const party = partyOf.get(token)
  if (!party) return
  sendParty(party, party.tokens)
  setTimeout(() => {
    if (!liveWs(token) && partyOf.get(token) === party) leaveParty(token)
  }, PARTY_GRACE_MS)
}

// ---- Quick chat: preset lines only (no free text with strangers; plans/accounts.md), to everyone in the room.
const CHAT_GAP_MS = 1500
function onChat(room: Room, seat: Seat, line: number) {
  if (!Number.isInteger(line) || line < 0 || line >= QUICK_CHAT.length) return
  const now = Date.now()
  if (now - seat.chatAt < CHAT_GAP_MS) return
  seat.chatAt = now
  const name = seat.player?.name ?? guestName(seat.token)
  const fighters = room.combat.roster
  for (const s of room.seats) {
    const from = seat.fid && s.fid && room.phase !== 'lobby' ? idsFor(fighters, s.fid)[seat.fid] : null
    send(s.ws, { t: 'chat', from, name, line, you: s === seat })
  }
}

// ---- Friends (server/social.ts): presence from the sockets, seats and queue here.
const socialSocks = new Map<WebSocket, string>() // Friends page sockets -> user id
const socialOfUser = new Map<string, Set<WebSocket>>() // and the reverse
function addSocial(ws: WebSocket, userId: string) {
  socialSocks.set(ws, userId)
  let set = socialOfUser.get(userId)
  if (!set) socialOfUser.set(userId, (set = new Set()))
  set.add(ws)
}
function dropSocial(ws: WebSocket) {
  const id = socialSocks.get(ws)
  if (!id) return
  socialSocks.delete(ws)
  const set = socialOfUser.get(id)
  set?.delete(ws)
  if (set && !set.size) socialOfUser.delete(id)
}
const userToken = (userId: string) => `user:${userId}`
function socketsOf(userId: string) {
  const out: WebSocket[] = []
  const t = userToken(userId)
  for (const ws of wsOfToken.get(t) ?? []) if (ws.readyState === ws.OPEN) out.push(ws)
  for (const ws of socialOfUser.get(userId) ?? []) if (ws.readyState === ws.OPEN) out.push(ws)
  return out
}
function presenceOf(userId: string): Presence {
  const t = userToken(userId)
  const at = seatOfToken.get(t)
  if (at && (at.room.phase === 'fighting' || at.room.phase === 'countdown')) return 'match'
  if (!socketsOf(userId).length) return 'offline'
  if (entryOf(t) || proposals.has(t)) return 'queue'
  return 'online'
}
function partyCodeFor(userId: string) {
  const t = userToken(userId)
  let party = partyOf.get(t)
  if (!party) {
    party = { code: newCode(), tokens: [t] }
    parties.set(party.code, party)
    partyOf.set(t, party)
    sendParty(party, [t])
  }
  return party.code
}
const social = createSocial({ send, socketsOf, presenceOf, partyCodeFor })
// Presence changes are batched: a match starting touches several players at once.
const touched = new Set<string>()
let touchTimer: ReturnType<typeof setTimeout> | null = null
function touch(tokenOrId: string | null | undefined) {
  if (!accountsOn || !tokenOrId) return
  touched.add(tokenOrId.startsWith('user:') ? tokenOrId.slice(5) : tokenOrId)
  touchTimer ??= setTimeout(() => {
    touchTimer = null
    const ids = [...touched]
    touched.clear()
    for (const id of ids) void social.presenceChanged(id)
  }, 500)
}
const touchToken = (token: string) => token.startsWith('user:') && touch(token)

// ---- Guest names (like chess.com's "Guest12345"): unique among everyone online, kept per browser tab (its
// token survives a refresh). Freed when that tab has been gone a while and isn't holding a seat.
const guestNames = new Map<string, string>() // token -> name
const namesTaken = new Set<string>()
function guestName(token: string) {
  let n = guestNames.get(token)
  if (!n) {
    do n = `Guest${10000 + Math.floor(Math.random() * 90000)}`
    while (namesTaken.has(n))
    guestNames.set(token, n)
    namesTaken.add(n)
  }
  return n
}
function freeGuestName(token: string) {
  setTimeout(() => {
    const online = wsOfToken.has(token)
    if (online || seatOfToken.has(token)) return
    const n = guestNames.get(token)
    if (n) namesTaken.delete(n)
    guestNames.delete(token)
  }, GRACE_MS * 2)
}

/** Who's on this socket: their account (checked once, when it connected), or null for a guest. */
const accountOfWs = new WeakMap<WebSocket, Account | null>()
const playerOf = (ws: WebSocket) => {
  const a = accountOfWs.get(ws)
  return a?.username ? { userId: a.id, name: a.username, portrait: a.portrait } : null
}

function onHello(ws: WebSocket, clientToken: string) {
  // Signed in: the seat belongs to the account, whatever the browser's token says, so any tab or device on that
  // account gets it back. A guest is their tab's token, as before.
  const a = accountOfWs.get(ws)
  const token = a?.username ? `user:${a.id}` : clientToken
  // A token that's already connected elsewhere (two tabs, same session) takes over the seat.
  bindToken(ws, token)
  const at = seatOfToken.get(token)
  const you = { name: playerOf(ws)?.name ?? guestName(token), guest: !playerOf(ws) }
  const party = partyOf.get(token)
  if (party) setTimeout(() => sendParty(party, party.tokens)) // after the welcome
  touchToken(token)
  if (!at) return send(ws, { t: 'welcome', resumed: false, ...you })
  const { room, seat } = at
  if (seat.ws && seat.ws !== ws) {
    unbindWs(seat.ws)
    seat.ws.close()
  }
  seat.ws = ws
  seat.sent = {} // a new socket gets the whole state again
  if (seat.awayTimer) clearTimeout(seat.awayTimer)
  seat.awayTimer = null
  send(ws, { t: 'welcome', resumed: true, ...you })
  others(room, seat).forEach((s) => send(s.ws, { t: 'back' }))
  sendLobby(room)
  if (room.phase === 'fighting' && seat.fid) {
    send(ws, { t: 'start' })
    updatePause(room)
    sendState(room)
  }
}

/** Another fighter's casting, to everyone else (by the id each of them knows that fighter as). */
function relay(room: Room, from: Seat, ev: OppEvent) {
  if (room.phase !== 'fighting' || room.pausedAt !== null || !from.fid) return
  // Shrouded: their charge, strokes and readied spell stay on the server (only the throw itself is shown).
  if (ev.kind !== 'cast' && room.combat.shrouded(from.fid, Date.now())) return
  const fighters = room.combat.roster
  for (const s of others(room, from)) if (s.fid) send(s.ws, { t: 'opp', from: idsFor(fighters, s.fid)[from.fid], ev })
}

function onMessage(ws: WebSocket, msg: ClientMsg) {
  if (msg.t === 'hello') {
    if (typeof msg.token === 'string' && msg.token.length >= 8 && msg.token.length <= 64) onHello(ws, msg.token)
    return
  }
  if (msg.t === 'social' || msg.t === 'friends' || msg.t === 'invite') {
    const p = playerOf(ws)
    if (!p || !accountsOn) return send(ws, { t: 'error', msg: 'Sign in to have friends.' })
    if (msg.t === 'social') {
      if (!socialSocks.has(ws)) touch(p.userId)
      addSocial(ws, p.userId)
      return void social.handle(ws, { userId: p.userId, name: p.name }, { t: 'friends', op: 'list' })
    }
    return void social.handle(ws, { userId: p.userId, name: p.name }, msg as SocialMsg)
  }
  const token = tokenOfWs.get(ws)
  if (!token) return // must say hello first
  const at = seatOfToken.get(token)

  switch (msg.t) {
    case 'create': {
      if (at) removeSeat(at.room, at.seat, false)
      leaveQueue(ws, token)
      const seat: Seat = { token, ws, awayTimer: null, team: 'player', ready: false, hp: MAX_HP, fid: null, forfeit: false, progress: progressOf(msg.progress), sent: {}, ink: [], player: playerOf(ws), chatAt: 0 }
      const r: Room = { code: newCode(), seats: [seat], phase: 'lobby', combat: new Combat(), timer: null, pausedAt: null, duo: null, bots: null, raw: {}, quick: false, ranked: false, match: null, countdownEnds: 0 }
      if (msg.duo) r.duo = { floor: unlocked(r) } // a Duo Tower room (made on the Tower page)
      rooms.set(r.code, r)
      seatOfToken.set(token, { room: r, seat })
      sendLobby(r)
      return
    }
    case 'join': {
      const r = rooms.get(String(msg.code ?? '').toUpperCase().trim())
      if (!r) return send(ws, { t: 'error', msg: 'No room with that code.' })
      if (at?.room === r) return
      if (r.seats.length >= ROOM_MAX) return send(ws, { t: 'error', msg: 'That room is full.' })
      if (r.phase === 'fighting' || r.phase === 'countdown') return send(ws, { t: 'error', msg: 'That room is in a match. Try again when it ends.' })
      // Duo Tower rooms are joined from the Tower page, Duel rooms from Duel.
      if (!!r.duo !== !!msg.duo) return send(ws, { t: 'error', msg: r.duo ? 'That code is for a Duo Tower room. Join it from the Tower.' : 'That code is for a Duel room. Join it from Duel.' })
      if (r.duo && r.seats.length >= TEAM_MAX) return send(ws, { t: 'error', msg: 'That room is full.' })
      if (at) removeSeat(at.room, at.seat, false)
      leaveQueue(ws, token)
      // The smaller team gets the new player (team 2 on a tie, so a 1v1 fills first). Duo Tower: your team.
      const team: Side = r.duo ? 'player' : teamSize(r, 'enemy') <= teamSize(r, 'player') ? 'enemy' : 'player'
      const seat: Seat = { token, ws, awayTimer: null, team, ready: false, hp: MAX_HP, fid: null, forfeit: false, progress: progressOf(msg.progress), sent: {}, ink: [], player: playerOf(ws), chatAt: 0 }
      r.seats.push(seat)
      seatOfToken.set(token, { room: r, seat })
      r.phase = 'lobby'
      r.seats.forEach((s) => (s.ready = false))
      sendLobby(r)
      return
    }
    case 'leave':
      if (at) removeSeat(at.room, at.seat, at.room.phase === 'fighting')
      return
    case 'queue':
      // Not from inside a match; a room you're sitting in (lobby, results) is left when the match starts.
      if (at && (at.room.phase === 'fighting' || at.room.phase === 'countdown')) return
      return void enqueue(ws, token, msg.mode === 'ranked' ? 'ranked' : 'casual', msg.size === '2v2' ? '2v2' : '1v1')
    case 'unqueue':
      if (proposals.has(token)) return endProposal(token, 'declined') // cancelling a found match is declining it
      return leaveQueue(ws, token)
    case 'party':
      return onPartyMsg(ws, token, msg)
    case 'accept':
      return acceptMatch(token)
    case 'decline':
      return endProposal(token, 'declined')
  }
  if (!at) return
  const { room, seat } = at
  const lobby = room.phase === 'lobby' || room.phase === 'over'
  switch (msg.t) {
    case 'ready':
      if (room.phase === 'countdown') return readyUp(room, seat)
      if (!lobby) return
      if (room.ranked) return send(ws, { t: 'error', msg: "Ranked matches don't rematch. Find another match from Play." })
      seat.ready = true
      sendLobby(room)
      if (canStart(room)) startCountdown(room)
      return
    case 'chat':
      return onChat(room, seat, Number(msg.line))
    case 'unready':
      if (!lobby || !seat.ready) return
      seat.ready = false
      return sendLobby(room)
    case 'floor': {
      const n = Math.round(Number(msg.floor))
      if (!lobby || room.seats[0] !== seat || !room.duo || !(n >= 1 && n <= unlocked(room))) return
      room.duo.floor = n
      room.seats.forEach((s) => (s.ready = false))
      return sendLobby(room)
    }
    case 'team': {
      if (room.duo || room.quick) return // quick match: the teams the queue made
      const to: Side = seat.team === 'player' ? 'enemy' : 'player'
      if (!lobby || teamSize(room, to) >= TEAM_MAX) return
      seat.team = to
      room.seats.forEach((s) => (s.ready = false)) // teams changed: everyone confirms again
      return sendLobby(room)
    }
    case 'hp': {
      const target = room.seats[Number(msg.seat)]
      if (room.duo || room.quick || !lobby || room.seats[0] !== seat || !target) return // quick match: everyone at the standard HP
      target.hp = Math.min(HP_MAX, Math.max(HP_MIN, Math.round(Number(msg.hp) || MAX_HP))) // exact whole numbers (Nov 25: was rounded to 10)
      room.seats.forEach((s) => (s.ready = false))
      return sendLobby(room)
    }
    case 'forfeit':
      // A vote (pressing again takes it back). Alone on your team, it ends the match at once.
      if (room.phase !== 'fighting' || !seat.fid) return
      seat.forfeit = !seat.forfeit
      if (!checkForfeit(room) && !seat.forfeit) for (const s of room.seats.filter((x) => x.team === seat.team)) send(s.ws, { t: 'forfeitVote', votes: 0, needed: 0, mine: s.forfeit })
      return
  }
  // Casting: the browser only says what it recognized. The fight's rules decide what that does, on
  // the server's clock (charges, readied spells, throws, fizzle lockouts, fades). Nothing while paused.
  // Each decision goes out to everyone at once, not on the next tick (the tick is for what happens with
  // nobody acting: spells landing, burns, fades).
  if (room.phase !== 'fighting' || room.pausedAt !== null || !seat.fid) return
  const side = seat.fid
  const now = Date.now()
  switch (msg.t) {
    case 'sign': {
      const el = typeof msg.el === 'string' ? msg.el.slice(0, 1) : ''
      if (!room.combat.chargeOf(side)) seat.ink = [] // a fresh charge: any old drawing is gone (silenced, knocked off)
      if (room.combat.sign(side, el, now)) relay(room, seat, { kind: 'charge', el: room.combat.chargeOf(side) })
      return sendState(room) // even a refusal: it corrects the player's own early display
    }
    case 'stroke': {
      if (!Array.isArray(msg.pts)) return
      if (room.combat.drawing(side, now)) {
        // A redraw dropped their readied spell, or a combo locked in.
        relay(room, seat, { kind: 'charge', el: room.combat.chargeOf(side) })
        sendState(room)
      }
      const a = Math.min(4, Math.max(0.25, Number(msg.a) || 16 / 9)) // their visible view's width / height
      const pts = msg.pts.slice(0, MAX_STROKE_PTS).map((p) => [Number(p?.[0]) || 0, Number(p?.[1]) || 0] as [number, number])
      // Kept for reading the drawing: un-mirrored and back in the view's proportions, like the camera pixels
      // the browser read. Nothing charged = nothing being drawn (the browser drops it too).
      if (!room.combat.chargeOf(side)) seat.ink = []
      else if (seat.ink.length < MAX_INK) seat.ink.push(...pts.map(([x, y]) => ({ x: (1 - x) * a, y })))
      return relay(room, seat, { kind: 'stroke', a, pts })
    }
    case 'drew': {
      // The browser may always fizzle its own stroke (too short for its hand size, which only it knows);
      // otherwise what the server reads from the points decides.
      const claim = typeof msg.shape === 'string' ? msg.shape.slice(0, 32) : null
      const shape = claim === null || TRUST_DRAWINGS ? claim : seat.ink.length >= 2 ? readStroke(SHAPES, seat.ink, room.combat.chargeOf(side)).shape : null
      if (claim !== null && !TRUST_DRAWINGS) {
        if (shape === claim) drawings.agreed++
        else drawings.overruled++
      }
      seat.ink = []
      const r = room.combat.drew(side, shape, now)
      relay(room, seat, r ? { kind: 'readied', el: r.el, shape: r.shape } : { kind: 'cleared' })
      return sendState(room)
    }
    case 'aim': {
      // Their ids -> the server's.
      const mine = idsFor(room.combat.roster, side)
      const target = typeof msg.target === 'string' ? Object.keys(mine).find((k) => mine[k] === msg.target) ?? null : null
      room.combat.aim(side, target)
      return
    }
    case 'parry':
      room.combat.parry(side, now)
      return sendState(room)
    case 'uncharge':
      if (room.combat.uncharge(side)) relay(room, seat, { kind: 'charge', el: null })
      return sendState(room)
    case 'cleared':
      seat.ink = []
      room.combat.strokeCancelled(side)
      return relay(room, seat, { kind: 'cleared' })
    case 'push': {
      const res = room.combat.push(side, now)
      if (res === 'ok') relay(room, seat, { kind: 'cast' })
      else if (res === 'static') relay(room, seat, { kind: 'cleared' })
      room.combat.update(now) // a heal applies at once
      if (room.combat.winner) return endFight(room)
      return sendState(room)
    }
  }
}

// ---- HTTP: serve the built web app ---------------------------------------------------------
const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.wasm': 'application/wasm',
}
const accountsOn = await setupDatabase()
if (accountsOn) {
  startCleanup()
  await backfillTotals().catch((err) => console.error('totals backfill failed', (err as Error).message))
}
const http = createServer(async (req, res) => {
  // Health (deploys): up, and how many matches are running, so a deploy can wait for them to finish (a restart
  // ends every match in progress; rooms live in memory).
  if (req.url === '/healthz') {
    const busy = [...rooms.values()].filter((r) => r.phase === 'fighting' || r.phase === 'countdown').length
    res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }).end(JSON.stringify({ ok: true, busy, db: accountsOn }))
    return
  }
  // Sign-in and the account API (auth.ts); everything else is the web app.
  try {
    if (await handleAuth(req, res, accountsOn)) return
  } catch (err) {
    console.error('api failed', req.url?.split('?')[0], err)
    if (!res.headersSent) res.writeHead(500, { 'Content-Type': 'application/json' }).end('{"error":"Server error."}')
    return
  }
  let path: string
  try {
    path = normalize(decodeURIComponent((req.url ?? '/').split('?')[0])).replace(/^([/\\])+/, '')
  } catch {
    return res.writeHead(400).end()
  }
  if (path.includes('..')) return res.writeHead(400).end()
  for (const file of [join(DIST, path || 'index.html'), join(DIST, 'index.html')]) {
    try {
      const body = await readFile(file)
      res.writeHead(200, { 'Content-Type': TYPES[extname(file)] ?? 'application/octet-stream' })
      return res.end(body)
    } catch {
      /* try the next one (SPA fallback) */
    }
  }
  res.writeHead(404).end('Not built yet: run `npm run build` in apps/web')
})

// Compression: state updates are near-identical JSON 40 times a second, so with the shared window
// (context takeover) each one shrinks to a small diff. Tiny messages aren't worth compressing.
const wss = new WebSocketServer({ server: http, path: '/ws', maxPayload: MAX_MSG_BYTES, perMessageDeflate: { threshold: 128 } })
const alive = new WeakMap<WebSocket, boolean>()
const perIp = new Map<string, number>()
const limits = { dropped: 0, kicked: 0, refused: 0 } // for STATS
wss.on('connection', (ws, req) => {
  // The player's address: behind a host's proxy (Render) it's the first X-Forwarded-For entry. This machine
  // itself (the load test, local play) has no cap.
  const fwd = req.headers['x-forwarded-for']
  const ip = (Array.isArray(fwd) ? fwd[0] : fwd)?.split(',')[0].trim() || req.socket.remoteAddress || '?'
  const local = !fwd && /^(::1|127\.|::ffff:127\.)/.test(ip)
  if (!local && (perIp.get(ip) ?? 0) >= MAX_PER_IP) {
    limits.refused++
    return ws.close(1008, 'Too many connections')
  }
  // Only our own pages may open a socket with your cookie (stops another site opening one in your name).
  // Browsers always send Origin; scripts and the load test send none, and carry no cookie of yours anyway.
  if (req.headers.origin && !sameOrigin(req)) {
    limits.refused++
    return ws.close(1008, 'Bad origin')
  }
  perIp.set(ip, (perIp.get(ip) ?? 0) + 1)
  // The account, looked up once; messages wait for it (in order), so 'hello' always knows who this is.
  const authed: Promise<void> = (accountsOn ? accountOf(req).catch(() => null) : Promise.resolve(null)).then((a) => void accountOfWs.set(ws, a))
  let tokens = BURST
  let filled = performance.now()
  let kicked = false
  alive.set(ws, true)
  ws.on('pong', () => alive.set(ws, true))
  ws.on('message', (data) => {
    if (kicked) return // closing: whatever was already on its way is ignored
    const now = performance.now()
    tokens = Math.min(BURST, tokens + ((now - filled) / 1000) * RATE) - 1
    filled = now
    if (tokens < 0) {
      limits.dropped++
      // Still flooding long after the limit (the debt keeps growing): not a player.
      if (tokens < -KICK_AT) {
        kicked = true
        limits.kicked++
        ws.close(1008, 'Too many messages')
      }
      return
    }
    let msg: ClientMsg
    try {
      msg = JSON.parse(String(data))
    } catch {
      return
    }
    if (!msg || typeof msg !== 'object') return
    // One bad message must never take the server (and every other room) down.
    void authed.then(() => {
      try {
        onMessage(ws, msg)
      } catch (err) {
        console.error('message failed', (msg as { t?: unknown }).t, err)
      }
    })
  })
  ws.on('close', () => {
    const token = tokenOfWs.get(ws)
    if (token) {
      leaveQueue(ws, token)
      partyAway(token)
      freeGuestName(token)
      touchToken(token)
    }
    const sid = socialSocks.get(ws)
    if (sid) {
      dropSocial(ws)
      touch(sid)
    }
    const n = (perIp.get(ip) ?? 1) - 1
    if (n > 0) perIp.set(ip, n)
    else perIp.delete(ip)
    try {
      onDisconnect(ws)
    } catch (err) {
      console.error('disconnect failed', err)
    }
  })
  ws.on('error', () => ws.terminate())
})
// Drop connections that stopped answering (their 'close' then frees the seat after the grace period).
setInterval(() => {
  for (const ws of wss.clients) {
    if (!alive.get(ws)) {
      ws.terminate()
      continue
    }
    alive.set(ws, false)
    ws.ping()
  }
}, PING_MS)

// STATS=1: every 10 s, log rooms, players, CPU and event-loop lag (how late timers fire; high = overloaded).
if (process.env.STATS) {
  const lag = monitorEventLoopDelay({ resolution: 10 })
  lag.enable()
  let cpu = process.cpuUsage()
  let at = performance.now()
  setInterval(() => {
    const used = process.cpuUsage(cpu)
    const ms = performance.now() - at
    const fighting = [...rooms.values()].filter((r) => r.phase === 'fighting').length
    console.log(`stats: ${rooms.size} rooms (${fighting} fighting), ${wss.clients.size} sockets, CPU ${(((used.user + used.system) / 1000 / ms) * 100).toFixed(0)}%, loop lag p99 ${(lag.percentile(99) / 1e6).toFixed(1)} ms, heap ${(process.memoryUsage().heapUsed / 1e6).toFixed(0)} MB, state builds ${(load.states / (ms / 1000)).toFixed(0)}/s (${load.states ? ((load.stateMs / load.states) * 1000).toFixed(0) : 0} us each, ${((load.stateMs / ms) * 100).toFixed(0)}% of the time), ${(load.sent / (ms / 1000)).toFixed(0)} sent/s`)
    console.log(`  drawings: ${drawings.agreed} claims agreed, ${drawings.overruled} overruled; limits: ${limits.dropped} messages dropped, ${limits.kicked} sockets kicked, ${limits.refused} refused (per-address cap)`)
    Object.assign(load, { states: 0, stateMs: 0, sent: 0 })
    Object.assign(drawings, { agreed: 0, overruled: 0 })
    Object.assign(limits, { dropped: 0, kicked: 0, refused: 0 })
    lag.reset()
    cpu = process.cpuUsage()
    at = performance.now()
  }, 10000)
}

process.on('uncaughtException',(err) => console.error('uncaught', err))
process.on('unhandledRejection', (err) => console.error('unhandled rejection', err))

http.listen(PORT, () => console.log(`Game server on http://localhost:${PORT} (WebSocket at /ws)`))
