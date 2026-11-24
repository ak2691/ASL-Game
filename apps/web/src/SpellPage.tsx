// Spellcasting prototype: sign an element letter to charge, then pinch (or point) and draw a shape.
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { DrawingUtils, HandLandmarker, type NormalizedLandmark } from '@mediapipe/tasks-vision'
import { openCamera, type CameraInfo } from './camera'
import { classify, loadRecognizer, trueShape, type Hand } from './recognition'
import { directionLetter, passesGate } from './rules'
import { getTracker, type Handed } from './trackers'
import { LandmarkSmoother } from './smoothing'
import { CastGuide } from './CastGuide'
import { loadShapeModel, pathLength, recognizeShape, shapeFeatures, type Pt } from './shapes'
import { STRICT_SHAPES, BEATS, canQuick, COMBO, COMBOS_ON, COUNTER, ELEMENTS, chargeInfo, QUICK, isValidSpell, shapesFor, signsFor, COMBO_SHAPE, COMBO_MIX, spellName } from './spells'
import { Tower } from './Ladder'
import { DummyArena, PracticeArena, beaterOf, shapePoints, spellOf, type Arena, type Difficulty, type Snapshot } from './battle'
import { BoltLayer, Impacts, ParryRings, StatusFx, setLocalBoltClock, useShake } from './effects'
import { PARRY_WINDOW_MS, type Bolt, type Fid } from './combat'
import { TeamArena, type TeamSnapshot } from './team'
import { HP_MAX, HP_MIN, TEAM_MAX } from './protocol'
import { pencil, play, useFightSfx } from './sfx'
import { VolumeSlider } from './VolumeSlider'
import { DRAW_HAND_KEY, TWO_HANDS_KEY, getPushGrowth, loadDrawHand, loadDummyPool, saveDummyPool, loadTwoHands, DUMMY_POOL2_KEY, loadDummyTwo, saveDummyTwo, loadDummyPace, saveDummyPace, CAST_PCT, GAP_MS, type DummyPace, loadDummyAids, saveDummyAids, type DummyAids } from './settings'
import { PushSlider } from './PushSlider'
import { DummySpells } from './DummySpells'
import { GEAR, Icon } from './HomeCorner'

const RESET = 'M3 12a9 9 0 1 0 3-6.7 M3 4v5h5'
import { OnlineArena, setOnlineFlag, type LobbyInfo } from './online'
import { Tutorial } from './Tutorial'

// ?debug: cast with buttons, no camera needed. Local dev server only (npm run dev): the deployed build
// drops it, since its cast buttons skip signing.
const DEBUG = import.meta.env.DEV && new URLSearchParams(location.search).has('debug')

// ?debug: every finished stroke is kept (points + what it was read as), to download and tune
// the recognizer on real finger strokes. Points are fingertip pixels; no video, nothing uploaded.
interface StrokeRecord {
  t: string
  charge: string | null
  points: [number, number][]
  read: string
  score: number
  rejected: string | null
  corners: number
  turns: number
}
const strokeLog: StrokeRecord[] = []
function downloadStrokes() {
  const blob = new Blob([JSON.stringify(strokeLog)], { type: 'application/json' })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = `strokes-${new Date().toISOString().slice(0, 19).replace(/:/g, '-')}.json`
  a.click()
  URL.revokeObjectURL(a.href)
}

const CHARGE_PROB = 0.75 // letter model confidence needed to charge an element...
const CHARGE_MS = 50 // ...held this long (two fight ticks)
const UNCHARGE_MS = 150 // an open hand held this long while charged (nothing drawn) drops the charge: kept longer so a passing open hand doesn't
// A stroke ends right away only on a deliberate pen-up (a second finger raised). Losing the
// hand or a blurry index (fast moves) keeps the stroke open this long; the gap is bridged.
const LOST_GRACE_MS = 400
// Two hands: a hand lost on a fast move never ends the drawing; when it's back, the line joins up from
// where it was last seen. Only a hand gone this long (out of frame, put down) ends it.
const TWO_LOST_MS = 3000
// Fast moves blur the fingers together and can fake a raised finger for a frame or two. So the
// pen-up must be held this long, and only counts while the hand is moving slower than this.
const PEN_UP_HOLD_MS = 100
const PEN_UP_MAX_SPEED = 4 // palm-widths per second
// Opening your hand while already moving fast (straight into a push) still ends the stroke, just a bit later
// (blur can fake an open hand for a frame or two, so it has to last).
const FAST_PEN_UP_MS = 180
// Push to throw: a readied spell is thrown when the hand grows this much on screen within the window.
const PUSH_WINDOW_MS = 300
const PUSH_EVEN = 0.6 // a push grows the palm's width and length each by at least this share of the push size
const UI_TICK_MS = 25 // how often the fight is advanced and redrawn
/** The palm, measured for push detection, in 3D (the tracker's depth estimate, on x's scale): its size
 *  (three edges: wrist, index knuckle, pinky knuckle), its width (knuckle to knuckle) and its length (wrist
 *  to middle knuckle). On screen alone, turning the hand edge-on shrinks it and turning back "grows" it. */
type PalmSample = { t: number; s: number; w: number; l: number }
function palmSample(h: NormalizedLandmark[], W: number, H: number, t: number): PalmSample {
  const e = (a: number, b: number) => Math.hypot((h[a].x - h[b].x) * W, (h[a].y - h[b].y) * H, (h[a].z - h[b].z) * W)
  return { t, s: (e(0, 5) + e(0, 17) + e(5, 17)) / 3, w: e(5, 17), l: e(0, 9) }
}
const growth = (buf: PalmSample[], k: 's' | 'w' | 'l') => (buf.length > 1 ? buf[buf.length - 1][k] / Math.min(...buf.map((x) => x[k])) : 1)
/** A push: the palm grew by the chosen size within PUSH_WINDOW_MS, and evenly. Coming closer grows its
 *  width and its length together; a turn mostly changes one (side to side: the width; a tilt: the length). */
function isPush(buf: PalmSample[]) {
  const g = getPushGrowth()
  const each = 1 + (g - 1) * PUSH_EVEN
  return growth(buf, 's') >= g && growth(buf, 'w') >= each && growth(buf, 'l') >= each
}
const PENCIL_FAST = 0.2 // drawing sound: this much fingertip travel per frame (palm units) is full volume
// Parry (prototype, plans/parry.md): both hands push at once. The drawing hand must reach the same growth,
// at most PARRY_SYNC_MS before or after the signing hand. Shape is never read, only size on screen.
const PARRY_SYNC_MS = 100
const PARRY_COOLDOWN_MS = 500
// Drawing hand halfway into a push (of the push size you picked): the throw waits for it.
const parryPendingGrowth = () => 1 + (getPushGrowth() - 1) / 2
const MIN_STROKE_PALMS = 0.8 // shorter strokes fizzle (too short to be a shape). Was 1.2: lines (one segment) had to be far bigger than a W
const NOISE_STROKE_PALMS = 0.5 // shorter still = just settling the hand, ignored (no fizzle)
const MATCH_SCORE = 0.7 // network probability needed to count as a shape
const SIGNATURE_SCORE = 0.9 // signatures are stricter
const DROPOUT_MS = 150
const RELEASE_MS = 100 // after a throw, letting go of the letter this long frees it to charge again
const REHOLD_MS = 400 // ...or keep holding it this long after the throw (charges again without letting go)
const PREDICT_MS = 400 // how long a just-signed charge shows before the fight must confirm it

const THUMB_OUT = 0.75 // thumb tip this far from the middle knuckle (palm sizes) = out
const L_VETO_PROB = 0.6 // the letter model this sure it sees L = signing Lightning, not drawing

const dist = (a: NormalizedLandmark, b: NormalizedLandmark) => Math.hypot(a.x - b.x, a.y - b.y)

/** Pen down = pointing: index straight, the other three fingers curled, thumb tucked (not L). */
function isPointing(lm: NormalizedLandmark[]) {
  const w = lm[0]
  const straight = dist(w, lm[8]) > dist(w, lm[6]) * 1.15
  const curled = [12, 16, 20].every((tip) => dist(w, lm[tip]) < dist(w, lm[tip - 2]) * 1.05)
  return straight && curled && !thumbOut(lm)
}

/** Thumb noticeably out to the side (as in L): not drawing. Tip-to-middle-knuckle, in palm sizes. */
function thumbOut(lm: NormalizedLandmark[]) {
  return dist(lm[4], lm[9]) / (dist(lm[0], lm[9]) || 1) > THUMB_OUT
}

/** Pen-up: an open hand. Default: all five fingers up (a "5" is no letter, so it can't be mistaken
 *  for a sign). (`easy`, any second finger up, is no longer offered.) */
function isOpen(lm: NormalizedLandmark[], easy: boolean) {
  const w = lm[0]
  const up = (tip: number) => dist(w, lm[tip]) > dist(w, lm[tip - 2]) * 1.15
  if (easy) return thumbOut(lm) || [12, 16, 20].some(up)
  return thumbOut(lm) && [8, 12, 16, 20].every(up)
}
// Two hands: the drawing hand's index tip is the pen, always. The signing hand works the pen: while
// you're charged, holding an element letter (or C) is pen down, an open hand (all five up) is pen up and
// finishes the drawing. Anything in between keeps the pen as it was. Then push to throw.
const PEN_SWITCH_MS = 50 // the signing hand must hold a change (letter / open) this long to flip the pen
type Wrist = { x: number; y: number } | null
const HANDED_SURE = 0.75 // MediaPipe's left/right label is trusted from this score up
const HANDED_LEARN = 30 // clear frames used to learn MediaPipe's label convention (then it's fixed)
/** MediaPipe labels hands as if the image were mirrored. Ours isn't, so its "Left" should be the player's
 *  right hand, but rather than trust that, it's learned: whenever both hands are clearly apart and
 *  uncrossed (the player's right hand on the left of the frame), each label is checked against its side. */
const handedVotes = { flipped: 0, straight: 0 }
const playerHandOf = (label: 'Left' | 'Right'): Hand => {
  const flipped = handedVotes.flipped >= handedVotes.straight
  return (label === 'Left') === flipped ? 'right' : 'left'
}
/** Which hand signs and which draws. The hand you set to draw always draws: MediaPipe says which hand is
 *  which (its left/right label). Only when it isn't sure (hands crossing, overlapping) does each hand keep
 *  its role by following where it was last frame; the next clear frame puts any mix-up right again.
 *  The video isn't mirrored, so the player's right hand is on the left of the frame (smaller x). */
