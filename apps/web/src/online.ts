// Online play: one WebSocket to the game server. The server runs the fight; this mirrors its
// state for the page, relays your casting steps, and builds the opponent's cast from theirs.
import { MAX_HP, type CombatView, type Fid } from './combat'
import { spellOf, type Arena, type OppCast, type Pt01 } from './battle'
import type { ClientMsg, DuoRoom, OppEvent, SeatInfo, ServerMsg } from './protocol'
import type { BotInfo } from './duo'
import type { TeamSnapshot } from './team'
import { chargeInfo, spellName } from './spells'

export type OnlinePhase = 'connecting' | 'reconnecting' | 'menu' | 'lobby' | 'countdown' | 'fighting' | 'over' | 'offline'

export interface LobbyInfo {
  phase: OnlinePhase
  code: string | null
  seats: SeatInfo[] // everyone in the room (team, ready, HP, connected)
  you: number // your seat
  host: number // the seat that sets HP
  countdownEnds: number | null // performance.now() time
  paused: boolean // fight paused: a whole team is reconnecting
  awayUntil: number | null // performance.now() time a disconnected player's seat is held until
  note: string | null // errors, "a player left"
  forfeit: { votes: number; needed: number; mine: boolean } | null // your team's forfeit vote, if one is going
  duo: DuoRoom | null // a Duo Tower room (you two against a pair of bots)
}

