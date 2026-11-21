// Game server: rooms with join codes, and the authoritative fight (HP, shields, traps, timing).
// One WebSocket per player at /ws. Also serves the built web app (apps/web/dist) so one Render
// service hosts everything.
//
// Players are identified by a token their browser keeps across refreshes (not by the socket), so a
// dropped connection or a refresh can rejoin the same seat within GRACE_MS. While a fighter is
// away the fight is paused.
import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { extname, join, normalize } from 'node:path'
import { fileURLToPath } from 'node:url'
import { WebSocketServer, type WebSocket } from 'ws'
import { Combat, flipView, type Side } from '../apps/web/src/combat.ts'
import type { ClientMsg, OppEvent, ServerMsg } from '../apps/web/src/protocol.ts'

const PORT = Number(process.env.PORT ?? 8787)
const COUNTDOWN_MS = 3000
const TICK_MS = 50
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
}
interface Room {
  code: string
  seats: [Seat | null, Seat | null] // seat 0 = 'player' side, seat 1 = 'enemy' side
  ready: [boolean, boolean]
  phase: Phase
  combat: Combat
  timer: ReturnType<typeof setTimeout> | null // countdown or tick
  pausedAt: number | null
}

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

const send = (ws: WebSocket | null | undefined, msg: ServerMsg) => {
  if (ws && ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg))
}
const sideOf = (i: number): Side => (i === 0 ? 'player' : 'enemy')
const indexOf = (room: Room, seat: Seat) => room.seats.indexOf(seat)
const otherSeat = (room: Room, seat: Seat) => room.seats[1 - indexOf(room, seat)]

function sendLobby(room: Room) {
  const count = room.seats.filter(Boolean).length
  room.seats.forEach((s, i) => send(s?.ws, { t: 'lobby', code: room.code, players: count, ready: [room.ready[i], room.ready[1 - i]] }))
}

function sendState(room: Room) {
  const view = room.combat.view(room.pausedAt ?? Date.now())
  const paused = room.pausedAt !== null
  send(room.seats[0]?.ws, { t: 'state', view, paused })
  send(room.seats[1]?.ws, { t: 'state', view: flipView(view), paused })
}

function stopTimer(room: Room) {
  if (room.timer) clearTimeout(room.timer)
  room.timer = null
}

function startCountdown(room: Room) {
  room.phase = 'countdown'
  room.combat = new Combat()
  room.pausedAt = null
  room.seats.forEach((s) => send(s?.ws, { t: 'countdown', ms: COUNTDOWN_MS }))
  room.timer = setTimeout(() => {
    room.phase = 'fighting'
    room.seats.forEach((s) => send(s?.ws, { t: 'start' }))
    tick(room)
  }, COUNTDOWN_MS)
}

function endFight(room: Room) {
  stopTimer(room)
  sendState(room)
  room.phase = 'over'
  room.ready = [false, false]
  room.pausedAt = null
  sendLobby(room)
}

function tick(room: Room) {
  room.timer = null
  try {
    if (room.pausedAt === null) room.combat.update(Date.now())
    sendState(room)
    if (room.combat.winner) return endFight(room)
  } catch (err) {
    console.error(`room ${room.code}: tick failed`, err)
  }
  if (rooms.get(room.code) === room && room.phase === 'fighting') room.timer = setTimeout(() => tick(room), TICK_MS)
}

/** Remove a seat for good. Mid-fight, that's a forfeit. */
function removeSeat(room: Room, seat: Seat, forfeited: boolean) {
  const i = indexOf(room, seat)
  if (i < 0) return
  if (seat.awayTimer) clearTimeout(seat.awayTimer)
  seatOfToken.delete(seat.token)
  const fighting = room.phase === 'fighting'
  if (fighting) {
    room.combat.forfeit(sideOf(i))
    endFight(room)
  }
  room.seats[i] = null
  const left = room.seats.find(Boolean) ?? null
  if (!left) {
    stopTimer(room)
    rooms.delete(room.code)
    return
  }
  // The remaining player keeps the room (and the code) and moves to seat 0.
  room.seats = [left, null]
  stopTimer(room)
  room.phase = fighting ? 'over' : 'lobby'
  room.ready = [false, false]
  room.pausedAt = null
  send(left.ws, { t: 'oppLeft', forfeited: forfeited || fighting })
  sendLobby(room)
}