function splitHands(hands: NormalizedLandmark[][], handed: Handed[], signHand: Hand, prev: { sign: Wrist; draw: Wrist }) {
  const signLeftInFrame = signHand === 'right'
  const sure = (i: number) => (handed[i]?.label && handed[i].score >= HANDED_SURE ? handed[i].label : null)
  if (hands.length >= 2) {
    const [ia, ib] = [0, 1].sort((p, q) => hands[p][0].x - hands[q][0].x) // ia: left of the frame
    const [a, b] = [hands[ia], hands[ib]]
    const la = sure(ia)
    const lb = sure(ib)
    // Learn the label convention from the first clear frames (hands well apart, labels disagree), then
    // keep it: crossing your hands to aim later can't unlearn it. Hands start uncrossed, so the hand on
    // the frame's left is the player's right.
    if (la && lb && la !== lb && b[0].x - a[0].x > 0.25 && handedVotes.flipped + handedVotes.straight < HANDED_LEARN) {
      if (la === 'Left') handedVotes.flipped++
      else handedVotes.straight++
    }
    if (la && lb && la !== lb) return playerHandOf(la) === signHand ? { sign: a, draw: b } : { sign: b, draw: a }
    if (la && !lb) return playerHandOf(la) === signHand ? { sign: a, draw: b } : { sign: b, draw: a }
    if (lb && !la) return playerHandOf(lb) === signHand ? { sign: b, draw: a } : { sign: a, draw: b }
    // Not sure which is which: follow where each hand was last frame.
    if (prev.sign && prev.draw) {
      const d = (h: NormalizedLandmark[], w: { x: number; y: number }) => Math.hypot(h[0].x - w.x, h[0].y - w.y)
      return d(a, prev.sign) + d(b, prev.draw) <= d(b, prev.sign) + d(a, prev.draw) ? { sign: a, draw: b } : { sign: b, draw: a }
    }
    return signLeftInFrame ? { sign: a, draw: b } : { sign: b, draw: a }
  }
  if (hands.length === 0) return { sign: null, draw: null }
  const h = hands[0]
  const l = sure(0)
  if (l) return playerHandOf(l) === signHand ? { sign: h, draw: null } : { sign: null, draw: h }
  const near = (w: Wrist) => (w ? Math.hypot(w.x - h[0].x, w.y - h[0].y) : Infinity)
  const ds = near(prev.sign)
  const dd = near(prev.draw)
  const isSign = Math.min(ds, dd) < 0.25 ? ds <= dd : signLeftInFrame === h[0].x < 0.5
  return isSign ? { sign: h, draw: null } : { sign: null, draw: h }
}

interface Cast {
  name: string
  detail: string
  color: string
  ok: boolean
  t: number
}

export type Mode = 'dummy' | 'practice' | 'online' | 'tutorial'

/** Two enemies (training dummy): where the throwing hand is on screen picks the target (Future Plans.md, "Team modes"). */
type Zone = 'left' | 'right'
/** Two zones, sized for comfort: the third of the screen on your signing hand's side aims that way,
 *  the rest aims the other way (screen x, as you see it: 0 = left). */
const SIDE_ZONE = 1 / 3
const MAJORITY_SWITCH = 0.6 // share of the hand that must be on the other side to switch zones
/** A team card's spells: what it threw or what hit it (heals only on whoever they healed). */
const cardBolts = (bolts: Bolt[], id: Fid) => bolts.filter((b) => (b.kind === 'heal' ? b.to === id : b.to === id || b.by === id))