const EMPTY_VIEW: CombatView = {
  fighters: [
    { id: 'player', team: 'player', maxHp: MAX_HP },
    { id: 'enemy', team: 'enemy', maxHp: MAX_HP },
  ],
  aim: { player: null, enemy: null },
  hp: { player: MAX_HP, enemy: MAX_HP },
  maxHp: { player: MAX_HP, enemy: MAX_HP },
  silenced: { player: 0, enemy: 0 },
  static: { player: null, enemy: null },
  chill: { player: 0, enemy: 0 },
  chillMs: { player: 0, enemy: 0 },
  burning: { player: false, enemy: false },
  regen: { player: false, enemy: false },
  knocked: { player: 0, enemy: 0 },
  charge: { player: null, enemy: null },
  mix: { player: [], enemy: [] },
  shield: { player: 0, enemy: 0 },
  mirror: { player: 0, enemy: 0 },
  doom: { player: 0, enemy: 0 },
  shroud: { player: 0, enemy: 0 },
  guard: { player: 0, enemy: 0 },
  exposed: { player: 0, enemy: 0 },
  fog: { player: 0, enemy: 0 },
  fogShots: { player: 0, enemy: 0 },
  noHeal: { player: 0, enemy: 0 },
  wear: { player: {}, enemy: {} },
  glacier: { player: 0, enemy: 0 },
  storm: { player: false, enemy: false },
  ready: { player: null, enemy: null },
  fizzled: { player: 0, enemy: 0 },
  staggered: { player: 0, enemy: 0 },
  locked: { player: 0, enemy: 0 },
  recover: { player: 0, enemy: 0 },
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
/** Duo Tower floors you've cleared (this browser). The room unlocks one past the best of its players. */
export function duoProgress() {
  try {
    return Math.max(0, Number(localStorage.getItem('duo-progress')) || 0)
  } catch {
    return 0
  }
}
function saveDuoProgress(floor: number) {
  try {
    if (floor > duoProgress()) localStorage.setItem('duo-progress', String(floor))
  } catch {
    /* ignore */
  }
}

/** Remember that this tab is in an online room, so a refresh reopens online mode. */
export function setOnlineFlag(on: boolean, page: 'online' | 'duo' = 'online') {
  try {
    if (on) sessionStorage.setItem('spells-online', page)
    else sessionStorage.removeItem('spells-online')
  } catch {
    /* ignore */
  }
}
/** The page this tab's online room belongs to (Duel or the Tower's Duo), or null. */
export function getOnlineFlag(): 'online' | 'duo' | null {
  try {
    const v = sessionStorage.getItem('spells-online')
    return v === 'duo' ? 'duo' : v ? 'online' : null
  } catch {
    return null
  }
}

export class OnlineArena implements Arena {
  private ws!: WebSocket
  private token = sessionToken()
  private closed = false
  private droppedAt: number | null = null
  private view: CombatView = EMPTY_VIEW
  private conn: Record<Fid, 'away' | 'left'> = {}
  private casts: Record<Fid, OppCast | null> = {} // everyone else's spell in progress, by their id as you see them
  private bots: Record<Fid, BotInfo> = {} // Duo Tower: the pair, as the server runs them
  private botPts = new Map<string, Pt01[]>() // each bot cast's drawing (the server sends just its shape and progress)
  private sentAim: Fid | null | undefined = undefined
  private outbox: Pt01[] = [] // your stroke points, sent in batches
  private outAspect = 16 / 9 // your visible view's width / height
  info: LobbyInfo = {
    phase: 'connecting',
    code: null,
    seats: [],
    you: 0,
    host: 0,
    countdownEnds: null,
    paused: false,
    awayUntil: null,
    note: null,
    forfeit: null,
    duo: null,
  }

  readonly duo: boolean // opened from the Tower's Duo: it makes and joins Duo Tower rooms only
  constructor(duo = false) {
    this.duo = duo
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
    this.send({ t: 'create', progress: duoProgress(), duo: this.duo })
  }
  join(code: string) {
    this.info = { ...this.info, note: null }
    this.send({ t: 'join', code, progress: duoProgress(), duo: this.duo })
  }
  ready() {
    this.send({ t: 'ready' })
  }
  unready() {
    this.send({ t: 'unready' })
  }
  forfeit() {
    this.send({ t: 'forfeit' })
  }
  switchTeam() {
    this.send({ t: 'team' })
  }
  /** Host: the Duo Tower floor to fight. */
  setFloor(floor: number) {
    this.send({ t: 'floor', floor })
  }
  /** Host: a player's max HP for the next match. */
  setHp(seat: number, hp: number) {
    this.send({ t: 'hp', seat, hp })
  }
  leave() {
    this.send({ t: 'leave' })
    setOnlineFlag(false)
    this.casts = {}
    this.view = EMPTY_VIEW
    this.conn = {}
    this.bots = {}
    this.info = { ...this.info, phase: 'menu', code: null, seats: [], paused: false, awayUntil: null, note: null }
  }

  private onMessage(m: ServerMsg) {
    switch (m.t) {
      case 'welcome':
        // Not resumed = fresh start (or our seat expired): show the menu.
        if (!m.resumed) this.info = { ...this.info, phase: 'menu', code: null, seats: [] }
        return
      case 'lobby': {
        setOnlineFlag(true, this.duo ? 'duo' : 'online')
        const was = this.info.phase
        // Mid-fight lobby updates (someone reconnecting) don't end the fight; the result arrives in 'state'.
        // After a fight, keep showing the result until someone readies up.
        const phase = was === 'fighting' ? 'fighting' : was === 'over' && !m.seats.some((s) => s.ready) ? 'over' : 'lobby'
        this.info = { ...this.info, phase, code: m.code, seats: m.seats, you: m.you, host: m.host, countdownEnds: null, duo: m.duo ?? null }
        if (!m.seats.some((s) => !s.here)) this.info.awayUntil = null
        return
      }
      case 'countdown':
        this.view = EMPTY_VIEW
        this.conn = {}
        this.bots = {}
        this.casts = {}
        this.sentAim = undefined
        this.info = { ...this.info, phase: 'countdown', countdownEnds: performance.now() + m.ms, note: null, forfeit: null }
        return
      case 'start':
        this.info = { ...this.info, phase: 'fighting', countdownEnds: null }
        return
      case 'state':
        this.view = m.view
        this.conn = m.conn ?? {}
        this.bots = m.bots ?? {}
        // A Duo Tower floor cleared: this browser remembers it (the room then moves on to the next floor).
        if (m.view.over === 'player' && this.info.duo && this.info.phase === 'fighting') saveDuoProgress(this.info.duo.floor)
        this.info = { ...this.info, paused: m.paused, ...(m.view.over ? { phase: 'over' as const } : {}) }
        return
      case 'opp':
        return this.onOpp(m.from, m.ev)
      case 'away':
        this.info = { ...this.info, awayUntil: performance.now() + m.ms, note: null }
        return
      case 'back':
        this.info = { ...this.info, awayUntil: null, note: null }
        return
      case 'left':
        this.info = { ...this.info, awayUntil: null, note: m.forfeited ? 'A player left the match.' : 'A player left the room.' }
        return
      case 'forfeitVote':
        this.info = { ...this.info, forfeit: m.needed ? { votes: m.votes, needed: m.needed, mine: m.mine } : null }
        return
      case 'error':
        this.info = { ...this.info, note: m.msg }
        return
    }
  }

  private onOpp(from: Fid, ev: OppEvent) {
    const colorOf = (el: string | null) => (el ? chargeInfo(el).color : '#cccccc')
    const base = (el: string | null): OppCast => ({ el: el ?? '?', name: null, color: colorOf(el), phase: 'charge', points: [], view: { aspect: 16 / 9, fit: 'cover' }, progress: null })
    const cur = this.casts[from] ?? null
    const set = (c: OppCast | null) => (this.casts[from] = c)
    switch (ev.kind) {
      case 'charge':
        set(ev.el ? { ...(cur ?? base(ev.el)), el: ev.el, color: colorOf(ev.el) } : cur?.points.length ? cur : null)
        return
      case 'stroke': {
        const o = cur ?? base(null)
        // Fractions of what they saw in their window; shown filling this panel the same way.
        const pts = ev.pts.map(([x, y]) => ({ x, y }))
        set({ ...o, phase: 'draw', name: null, points: [...o.points, ...pts].slice(-600), view: { aspect: ev.a, fit: 'cover' } })
        return
      }
      case 'readied':
        set({ ...(cur ?? base(ev.el)), el: ev.el, color: colorOf(ev.el), phase: 'ready', name: spellName(ev.el, ev.shape) })
        return
      case 'cleared':
        set(cur && cur.el !== '?' ? { ...cur, phase: 'charge', points: [], name: null } : null)
        return
      case 'cast':
        set(null)
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
  /** Team fights: who your next throw goes to (sent only when it changes). */
  aim(target: Fid | null) {
    if (target === this.sentAim) return
    this.sentAim = target
    this.send({ t: 'aim', target })
  }
  parry() {
    this.send({ t: 'parry' })
  }
  uncharge() {
    this.send({ t: 'uncharge' })
  }

  private flush() {
    if (!this.outbox.length) return
    this.send({ t: 'stroke', a: Math.round(this.outAspect * 1000) / 1000, pts: this.outbox.map((p) => [Math.round(p.x * 1000) / 1000, Math.round(p.y * 1000) / 1000]) })
    this.outbox = []
  }

  update(): TeamSnapshot {
    if (this.info.phase === 'fighting') this.flush() // ~20 batches a second (the page calls this every 50 ms)
    // The server's state wins: a readied spell that faded, or a charge that's gone (silenced, faded).
    for (const [id, o] of Object.entries(this.casts)) {
      if (o?.phase === 'ready' && !this.view.ready[id]) this.casts[id] = null
      else if (o?.phase === 'charge' && !this.view.charge[id]) this.casts[id] = null
    }
    const casts = { ...this.casts, ...this.botCasts() }
    return { ...this.view, casts, enemyCast: casts.enemy ?? null, conn: this.conn, bots: this.bots, running: this.info.phase === 'fighting' }
  }

  /** The bots' spells in progress, drawn here from what the server says (shape and how far along). */
  private botCasts(): Record<Fid, OppCast | null> {
    const out: Record<Fid, OppCast | null> = {}
    for (const [id, b] of Object.entries(this.bots)) {
      const c = b.cast
      if (!c) {
        out[id] = null
        continue
      }
      const key = `${id}:${c.id}:${c.el}:${c.shape}`
      let pts = this.botPts.get(key)
      if (!pts) {
        if (this.botPts.size > 40) this.botPts.clear()
        this.botPts.set(key, (pts = spellOf(c.el, c.shape, 1).points))
      }
      out[id] = {
        el: c.el,
        name: c.name,
        color: chargeInfo(c.el).color,
        phase: c.phase,
        points: c.phase === 'charge' ? [] : pts.slice(0, Math.max(0, Math.ceil(c.drawn * pts.length))),
        view: { aspect: 1, fit: 'contain' },
        progress: c.progress,
      }
    }
    return out
  }
}