function pause(room: Room) {
  if (room.phase === 'fighting' && room.pausedAt === null) room.pausedAt = Date.now()
}
function resumeIfAllHere(room: Room) {
  if (room.pausedAt === null || room.seats.some((s) => s && !s.ws)) return
  room.combat.shift(Date.now() - room.pausedAt)
  room.pausedAt = null
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
    room.ready = [false, false]
  }
  pause(room)
  send(otherSeat(room, seat)?.ws, { t: 'oppAway', ms: GRACE_MS })
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
  send(otherSeat(room, seat)?.ws, { t: 'oppBack' })
  sendLobby(room)
  if (room.phase === 'fighting') {
    send(ws, { t: 'start' })
    resumeIfAllHere(room)
    sendState(room)
  }
}

function relay(room: Room, from: Seat, ev: OppEvent) {
  if (room.phase !== 'fighting' || room.pausedAt !== null) return
  send(otherSeat(room, from)?.ws, { t: 'opp', ev })
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
      const seat: Seat = { token, ws, awayTimer: null }
      const r: Room = { code: newCode(), seats: [seat, null], ready: [false, false], phase: 'lobby', combat: new Combat(), timer: null, pausedAt: null }
      rooms.set(r.code, r)
      seatOfToken.set(token, { room: r, seat })
      sendLobby(r)
      return
    }
    case 'join': {
      const r = rooms.get(String(msg.code ?? '').toUpperCase().trim())
      if (!r) return send(ws, { t: 'error', msg: 'No room with that code.' })
      if (at?.room === r) return
      if (r.seats[0] && r.seats[1]) return send(ws, { t: 'error', msg: 'That room is full.' })
      if (at) removeSeat(at.room, at.seat, false)
      const seat: Seat = { token, ws, awayTimer: null }
      r.seats[r.seats[0] ? 1 : 0] = seat
      seatOfToken.set(token, { room: r, seat })
      r.phase = 'lobby'
      r.ready = [false, false]
      sendLobby(r)
      return
    }
    case 'leave':
      if (at) removeSeat(at.room, at.seat, at.room.phase === 'fighting')
      return
  }
  if (!at) return
  const { room, seat } = at
  const i = indexOf(room, seat)
  switch (msg.t) {
    case 'ready':
      if (room.phase !== 'lobby' && room.phase !== 'over') return
      room.ready[i] = true
      sendLobby(room)
      if (room.seats[0]?.ws && room.seats[1]?.ws && room.ready[0] && room.ready[1]) startCountdown(room)
      return
    case 'forfeit':
      if (room.phase !== 'fighting') return
      room.combat.forfeit(sideOf(i))
      return endFight(room)
  }
  // Casting: the browser only says what it recognized. The fight's rules decide what that does, on
  // the server's clock (charges, readied spells, throws, fizzle lockouts, fades). Nothing while paused.
  // Each decision goes out to both players at once, not on the next tick (the tick is for what
  // happens with nobody acting: spells landing, burns, fades).
  if (room.phase !== 'fighting' || room.pausedAt !== null) return
  const side = sideOf(i)
  const now = Date.now()
  switch (msg.t) {
    case 'sign': {
      const el = typeof msg.el === 'string' ? msg.el.slice(0, 1) : ''
      if (room.combat.sign(side, el, now)) relay(room, seat, { kind: 'charge', el })
      return sendState(room) // even a refusal: it corrects the player's own early display
    }
    case 'stroke':
      if (!Array.isArray(msg.pts)) return
      if (room.combat.drawing(side, now)) sendState(room) // a redraw dropped their readied spell
      return relay(room, seat, {
        kind: 'stroke',
        pts: msg.pts.slice(0, MAX_STROKE_PTS).map((p) => [Number(p?.[0]) || 0, Number(p?.[1]) || 0] as [number, number]),
      })
    case 'drew': {
      const r = room.combat.drew(side, typeof msg.shape === 'string' ? msg.shape.slice(0, 32) : null, now)
      relay(room, seat, r ? { kind: 'readied', el: r.el, shape: r.shape } : { kind: 'cleared' })
      return sendState(room)
    }
    case 'cleared':
      room.combat.strokeCancelled(side)
      return relay(room, seat, { kind: 'cleared' })
    case 'push': {
      const res = room.combat.push(side, now)
      if (res === 'ok') relay(room, seat, { kind: 'cast' })
      else if (res === 'static') relay(room, seat, { kind: 'cleared' })
      room.combat.update(now) // a heal applies at once
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

const wss = new WebSocketServer({ server: http, path: '/ws', maxPayload: MAX_MSG_BYTES })
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
