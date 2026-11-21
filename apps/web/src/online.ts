// Online play: one WebSocket to the game server. The server runs the fight; this mirrors its
// state for the page, relays your casting steps, and builds the opponent's cast from theirs.
import { MAX_HP, type CombatView } from './combat'
import type { Arena, OppCast, Pt01, Snapshot } from './battle'
import type { ClientMsg, OppEvent, ServerMsg } from './protocol'
import { ELEMENTS, spellName } from './spells'

export type OnlinePhase = 'connecting' | 'reconnecting' | 'menu' | 'lobby' | 'countdown' | 'fighting' | 'over' | 'offline'

export interface LobbyInfo {
  phase: OnlinePhase
  code: string | null
  players: number
  ready: [boolean, boolean] // [you, opponent]
  countdownEnds: number | null // performance.now() time
  paused: boolean // fight paused: someone is reconnecting
  oppAwayUntil: number | null // performance.now() time the opponent's seat is held until
  note: string | null // errors, "opponent left"
}

const EMPTY_VIEW: CombatView = {
  hp: { player: MAX_HP, enemy: MAX_HP },
  maxHp: { player: MAX_HP, enemy: MAX_HP },
  silenced: { player: 0, enemy: 0 },
  static: { player: null, enemy: null },
  chill: { player: 0, enemy: 0 },
  burning: { player: false, enemy: false },
  regen: { player: false, enemy: false },
  knocked: { player: 0, enemy: 0 },
  charge: { player: null, enemy: null },
  ready: { player: null, enemy: null },
  fizzled: { player: 0, enemy: 0 },
  notes: [],
  dealt: { player: 0, enemy: 0 },
  floats: [],
  bolts: [],
  over: null,
}

const wsUrl = () => `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`
const RETRY_MS = 1500
const RETRY_FOR_MS = 20000 // the server holds your seat 15 s; keep trying a little longer

/** Who you are to the server. Per tab, kept across refreshes, so a refresh rejoins your room. */
function sessionToken() {
  try {
    let t = sessionStorage.getItem('spells-token')
    if (!t) sessionStorage.setItem('spells-token', (t = crypto.randomUUID()))
    return t
  } catch {
    return crypto.randomUUID()
  }
}
/** Remember that this tab is in an online room, so a refresh reopens online mode. */
export function setOnlineFlag(on: boolean) {
  try {
    if (on) sessionStorage.setItem('spells-online', '1')
    else sessionStorage.removeItem('spells-online')
  } catch {
    /* ignore */
  }
}
export function getOnlineFlag() {
  try {
    return sessionStorage.getItem('spells-online') === '1'
  } catch {
    return false
  }
}

export class OnlineArena implements Arena {
  private ws!: WebSocket
  private token = sessionToken()
  private closed = false
  private droppedAt: number | null = null
  private view: CombatView = EMPTY_VIEW
  private opp: OppCast | null = null
  private outbox: Pt01[] = [] // your stroke points, sent in batches
  private outAspect = 16 / 9 // your visible view's width / height
  info: LobbyInfo = {
    phase: 'connecting',
    code: null,
    players: 0,
    ready: [false, false],
    countdownEnds: null,
    paused: false,
    oppAwayUntil: null,
    note: null,
  }

  constructor() {
    this.connect()
  }

  private connect() {
    const ws = (this.ws = new WebSocket(wsUrl()))
    ws.onopen = () => {
      this.droppedAt = null
      ws.send(JSON.stringify({ t: 'hello', token: this.token } satisfies ClientMsg))
    }
    ws.onmessage = (e) => this.onMessage(JSON.parse(e.data) as ServerMsg)
    ws.onclose = () => {
      if (this.closed || ws !== this.ws) return
      // Lost the connection: keep retrying with the same token; the server holds our seat.
      this.droppedAt ??= performance.now()
      if (performance.now() - this.droppedAt > RETRY_FOR_MS) {
        this.info = { ...this.info, phase: 'offline', note: 'Disconnected from the server.' }
        return
      }
      this.info = { ...this.info, phase: 'reconnecting' }
      setTimeout(() => !this.closed && this.connect(), RETRY_MS)
    }
  }

  close() {
    this.closed = true
    this.ws.close()
  }

  private send(msg: ClientMsg) {
    if (this.ws.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(msg))
  }

  // Lobby actions
  create() {
    this.info = { ...this.info, note: null }
    this.send({ t: 'create' })
  }
  join(code: string) {
    this.info = { ...this.info, note: null }
    this.send({ t: 'join', code })
  }
  ready() {
    this.send({ t: 'ready' })
  }
  forfeit() {
    this.send({ t: 'forfeit' })
  }
  leave() {
    this.send({ t: 'leave' })
    setOnlineFlag(false)
    this.opp = null
    this.view = EMPTY_VIEW
    this.info = { ...this.info, phase: 'menu', code: null, players: 0, paused: false, oppAwayUntil: null, note: null }
  }