export function SpellPage({ hand, mode, onHome }: { hand: Hand; mode: Mode; onHome: () => void }) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [status, setStatus] = useState('Loading hand tracking and letter model…')
  const [seeing, setSeeing] = useState('')
  const [drawing, setDrawing] = useState(false)
  const [log, setLog] = useState<Cast[]>([])
  const [menu, setMenu] = useState<null | 'main' | 'help' | 'leave' | 'dummy'>(null)
  const [camInfo, setCamInfo] = useState<CameraInfo | null>(null)
  const [twoHands, setTwoHands] = useState(loadTwoHands)
  const twoHandsRef = useRef(twoHands) // read by the camera loop
  const toggleTwoHands = () => {
    const on = !twoHandsRef.current
    twoHandsRef.current = on
    setTwoHands(on)
    try {
      localStorage.setItem(TWO_HANDS_KEY, on ? '1' : '0')
    } catch {
      /* not saved: fine */
    }
  }
  // Two hands: which hand draws (the other one signs). Defaults to the hand you didn't pick to sign with.
  const [drawHand, setDrawHand] = useState<Hand>(() => loadDrawHand())
  const drawHandRef = useRef(drawHand)
  const swapDrawHand = () => {
    const next: Hand = drawHandRef.current === 'right' ? 'left' : 'right'
    drawHandRef.current = next
    setDrawHand(next)
    try {
      localStorage.setItem(DRAW_HAND_KEY, next)
    } catch {
      /* not saved: fine */
    }
  }
  const [strokeCount, setStrokeCount] = useState(0)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMenu((m) => (m ? null : 'main'))
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
  // The fight: practice (AI enemy) or online (server). Polled on its own timer, separate from the camera loop.
  const dummy = useRef(new DummyArena())
  const [dummyAttacks, setDummyAttacksState] = useState(false)
  const [dummyPool, setDummyPoolState] = useState(() => (dummy.current.pool = loadDummyPool()))
  // A second enemy: the dummy fight becomes you against two dummies, each with its own spells.
  const team = useState(() => new TeamArena())[0]
  const [twoFoes, setTwoFoesState] = useState(() => mode === 'dummy' && loadDummyTwo())
  const aimOnRef = useRef(false) // two foes to aim between (read by the camera loop)
  const [dummyPool2, setDummyPool2State] = useState(() => loadDummyPool(DUMMY_POOL2_KEY))
  team.pools = { enemy: dummyPool, enemy2: dummyPool2 }
  // Dummy pace (both dummies): cast time as a % of the default, and the time between casts.
  const [pace, setPaceState] = useState(loadDummyPace)
  dummy.current.castPct = team.castPct = pace.castPct
  dummy.current.gapMs = team.gapMs = pace.gapMs
  dummy.current.parryPct = team.parryPct = pace.parryPct
  const setPace = (p: Pace) => {
    saveDummyPace(p)
    setPaceState(p)
  }
  // Dummy aids: the counter hint and the parry timing rings (the tutorial always shows the rings).
  const [aids, setAidsState] = useState(loadDummyAids)
  const setAids = (a: DummyAids) => {
    saveDummyAids(a)
    setAidsState(a)
  }
  const setDummyPool = (pool: string[], second = false) => {
    if (second) {
      saveDummyPool(pool, DUMMY_POOL2_KEY)
      setDummyPool2State(pool)
    } else {
      dummy.current.pool = pool
      saveDummyPool(pool)
      setDummyPoolState(pool)
    }
  }
  const setDummyAttacks = (on: boolean) => {
    dummy.current.setAttacking(on)
    team.setAttacking(on)
    setDummyAttacksState(on)
  }
  const practice = useRef(new PracticeArena())
  practice.current.playerTwoHands = twoHands // it only parries when you can parry back
  const online = useRef<OnlineArena | null>(null)
  const [aimZone, setAimZone] = useState<Zone>('left')
  const arena = useRef<Arena>(mode === 'practice' ? practice.current : twoFoes ? team : dummy.current)
  const setTwoFoes = (on: boolean, save = true) => {
    if (save) saveDummyTwo(on)
    setTwoFoesState(on)
    const a = on ? team : dummy.current
    a.reset()
    a.setAttacking(dummyAttacks)
    arena.current = a
  }
  // Tutorial "Try it": the dummy throws heavy Earth for you to parry, or two dummies to aim at.
  // Nothing here is saved: leaving the try puts the dummy back the way it was.
  const tutorialTry = (kind: 'parry' | 'two' | null) => {
    setTwoFoes(kind === 'two', false)
    dummy.current.pool = kind === 'parry' ? ['E:h'] : dummyPool
    setDummyAttacks(kind === 'parry')
  }
  const [fight, setFight] = useState<Snapshot>(() => arena.current.update(0))
  const fightRef = useRef(fight) // read by the camera loop (e.g. "am I silenced?")
  // Your charge and readied spell, as the fight decided them (online: the server).
  // A charge you just signed shows at once; the fight confirms it (online, a round trip later) or,
  // if it refused, it goes back after PREDICT_MS.
  const predicted = useRef<{ el: string; t: number } | null>(null)
  const knockedRef = useRef(0)
  const shownCharge = (now: number, real: string | null) => {
    const p = predicted.current
    return p && now - p.t < PREDICT_MS ? p.el : real
  }
  const readyName = fight.ready.player && spellName(fight.ready.player.el, fight.ready.player.shape)
  const seenNotes = useRef(new Set<number>())
  // Shake the half a spell lands on (see effects.tsx).
  const youRef = useRef<HTMLDivElement>(null)
  const oppRef = useRef<HTMLDivElement>(null)
  const sideRefs = useRef({ player: youRef, enemy: oppRef }).current
  setLocalBoltClock(mode !== 'online')
  useShake(fight.bolts, sideRefs)
  useFightSfx(fight, 'player', mode === 'practice' || mode === 'online')
  const [lobby, setLobby] = useState<LobbyInfo | null>(null)
  const [clock, setClock] = useState(0)
  const charge = shownCharge(clock, fight.charge.player)
  const [joinCode, setJoinCode] = useState('')
  // The fight is advanced and redrawn every UI_TICK_MS (same as the online server's tick).
  useEffect(() => {
    // The enemy's drawing is heard too (quieter, on their side): while its points keep growing.
    let enemyPts = 0
    let enemyDrewAt = -1e9
    const id = setInterval(() => {
      const t = performance.now()
      const snap = arena.current.update(t)
      fightRef.current = snap
      setFight(snap)
      const ec = snap.running && !(snap.shroud.enemy > 0) ? snap.enemyCast : null
      const n = ec?.phase === 'draw' || ec?.phase === 'ready' ? ec.points.length : 0
      if (n > enemyPts) enemyDrewAt = t
      enemyPts = n
      pencil('enemy', n && t - enemyDrewAt < 120 ? 0.6 : 0) // strokes online arrive in bursts: bridge the gaps
      if (predicted.current && snap.charge.player === predicted.current.el) predicted.current = null // confirmed
      if (!snap.running) predicted.current = null // match over, or in a lobby: no guessed charge
      // Silenced or knocked off (the server says so): the guessed charge goes at once, no waiting.
      if (snap.silenced.player > 0 || snap.knocked.player !== knockedRef.current) predicted.current = null
      knockedRef.current = snap.knocked.player
      // Your cast log: what the fight says your casting did.
      const fresh = snap.notes.filter((n) => n.side === 'player' && !seenNotes.current.has(n.id))
      seenNotes.current = new Set(snap.notes.map((n) => n.id))
      if (fresh.length) setLog((l) => [...fresh.reverse().map((n) => ({ name: n.name, detail: n.detail, color: n.color, ok: n.ok, t: t })), ...l].slice(0, 8))
      setLobby(online.current ? { ...online.current.info } : null)
      setClock(t)
    }, UI_TICK_MS)
    return () => {
      clearInterval(id)
      pencil('me', 0)
      pencil('enemy', 0)
      online.current?.close()
    }
  }, [])
  const leaveOnline = () => {
    online.current?.leave() // free the seat now (otherwise the server holds it 15 s)
    online.current?.close()
    setOnlineFlag(false)
    online.current = null
  }
  const goOnline = () => {
    online.current?.close()
    online.current = new OnlineArena()
    arena.current = online.current
  }
  const inRoom = mode === 'online' && !!lobby?.code
  // When the last match ended (the result shows a moment before the lobby comes back).
  const overAt = useRef(0)
  const lastPhase = useRef<string | null>(null)
  if (lobby?.phase !== lastPhase.current) {
    if (lobby?.phase === 'over') overAt.current = clock
    lastPhase.current = lobby?.phase ?? null
  }
  const goHome = () => {
    leaveOnline()
    onHome()
  }
  const [difficulty, setDifficulty] = useState<Difficulty>('pebble')
  // Practice starts after a short 3-2-1 (the gong plays when the fight begins).
  const [countdownEnds, setCountdownEnds] = useState<number | null>(null)
  const startPractice = () => setCountdownEnds(performance.now() + 3000)
  const lastTick = useRef(0)
  const secsLeft = (ends: number | null | undefined) => (ends ? Math.max(0, Math.ceil((ends - clock) / 1000)) : 0)
  const onlineEnds = mode === 'online' && lobby?.phase === 'countdown' ? lobby.countdownEnds : null
  useEffect(() => {
    const left = secsLeft(countdownEnds ?? onlineEnds)
    if (left > 0 && left !== lastTick.current) play('countdown_tick', { vol: 0.6 })
    lastTick.current = left
    if (countdownEnds && clock >= countdownEnds) {
      setCountdownEnds(null)
      practice.current.start(performance.now(), difficulty)
    }
  }, [clock]) // eslint-disable-line react-hooks/exhaustive-deps
  const inPracticeMatch = mode === 'practice' && fight.running
  useEffect(() => {
    if (mode === 'online') goOnline()
  }, [])
  // Two enemies: the zone your signing hand is in, as a target. Heals and buffs go to the default (the most
  // hurt on your team).
  const zoneTarget = (z: Zone, el: string | null, shape: string): Fid | null => {
    if (!el || shape === 'veil') return null
    if (el === 'H' && shape !== COUNTER) return null // heals and buffs: on you
    return z === 'left' ? 'enemy' : 'enemy2'
  }
  // ?debug: cast a spell without the camera (for testing online play with two tabs).
  const debugCast = (el: string, shape: string) => {
    const a = arena.current
    for (const l of signsFor(el)) a.sign(l)
    if (shape !== QUICK) {
      a.stroke(shapePoints(shape), 1)
      setTimeout(() => a.drew(shape), 300)
    }
    setTimeout(() => a.push(), 700)
  }

  useEffect(() => {
    let stopped = false
    let stream: MediaStream | null = null

    async function start() {
      try {
        const [rec, tracker, tracker2, shapeModel] = await Promise.all([loadRecognizer(), getTracker(1), getTracker(2), loadShapeModel()])
        if (stopped) return
        // Front camera, 60 fps where it offers it (see camera.ts).
        const cam = await openCamera()
        stream = cam.stream
        setCamInfo(cam.info())
        if (stopped) return stream.getTracks().forEach((t) => t.stop())
        const video = videoRef.current!
        video.srcObject = stream
        await video.play()
        const canvas = canvasRef.current!
        canvas.width = video.videoWidth
        canvas.height = video.videoHeight
        const ctx = canvas.getContext('2d')!
        const drawer = new DrawingUtils(ctx)
        setStatus('')

        const smoother = new LandmarkSmoother()
        let last: { lm: NormalizedLandmark[]; t: number } | null = null
        let lastVideoTime = -1
        // Letter being held (to charge an element once held long enough)
        let holdLetter: string | null = null
        let holdSince = 0
        // Stroke state
        let stroke: Pt[] = []
        let palmSum = 0
        let pencilSpeed = 0 // drawing sound: smoothed fingertip speed (palm units per frame)
        let lastPointT = 0
        let fade: { pts: Pt[]; color: string; t: number } | null = null
        let lastUi = 0
        let prevWrist: { x: number; y: number; t: number } | null = null
        let openSince: number | null = null
        let openFastSince: number | null = null // open hand, ignoring the speed limit (a pen-up straight into a push)
        let sizes: PalmSample[] = [] // recent palm measurements (push detection)
        let wasSilenced = false
        let sentSign: { el: string; t: number } | null = null // last element sent, so it isn't resent every frame
        let lastCharge: string | null = null // to spot a new charge (see the push below)
        // After a throw your hand is often still in that letter's shape. It mustn't recharge you: the
        // letter has to be let go (another shape for a moment) before it can charge again.
        let release: { el: string; since: number | null; thrown: number } | null = null
        let penUpU = false // a stroke just ended: a U hand is the pen-up, not Unholy, until the hand changes
        let penUpOpen = false // a stroke just ended with an open hand: it doesn't drop the charge until the hand changes
        let openHoldSince: number | null = null // open hand held while charged (drops the charge after CHARGE_MS)
        let sentUncharge = 0
        let knockedSeen = 0
        // Two hands: the drawing hand, tracked on its own.
        const drawSmoother = new LandmarkSmoother()
        let drawLast: { lm: NormalizedLandmark[]; t: number } | null = null
        const roles: { sign: Wrist; draw: Wrist } = { sign: null, draw: null }
        let penDown = false // two hands: the pen, as the signing hand set it
        let penFlipSince: number | null = null // the signing hand has wanted the other pen state since then
        // Parry: each hand's recent sizes (never cleared by charges or strokes) and when it last pushed.
        let pSign: PalmSample[] = []
        let pDraw: PalmSample[] = []
        let signPushAt = -1e9
        let drawPushAt = -1e9
        let parryAt = -1e9
        // Two enemies: the aim zone (the highlight while you hold a spell).
        let zone: Zone = 'left'

        const finishStroke = (now: number) => {
          const pts = stroke
          const palm = palmSum / Math.max(pts.length, 1)
          stroke = []
          palmSum = 0
          setDrawing(false)
          // Very few points is noise, unless it covered real distance (a fast line at 60 fps can be ~5 frames).
          if (pts.length < 4) return arena.current.cleared()
          const palms = pathLength(pts) / palm
          if (pts.length < 8 && palms < MIN_STROKE_PALMS) return arena.current.cleared()
          if (palms < NOISE_STROKE_PALMS) return arena.current.cleared() // just settling the hand: not a drawing
          if (palms < MIN_STROKE_PALMS) {
            // A real attempt that came out too short: a fizzle like any failed drawing (lockout, charge
            // lost), so a botched spell can't fall back to an instant quick interrupt.
            arena.current.drew(null)
            fade = { pts, color: '#888', t: now }
            setLog((l) => [{ name: 'Fizzle', detail: 'Too short', color: '#888', ok: false, t: now }, ...l].slice(0, 8))
            return
          }
          const m = recognizeShape(shapeModel, pts)
          const need = STRICT_SHAPES.has(m.name) ? SIGNATURE_SCORE : MATCH_SCORE
          const shape = m.score >= need && m.name !== 'none' ? m.name : null
          const el = fightRef.current.charge.player
          if (DEBUG) {
            const ft = shapeFeatures(pts)
            const o = ft.length - 8 // summary inputs: turns, …, corners (see shapes.ts)
            strokeLog.push({
              t: new Date().toISOString(),
              charge: el,
              points: pts.map((q) => [Math.round(q.x), Math.round(q.y)]),
              read: m.name,
              score: Math.round(m.score * 1000) / 1000,
              rejected: m.top.slice(0, 3).map((t) => `${t.name} ${Math.round(t.prob * 100)}%`).join(', '),
              corners: Math.round(ft[o + 5] * 10),
              turns: Math.round(ft[o] * 400) / 100,
            })
            if (strokeLog.length > 300) strokeLog.shift()
            setStrokeCount(strokeLog.length)
          }
          // Report what was drawn; the fight decides (ready it, or fizzle). Only what the browser alone
          // knows is logged here: why a stroke wasn't a spell shape.
          arena.current.drew(shape)
          const fits = shape && el && isValidSpell(el, shape)
          fade = { pts, color: fits ? chargeInfo(el).color : '#888', t: now }
          if (!shape) log({ name: 'Fizzle', detail: m.name === 'none' ? 'Not a spell shape' : 'Shape unclear', color: '#888', ok: false, t: now })
        }
        const log = (c: Cast) => setLog((l) => [c, ...l].slice(0, 8))

        const loop = async () => {
          if (stopped) return
          video.requestVideoFrameCallback(loop)
          if (video.currentTime === lastVideoTime) return
          lastVideoTime = video.currentTime
          const now = performance.now()
          const two = twoHandsRef.current
          // Two hands: the signing hand is whichever one doesn't draw (the letter model reads it as that hand).
          const signHand: Hand = two ? (drawHandRef.current === 'right' ? 'left' : 'right') : hand
          let found: NormalizedLandmark[] | null
          let drawFound: NormalizedLandmark[] | null = null
          if (two) {
            const all = await tracker2.detectAll(video, now)
            const split = splitHands(all.image, all.handed, signHand, roles)
            found = split.sign
            drawFound = split.draw
            if (found) roles.sign = { x: found[0].x, y: found[0].y }
            if (drawFound) roles.draw = { x: drawFound[0].x, y: drawFound[0].y }
          } else found = await tracker.detect(video, now)
          if (stopped) return
          let dLm: NormalizedLandmark[] | null = null
          if (drawFound) {
            dLm = drawSmoother.smooth(drawFound, now)
            drawLast = { lm: dLm, t: now }
          } else if (drawLast && now - drawLast.t < DROPOUT_MS) dLm = drawLast.lm
          else {
            drawLast = null
            drawSmoother.reset()
          }

          let lm: NormalizedLandmark[] | null = null
          if (found) {
            lm = smoother.smooth(found, now)
            last = { lm, t: now }
          } else if (last && now - last.t < DROPOUT_MS) lm = last.lm
          else {
            last = null
            smoother.reset()
          }

          // The phone was turned: the frames changed shape, so the overlay follows.
          if (canvas.width !== video.videoWidth || canvas.height !== video.videoHeight) {
            canvas.width = video.videoWidth
            canvas.height = video.videoHeight
          }
          const W = canvas.width
          const H = canvas.height
          ctx.clearRect(0, 0, W, H)
          // Hand shape is read in true proportions, the same on any camera shape (see trueShape()).
          // Drawing on screen and stroke points keep the real frame.
          const shapeLm = lm && trueShape(lm, W, H)
          const shapeFound = found && trueShape(found, W, H)
          const view = fightRef.current
          const myCharge = shownCharge(now, view.charge.player)
          // A new charge: forget earlier hand movement, so raising your hand to sign isn't read as a
          // push. Only a push that starts after the charge throws (e.g. a quick interrupt).
          if (myCharge !== lastCharge) {
            lastCharge = myCharge
            sizes = []
          }
          const myReady = view.ready.player
          // Two hands: a stroke still under NOISE_STROKE_PALMS (a dot, a twitch) isn't a drawing yet. Until it
          // is, the signing hand can still switch element or open to drop the charge (the dot is thrown
          // away). Past that you're committed: only the open hand ends it (a spell or a fizzle).
          const committed = stroke.length > 1 && pathLength(stroke) / (palmSum / stroke.length || 1) >= NOISE_STROKE_PALMS
          const dropDot = () => {
            if (!stroke.length) return
            stroke = []
            palmSum = 0
            setDrawing(false)
            arena.current.cleared()
          }
          // Silenced (a counterspell landed on you): your charge, drawing and ready spell are gone,
          // and you can't charge or draw until it ends.
          const silenced = fightRef.current.running && fightRef.current.silenced.player > 0
          if (silenced && !wasSilenced) {
            if (stroke.length) {
              stroke = []
              palmSum = 0
              setDrawing(false)
            }
            holdLetter = null
          }
          wasSilenced = silenced
          // Earthquake knocked your charge off: your charge, drawing and ready spell are gone.
          const knocked = fightRef.current.knocked.player
          if (knocked > knockedSeen) {
            if (stroke.length) {
              stroke = []
              palmSum = 0
              setDrawing(false)
            }
          }
          knockedSeen = knocked

          // The letter model runs every frame: a confident L (index up, thumb out) is Lightning
          // being signed, never drawing, even if the geometry check alone would call it pointing.
          const pred = shapeLm ? classify(rec, shapeLm, signHand) : null
          const signingL = pred !== null && pred.letter === 'L' && pred.confidence >= L_VETO_PROB
          // Mixing a combo (fewer than 2 elements in): pointing between letters (W to L) isn't drawing.
          const mixing = myCharge === COMBO && view.mix.player.length < 2
          // Two hands: the signing hand holding an element letter (or C) = pen down, open hand = pen up.
          // Only while charged with nothing readied, and both hands in view.
          const signingCharge = pred !== null && !!myCharge && pred.letter === myCharge && pred.confidence >= CHARGE_PROB
          if (two) {
            const can = !!myCharge && !myReady && !silenced && !mixing
            const holdingType = pred !== null && pred.confidence >= CHARGE_PROB && (!!ELEMENTS[pred.letter] || (pred.letter === COMBO && COMBOS_ON))
            const signOpen = !!shapeLm && isOpen(shapeLm, false)
            const want = can && (penDown ? !signOpen : holdingType && !signOpen)
            if (!can) {
              penDown = false
              penFlipSince = null
            } else if (!lm) penFlipSince = null // signing hand lost (fast move): the pen stays as it was
            else if (want === penDown) penFlipSince = null
            else if ((penFlipSince ??= now) && now - penFlipSince >= PEN_SWITCH_MS) {
              penDown = want
              penFlipSince = null
            }
          }
          const pointing = silenced || mixing ? false : two ? penDown : !!shapeLm && isPointing(shapeLm) && !signingL
          // The pen, in pixels: the index tip.
          const penHand = two ? dLm : lm
          const pen: Pt | null = penHand ? { x: penHand[8].x * W, y: penHand[8].y * H } : null
          if (two && dLm && pen) {
            drawer.drawConnectors(dLm, HandLandmarker.HAND_CONNECTIONS, { color: 'rgba(255,255,255,0.5)', lineWidth: 2 })
            // Pen cursor: hollow while hovering, filled while drawing.
            ctx.beginPath()
            ctx.arc(pen.x, pen.y, 0.012 * W, 0, 2 * Math.PI)
            ctx.lineWidth = 3
            ctx.strokeStyle = ctx.fillStyle = myCharge ? chargeInfo(myCharge).color : '#ffffff'
            if (pointing) ctx.fill()
            else ctx.stroke()
          }
          let letter = ''
          if (lm && pred) {
            // Fizzle lockout: the hand goes dim and grey until you can throw again.
            const staggered = (view.staggered?.player ?? 0) > 0
            const dim = view.fizzled.player > 0 || staggered
            if (dim) ctx.globalAlpha = 0.3
            drawer.drawConnectors(lm, HandLandmarker.HAND_CONNECTIONS, { color: dim ? '#888' : myCharge ? chargeInfo(myCharge).color : '#e2b714', lineWidth: 3 })
            ctx.globalAlpha = 1
            if (dim) {
              // "Fizzled" over the palm. The canvas is mirrored on screen, so flip the text back.
              const cx = ((lm[0].x + lm[9].x) / 2) * W
              const cy = ((lm[0].y + lm[9].y) / 2) * H
              ctx.save()
              ctx.translate(cx, cy)
              ctx.scale(-1, 1)
              ctx.font = `bold ${Math.round(0.04 * W)}px sans-serif`
              ctx.textAlign = 'center'
              ctx.textBaseline = 'middle'
              ctx.fillStyle = '#ccc'
              ctx.shadowColor = '#000'
              ctx.shadowBlur = 8
              ctx.fillText(staggered ? 'Staggered' : 'Fizzled', 0, 0)
              ctx.restore()
            }
            // Not while drawing, silenced or with a spell readied (the fight would refuse it anyway).
            // An open hand ("none") held CHARGE_MS while charged, nothing drawn: drop the charge. Not the
            // open hand that just ended a stroke (that one has to change shape first).
            const canSwitch = two ? !committed : !pointing && stroke.length === 0
            const openHand = canSwitch && !!shapeLm && isOpen(shapeLm, false)
            if (!openHand) penUpOpen = false
            if (openHand && myCharge && !myReady && !penUpOpen && !silenced && view.running) {
              openHoldSince ??= now
              if (now - openHoldSince >= UNCHARGE_MS && now - sentUncharge > 300) {
                dropDot()
                arena.current.uncharge()
                sentUncharge = now
                predicted.current = null
                holdLetter = null
              }
            } else openHoldSince = null
            if (canSwitch && !silenced && !myReady) {
              // Not drawing: read the handshape as a letter, to charge an element.
              letter = pred.confidence >= CHARGE_PROB ? directionLetter(pred.letter, shapeLm) : ''
              if (letter && !passesGate(letter, shapeLm)) letter = '' // e.g. an open palm read as F
              if (letter !== 'U') penUpU = false
              else if (penUpU) letter = ''
              // An open "5" is no letter. Until the letter model has a "none" class it still picks its
              // closest letter (C, H, ...), so a full open hand never charges.
              if (letter && shapeLm && isOpen(shapeLm, false)) letter = ''
              let el = ELEMENTS[letter] || (letter === COMBO && COMBOS_ON) ? letter : null
              if (release) {
                if (el === release.el) release.since = null
                else if ((release.since ??= now) && now - release.since >= RELEASE_MS) release = null
                // Still holding the thrown letter: blocked for a moment (so the throw itself doesn't
                // recharge you), then holding it on charges it again.
                if (release && el === release.el && now - release.thrown >= REHOLD_MS) release = null
                if (release && el === release.el) el = null
              }
              if (el !== holdLetter) {
                holdLetter = el
                holdSince = now
              } else if (el && view.running && el !== myCharge && !(myCharge && COMBO_MIX[myCharge]?.includes(el)) && !view.mix.player.includes(el) && !(el === COMBO && view.mix.player.length === 2) && now - holdSince >= CHARGE_MS && (sentSign?.el !== el || now - sentSign.t > 300)) {
                // Only in a fight (a running match, or the dummy): between matches and in lobbies
                // nothing can be cast, so nothing charges and no guessed charge flashes up.
                dropDot() // switching element: the dot drawn so far goes
                arena.current.sign(el) // the fight decides (e.g. not right after a throw)
                sentSign = { el, t: now }
                if (!silenced && myCharge !== COMBO) predicted.current = { el, t: now } // mixing a combo keeps the C charge
              }
            }
          }

          // Pen: the index fingertip, in pixels (so circles aren't squashed by the 16:9 frame).
          // Right after a parry the drawing hand is still moving: no new line until it settles.
          // Staggered from a missed parry: no drawing at all until it wears off.
          if (penHand && pen && pointing && now - parryAt >= PARRY_COOLDOWN_MS && !((view.staggered?.player ?? 0) > 0)) {
            if (stroke.length === 0) setDrawing(true) // drawing with a spell readied drops it (the fight decides)
            release = null // pointing to draw is letting go of the thrown letter (else signing it again right after stays blocked)
            stroke.push(pen)
            // For the opponent: the fingertip as a fraction of what YOU see (your camera cropped to fill
            // your window, mirrored), plus that view's shape. Their panel shows the same view filling it
            // the same way, so a circle stays round and edge to edge stays edge to edge on any screen.
            const cw = video.clientWidth || W
            const ch = video.clientHeight || H
            const k = Math.max(cw / W, ch / H) // object-fit: cover
            const vw = cw / k
            const vh = ch / k
            arena.current.stroke([{ x: (W - pen.x - (W - vw) / 2) / vw, y: (pen.y - (H - vh) / 2) / vh }], vw / vh)
            const palmPx = Math.hypot((penHand[0].x - penHand[9].x) * W, (penHand[0].y - penHand[9].y) * H)
            palmSum += palmPx
            // Drawing sound: the pencil gets louder the faster the fingertip moves (a still finger is silent).
            const prev = stroke[stroke.length - 2]
            const step = prev ? Math.hypot(pen.x - prev.x, pen.y - prev.y) / (palmPx || 1) : 0
            pencilSpeed = 0.6 * pencilSpeed + 0.4 * step
            pencil('me', pencilSpeed < 0.01 ? 0 : pencilSpeed / PENCIL_FAST)
            lastPointT = now
          } else if (pencilSpeed > 0) {
            pencilSpeed = 0 // pen up: the pencil goes quiet
            pencil('me', 0)
          }
          // Hand speed (palm-widths per second), from the smoothed wrist.
          let speed = 0
          if (lm) {
            const hw = shapeLm![0] // same proportions as the palm size below
            const palm = dist(hw, shapeLm![9]) || 1
            if (prevWrist) speed = Math.hypot(hw.x - prevWrist.x, hw.y - prevWrist.y) / palm / (Math.max(now - prevWrist.t, 1) / 1000)
            prevWrist = { x: hw.x, y: hw.y, t: now }
          } else prevWrist = null
          // The speed limit applies only when the pen-up starts (that's when blur fakes it); once
          // started it holds through a fast move, so pushing right away doesn't cancel it.
          if (!two && found && lm && !pointing && (isOpen(shapeFound!, false) || signingL || signingCharge) && (openSince !== null || speed < PEN_UP_MAX_SPEED)) openSince ??= now
          else openSince = null
          if (!two && found && lm && !pointing && (isOpen(shapeFound!, false) || signingL || signingCharge)) openFastSince ??= now
          else openFastSince = null
          const penUpStart = openSince ?? openFastSince
          const fastPenUp = openFastSince !== null && now - openFastSince >= FAST_PEN_UP_MS
          // Two hands: charge gone (open palm, knocked off, silenced) = the drawing is dropped, no fizzle.
          if (two && stroke.length && !myCharge) {
            stroke = []
            palmSum = 0
            setDrawing(false)
            arena.current.cleared()
          }
          // Two hands: the signing hand opened (pen up), or the drawing hand has been gone TWO_LOST_MS.
          const twoEnd = two && (!pointing || now - lastPointT > TWO_LOST_MS)
          if (stroke.length && (twoEnd || (!two && !pointing && ((openSince !== null && now - openSince >= PEN_UP_HOLD_MS) || fastPenUp || now - lastPointT > LOST_GRACE_MS)))) {
            openSince = null
            openFastSince = null
            finishStroke(now)
            // The hand that ended the stroke mustn't read as a letter (one hand) or drop the charge until it
            // changes. Two hands: unless it was only a dot, then the open hand drops the charge as usual.
            penUpU = !two
            penUpOpen = !two || committed
            // A push that began with the pen-up still counts: keep hand sizes from that moment on.
            sizes = sizes.filter((x) => penUpStart !== null && x.t >= penUpStart)
          }
          // Recent hand sizes (for push detection), recorded every frame.
          if (lm && found) {
            sizes.push(palmSample(lm, W, H, now))
            while (sizes.length && now - sizes[0].t > PUSH_WINDOW_MS) sizes.shift()
          } else sizes = []

          // Parry: track both hands (fresh detections only) and note when each crosses the push growth.
          let parried = false
          if (two) {
            const size = (h: NormalizedLandmark[]) => palmSample(h, W, H, now).s
            const pushed = (buf: PalmSample[], h: NormalizedLandmark[] | null) => {
              if (!h) return false
              buf.push(palmSample(h, W, H, now))
              while (buf.length && now - buf[0].t > PUSH_WINDOW_MS) buf.shift()
              return isPush(buf)
            }
            if (pushed(pSign, found && lm)) {
              if (now - signPushAt > PUSH_WINDOW_MS) signPushAt = now
            } else if (!found) pSign = []
            if (pushed(pDraw, drawFound && dLm)) {
              if (now - drawPushAt > PUSH_WINDOW_MS) drawPushAt = now
            } else if (!drawFound) pDraw = []
            // Signing hand pushed first, drawing hand already growing: hold the throw until it catches up
            // (or PARRY_SYNC_MS passes; then the throw goes as usual).
            let bothPushed = false
            const drawGrowth = growth(pDraw, 's')
            if (now - signPushAt <= PARRY_SYNC_MS && drawGrowth >= parryPendingGrowth()) parried = true
            if (Math.abs(signPushAt - drawPushAt) <= PARRY_SYNC_MS && now - Math.max(signPushAt, drawPushAt) < PUSH_WINDOW_MS) {
              parried = true // both pushing: never a throw
              bothPushed = true
            }
            // Staggered from a missed parry: the push does nothing (no rings, no dropped drawing).
            if (bothPushed && !(fightRef.current.staggered?.player > 0)) {
              // A parry drops any drawing in progress (no fizzle).
              if (stroke.length) {
                stroke = []
                palmSum = 0
                setDrawing(false)
                arena.current.cleared()
              }
              if (now - parryAt > PARRY_COOLDOWN_MS) {
                parryAt = now
                arena.current.parry() // the fight logs what it did (reflected, missed, or nothing while staggered)
              }
            }
            // Flash both palms while the parry shows.
            if (now - parryAt < 300) {
              ctx.lineWidth = 6
              ctx.strokeStyle = '#7fd8ff'
              for (const h of [lm, dLm]) {
                if (!h) continue
                ctx.beginPath()
                ctx.arc(h[9].x * W, h[9].y * H, size(h) * 1.2, 0, 2 * Math.PI)
                ctx.stroke()
              }
            }
          }

          // Two enemies: aim with the signing hand's position on screen. Signing with your left hand, the left
          // third aims left and the rest aims right (mirrored for the right hand). The side most of the hand
          // (its 21 points) is on wins, measured in the view you see (cropped to fill its panel, mirrored).
          const leftShare = (h: NormalizedLandmark[]) => {
            const edge = signHand === 'left' ? SIDE_ZONE : 1 - SIDE_ZONE
            const cw = video.clientWidth || W
            const ch = video.clientHeight || H
            const k = Math.max(cw / W, ch / H)
            const vw = cw / k
            return h.filter((p) => (W - p.x * W - (W - vw) / 2) / vw < edge).length / h.length
          }
          if (aimOnRef.current) {
            // The highlight while you hold the spell: a clear majority (MAJORITY_SWITCH) to switch, so it doesn't
            // flicker on the line. A lost hand keeps the last aim. The throw itself uses where the hand is then.
            if (lm && (myReady || myCharge)) {
              const ls = leftShare(lm)
              if (zone === 'left' && 1 - ls >= MAJORITY_SWITCH) zone = 'right'
              else if (zone === 'right' && ls >= MAJORITY_SWITCH) zone = 'left'
            }
            arena.current.aim?.(myReady ? zoneTarget(zone, myReady.el, myReady.shape) : null)
            setAimZone(zone)
          }
          // Push: the hand quickly grows on screen (moves toward the camera). Reported only with something
          // to throw (a readied spell, or a counter element for a quick interrupt) and no stroke in
          // progress, so drawing never throws by accident. The fight decides what it throws, if anything.
          // Two hands: holding the letter already puts the pen down, so a push still counts while the line is
          // only a dot (the dot is thrown away). That's the quick interrupt: sign, then push before you draw.
          if (!parried && (myReady || (myCharge && canQuick(myCharge))) && sizes.length > 1 && (two ? !committed : stroke.length === 0 && !pointing)) {
            if (isPush(sizes)) {
              dropDot()
              if (aimOnRef.current) {
                // The target is wherever the hand is the moment the throw goes: simple majority, no lag.
                const z0: Zone = lm ? (leftShare(lm) >= 0.5 ? 'left' : 'right') : zone
                zone = z0
                arena.current.aim?.(zoneTarget(z0, myReady?.el ?? myCharge, myReady?.shape ?? QUICK))
              }
              arena.current.push()
              if (myCharge) release = { el: myCharge, since: null, thrown: now }
              predicted.current = null
              holdLetter = null
              sizes = []
            }
          }
          if (myReady) {
            if (lm) {
              // The readied spell glows on the hand, pulsing.
              const cx = ((lm[0].x + lm[9].x) / 2) * W
              const cy = ((lm[0].y + lm[9].y) / 2) * H
              ctx.globalAlpha = 0.35 + 0.25 * Math.sin(now / 120)
              ctx.fillStyle = chargeInfo(myReady.el).color
              ctx.shadowColor = chargeInfo(myReady.el).color
              ctx.shadowBlur = 40
              ctx.beginPath()
              ctx.arc(cx, cy, 0.08 * W, 0, 2 * Math.PI)
              ctx.fill()
              ctx.shadowBlur = 0
              ctx.globalAlpha = 1
            }
          }

          // Trail while drawing, and the finished stroke fading out in the spell's color.
          const trail = (pts: Pt[], color: string, alpha: number) => {
            if (pts.length < 2) return
            ctx.globalAlpha = alpha
            ctx.strokeStyle = color
            ctx.lineWidth = 10
            const pixel = document.documentElement.dataset.theme === 'pixel'
            ctx.lineCap = pixel ? 'square' : 'round'
            ctx.lineJoin = pixel ? 'miter' : 'round'
            const cartoon = document.documentElement.dataset.theme === 'cartoon'
            ctx.shadowColor = color
            ctx.shadowBlur = pixel || cartoon ? 0 : 20
            ctx.beginPath()
            ctx.moveTo(pts[0].x, pts[0].y)
            for (const p of pts) ctx.lineTo(p.x, p.y)
            if (cartoon) {
              // Marker look: a dark outline under the colored stroke.
              ctx.strokeStyle = '#15132e'
              ctx.lineWidth = 18
              ctx.stroke()
              ctx.strokeStyle = color
              ctx.lineWidth = 10
            }
            ctx.stroke()
            ctx.shadowBlur = 0
            ctx.globalAlpha = 1
          }
          trail(stroke, myCharge ? chargeInfo(myCharge).color : '#ffffff', 0.9)
          if (fade) {
            const a = 1 - (now - fade.t) / 1200
            if (a <= 0) fade = null
            else trail(fade.pts, fade.color, a)
          }

          if (now - lastUi > 100) {
            lastUi = now
            setSeeing(pointing ? 'drawing' : letter || '–')
          }
        }
        loop()
      } catch (err) {
        setStatus(`Couldn't start: ${(err as Error).message}`)
      }
    }
    start()
    return () => {
      stopped = true
      stream?.getTracks().forEach((t) => t.stop())
    }
  }, [hand])

  // A new match starts with a clean cast log (last match's "Knocked down!" mustn't linger).
  useEffect(() => {
    if (fight.running) setLog([])
  }, [fight.running])
  const latest = log[0]
  const oppName = mode === 'online' ? 'Opponent' : mode === 'dummy' || mode === 'tutorial' ? 'Training dummy' : 'Enemy'
  const teamOf = (id: Fid) => fight.fighters.find((f) => f.id === id)?.team ?? id
  const fighterHead = (side: Fid, name?: string) => (
    <div className="fighter">
      <div className="fighter-name">
        {name ?? (side === 'player' ? 'You' : oppName)}
        {fight.static[side] && <span className={`tag static ${fight.static[side]}`}>⚡ {fight.static[side] === 'on' ? 'static' : 'gap'}</span>}
        {fight.chill[side] > 0 && <span className="tag chill">chilled +{fight.chill[side]}%</span>}
      </div>
      <div className="hp-bar">
        <div
          className="hp-fill"
          style={{ width: `${fight.maxHp[side] === Infinity ? 100 : (100 * fight.hp[side]) / fight.maxHp[side]}%`, background: fight.shield[side] > 0 ? 'var(--armor-hp)' : teamOf(side) === 'player' ? 'var(--you)' : 'var(--foe)' }}
        />
        <ArmorBar hp={fight.hp[side]} max={fight.maxHp[side]} armor={fight.shield[side]} />
        <span className="hp-text">
          {fight.maxHp[side] === Infinity ? '∞' : `${Math.ceil(fight.hp[side])} / ${fight.maxHp[side]}`}
          {fight.shield[side] > 0 && <b className="armor-text">+{fight.shield[side]}</b>}
        </span>
        {fight.floats
          .filter((f) => f.side === side)
          .map((f) => (
            <span key={f.id} className={/^[-+]\d/.test(f.text) ? 'float hp-num' : 'float'} style={{ color: f.color }}>
              {f.text}
            </span>
          ))}
      </div>
    </div>
  )
  // Team modes.
  const tf = fight as TeamSnapshot
  const online2 = mode === 'online' && fight.fighters.length > 2 // an online team match (1v2, 2v1, 2v2)
  const isTeam = ((mode === 'dummy' || mode === 'tutorial') && twoFoes) || online2
  const foes = isTeam ? fight.fighters.filter((f) => f.team === 'enemy').map((f) => f.id) : []
  const allies = isTeam ? fight.fighters.filter((f) => f.team === 'player' && f.id !== 'player').map((f) => f.id) : []
  aimOnRef.current = foes.length >= 2
  const nameOf = (id: Fid) => {
    if (id === 'player') return 'You'
    if (id.startsWith('ally')) return 'Teammate'
    if (!online2) return id === 'enemy' ? 'Left dummy' : 'Right dummy'
    return foes.length < 2 ? 'Opponent' : id === 'enemy' ? 'Left foe' : 'Right foe'
  }
  const myR = fight.ready.player
  /** Where your ready spell would go. Online, worked out here the same way the server does (minus "who
   *  hit you last"): your zone's foe, else the foe with the least HP; heals go to the most hurt teammate. */
  const targetFor = (el: string, shape: string): Fid | null => {
    if (!online2) return team.targetFor(el, shape)
    const alive = (id: Fid) => fight.hp[id] > 0
    if (el === 'H' && shape !== COUNTER) {
      const share = (id: Fid) => (fight.maxHp[id] === Infinity ? 1 : fight.hp[id] / fight.maxHp[id])
      return ['player', ...allies].filter(alive).sort((a, b) => share(a) - share(b))[0] ?? 'player'
    }
    const z = foes.length >= 2 ? zoneTarget(aimZone, el, shape) : null
    if (z && alive(z)) return z
    return foes.filter(alive).sort((a, b) => fight.hp[a] - fight.hp[b])[0] ?? null
  }
  const myTarget = isTeam && myR ? targetFor(myR.el, myR.shape) : null
  const allyCard = (id: Fid) => {
    const cast = fight.running ? tf.casts?.[id] ?? null : null
    const out = fight.hp[id] <= 0
    return (
      <div key={id} className={`team-card ally ${myTarget === id ? 'targeted' : ''} ${out ? 'out' : ''}`} style={{ '--aim': myR ? chargeInfo(myR.el).color : undefined } as React.CSSProperties}>
        {fighterHead(id, nameOf(id))}
        <OppStatus fight={fight} id={id} cast={cast} />
        <StatusFx side={id} view={fight} />
        <Impacts side="player" bolts={cardBolts(fight.bolts, id)} />
        {out && <b className="out-tag">Out</b>}
      </div>
    )
  }
  const foeCard = (id: Fid) => {
    const cast = fight.running ? tf.casts?.[id] ?? null : null
    const shrouded = fight.shroud[id] > 0
    const out = fight.hp[id] <= 0
    return (
      <div key={id} className={`team-card foe ${myTarget === id ? 'targeted' : ''} ${out ? 'out' : ''}`} style={{ '--aim': myR ? chargeInfo(myR.el).color : undefined } as React.CSSProperties}>
        <EnemyCanvas cast={shrouded ? null : cast} />
        {cast?.phase === 'ready' && !shrouded && (
          <b className="team-spell" style={{ color: cast.color }}>
            {cast.name}
          </b>
        )}
        <div className="side-hud">
          {fighterHead(id, nameOf(id))}
          <div className="hud-row">
            <OppStatus fight={fight} id={id} cast={cast} hint={mode === 'dummy' && aids.hint} />
            {mode === 'dummy' && id === foes[foes.length - 1] && dummyBar}
          </div>
        </div>
        <StatusFx side={id} view={fight} />
        <Impacts side="enemy" bolts={cardBolts(fight.bolts, id)} />
        {out && <b className="out-tag">Out</b>}
      </div>
    )
  }
  // What each aim zone does right now (shown on your camera while a spell is ready).
  const zoneLabel = (z: Zone) => {
    if (!myR) return ''
    const t = zoneTarget(z, myR.el, myR.shape)
    return t ? nameOf(t) : nameOf(myTarget ?? 'player')
  }
  const signLeft = (twoHands ? (drawHand === 'right' ? 'left' : 'right') : hand) === 'left'
  const dummyBar = (
    <div className="dummy-bar">
      <button className={`small ${dummyAttacks ? 'btn-stop' : 'btn-go'}`} onClick={() => setDummyAttacks(!dummyAttacks)} disabled={!dummyPool.length && !(twoFoes && dummyPool2.length) && !dummyAttacks}>
        {dummyAttacks ? 'Stop attacks' : 'Start attacks'}
      </button>
      <button className="small icon-btn btn-reset" onClick={() => arena.current.reset?.()} aria-label="Reset" title="Reset">
        <Icon d={RESET} />
      </button>
      <button className="small icon-btn" onClick={() => setMenu('dummy')} aria-label="Dummy settings" title="Dummy settings">
        <Icon d={GEAR} />
      </button>
    </div>
  )
  const result = fight.over ? (fight.over === 'player' ? 'You win!' : 'You lose') : null
  // The result goes across the middle of the arena (it's about you, not the enemy's half).
  const showResult = !!result && (mode === 'practice' ? !countdownEnds : mode === 'online' && lobby?.phase === 'over')
  // Online: the lobby screen covers the arena except during the countdown and the fight (and the result,
  // which shows for RESULT_MS before going back to the lobby).
  // Before the first word from the server there's no lobby info yet: still the lobby screen (never the arena).
  const showLobby = mode === 'online' && (!lobby || (lobby.phase === 'over' ? clock - overAt.current > RESULT_MS : lobby.phase !== 'countdown' && lobby.phase !== 'fighting'))
  // Home goes home at once; only a running online match asks first (leaving it counts as leaving your team).
  const homeNow = () => (mode === 'online' && lobby?.phase === 'fighting' ? setMenu('leave') : goHome())

  return (
    <main className="page duel-page">
      <div className="corner-bar">
        {mode === 'online' && lobby && !showLobby && <OnlineChip lobby={lobby} clock={clock} arena={online.current} />}
        <button className="small" onClick={() => setMenu('main')} title="Menu (Esc)">
          Menu
        </button>
        <button className="small" onClick={homeNow}>
          Home
        </button>
      </div>

      {showLobby &&
        (lobby ? (
          <LobbyScreen lobby={lobby} joinCode={joinCode} setJoinCode={setJoinCode} arena={online.current} onReconnect={goOnline} onHome={goHome} />
        ) : (
          <section className="lobby-screen">
            <div className="lobby-card">
              <b className="lobby-title">Custom game</b>
              <span className="sub-line">Connecting to the game server…</span>
            </div>
          </section>
        ))}

      {DEBUG && (
        <section className="debug-casts">
          <button className="small" onClick={downloadStrokes} title="Your recent strokes (fingertip points + how each was read), for tuning">
            Download strokes ({strokeCount})
          </button>
          {camInfo && <span>camera {camInfo.width}×{camInfo.height} @ {camInfo.fps} fps</span>}
          debug cast:
          {['F', 'I', 'L', 'E', 'W', 'H', 'U', ...(COMBOS_ON ? Object.keys(COMBO_SHAPE) : [])].map((el) =>
            [...shapesFor(el), ...(el in BEATS ? [COUNTER] : []), ...(canQuick(el) ? [QUICK] : [])].map((shape) => (
              <button key={el + shape} className="small" onClick={() => debugCast(el, shape)}>
                {el} {shape}
              </button>
            )),
          )}
        </section>
      )}

      <section className="duel">
        <div className="duel-side you" ref={youRef}>
          <div className="camera">
            <video ref={videoRef} playsInline muted />
            <canvas ref={canvasRef} />
          </div>
          <div className="side-hud">
            {fighterHead('player')}
            <div className="status-strip">
              <span className="charge" style={{ color: charge ? chargeInfo(charge).color : undefined }}>
                {chargeLabel(charge, fight.mix.player)}
              </span>
              <span className="sub-line">
                {fight.running && fight.silenced.player > 0
                  ? 'Silenced!'
                  : readyName
                    ? `Push to throw ${readyName}`
                    : drawing
                      ? 'drawing…'
                      : `seeing: ${seeing}`}
              </span>
              {mode === 'dummy' && (
                <span className="dealt-line">
                  Damage dealt <b>{fight.dealt.player}</b>
                </span>
              )}
            </div>
          </div>
          {status && <p className="status side-status">{status}</p>}
          {latest && !latest.ok && (
            <div className="cast stage-overlay" key={latest.t} style={{ color: latest.color }}>
              {latest.name}
              <span>{latest.detail}</span>
            </div>
          )}
          <StatusFx side="player" view={fight} />
          <Impacts side="player" bolts={isTeam ? cardBolts(fight.bolts, 'player') : fight.bolts} />
          {twoHands && (mode === 'dummy' ? aids.parryTimer : mode === 'tutorial' || isTeam) && <ParryRings side="player" bolts={isTeam ? fight.bolts.filter((b) => b.to === 'player') : fight.bolts} windowMs={PARRY_WINDOW_MS} />}
          {isTeam && allies.map(allyCard)}
          {isTeam && foes.length >= 2 && myR && fight.running && (
            <div className="aim-zones" style={{ '--aim': chargeInfo(myR.el).color, gridTemplateColumns: signLeft ? '1fr 2fr' : '2fr 1fr' } as React.CSSProperties}>
              {(['left', 'right'] as Zone[]).map((z) => (
                <div key={z} className={z === aimZone ? 'on' : ''}>
                  <span>{zoneLabel(z)}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="duel-side opp" ref={oppRef}>
          {isTeam && <div className="team-foes">{foes.map(foeCard)}</div>}
          {!isTeam && <EnemyCanvas cast={fight.running && !(fight.shroud.enemy > 0) ? fight.enemyCast : null} />}
          {!isTeam && <div className="side-hud">
            {fighterHead('enemy')}
            <div className="hud-row">
              {((mode !== 'dummy' && mode !== 'tutorial') || (mode === 'dummy' && aids.hint)) && <OppStatus fight={fight} hint={mode === 'dummy' && aids.hint} />}
              {mode === 'dummy' && dummyBar}
            </div>
          </div>}
          {mode === 'tutorial' && <Tutorial notes={fight.notes} onHome={goHome} drawHand={drawHand} twoHands={twoHands} onTry={tutorialTry} />}
          {mode === 'practice' && !fight.running && (
            <div className="stage-center">
              <Tower value={difficulty} onPick={setDifficulty} />
              {countdownEnds ? (
                <b className="countdown">{secsLeft(countdownEnds) || 1}</b>
              ) : (
                <button className="cta" onClick={startPractice}>{result ? 'Fight again' : 'Start battle'}</button>
              )}
            </div>
          )}
          {mode === 'online' && !fight.running && (
            <div className="stage-center">
              {lobby?.phase === 'countdown' && <b className="countdown">{Math.max(1, Math.ceil(((lobby.countdownEnds ?? clock) - clock) / 1000))}</b>}
            </div>
          )}
          {!isTeam && <StatusFx side="enemy" view={fight} />}
          {!isTeam && <Impacts side="enemy" bolts={fight.bolts} />}
        </div>

        <BoltLayer bolts={fight.bolts} />
        {showResult && <div className={`result-banner ${fight.over === 'player' ? 'won' : 'lost'}`}>{result}</div>}
        {mode !== 'tutorial' && <p className="privacy-note">Your camera stays on your device. Online, your opponent only sees your drawings and element.</p>}
      </section>
      {menu === 'main' && (
        <div className="menu-overlay" onClick={() => setMenu(null)}>
          <div className="menu-card pause-menu" onClick={(e) => e.stopPropagation()}>
            <button onClick={() => setMenu(null)}>Resume</button>
            {mode === 'practice' && fight.running && (
              <button
                onClick={() => {
                  practice.current.stop()
                  setMenu(null)
                }}
              >
                End match
              </button>
            )}
            {mode !== 'tutorial' && <button onClick={() => setMenu('help')}>How to cast</button>}
            <button onClick={toggleTwoHands}>Two hands: {twoHands ? 'on' : 'off'}</button>
            {twoHands && <button onClick={swapDrawHand}>Draw with: {drawHand === 'right' ? 'Right hand' : 'Left hand'}</button>}
            <PushSlider />
            <button onClick={() => (inRoom || inPracticeMatch ? setMenu('leave') : goHome())}>Home</button>
            <VolumeSlider />
          </div>
        </div>
      )}
      {menu === 'dummy' && (
        <div className="menu-overlay" onClick={() => setMenu(null)}>
          <div className="menu-card" onClick={(e) => e.stopPropagation()}>
            <DummyMenu
              twoFoes={twoFoes}
              setTwoFoes={setTwoFoes}
              pools={[dummyPool, dummyPool2]}
              setPool={setDummyPool}
              pace={pace}
              setPace={setPace}
              aids={aids}
              setAids={setAids}
              onDone={() => setMenu(null)}
            />
          </div>
        </div>
      )}
      {menu === 'leave' && (
        <div className="menu-overlay" onClick={() => setMenu(null)}>
          <div className="menu-card pause-menu" onClick={(e) => e.stopPropagation()}>
            <b className="leave-title">Leave the match?</b>
            <p className="leave-text">
              {inPracticeMatch
                ? 'This will end the match.'
                : lobby?.phase === 'fighting'
                ? 'You’ll forfeit this fight and lose your spot in the room.'
                : `You’ll leave room ${lobby?.code ?? ''}. Rejoin with the code if you change your mind.`}
            </p>
            <button onClick={goHome}>Leave</button>
            <button onClick={() => setMenu('main')}>Stay</button>
          </div>
        </div>
      )}
      {menu === 'help' && (
        <div className="menu-overlay" onClick={() => setMenu(null)}>
          <div className="menu-card" onClick={(e) => e.stopPropagation()}>
            <div className="menu-head">
              <b>How to cast</b>
              <button className="small" onClick={() => setMenu('main')}>
                Back
              </button>
            </div>
            <CastGuide />
          </div>
        </div>
      )}
    </main>
  )
}

/** The opponent's drawing in its true shape: points are fractions of a box `view.aspect` wide / tall
 *  (a player's visible camera view, or the AI's square), drawn without stretching. A player's view
 *  fills this half the way their camera filled theirs (cover); the AI's box is shown whole. */
const FRAME_H = 1000
function EnemyCanvas({ cast }: { cast: Snapshot['enemyCast'] }) {
  const fw = FRAME_H * (cast?.view.aspect ?? 16 / 9)
  const d = cast?.points.map((p, i) => `${i ? 'L' : 'M'}${(p.x * fw).toFixed(1)} ${(p.y * FRAME_H).toFixed(1)}`).join(' ') ?? ''
  return (
    <div className={`enemy-canvas ${cast?.phase === 'ready' ? 'ready' : ''}`} style={{ color: cast?.color ?? 'var(--sub)' }}>
      <svg viewBox={`0 0 ${fw.toFixed(1)} ${FRAME_H}`} preserveAspectRatio={`xMidYMid ${cast?.view.fit === 'contain' ? 'meet' : 'slice'}`}>
        {d && <path d={d} className="enemy-ink" />}
        {d && <path d={d} className="enemy-stroke" />}
      </svg>
    </div>
  )
}

/** Aegis armor on the health bar: blue after your health; whatever doesn't fit wraps back in from the left. */
function ArmorBar({ hp, max, armor }: { hp: number; max: number; armor: number }) {
  if (armor <= 0) return null
  const m = max === Infinity ? 100 : max
  const start = max === Infinity ? 0 : Math.min(hp, m)
  const end = Math.min(m, start + armor)
  const over = start + armor - m // overflow, wrapped from the left
  return (
    <>
      <div className="armor-fill" style={{ left: `${(100 * start) / m}%`, width: `${(100 * (end - start)) / m}%` }} />
      {over > 0 && <div className="armor-fill over" style={{ left: 0, width: `${(100 * Math.min(over, m)) / m}%` }} />}
    </>
  )
}

/** A charge as text: a combo lists what's mixed in so far. */
function chargeLabel(el: string | null, mix: string[]) {
  if (!el) return 'no charge'
  const mixed = mix.map((e) => ELEMENTS[e].name).join(' + ')
  if (el === COMBO) return mixed ? `Charging combo: ${mixed}` : 'Charging combo'
  return mixed ? `${chargeInfo(el).name} charged (${mixed})` : `${chargeInfo(el).name} charged`
}

/** What the opponent is doing, as text (same style as your own charge line). */
function OppStatus({ fight, id = 'enemy', cast, hint: showHint }: { fight: Snapshot; id?: Fid; cast?: Snapshot['enemyCast']; hint?: boolean }) {
  const c = cast === undefined ? fight.enemyCast : cast
  const silenced = fight.running && fight.silenced[id] > 0
  // The fight's view shows a combo's mix as it grows.
  const el = fight.charge[id] ?? (c && c.el !== '?' ? c.el : null)
  // Training dummy aid: the element that counters what it's charging (attacks only).
  const hint = showHint && c && c.el in BEATS ? beaterOf(c.el) : null
  if (fight.shroud[id] > 0 && !silenced)
    // Shroud: you can't see what they're charging or drawing.
    return (
      <div className="status-strip">
        <span className="charge" style={{ color: ELEMENTS.U.color }}>
          Shrouded
        </span>
        <span className="sub-line">can't see their spell</span>
      </div>
    )
  return (
    <div className="status-strip">
      <span className="charge" style={{ color: el ? chargeInfo(el).color : undefined }}>
        {chargeLabel(el, fight.mix[id] ?? [])}
      </span>
      <span className="sub-line">{silenced ? 'Silenced!' : c?.phase === 'ready' ? `${c.name} ready!` : c?.phase === 'draw' ? 'drawing…' : ''}</span>
      {hint && !silenced && (
        <span className="sub-line" style={{ color: ELEMENTS[hint].color }}>
          Counter with {ELEMENTS[hint].name}
        </span>
      )}
    </div>
  )
}

const RESULT_MS = 3500 // the result shows this long before the lobby comes back

/** Online lobby: a page of its own. Enter or create a room code; in a room, the two teams, HP (the host
 *  sets it) and Ready. Covers the arena until the countdown starts. */
function LobbyScreen(props: {
  lobby: LobbyInfo
  joinCode: string
  setJoinCode: (c: string) => void
  arena: OnlineArena | null
  onReconnect: () => void
  onHome: () => void
}) {
  const { lobby, joinCode, setJoinCode, arena, onReconnect, onHome } = props
  const me = lobby.seats[lobby.you]
  const inRoom = (lobby.phase === 'lobby' || lobby.phase === 'over') && !!lobby.code
  let body: ReactNode = null
  switch (lobby.phase) {
    case 'connecting':
      body = <span className="sub-line">Connecting to the game server…</span>
      break
    case 'reconnecting':
      body = <span className="sub-line">Reconnecting…</span>
      break
    case 'offline':
      body = <button onClick={onReconnect}>Reconnect</button>
      break
    case 'menu':
      body = (
        <div className="lobby-join">
          <form
            className="row"
            onSubmit={(e) => {
              e.preventDefault()
              arena?.join(joinCode)
            }}
          >
            <input className="code-input" value={joinCode} maxLength={4} placeholder="CODE" autoCapitalize="characters" autoComplete="off" autoCorrect="off" spellCheck={false} enterKeyHint="go" aria-label="Room code" onChange={(e) => setJoinCode(e.target.value.toUpperCase())} />
            <button type="submit" disabled={joinCode.length !== 4}>
              Join
            </button>
          </form>
          <span className="sub-line">or</span>
          <button onClick={() => arena?.create()}>Create room</button>
        </div>
      )
      break
  }
  if (inRoom)
    body = (
      <>
        <div className="lobby-code">
          <span className="sub-line">Room code</span>
          <b className="room-code">{lobby.code}</b>
        </div>
        <RoomTeams lobby={lobby} arena={arena} />
        <div className="lobby-actions">
          {lobby.seats.length < 2 ? (
            <span className="sub-line">Share the code. Up to 4 players, 2 per team.</span>
          ) : (
            <button className="cta" onClick={() => arena?.ready()} disabled={me?.ready}>
              {me?.ready ? 'Ready ✓' : lobby.phase === 'over' ? 'Rematch' : 'Ready'}
            </button>
          )}
          <button className="small" onClick={() => arena?.leave()}>
            Leave room
          </button>
        </div>
      </>
    )
  return (
    <section className="lobby-screen">
      <div className="lobby-card">
        <b className="lobby-title">Custom game</b>
        {body}
        {lobby.awayUntil !== null && <span className="note-line">A player disconnected. Their seat is held 15 s.</span>}
        {lobby.note && <span className="note-line">{lobby.note}</span>}
        <button className="small lobby-home" onClick={onHome}>
          Home
        </button>
      </div>
    </section>
  )
}

/** During a match: the room code and Forfeit in the corner by Esc, and notices as a small toast. */
function OnlineChip({ lobby, clock, arena }: { lobby: LobbyInfo; clock: number; arena: OnlineArena | null }) {
  const f = lobby.forfeit
  const notice =
    f && !f.mine
      ? `Your teammate wants to forfeit. Press Forfeit to agree.`
      : lobby.awayUntil !== null
      ? `A player disconnected. Waiting ${Math.max(0, Math.ceil((lobby.awayUntil - clock) / 1000))} s`
      : lobby.paused
        ? 'Paused while a player reconnects'
        : lobby.note
  return (
    <>
      <div className="online-chip">
        <span className="sub-line">
          Room <b>{lobby.code}</b>
        </span>
        {lobby.phase === 'fighting' &&
          (f?.mine ? (
            <button className="small" onClick={() => arena?.forfeit()} title="Take back your vote">
              Forfeit {f.votes}/{f.needed}
            </button>
          ) : (
            <button className="small" onClick={() => (f || window.confirm('Forfeit this match?')) && arena?.forfeit()}>
              Forfeit
            </button>
          ))}
      </div>
      {notice && <div className="online-toast">{notice}</div>}
    </>
  )
}

/** The room's two teams: who's on each, ready or not, and their HP (the host sets HP). */
function RoomTeams({ lobby, arena }: { lobby: LobbyInfo; arena: OnlineArena | null }) {
  const host = lobby.you === lobby.host
  const team = (t: 'player' | 'enemy', label: string) => {
    const seats = lobby.seats.map((s, i) => ({ ...s, i })).filter((s) => s.team === t)
    return (
      <div className={`room-team ${t === 'player' ? 'one' : 'two'}`}>
        <b className="room-team-name">{label}</b>
        {seats.map((s) => (
          <div key={s.i} className={`room-seat ${s.here ? '' : 'away'}`}>
            <span className="room-seat-name">{s.i === lobby.you ? 'You' : `Player ${s.i + 1}`}</span>
            {host ? (
              <label className="room-hp">
                <input type="range" min={HP_MIN} max={HP_MAX} step={50} value={s.hp} onChange={(e) => arena?.setHp(s.i, Number(e.target.value))} aria-label="HP" />
                <span>{s.hp} HP</span>
              </label>
            ) : (
              <span className="room-hp">{s.hp} HP</span>
            )}
            <span className={`room-ready ${s.ready ? 'on' : ''}`}>{s.ready ? 'Ready' : s.here ? 'Not ready' : 'Away'}</span>
          </div>
        ))}
        {!seats.length && <span className="sub-line">Empty</span>}
        {lobby.seats[lobby.you]?.team !== t && seats.length < TEAM_MAX && (
          <button className="small" onClick={() => arena?.switchTeam()}>
            Join this team
          </button>
        )}
      </div>
    )
  }
  return (
    <div className="room-teams">
      {team('player', 'Team 1')}
      {team('enemy', 'Team 2')}
    </div>
  )
}

/** Training dummy settings: a second enemy on or off, and the spells each enemy casts. */
type Pace = DummyPace
function DummyMenu(props: { twoFoes: boolean; setTwoFoes: (on: boolean) => void; pools: [string[], string[]]; setPool: (pool: string[], second: boolean) => void; pace: Pace; setPace: (p: Pace) => void; aids: DummyAids; setAids: (a: DummyAids) => void; onDone: () => void }) {
  const { twoFoes, setTwoFoes, pools, setPool, pace, setPace, aids, setAids, onDone } = props
  // What the cast time % means: the default times (charge + draw + ready) for a light, heavy and signature spell.
  const secs = (shape: string) => {
    const sp = spellOf('F', shape, pace.castPct / 100)
    return ((sp.chargeMs + sp.drawMs + sp.readyMs) / 1000).toFixed(1)
  }
  const [which, setWhich] = useState(0)
  const second = twoFoes && which === 1
  return (
    <>
      <div className="dummy-pace">
        <label className="pace-row">
          <span>Cast time</span>
          <input type="range" min={CAST_PCT.min} max={CAST_PCT.max} step={10} value={pace.castPct} onChange={(e) => setPace({ ...pace, castPct: Number(e.target.value) })} aria-label="Cast time" />
          <b>{pace.castPct}%</b>
        </label>
        <span className="pace-hint">
          Light {secs('line')} s, heavy {secs('h')} s, signature {secs('flame')} s
          {pace.castPct === 100 ? ' (default)' : ''}
        </span>
        <label className="pace-row">
          <span>Time between casts</span>
          <input type="range" min={GAP_MS.min} max={GAP_MS.max} step={250} value={pace.gapMs} onChange={(e) => setPace({ ...pace, gapMs: Number(e.target.value) })} aria-label="Time between casts" />
          <b>{(pace.gapMs / 1000).toFixed(pace.gapMs % 1000 ? 2 : 0).replace(/0$/, '')} s</b>
        </label>
        <label className="pace-row">
          <span>Parry chance</span>
          <input type="range" min={0} max={100} step={5} value={pace.parryPct} onChange={(e) => setPace({ ...pace, parryPct: Number(e.target.value) })} aria-label="Parry chance" />
          <b>{pace.parryPct}%</b>
        </label>
      </div>
      <div className="dummy-foes">
        <button className={`small ${aids.hint ? 'on' : ''}`} aria-pressed={aids.hint} onClick={() => setAids({ ...aids, hint: !aids.hint })}>
          Counter hint: {aids.hint ? 'on' : 'off'}
        </button>
        <button className={`small ${aids.parryTimer ? 'on' : ''}`} aria-pressed={aids.parryTimer} onClick={() => setAids({ ...aids, parryTimer: !aids.parryTimer })}>
          Parry timer: {aids.parryTimer ? 'on' : 'off'}
        </button>
      </div>
      <div className="dummy-foes">
        <button className={`small ${twoFoes ? 'on' : ''}`} aria-pressed={twoFoes} onClick={() => setTwoFoes(!twoFoes)}>
          Second enemy: {twoFoes ? 'on' : 'off'}
        </button>
        {twoFoes && (
          <span className="dummy-tabs">
            {['Left dummy', 'Right dummy'].map((n, i) => (
              <button key={n} className={`small ${which === i ? 'on' : ''}`} aria-pressed={which === i} onClick={() => setWhich(i)}>
                {n}
              </button>
            ))}
          </span>
        )}
      </div>
      <DummySpells key={second ? 2 : 1} pool={pools[second ? 1 : 0]} onChange={(p) => setPool(p, second)} onDone={onDone} />
    </>
  )
}
