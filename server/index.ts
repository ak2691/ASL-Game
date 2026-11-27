// Game server: rooms with join codes, and the authoritative fight (HP, shields, traps, timing).
// One WebSocket per player at /ws. Also serves the built web app (apps/web/dist) so one Render
// service hosts everything.
//
// A room holds up to 4 players on two teams (1v1, 1v2, 2v2). The first player is the host and sets
// each player's HP. Players are identified by a token their browser keeps across refreshes (not by the
// socket), so a dropped connection or a refresh can rejoin the same seat within GRACE_MS. If a whole
// team is away the fight pauses; if a teammate is still fighting, it goes on without them. A player
// who doesn't come back in time is out of the match and the room.
import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { extname, join, normalize } from 'node:path'
import { fileURLToPath } from 'node:url'
import { WebSocketServer, type WebSocket } from 'ws'
import { Combat, MAX_HP, type Fid, type Side } from '../apps/web/src/combat.ts'
import { HP_MAX, HP_MIN, ROOM_MAX, TEAM_MAX, type ClientMsg, type OppEvent, type ServerMsg } from '../apps/web/src/protocol.ts'
import { hideShrouded, idsFor, viewFor } from '../apps/web/src/teamView.ts'
import { DuoBots, DUO_HP, DUO_TOP } from '../apps/web/src/duo.ts'

const PORT = Number(process.env.PORT ?? 8787)
const COUNTDOWN_MS = 3000
const TICK_MS = 25 // how often a running fight is advanced (spells landing, ticks); local play redraws every frame
const GRACE_MS = 15000 // a disconnected player keeps their seat this long
const MAX_STROKE_PTS = 200 // per message
const MAX_MSG_BYTES = 64 * 1024
// Heartbeat: a connection that dies without closing (phone loses signal) would otherwise keep its
// seat "connected" forever (no pause, no grace timer). Browsers answer pings on their own.
const PING_MS = 20000
const DIST = fileURLToPath(new URL('../apps/web/dist/', import.meta.url))

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
}
const BOT_IDS: [Fid, Fid] = ['b0', 'b1']
const isBot = (id: Fid) => (BOT_IDS as Fid[]).includes(id)
/** The highest Duo Tower floor this room may pick: one past the best anyone here has cleared. */
const unlocked = (room: Room) => Math.min(DUO_TOP, Math.max(0, ...room.seats.map((s) => s.progress)) + 1)

const rooms = new Map<string, Room>()
const seatOfToken = new Map<string, { room: Room; seat: Seat }>()
const tokenOfWs = new Map<WebSocket, string>()

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
  const seats = room.seats.map((s) => ({ team: s.team, ready: s.ready, hp: s.hp, here: !!s.ws }))
  const duo = room.duo && { floor: room.duo.floor, unlocked: unlocked(room) }
  room.seats.forEach((s, i) => send(s.ws, { t: 'lobby', code: room.code, seats, you: i, host: 0, duo }))
}