  private onMessage(m: ServerMsg) {
    switch (m.t) {
      case 'welcome':
        // Not resumed = fresh start (or our seat expired): show the menu.
        if (!m.resumed) this.info = { ...this.info, phase: 'menu', code: null, players: 0 }
        return
      case 'lobby': {
        setOnlineFlag(true)
        const was = this.info.phase
        // Mid-fight lobby updates (someone reconnecting) don't end the fight; the result arrives in 'state'.
        // After a fight, keep showing the result until someone readies up.
        const phase =
          was === 'fighting' ? 'fighting' : was === 'over' && !m.ready.some(Boolean) ? 'over' : 'lobby'
        this.info = { ...this.info, phase, code: m.code, players: m.players, ready: m.ready, countdownEnds: null }
        if (m.players < 2) this.opp = null
        return
      }
      case 'countdown':
        this.view = EMPTY_VIEW
        this.opp = null
        this.info = { ...this.info, phase: 'countdown', countdownEnds: performance.now() + m.ms, note: null }
        return
      case 'start':
        this.info = { ...this.info, phase: 'fighting', countdownEnds: null }
        return
      case 'state':
        this.view = m.view
        this.info = { ...this.info, paused: m.paused, ...(m.view.over ? { phase: 'over' as const } : {}) }
        return
      case 'opp':
        return this.onOpp(m.ev)
      case 'oppAway':
        this.opp = null
        this.info = { ...this.info, oppAwayUntil: performance.now() + m.ms, note: null }
        return
      case 'oppBack':
        this.info = { ...this.info, oppAwayUntil: null, note: null }
        return
      case 'oppLeft':
        this.opp = null
        this.info = {
          ...this.info,
          phase: m.forfeited ? 'over' : 'lobby',
          oppAwayUntil: null,
          paused: false,
          note: `Your opponent ${m.forfeited ? 'forfeited' : 'left'}. Share the code to play someone else.`,
        }
        return
      case 'error':
        this.info = { ...this.info, note: m.msg }
        return
    }
  }

  private onOpp(ev: OppEvent) {
    const colorOf = (el: string | null) => (el && ELEMENTS[el] ? ELEMENTS[el].color : '#cccccc')
    const base = (el: string | null): OppCast => ({ el: el ?? '?', name: null, color: colorOf(el), phase: 'charge', points: [], view: { aspect: 16 / 9, fit: 'cover' }, progress: null })
    switch (ev.kind) {
      case 'charge':
        this.opp = ev.el ? { ...(this.opp ?? base(ev.el)), el: ev.el, color: colorOf(ev.el) } : this.opp?.points.length ? this.opp : null
        return
      case 'stroke': {
        const o = this.opp ?? base(null)
        // Fractions of what they saw in their window; shown filling this panel the same way.
        const pts = ev.pts.map(([x, y]) => ({ x, y }))
        this.opp = { ...o, phase: 'draw', name: null, points: [...o.points, ...pts].slice(-600), view: { aspect: ev.a, fit: 'cover' } }
        return
      }
      case 'readied':
        this.opp = { ...(this.opp ?? base(ev.el)), el: ev.el, color: colorOf(ev.el), phase: 'ready', name: spellName(ev.el, ev.shape) }
        return
      case 'cleared':
        this.opp = this.opp && this.opp.el !== '?' ? { ...this.opp, phase: 'charge', points: [], name: null } : null
        return
      case 'cast':
        this.opp = null
        return
    }
  }

  // What you did → the server, which decides what it means (and tells the opponent)
  sign(el: string) {
    this.send({ t: 'sign', el })
  }
  stroke(points: Pt01[], aspect: number) {
    this.outbox.push(...points)
    this.outAspect = aspect
  }
  drew(shape: string | null) {
    this.flush()
    this.send({ t: 'drew', shape })
  }
  cleared() {
    this.outbox = []
    this.send({ t: 'cleared' })
  }
  push() {
    this.send({ t: 'push' })
  }

  private flush() {
    if (!this.outbox.length) return
    this.send({ t: 'stroke', a: Math.round(this.outAspect * 1000) / 1000, pts: this.outbox.map((p) => [Math.round(p.x * 1000) / 1000, Math.round(p.y * 1000) / 1000]) })
    this.outbox = []
  }

  update(): Snapshot {
    if (this.info.phase === 'fighting') this.flush() // ~20 batches a second (the page calls this every 50 ms)
    // The server's state wins: a readied spell that faded, or a charge that's gone (silenced, faded).
    const o = this.opp
    if (o?.phase === 'ready' && !this.view.ready.enemy) this.opp = null
    else if (o?.phase === 'charge' && !this.view.charge.enemy) this.opp = null
    return { ...this.view, enemyCast: this.opp, running: this.info.phase === 'fighting' }
  }
}
