// Load test: many fake players in many rooms, fighting on a loop, against a running game server.
//   npm run loadtest --prefix server -- [rooms=50] [size=2|4] [seconds=30] [url=ws://localhost:8787/ws]
// Each fake player casts a Fire line every few seconds (sign, stroke batches, drew, push), like a real
// player's message pattern. Prints what each player receives (real bytes on the wire, after compression)
// and how fast the server answers. Run the server with STATS=1 to see its side (CPU, event-loop lag).
import { WebSocket } from 'ws'
import { randomUUID } from 'node:crypto'

const arg = (i: number, d: string) => process.argv[2 + i] ?? d
const ROOMS = Number(arg(0, '50'))
const SIZE = Number(arg(1, '2')) // players per room: 2 = 1v1, 4 = 2v2
const SECONDS = Number(arg(2, '30'))
const URL = arg(3, 'ws://localhost:8787/ws')

interface Bot {
  ws: WebSocket
  fighting: boolean
  msgs: number
  jsonBytes: number
  wireStart: number
  pingSent: number
  rtts: number[]
}
const bots: Bot[] = []
const fieldCount = new Map<string, number>() // how often each state field was sent (what drives the traffic)
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
const wire = (b: Bot) => (b.ws as unknown as { _socket?: { bytesRead: number } })._socket?.bytesRead ?? 0

function connect(): Promise<Bot> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(URL, { perMessageDeflate: process.env.NODEFLATE ? false : true }) // browsers negotiate compression too
    const bot: Bot = { ws, fighting: false, msgs: 0, jsonBytes: 0, wireStart: 0, pingSent: 0, rtts: [] }
    ws.on('open', () => {
      ws.send(JSON.stringify({ t: 'hello', token: randomUUID() }))
      resolve(bot)
    })
    ws.on('error', reject)
    ws.on('message', (data) => {
      const s = String(data)
      bot.msgs++
      bot.jsonBytes += s.length
      const m = JSON.parse(s)
      if (m.t === 'start') bot.fighting = true
      if (m.t === 'state') for (const k of Object.keys(m.d)) fieldCount.set(k, (fieldCount.get(k) ?? 0) + 1)
      if (m.t === 'lobby' && bot.fighting) {
        // A match ended: ready up again so the room keeps fighting.
        bot.fighting = false
        ws.send(JSON.stringify({ t: 'ready' }))
      }
      // Round trip: a 'sign' is answered with a state update at once.
      if (m.t === 'state' && bot.pingSent) {
        bot.rtts.push(performance.now() - bot.pingSent)
        bot.pingSent = 0
      }
    })
  })
}

async function room() {
  const host = await connect()
  const code: string = await new Promise((resolve) => {
    host.ws.on('message', function on(d) {
      const m = JSON.parse(String(d))
      if (m.t === 'lobby') {
        host.ws.off('message', on)
        resolve(m.code)
      }
    })
    host.ws.send(JSON.stringify({ t: 'create' }))
  })
  const members = [host]
  for (let i = 1; i < SIZE; i++) {
    const b = await connect()
    b.ws.send(JSON.stringify({ t: 'join', code }))
    members.push(b)
  }
  await sleep(200)
  for (const b of members) b.ws.send(JSON.stringify({ t: 'ready' }))
  bots.push(...members)
}

/** One cast, the way a browser sends it: sign, ~20 stroke batches a second for ~0.6 s, drew, push. */
async function cast(b: Bot) {
  if (!b.fighting || b.ws.readyState !== b.ws.OPEN) return
  const send = (m: object) => b.ws.readyState === b.ws.OPEN && b.ws.send(JSON.stringify(m))
  b.pingSent = performance.now()
  send({ t: 'sign', el: 'F' })
  await sleep(300)
  for (let i = 0; i < 12; i++) {
    // A diagonal line (a light attack): the server reads drawings itself, so the stroke has to be real.
    send({ t: 'stroke', a: 1.778, pts: [0, 1, 2].map((k) => [Math.round((0.3 + (i * 3 + k) * 0.012) * 1e4) / 1e4, Math.round((0.7 - (i * 3 + k) * 0.012) * 1e4) / 1e4]) })
    await sleep(50)
  }
  send({ t: 'drew', shape: 'line' })
  await sleep(200)
  send({ t: 'push' })
}

async function main() {
  console.log(`${ROOMS} rooms x ${SIZE} players = ${ROOMS * SIZE} clients, ${SECONDS} s, ${URL}`)
  for (let i = 0; i < ROOMS; i++) await room()
  await sleep(4000) // countdown
  const t0 = performance.now()
  for (const b of bots) {
    b.msgs = 0
    b.jsonBytes = 0
    b.wireStart = wire(b)
    b.rtts = []
  }
  fieldCount.clear()
  // Every player casts every 2-4 s, at random offsets.
  const loops = bots.map(async (b) => {
    await sleep(Math.random() * 3000)
    while (performance.now() - t0 < SECONDS * 1000) {
      await cast(b)
      await sleep(2000 + Math.random() * 2000)
    }
  })
  await Promise.all(loops)
  const secs = (performance.now() - t0) / 1000
  const total = bots.length
  const wireBytes = bots.reduce((s, b) => s + wire(b) - b.wireStart, 0)
  const json = bots.reduce((s, b) => s + b.jsonBytes, 0)
  const msgs = bots.reduce((s, b) => s + b.msgs, 0)
  const rtts = bots.flatMap((b) => b.rtts).sort((a, b) => a - b)
  const pct = (p: number) => (rtts.length ? rtts[Math.min(rtts.length - 1, Math.floor(p * rtts.length))].toFixed(1) : '-')
  const perPlayer = wireBytes / total / secs
  console.log(`per player:  ${(msgs / total / secs).toFixed(1)} msgs/s, ${(json / total / secs / 1024).toFixed(1)} KB/s JSON, ${(perPlayer / 1024).toFixed(1)} KB/s on the wire`)
  console.log(`all players: ${((wireBytes / secs) * 8 / 1e6).toFixed(2)} Mbit/s out of the server; ${((perPlayer * 1000 * 3600) / 1e9).toFixed(1)} GB per hour at 1,000 players`)
  console.log(`reply time (sign -> state): median ${pct(0.5)} ms, p95 ${pct(0.95)} ms, p99 ${pct(0.99)} ms`)
  const top = [...fieldCount].sort((a, b) => b[1] - a[1]).slice(0, 8)
  console.log(`most sent fields (per player per s): ${top.map(([k, n]) => `${k} ${(n / total / secs).toFixed(1)}`).join(', ')}`)
  for (const b of bots) b.ws.close()
  process.exit(0)
}
main().catch((e) => {
  console.error(e)
  process.exit(1)
})