function sendState(room: Room) {
  const view = room.combat.view(room.pausedAt ?? Date.now())
  const paused = room.pausedAt !== null
  // Who's disconnected (seat held) or gone (seat removed), so their cards can say so.
  const conn: Record<Fid, 'away' | 'left'> = {}
  for (const f of view.fighters) {
    if (isBot(f.id)) continue
    const seat = room.seats.find((s) => s.fid === f.id)
    if (!seat) conn[f.id] = 'left'
    else if (!seat.ws) conn[f.id] = 'away'
  }
  for (const s of room.seats) {
    if (!s.fid) continue
    const map = idsFor(view.fighters, s.fid)
    const mine = Object.fromEntries(Object.entries(conn).map(([id, c]) => [map[id] ?? id, c]))
    const bots = room.bots ? Object.fromEntries(Object.entries(room.bots.info(room.pausedAt ?? Date.now())).map(([id, b]) => [map[id] ?? id, b.cast && view.shroud[id] > 0 ? { ...b, cast: null } : b])) : undefined
    send(s.ws, { t: 'state', view: hideShrouded(viewFor(view, s.fid)), paused, conn: mine, bots })
  }
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
  room.seats.forEach((s, i) => {
    s.fid = `f${i}`
    s.forfeit = false
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
  room.seats.forEach((s) => send(s.ws, { t: 'countdown', ms: COUNTDOWN_MS }))
  room.timer = setTimeout(() => {
    room.bots?.start(Date.now())
    room.phase = 'fighting'
    room.seats.forEach((s) => send(s.ws, { t: 'start' }))
    tick(room)
  }, COUNTDOWN_MS)
}

function endFight(room: Room) {
  stopTimer(room)
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
  tokenOfWs.delete(ws)
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

function onHello(ws: WebSocket, token: string) {
  // A token that's already connected elsewhere (two tabs, same session) takes over the seat.
  tokenOfWs.set(ws, token)
  const at = seatOfToken.get(token)
  if (!at) return send(ws, { t: 'welcome', resumed: false })
  const { room, seat } = at
  if (seat.ws && seat.ws !== ws) {
    tokenOfWs.delete(seat.ws)
    seat.ws.close()
  }
  seat.ws = ws
  if (seat.awayTimer) clearTimeout(seat.awayTimer)
  seat.awayTimer = null
  send(ws, { t: 'welcome', resumed: true })
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
  if (ev.kind !== 'cast' && room.combat.view(Date.now()).shroud[from.fid] > 0) return
  const fighters = room.combat.view(Date.now()).fighters
  for (const s of others(room, from)) if (s.fid) send(s.ws, { t: 'opp', from: idsFor(fighters, s.fid)[from.fid], ev })
}

function onMessage(ws: WebSocket, msg: ClientMsg) {
  if (msg.t === 'hello') {
    if (typeof msg.token === 'string' && msg.token.length >= 8 && msg.token.length <= 64) onHello(ws, msg.token)
    return
  }
  const token = tokenOfWs.get(ws)
  if (!token) return // must say hello first
  const at = seatOfToken.get(token)

  switch (msg.t) {
    case 'create': {
      if (at) removeSeat(at.room, at.seat, false)
      const seat: Seat = { token, ws, awayTimer: null, team: 'player', ready: false, hp: MAX_HP, fid: null, forfeit: false, progress: progressOf(msg.progress) }
      const r: Room = { code: newCode(), seats: [seat], phase: 'lobby', combat: new Combat(), timer: null, pausedAt: null, duo: null, bots: null }
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
      // The smaller team gets the new player (team 2 on a tie, so a 1v1 fills first). Duo Tower: your team.
      const team: Side = r.duo ? 'player' : teamSize(r, 'enemy') <= teamSize(r, 'player') ? 'enemy' : 'player'
      const seat: Seat = { token, ws, awayTimer: null, team, ready: false, hp: MAX_HP, fid: null, forfeit: false, progress: progressOf(msg.progress) }
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
  }
  if (!at) return
  const { room, seat } = at
  const lobby = room.phase === 'lobby' || room.phase === 'over'
  switch (msg.t) {
    case 'ready':
      if (!lobby) return
      seat.ready = true
      sendLobby(room)
      if (canStart(room)) startCountdown(room)
      return
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
      if (room.duo) return
      const to: Side = seat.team === 'player' ? 'enemy' : 'player'
      if (!lobby || teamSize(room, to) >= TEAM_MAX) return
      seat.team = to
      room.seats.forEach((s) => (s.ready = false)) // teams changed: everyone confirms again
      return sendLobby(room)
    }
    case 'hp': {
      const target = room.seats[Number(msg.seat)]
      if (room.duo || !lobby || room.seats[0] !== seat || !target) return
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
      if (room.combat.sign(side, el, now)) relay(room, seat, { kind: 'charge', el: room.combat.chargeOf(side) })
      return sendState(room) // even a refusal: it corrects the player's own early display
    }
    case 'stroke':
      if (!Array.isArray(msg.pts)) return
      if (room.combat.drawing(side, now)) {
        // A redraw dropped their readied spell, or a combo locked in.
        relay(room, seat, { kind: 'charge', el: room.combat.chargeOf(side) })
        sendState(room)
      }
      return relay(room, seat, {
        kind: 'stroke',
        a: Math.min(4, Math.max(0.25, Number(msg.a) || 16 / 9)), // their visible view's width / height
        pts: msg.pts.slice(0, MAX_STROKE_PTS).map((p) => [Number(p?.[0]) || 0, Number(p?.[1]) || 0] as [number, number]),
      })
    case 'drew': {
      const r = room.combat.drew(side, typeof msg.shape === 'string' ? msg.shape.slice(0, 32) : null, now)
      relay(room, seat, r ? { kind: 'readied', el: r.el, shape: r.shape } : { kind: 'cleared' })
      return sendState(room)
    }
    case 'aim': {
      // Their ids -> the server's.
      const mine = idsFor(room.combat.view(now).fighters, side)
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
const http = createServer(async (req, res) => {
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
wss.on('connection', (ws) => {
  alive.set(ws, true)
  ws.on('pong', () => alive.set(ws, true))
  ws.on('message', (data) => {
    let msg: ClientMsg
    try {
      msg = JSON.parse(String(data))
    } catch {
      return
    }
    if (!msg || typeof msg !== 'object') return
    // One bad message must never take the server (and every other room) down.
    try {
      onMessage(ws, msg)
    } catch (err) {
      console.error('message failed', (msg as { t?: unknown }).t, err)
    }
  })
  ws.on('close', () => {
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

process.on('uncaughtException', (err) => console.error('uncaught', err))
process.on('unhandledRejection', (err) => console.error('unhandled rejection', err))

http.listen(PORT, () => console.log(`Game server on http://localhost:${PORT} (WebSocket at /ws)`))
