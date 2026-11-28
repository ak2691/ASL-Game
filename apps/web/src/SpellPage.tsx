// Spellcasting prototype: sign an element letter to charge, then pinch (or point) and draw a shape.
import { memo, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { DrawingUtils, HandLandmarker, type NormalizedLandmark } from '@mediapipe/tasks-vision'
import { allowCamera, camAllowed, openCamera, type CameraInfo } from './camera'
import { classify, loadRecognizer, trueShape, type Hand } from './recognition'
import { directionLetter, passesGate } from './rules'
import { getTracker, type Handed } from './trackers'
import { BadFrameGuard, LandmarkSmoother } from './smoothing'
import { Spellbook } from './Spellbook'
import { AllyViewSlab, DrawingZoomSlab, PushSlab, SignDelaySlab, SlabChoice, SlabSection, SlabSlider, VolumeSlab } from './SettingRows'
import { loadShapeModel, pathLength, readStroke, shapeFeatures, type Pt } from './shapes'
import { BEATS, canQuick, COMBO, COMBOS_ON, COUNTER, ELEMENTS, chargeInfo, shortCharge, shortShape, QUICK, isValidSpell, shapesFor, signsFor, COMBO_SHAPE, COMBO_MIX, spellName, isMixCounter, mixCounter, elementOfSign } from './spells'
import { Tower, chatLine } from './Ladder'
import { PlayMenu, RatedCard } from './PlayMenu'
import { markBeaten } from './account'
import { DummyArena, LADDER, PracticeArena, beaterOf, dummyTimes, wizardCastMs, shapePoints, type Arena, type Difficulty, type Snapshot } from './battle'
import { HAND_ICONS, HAND_WORDS } from './statusIcons'
import { BoltLayer, Impacts, ParryRings, StatusFx, StatusRow, canActState, setLocalBoltClock, useShake } from './effects'
import { INTERRUPT_LOCK_MS, PARRY_POWER, PARRY_WINDOW_MS, type Bolt, type Fid, type Side } from './combat'
import { TeamArena, type TeamSnapshot } from './team'
import { HP_MAX, HP_MIN, QUICK_CHAT, TEAM_MAX } from './protocol'
import { pencil, play, useFightSfx } from './sfx'
import { ALL_DUMMY_SPELLS, DRAW_HAND_KEY, getDrawingZoom, getPushGrowth, getSignDelay, loadDrawHand, loadDummyPool, saveDummyPool, DUMMY_POOL2_KEY, loadDummyTwo, saveDummyTwo, loadDummyPace, saveDummyPace, CAST_PCT, SPELL_PCT, GAP_MS, type DummyPace, loadDummyAids, saveDummyAids, type DummyAids, loadChatter, saveChatter } from './settings'
import { DummySpells } from './DummySpells'
import { BOOK, GEAR, HomeButton, Icon } from './HomeCorner'

const RESET = 'M3 12a9 9 0 1 0 3-6.7 M3 4v5h5'
import { OnlineArena, duoProgress, setOnlineFlag, type LobbyInfo } from './online'
import { Tutorial } from './Tutorial'
import { DuoTower } from './DuoTower'
import { DUO_CHARS, DUO_TOP, duoLine, type BotInfo } from './duo'

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
const NO_BOLTS: Snapshot['bolts'] = [] // stable empty list: no shakes once a fight stops

function downloadStrokes() {
  const blob = new Blob([JSON.stringify(strokeLog)], { type: 'application/json' })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = `strokes-${new Date().toISOString().slice(0, 19).replace(/:/g, '-')}.json`
  a.click()
  URL.revokeObjectURL(a.href)
}

const CHARGE_PROB = 0.75 // letter model confidence needed to charge an element...
// A hand lost on a fast move never ends the drawing; when it's back, the line joins up from
// where it was last seen. Only a hand gone this long (out of frame, put down) ends it.
const TWO_LOST_MS = 3000
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
/** All four fingers out (each tip well past its knuckle, from the wrist). Push samples are only compared
 *  within one hand shape: opening a letter into a 5 spreads the knuckles and reads as the palm "growing". */
function handOpen(h: NormalizedLandmark[], W: number, H: number) {
  const d = (a: number, b: number) => Math.hypot((h[a].x - h[b].x) * W, (h[a].y - h[b].y) * H, (h[a].z - h[b].z) * W)
  return [[8, 5], [12, 9], [16, 13], [20, 17]].every(([tip, mcp]) => d(tip, 0) > 1.45 * d(mcp, 0))
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
const PARRY_FLASH_MS = 800 // "Reflected" / "Destroyed" stays on your hand this long
const DROPOUT_MS = 150
const REHOLD_MS = 100 // ...or keep holding it this long after the throw (charges again without letting go). Was 400; a whiffed interrupt now carries the spam cost
const PREDICT_MS = 400 // how long a just-signed charge shows before the fight must confirm it

const THUMB_OUT = 0.75 // thumb tip this far from the middle knuckle (palm sizes) = out

const dist = (a: NormalizedLandmark, b: NormalizedLandmark) => Math.hypot(a.x - b.x, a.y - b.y)

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
  // Two "hands" on top of each other are one hand found twice (a ghost after a blur): keep the surer one.
  if (hands.length >= 2) {
    const c = (h: NormalizedLandmark[]) => ({ x: (h[0].x + h[9].x) / 2, y: (h[0].y + h[9].y) / 2 })
    const [p, q] = [c(hands[0]), c(hands[1])]
    const palm = Math.hypot(hands[0][0].x - hands[0][9].x, hands[0][0].y - hands[0][9].y)
    if (Math.hypot(p.x - q.x, p.y - q.y) < 0.6 * palm) {
      const keep = (handed[1]?.score ?? 0) > (handed[0]?.score ?? 0) ? 1 : 0
      hands = [hands[keep]]
      handed = [handed[keep]]
    }
  }
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

export type Mode = 'dummy' | 'practice' | 'online' | 'tutorial' | 'duo' // duo: the Tower with a partner (online, against the pairs)

/** Two enemies (training dummy): where the throwing hand is on screen picks the target (Overview.md, "Team modes"). */
type Zone = 'left' | 'right'
/** Two zones, sized for comfort: the third of the screen on your signing hand's side aims that way,
 *  the rest aims the other way (screen x, as you see it: 0 = left). */
const SIDE_ZONE = 1 / 3
const MAJORITY_SWITCH = 0.6 // share of the hand that must be on the other side to switch zones
/** A team card's spells: what it threw or what hit it (heals only on whoever they healed). */
const cardBolts = (bolts: Bolt[], id: Fid) => bolts.filter((b) => (b.kind === 'heal' ? b.to === id : b.to === id || b.by === id))

export function SpellPage({ hand, mode, onHome, onMode, onAccount }: { hand: Hand; mode: Mode; onHome: () => void; onMode?: (m: Mode) => void; onAccount?: () => void }) {
  const net = mode === 'online' || mode === 'duo' // the fight runs on the game server
  const videoRef = useRef<HTMLVideoElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [status, setStatus] = useState('Loading hand tracking and letter model…')
  // The camera never opens by itself (Nov 24): you turn it on from a card that says why, or by starting play
  // (Start battle, Ready). Once allowed it stays allowed for this browser session. A Duel's lobby never uses it.
  const [camOn, setCamOn] = useState(() => mode !== 'online' && camAllowed())
  const turnOnCamera = () => {
    allowCamera()
    setCamOn(true)
  }
  const [seeing, setSeeing] = useState('')
  const [drawing, setDrawing] = useState(false)
  const [menu, setMenu] = useState<null | 'main' | 'help' | 'leave' | 'dummy' | 'forfeit' | 'chat'>(null)
  const menuRef = useRef(menu)
  menuRef.current = menu
  const [camInfo, setCamInfo] = useState<CameraInfo | null>(null)
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
  // The tutorial has its own plain dummy: defaults only, never the training dummy's saved settings.
  const tut = mode === 'tutorial'
  const [dummyPool, setDummyPoolState] = useState(() => (dummy.current.pool = tut ? ALL_DUMMY_SPELLS : loadDummyPool()))
  // A second enemy: the dummy fight becomes you against two dummies, each with its own spells.
  const team = useState(() => new TeamArena())[0]
  const [twoFoes, setTwoFoesState] = useState(() => mode === 'dummy' && loadDummyTwo())
  const aimOnRef = useRef(false) // two foes to aim between (read by the camera loop)
  const [dummyPool2, setDummyPool2State] = useState(() => (tut ? ALL_DUMMY_SPELLS : loadDummyPool(DUMMY_POOL2_KEY)))
  team.pools = { enemy: dummyPool, enemy2: dummyPool2 }
  // Dummy pace (both dummies): cast time as a % of the default, and the time between casts.
  const [pace, setPaceState] = useState(() => (tut ? { castPct: 100, gapMs: GAP_MS.def, parryPct: 0, spellPct: {}, template: null } : loadDummyPace()))
  dummy.current.castPct = team.castPct = pace.castPct
  dummy.current.gapMs = team.gapMs = pace.gapMs
  dummy.current.parryPct = team.parryPct = pace.parryPct
  dummy.current.spellPct = team.spellPct = pace.spellPct
  const setPace = (p: Pace) => {
    if (!tut) saveDummyPace(p)
    setPaceState(p)
  }
  // Dummy aids: the counter hint and the parry timing rings (the tutorial always shows the rings).
  const [aids, setAidsState] = useState(() => (tut ? { hint: false, parryTimer: true } : loadDummyAids()))
  const setAids = (a: DummyAids) => {
    if (!tut) saveDummyAids(a)
    setAidsState(a)
  }
  const setDummyPool = (pool: string[], second = false) => {
    if (second) {
      if (!tut) saveDummyPool(pool, DUMMY_POOL2_KEY)
      setDummyPool2State(pool)
    } else {
      dummy.current.pool = pool
      if (!tut) saveDummyPool(pool)
      setDummyPoolState(pool)
    }
  }
  const setDummyAttacks = (on: boolean) => {
    dummy.current.setAttacking(on)
    team.setAttacking(on)
    setDummyAttacksState(on)
  }
  const practice = useRef(new PracticeArena())
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
  // The Training dummy menu (Nov 26): the page re-renders every frame (the fight clock), so the menu is memoized
  // and gets stable callbacks that call the latest setters; otherwise scrolling it lagged.
  const menuLatest = useRef({ setTwoFoes, setPool: setDummyPool, setPace, setAids })
  menuLatest.current = { setTwoFoes, setPool: setDummyPool, setPace, setAids }
  const menuApi = useMemo(
    () => ({
      setTwoFoes: (on: boolean) => menuLatest.current.setTwoFoes(on),
      setPool: (pool: string[], second: boolean) => menuLatest.current.setPool(pool, second),
      setPace: (p: Pace) => menuLatest.current.setPace(p),
      setAids: (a: DummyAids) => menuLatest.current.setAids(a),
      onDone: () => setMenu(null),
    }),
    [],
  )
  // Quick chat (Nov 27): preset lines from the menu; each shows for CHAT_SHOW_MS by the sender's name.
  // Muting hides other people's lines (yours still show to you).
  const [chatMuted, setChatMuted] = useState(() => localStorage.getItem(CHAT_MUTE_KEY) === '1')
  const chatApi = useMemo(
    () => ({
      say: (line: number) => (online.current?.say(line), setMenu(null)),
      setMuted: (on: boolean) => {
        setChatMuted(on)
        try {
          localStorage.setItem(CHAT_MUTE_KEY, on ? '1' : '0')
        } catch {
          /* fine */
        }
      },
      onBack: () => setMenu('main'),
    }),
    [],
  )
  /** The newest quick chat line from this fighter (as you see them), while it's showing. */
  const chatOf = (side: Fid) => {
    if (!net || !lobby) return null
    for (let i = lobby.chat.length - 1; i >= 0; i--) {
      const c = lobby.chat[i]
      if (c.from === side && clock - c.at < CHAT_SHOW_MS && (c.you || !chatMuted)) return c
    }
    return null
  }
  const dummyPools = useMemo((): [string[], string[]] => [dummyPool, dummyPool2], [dummyPool, dummyPool2])
  // Tutorial "Try it": the dummy throws heavy Earth for you to parry, or two dummies to aim at.
  // Nothing here is saved: leaving the try puts the dummy back the way it was.
  const tutorialTry = (kind: 'parry' | 'two' | null) => {
    setTwoFoes(kind === 'two', false)
    dummy.current.pool = kind === 'parry' ? ['E:h'] : dummyPool
    setDummyAttacks(kind === 'parry')
  }
  const [fight, setFight] = useState<Snapshot>(() => arena.current.update(0))
  useEffect(() => {
    const say = fight.say
    if (!say || say.n === saidN.current || mode !== 'practice') return
    saidN.current = say.n
    if (!chatter || !fought.current) return
    setBubble({ text: chatLine(fought.current, say.key), n: say.n })
    play('ui_click', { vol: 0.35, pitch: 1.7 })
    const t = setTimeout(() => setBubble((b) => (b?.n === say.n ? null : b)), say.key === 'win' || say.key === 'lose' ? 5000 : 3500)
    return () => clearTimeout(t)
  }, [fight.say?.n]) // eslint-disable-line react-hooks/exhaustive-deps
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
  const parryFlash = useRef<{ text: string; t: number } | null>(null) // your last landed parry, shown on your hand
  const parryMiss = useRef<string | null>(null) // your last missed parry's "Too early" / "Too late" (parry timer on), shown under the stagger ring
  const parryTimerRef = useRef(false)
  // Shake the half a spell lands on (see effects.tsx).
  const youRef = useRef<HTMLDivElement>(null)
  const oppRef = useRef<HTMLDivElement>(null)
  const sideRefs = useRef({ player: youRef, enemy: oppRef }).current
  setLocalBoltClock(!net)
  useShake(fight.running && !fight.over ? fight.bolts : NO_BOLTS, sideRefs)
  useFightSfx(fight, 'player', mode === 'practice' || net)
  const [lobby, setLobby] = useState<LobbyInfo | null>(null)
  const [clock, setClock] = useState(0)
  const charge = shownCharge(clock, fight.charge.player)
  const [joinCode, setJoinCode] = useState('')
  // The fight is advanced and redrawn every UI_TICK_MS (same as the online server's tick).
  useEffect(() => {
    // The enemy's drawing is heard too (quieter, on their side): while its points keep growing.
    let enemyPts = 0
    let enemyDrewAt = -1e9
    let drawnAt = -1e9
    let wasOver = false
    const id = setInterval(() => {
      const t = performance.now()
      const snap = arena.current.update(t)
      fightRef.current = snap
      // A menu covers the arena (Nov 26): the fight goes on, but the page redraws only MENU_REDRAW_MS apart, so
      // scrolling the menu isn't interrupted by a whole-page re-render every tick.
      const redraw = !menuRef.current || t - drawnAt >= MENU_REDRAW_MS
      if (redraw) drawnAt = t
      if (redraw) setFight(snap)
      // Practice: the result screen turns on in the same render that ends the fight (a render later, the
      // tower would flash in between).
      if (snap.over && !wasOver && mode === 'practice') setReview(true)
      wasOver = !!snap.over
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
      // What the fight says your casting did (parry results go on your hand).
      const fresh = snap.notes.filter((n) => n.side === 'player' && !seenNotes.current.has(n.id))
      if (redraw) seenNotes.current = new Set(snap.notes.map((n) => n.id)) // between menu redraws, notes wait
      const pr = fresh.find((n) => n.name === 'Reflected!' || n.name === 'Destroyed!')
      if (pr && redraw) parryFlash.current = { text: pr.name.slice(0, -1), t }
      const pm = fresh.find((n) => n.name === 'Parry missed')
      if (pm && redraw) parryMiss.current = pm.detail.startsWith('Too ') ? pm.detail.split(',')[0] : null
      if (!redraw) return
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
    online.current = new OnlineArena(mode === 'duo')
    arena.current = online.current
  }
  const inRoom = net && !!lobby?.code
  // When the last match ended (the result shows a moment before the lobby comes back).
  const overAt = useRef(0)
  const lastOver = useRef<string | null>(null)
  const practiceOverAt = useRef(0)
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
  const fought = useRef<Difficulty | null>(null) // the floor of the last practice fight (for its loss tip)
  // Practice opponents talk (text only): a bubble by their name, a soft blip, gone after a few seconds.
  const [chatter, setChatter] = useState(loadChatter)
  const [bubble, setBubble] = useState<{ text: string; n: number } | null>(null)
  const saidN = useRef(0)
  // Practice starts after a short 3-2-1 (the gong plays when the fight begins).
  const [countdownEnds, setCountdownEnds] = useState<number | null>(null)
  // Practice (Nov 26): a finished fight stays on screen with its result until you pick what's next.
  const [review, setReview] = useState(false)
  const startPractice = () => {
    turnOnCamera()
    setCountdownEnds(performance.now() + 3000)
  }
  // Quick match (Nov 27): queueing never touches the camera; it turns on in the 10 s countdown before the fight.
  const findMatch = useCallback((mode: 'casual' | 'ranked', size: '1v1' | '2v2') => online.current?.findMatch(mode, size), [])
  // Duel: the camera turns on only in the arena (countdown or fight), never in the lobby, Ready included
  useEffect(() => {
    if (net && !camOn && (lobby?.phase === 'countdown' || lobby?.phase === 'fighting')) turnOnCamera()
  }, [lobby?.phase]) // eslint-disable-line react-hooks/exhaustive-deps
  const lastTick = useRef(0)
  const secsLeft = (ends: number | null | undefined) => (ends ? Math.max(0, Math.ceil((ends - clock) / 1000)) : 0)
  const onlineEnds = net && lobby?.phase === 'countdown' ? lobby.countdownEnds : null
  useEffect(() => {
    const left = secsLeft(countdownEnds ?? onlineEnds)
    if (left > 0 && left <= 3 && left !== lastTick.current) play('countdown_tick', { vol: 0.6 })
    lastTick.current = left
    if (countdownEnds && clock >= countdownEnds) {
      setCountdownEnds(null)
      setReview(false)
      fought.current = difficulty
      practice.current.start(performance.now(), difficulty)
      setFight(practice.current.update(performance.now())) // running at once: no frame where the tower comes back
    }
  }, [clock]) // eslint-disable-line react-hooks/exhaustive-deps
  const inPracticeMatch = mode === 'practice' && fight.running
  useEffect(() => {
    if (net) goOnline()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps -- once, on open (mode never changes: the page is keyed by it)
  // Aiming with the zone your signing hand is in. Two enemies: left zone the left one, right zone the right one.
  // With a teammate, heals, buffs and Shroud: your signing hand's own side is you, the other side your teammate.
  // (Read from a ref: the camera loop keeps the closure of an earlier render.)
  const sidesRef = useRef<{ foes: Fid[]; allies: Fid[] }>({ foes: [], allies: [] })
  const zoneTarget = (z: Zone, el: string | null, shape: string): Fid | null => {
    if (!el) return null
    const { foes: fs, allies: al } = sidesRef.current
    if ((el === 'A' && shape !== COUNTER) || shape === 'veil') {
      if (!al.length) return null // no teammate: on you
      const own: Zone = drawHandRef.current === 'right' ? 'left' : 'right'
      return z === own ? 'player' : al[0]
    }
    if (fs.length < 2) return null
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
      if (!camOn) return
      try {
        const [rec, tracker2, shapeModel] = await Promise.all([loadRecognizer(), getTracker(2), loadShapeModel()])
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
        let sizes: PalmSample[] = [] // recent palm measurements (push detection)
        let sizesOpen = false // whether those were taken with the hand open
        let handLock: { k: string; peak: number } | null = null // what's on your hand now, and its full length
        let lastLocked = 0
        let lockWhiff = false // the lockout's kind, decided when it starts (a whiff is the longer one)
        let wasSilenced = false
        let sentSign: { el: string; t: number } | null = null // last element sent, so it isn't resent every frame
        let lastCharge: string | null = null // to spot a new charge (see the push below)
        // After a throw your hand is often still in that letter's shape. It mustn't recharge you: the
        // letter has to be let go (another shape for a moment) before it can charge again.
        let release: { el: string; since: number | null; thrown: number } | null = null
        let penUpOpen = false // a stroke just ended with an open hand: it doesn't drop the charge until the hand changes
        let openHoldSince: number | null = null // open hand held while charged (drops the charge after CHARGE_MS)
        let sentUncharge = 0
        let knockedSeen = 0
        // Two hands: the drawing hand, tracked on its own.
        const drawSmoother = new LandmarkSmoother()
        let drawLast: { lm: NormalizedLandmark[]; t: number } | null = null
        const drawGuard = new BadFrameGuard()
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
            return
          }
          const el = fightRef.current.charge.player
          const { shape, m } = readStroke(shapeModel, pts, el)
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
        }

        const loop = async () => {
          if (stopped) return
          video.requestVideoFrameCallback(loop)
          if (video.currentTime === lastVideoTime) return
          lastVideoTime = video.currentTime
          const now = performance.now()
          // The signing hand is whichever one doesn't draw (the letter model reads it as that hand).
          const signHand: Hand = drawHandRef.current === 'right' ? 'left' : 'right'
          const all = await tracker2.detectAll(video, now)
          const split = splitHands(all.image, all.handed, signHand, roles)
          const found = split.sign
          const drawFound = split.draw
          if (found) roles.sign = { x: found[0].x, y: found[0].y }
          if (drawFound) roles.draw = { x: drawFound[0].x, y: drawFound[0].y }
          if (stopped) return
          let dLm: NormalizedLandmark[] | null = null
          // A wrecked frame (motion blur) is treated like a brief dropout: the pen holds, and the next good
          // frame joins the stroke with a straight line.
          const drawOk = !!drawFound && drawGuard.ok(drawFound, now)
          if (drawFound && drawOk) {
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
          const view = fightRef.current
          const myCharge = shownCharge(now, view.charge.player)
          // No match running (the tower before a fight, lobbies, after a match): free drawing. Any sign puts the pen
          // down, the line is white, an open hand wipes it, and nothing is charged, cast or sent to the fight (Nov 27).
          const idle = !view.running
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
          // Mixing a combo (fewer than 2 elements in): pointing between letters (W to L) isn't drawing.
          const mixing = myCharge === COMBO && view.mix.player.length < 2
          // The signing hand holding an element letter (or C) = pen down, open hand = pen up.
          // Only while charged with nothing readied, and both hands in view.
          {
            const can = idle || (!!myCharge && !myReady && !silenced && !mixing)
            const holdingType = pred !== null && pred.confidence >= CHARGE_PROB && (idle || !!ELEMENTS[pred.letter] || (pred.letter === COMBO && COMBOS_ON))
            const signOpen = !!shapeLm && isOpen(shapeLm, false)
            const want = can && (penDown ? !signOpen : holdingType && !signOpen)
            if (!can) {
              penDown = false
              penFlipSince = null
            } else if (!lm) penFlipSince = null // signing hand lost (fast move): the pen stays as it was
            else if (want === penDown) penFlipSince = null
            else if ((penFlipSince ??= now) && now - penFlipSince >= getSignDelay()) {
              penDown = want
              penFlipSince = null
            }
          }
          const pointing = silenced || mixing ? false : penDown
          // The pen, in pixels: the index tip.
          const penHand = dLm
          const pen: Pt | null = penHand ? { x: penHand[8].x * W, y: penHand[8].y * H } : null
          if (dLm && pen) {
            drawer.drawConnectors(dLm, HandLandmarker.HAND_CONNECTIONS, { color: 'rgba(255,255,255,0.5)', lineWidth: 2 })
            // Pen cursor: hollow while hovering, filled while drawing.
            ctx.beginPath()
            ctx.arc(pen.x, pen.y, 0.012 * W, 0, 2 * Math.PI)
            ctx.lineWidth = 3
            ctx.strokeStyle = ctx.fillStyle = myCharge ? chargeInfo(myCharge).color : '#ffffff'
            if (pointing) ctx.fill()
            else ctx.stroke()
          }
          {
            const lk = view.locked?.player ?? 0
            if (lk > lastLocked + 60) lockWhiff = lk > INTERRUPT_LOCK_MS
            lastLocked = lk
            const cs = view.over ? null : canActState(view, 'player', lockWhiff) // nothing on your hand once the match is over
            if (!cs) handLock = null
            else if (!handLock || handLock.k !== cs.k || cs.ms > handLock.peak) handLock = { k: cs.k, peak: Math.max(cs.ms, handLock?.k === cs.k ? handLock.peak : 0) }
          }
          let letter = ''
          if (lm && pred) {
            // Fizzle lockout: the hand goes dim and grey until you can throw again.
            const staggered = (view.staggered?.player ?? 0) > 0
            const locked = (view.locked?.player ?? 0) > 0 // interrupted or whiffed
            const dim = view.fizzled.player > 0 || staggered || locked || view.silenced.player > 0
            if (dim) ctx.globalAlpha = 0.3
            drawer.drawConnectors(lm, HandLandmarker.HAND_CONNECTIONS, { color: dim ? '#888' : myCharge ? chargeInfo(myCharge).color : '#e2b714', lineWidth: 3 })
            ctx.globalAlpha = 1
            // Can't act (fizzled, staggered, interrupted, whiffed, silenced, recovering from a parry): a ring on
            // the palm drains as the timer, with the cause's symbol in the middle. The timer runs in the fight,
            // so if the hand leaves the frame it's still counting when it comes back.
            const cs = view.over ? null : canActState(view, 'player', lockWhiff) // nothing on your hand once the match is over
            if (cs) {
              const cx = ((lm[0].x + lm[9].x) / 2) * W
              const cy = ((lm[0].y + lm[9].y) / 2) * H
              const r = 0.065 * W
              ctx.save()
              ctx.translate(cx, cy)
              ctx.scale(-1, 1) // the canvas is mirrored on screen
              ctx.fillStyle = 'rgba(20, 16, 40, 0.72)'
              ctx.beginPath()
              ctx.arc(0, 0, r, 0, 2 * Math.PI)
              ctx.fill()
              ctx.lineWidth = Math.max(4, 0.012 * W)
              ctx.strokeStyle = 'rgba(255, 255, 255, 0.18)'
              ctx.stroke()
              const f = Math.min(1, cs.ms / (handLock?.peak || cs.ms))
              ctx.strokeStyle = cs.k === 'recover' ? '#6be38a' : '#ff6b6b'
              ctx.lineCap = 'round'
              ctx.beginPath()
              ctx.arc(0, 0, r, -Math.PI / 2, -Math.PI / 2 + f * 2 * Math.PI)
              ctx.stroke()
              const k = (r * 1.15) / 24
              ctx.scale(k, k)
              ctx.translate(-12, -12)
              ctx.lineWidth = 2.4
              ctx.lineJoin = 'round'
              ctx.strokeStyle = '#fff'
              ctx.stroke(new Path2D(HAND_ICONS[cs.k]))
              ctx.restore()
              // The cause, in the theme's title font, under the ring.
              const word = cs.k === 'staggered' && parryTimerRef.current && parryMiss.current ? parryMiss.current : HAND_WORDS[cs.k]
              if (word) {
                ctx.save()
                ctx.translate(cx, cy + r + 0.03 * W)
                ctx.scale(-1, 1)
                const title = getComputedStyle(document.documentElement).getPropertyValue('--title').trim() || 'sans-serif'
                ctx.font = `${Math.round(0.032 * W)}px ${title}`
                ctx.textAlign = 'center'
                ctx.textBaseline = 'middle'
                ctx.lineWidth = Math.max(3, 0.007 * W)
                ctx.lineJoin = 'round'
                ctx.strokeStyle = '#000'
                ctx.strokeText(word, 0, 0)
                ctx.fillStyle = '#fff'
                ctx.fillText(word, 0, 0)
                ctx.restore()
              }
            }
            // A parry just landed: "Reflected" or "Destroyed" on the hand, where you're looking.
            const pf = parryFlash.current
            const flash = !dim && pf && now - pf.t < PARRY_FLASH_MS ? pf.text : null
            if (flash) {
              // "Fizzled" over the palm. The canvas is mirrored on screen, so flip the text back.
              const cx = ((lm[0].x + lm[9].x) / 2) * W
              const cy = ((lm[0].y + lm[9].y) / 2) * H
              ctx.save()
              ctx.translate(cx, cy)
              ctx.scale(-1, 1)
              ctx.font = `bold ${Math.round(0.04 * W)}px sans-serif`
              ctx.textAlign = 'center'
              ctx.textBaseline = 'middle'
              ctx.fillStyle = '#ffffff'
              ctx.shadowColor = '#000'
              ctx.shadowBlur = 8
              ctx.fillText(flash, 0, 0)
              ctx.restore()
            }
            // Not while drawing, silenced or with a spell readied (the fight would refuse it anyway).
            // An open hand ("none") held CHARGE_MS while charged, nothing drawn: drop the charge. Not the
            // open hand that just ended a stroke (that one has to change shape first).
            const canSwitch = !committed
            const openHand = canSwitch && !!shapeLm && isOpen(shapeLm, false)
            if (!openHand) penUpOpen = false
            if (openHand && myCharge && !myReady && !penUpOpen && !silenced && view.running) {
              openHoldSince ??= now
              if (now - openHoldSince >= getSignDelay() && now - sentUncharge > 300) {
                dropDot()
                arena.current.uncharge()
                sentUncharge = now
                predicted.current = null
                holdLetter = null
              }
            } else openHoldSince = null
            if (canSwitch && !silenced && !myReady && !((view.locked?.player ?? 0) > 0)) {
              // Not drawing: read the handshape as a letter, to charge an element.
              letter = pred.confidence >= CHARGE_PROB ? directionLetter(pred.letter, shapeLm) : ''
              if (letter && !passesGate(letter, shapeLm)) letter = '' // e.g. an open palm read as F
              // An open "5" is no letter. Until the letter model has a "none" class it still picks its
              // closest letter (C, H, ...), so a full open hand never charges.
              if (letter && shapeLm && isOpen(shapeLm, false)) letter = ''
              let el = elementOfSign(letter)
              if (release) {
                if (el === release.el) release.since = null
                else if ((release.since ??= now) && now - release.since >= getSignDelay()) release = null
                // Still holding the thrown letter: blocked for a moment (so the throw itself doesn't
                // recharge you), then holding it on charges it again.
                if (release && el === release.el && now - release.thrown >= REHOLD_MS) release = null
                if (release && el === release.el) el = null
              }
              if (el !== holdLetter) {
                holdLetter = el
                holdSince = now
              } else if (el && view.running && el !== myCharge && !(myCharge && COMBO_MIX[myCharge]?.includes(el)) && !view.mix.player.includes(el) && !(el === COMBO && view.mix.player.length === 2) && now - holdSince >= getSignDelay() && (sentSign?.el !== el || now - sentSign.t > 300)) {
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
          // Staggered from a missed parry: no drawing at all until it ends.
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
            if (!idle) arena.current.stroke([{ x: (W - pen.x - (W - vw) / 2) / vw, y: (pen.y - (H - vh) / 2) / vh }], vw / vh)
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
          // Charge gone (open palm, knocked off, silenced) = the drawing is dropped, no fizzle.
          if (stroke.length && !myCharge && !idle) {
            stroke = []
            palmSum = 0
            setDrawing(false)
            arena.current.cleared()
          }
          // The signing hand opened (pen up), or the drawing hand has been gone TWO_LOST_MS.
          if (stroke.length && idle && (!pointing || now - lastPointT > TWO_LOST_MS)) {
            // Free drawing: the open hand just wipes it.
            stroke = []
            palmSum = 0
            setDrawing(false)
          } else if (stroke.length && (!pointing || now - lastPointT > TWO_LOST_MS)) {
            finishStroke(now)
            // The open hand that ended the stroke doesn't drop the charge until it changes, unless the stroke
            // was only a dot.
            penUpOpen = committed
            sizes = []
          }
          // Recent hand sizes (for push detection), recorded every frame.
          if (lm && found) {
            const open = handOpen(lm, W, H)
            if (open !== sizesOpen) sizes = [] // the hand changed shape: start over from this one
            sizesOpen = open
            sizes.push(palmSample(lm, W, H, now))
            while (sizes.length && now - sizes[0].t > PUSH_WINDOW_MS) sizes.shift()
          } else sizes = []

          // Parry: track both hands (fresh detections only) and note when each crosses the push growth.
          let parried = false
          {
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
            if (pushed(pDraw, drawOk ? dLm : null)) {
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
                if (!idle) arena.current.cleared()
              }
              if (now - parryAt > PARRY_COOLDOWN_MS) {
                parryAt = now
                arena.current.parry() // the fight logs what it did (reflected, missed, or nothing while staggered)
              }
            }
            // Flash both palms while the parry shows.
            if (now - parryAt < 300) {
              ctx.lineWidth = 6
              ctx.strokeStyle = '#ffffff'; ctx.shadowColor = '#ffffff'; ctx.shadowBlur = 18
              for (const h of [lm, dLm]) {
                if (!h) continue
                ctx.beginPath()
                ctx.arc(h[9].x * W, h[9].y * H, size(h) * 1.2, 0, 2 * Math.PI)
                ctx.stroke()
              }
              ctx.shadowBlur = 0
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
          if (!parried && (myReady || (myCharge && canQuick(myCharge))) && sizes.length > 1 && !committed) {
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
              // "PUSH" in the glow: where you're looking, instead of a line of text up top. The canvas is
              // mirrored on screen, so flip the text back.
              ctx.save()
              ctx.translate(cx, cy)
              ctx.scale(-1, 1)
              ctx.font = `900 ${Math.round(0.045 * W)}px sans-serif`
              ctx.textAlign = 'center'
              ctx.textBaseline = 'middle'
              ctx.lineWidth = Math.max(3, 0.008 * W)
              ctx.strokeStyle = '#000'
              ctx.strokeText('PUSH', 0, 0)
              ctx.fillStyle = '#fff'
              ctx.fillText('PUSH', 0, 0)
              ctx.restore()
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
  }, [hand, camOn])

  const oppName = net ? 'Opponent' : mode === 'dummy' || mode === 'tutorial' ? 'Training dummy' : LADDER.find((b) => b.id === difficulty)?.name ?? 'Enemy'
  const teamOf = (id: Fid) => fight.fighters.find((f) => f.id === id)?.team ?? id
  // A stopped or finished fight shows no effects (statuses, armor, spells in flight): ending a match clears them at once.
  const fxOn = fight.running && !fight.over
  const armorOf = (side: Fid) => (fxOn ? fight.shield[side] : 0)
  /** What a fighter has charged, for the badge and the glow on their bar: '?' while Shrouded (yours always shows). */
  const chargeOf = (side: Fid): { el: string | null; mix: string[] } => {
    if (side === 'player') return { el: charge, mix: fight.mix.player }
    if (!fight.running) return { el: null, mix: [] }
    if (fight.shroud[side] > 0 && !(fight.silenced[side] > 0)) return { el: '?', mix: [] }
    const c = side === 'enemy' && !isTeam ? fight.enemyCast : tf.casts?.[side] ?? null
    return { el: fight.charge[side] ?? (c && c.el !== '?' ? c.el : null), mix: fight.mix[side] ?? [] }
  }
  // The fighter's frame (Nov 26): the name and status icons on one row, then the health bar. The charge is
  // written inside the bar (a word, so it reads without telling colors apart) and the bar glows its color.
  /** Written in a team fighter's empty HP bar: OUT (knocked out, or gone for good after a drop), or the
   *  seat countdown while their player is reconnecting. */
  const barTag = (side: Fid) => {
    if (fight.conn?.[side] === 'away') return lobby?.awayUntil != null ? `Reconnecting ${Math.max(0, Math.ceil((lobby.awayUntil - clock) / 1000))} s` : 'Reconnecting'
    return isTeam && fight.hp[side] <= 0 ? 'OUT' : null
  }
  const fighterHead = (side: Fid, name?: string) => {
    const ch = chargeOf(side)
    const glow = ch.el === '?' ? ELEMENTS.U.color : ch.el ? chargeInfo(ch.el).color : undefined
    const words = chargeWords(ch.el, ch.mix)
    const showPower = fxOn && !(mode === 'tutorial' && side === 'enemy')
    return (
    <div className="fighter">
      {/* Name left, HP number right (Nov 26: out of the bar, so the bar shows only health and the charge). */}
      {chatOf(side) && (
        <p className="chat-bubble quick-chat" key={chatOf(side)!.n}>
          {QUICK_CHAT[chatOf(side)!.line]}
        </p>
      )}
      <div className="fighter-name">
        <span className="fighter-label" title={name ?? fight.names?.[side]}>{name ?? fight.names?.[side] ?? (side === 'player' ? 'You' : oppName)}</span>
        <span className="hp-count">
          <small>HP</small>
          {/* A 2v2 foe card is narrow: just the HP left. */}
          {fight.maxHp[side] === Infinity ? '∞' : isTeam && side !== 'player' && !side.startsWith('ally') ? Math.ceil(fight.hp[side]) : `${Math.ceil(fight.hp[side])} / ${fight.maxHp[side]}`}
          {armorOf(side) > 0 && <b className="armor-text">+{armorOf(side)}</b>}
        </span>
      </div>
      <div className={`hp-bar ${glow ? 'charged' : ''}`} style={{ '--charge': glow } as React.CSSProperties}>
        <div
          className="hp-fill"
          style={{ width: `${fight.maxHp[side] === Infinity ? 100 : (100 * fight.hp[side]) / fight.maxHp[side]}%`, background: armorOf(side) > 0 ? 'var(--armor-hp)' : teamOf(side) === 'player' ? 'var(--you)' : 'var(--foe)' }}
        />
        <ArmorBar hp={fight.hp[side]} max={fight.maxHp[side]} armor={armorOf(side)} />
        {barTag(side) && <span className="hp-out">{barTag(side)}</span>}
        {words && (
          // At the bar's right end (the part that empties first). Three lengths; the bar's width picks one.
          <span className={`hp-charge ${words.len}`}>
            <span className="w-full">{words.full}</span>
            <span className="w-short">{words.short}</span>
            <span className="w-tiny">{words.tiny}</span>
          </span>
        )}
        {fight.floats
          .filter((f) => f.side === side)
          .map((f) => (
            <span key={f.id} className={/^[-+]\d/.test(f.text) ? 'float hp-num' : 'float'} style={{ color: f.color }}>
              {f.text}
            </span>
          ))}
      </div>
      {/* Under the bar, fixed room that fits the worst case (Nov 26): nothing here ever moves, wraps into the
          drawing or hides behind "+N". The status icons get their rows (one on a wide bar, two on a 2v2
          card); then all 8 elements' power in fixed slots. Your own "can't act" states are on your hand. */}
      <div className="fighter-status">
        <div className="status-slot">{fxOn && <StatusRow view={fight} side={side} hand={side === 'player'} max={99} />}</div>
        <PowerGrid power={showPower ? fight.power?.[side] ?? {} : undefined} />
      </div>
    </div>
    )
  }
  // Team modes.
  const tf = fight as TeamSnapshot
  // The Tower's Duo between fights (after the result has shown): the tower and its room panel, laid out like
  // the solo tower (not the last fight's 2v2 cards).
  // Before the online arena is attached (first frames), `fight` is the placeholder dummy's and counts as idle:
  // otherwise the bare arena with HP bars flashes before the tower.
  const duoIdle = mode === 'duo' && !(fight.running && arena.current === online.current) && lobby?.phase !== 'countdown' && lobby?.phase !== 'fighting' && !(lobby?.phase === 'over' && clock - overAt.current <= RESULT_MS)
  // The setup countdown before an online fight (Nov 28): shown on your side, with your camera's state.
  const setupOn = net && !fight.running && !duoIdle && lobby?.phase === 'countdown'
  const camBlocked = status.startsWith("Couldn't") && !DEBUG
  const camReady = status === '' || DEBUG // ?debug (dev only): play without a camera
  const online2 = net && fight.fighters.length > 2 && !duoIdle // an online team match (1v2, 2v1, 2v2)
  const isTeam = ((mode === 'dummy' || mode === 'tutorial') && twoFoes) || online2
  const parryTimer = mode === 'dummy' ? aids.parryTimer : mode === 'tutorial' || isTeam // the parry rings (and Too early / Too late on a miss)
  parryTimerRef.current = parryTimer
  const foes = isTeam ? fight.fighters.filter((f) => f.team === 'enemy').map((f) => f.id) : []
  const allies = isTeam ? fight.fighters.filter((f) => f.team === 'player' && f.id !== 'player').map((f) => f.id) : []
  sidesRef.current = { foes, allies }
  aimOnRef.current = foes.length >= 2 || allies.length > 0
  const nameOf = (id: Fid) => {
    const real = fight.names?.[id]
    if (real) return real // online: their actual name (Nov 28), yours too
    if (id === 'player') return 'You'
    if (id.startsWith('ally')) return 'Teammate'
    const bot = tf.bots?.[id]
    if (bot) return DUO_CHARS[bot.who]?.name ?? 'Wizard'
    if (!online2) return id === 'enemy' ? 'Left dummy' : 'Right dummy'
    return foes.length < 2 ? 'Opponent' : id === 'enemy' ? 'Left foe' : 'Right foe'
  }
  const myR = fight.ready.player
  /** Where your ready spell would go. Online, worked out here the same way the server does (minus "who
   *  hit you last"): your zone's foe, else the foe with the least HP; heals go by zone (you or your teammate). */
  const targetFor = (el: string, shape: string): Fid | null => {
    if (!online2) return team.targetFor(el, shape)
    const alive = (id: Fid) => fight.hp[id] > 0
    if (el === 'A' && shape !== COUNTER) {
      const zt = zoneTarget(aimZone, el, shape) // with a teammate: your side you, the other side them
      if (zt && alive(zt)) return zt
      const share = (id: Fid) => (fight.maxHp[id] === Infinity ? 1 : fight.hp[id] / fight.maxHp[id])
      return ['player', ...allies].filter(alive).sort((a, b) => share(a) - share(b))[0] ?? 'player'
    }
    const z = foes.length >= 2 ? zoneTarget(aimZone, el, shape) : null
    if (z && alive(z)) return z
    return foes.filter(alive).sort((a, b) => fight.hp[a] - fight.hp[b])[0] ?? null
  }
  const myTarget = isTeam && myR ? targetFor(myR.el, myR.shape) : null
  /** What a teammate is casting, in words: the spell once ready (and who it's aimed at), else their element. */
  const castWords = (id: Fid, cast: NonNullable<Snapshot['enemyCast']>) => {
    const el = fight.charge[id] ?? (cast.el !== '?' ? cast.el : null)
    const what = cast.name ?? (el ? chargeInfo(el).name : cast.points.length ? 'Drawing' : 'Charging')
    // Who it's aimed at, once ready: the foe's side as you see them (Nov 28: short, whatever their names).
    const at = cast.phase === 'ready' && fight.aim?.[id] && fight.aim[id] !== id ? fight.aim[id] : null
    const where = !at ? null : at === 'player' ? 'you' : at === foes[0] ? 'Left' : at === foes[1] ? 'Right' : nameOf(at)
    return { what, at: where }
  }
  /** Portrait phones (Nov 28): your teammate as a compact, slightly see-through card at the bottom left of your
   *  half (like the desktop card): their name and HP on one line, then their drawing, with their status in its top
   *  right and what they're casting, and at whom once ready, in its bottom left. */
  const allyMini = (id: Fid) => {
    const cast = fight.running ? tf.casts?.[id] ?? null : null
    const hp = fight.hp[id]
    // As short as it goes (Nov 28): "F", "Mag F+E"; once ready, the shape too ("F Heavy") and where ("→ R").
    let label: string | null = null
    let at: string | null = null
    if (cast) {
      const el = fight.charge[id] ?? (cast.el !== '?' ? cast.el : null)
      label = el ? shortCharge(el) : cast.points.length ? '…' : null
      if (cast.phase === 'ready') {
        if (cast.shape && label && shortShape(cast.shape)) label = `${label} ${shortShape(cast.shape)}`
        const w = castWords(id, cast).at
        at = w === 'you' ? 'you' : w === 'Left' ? 'L' : w === 'Right' ? 'R' : w
      }
    }
    return (
      <div key={id} data-fid={id} className={`ally-mini ${hp <= 0 ? 'out' : ''}`}>
        <div className="am-head">
          <span className="am-name" title={nameOf(id)}>{nameOf(id)}</span>
          <span className="am-hp">
            <small>HP</small> {Math.ceil(hp)}
          </span>
        </div>
        <div className="am-view">
          <EnemyCanvas cast={cast} fit />
          {label && (
            <span className="am-cast" style={{ color: cast!.color }}>
              {label}
              {at && <small> → {at}</small>}
            </span>
          )}
        </div>
        {/* Hits on them flash here like on any fighter (no status icons or power on phones: Nov 28). */}
        {fxOn && <Impacts side="player" bolts={cardBolts(fight.bolts, id)} />}
      </div>
    )
  }
  const allyCard = (id: Fid) => {
    const cast = fight.running ? tf.casts?.[id] ?? null : null
    const out = fight.hp[id] <= 0
    return (
      <div key={id} data-fid={id} className={`team-card ally ${myTarget === id ? 'targeted' : ''} ${out ? 'out' : ''}`} style={{ '--aim': myR ? chargeInfo(myR.el).color : undefined } as React.CSSProperties}>
        {fighterHead(id, nameOf(id))}
        <div className="hud-row">
          <OppStatus fight={fight} id={id} cast={cast} />
        </div>
        {/* Your teammate's casting (Nov 28), so a 2v2 can be coordinated without talking: their stroke as they
            draw, their charge or readied spell, and who it's aimed at. Only while they're casting, so the card
            stays a single row the rest of the time. */}
        {cast && (
          <div className="ally-view">
            <EnemyCanvas cast={cast} zoom />
            <span className="ally-cast" style={{ color: cast.color }}>
              {castWords(id, cast).what}
              {castWords(id, cast).at && <small> {castWords(id, cast).at === 'you' ? 'on you' : `at ${castWords(id, cast).at}`}</small>}
            </span>
          </div>
        )}
        {fxOn && <StatusFx side={id} view={fight} />}
        {fxOn && <Impacts side="player" bolts={cardBolts(fight.bolts, id)} />}
      </div>
    )
  }
  const foeCard = (id: Fid) => {
    const cast = fight.running ? tf.casts?.[id] ?? null : null
    const shrouded = fight.shroud[id] > 0
    const out = fight.hp[id] <= 0
    return (
      <div key={id} data-fid={id} className={`team-card foe ${myTarget === id ? 'targeted' : ''} ${out ? 'out' : ''}`} style={{ '--aim': myR ? chargeInfo(myR.el).color : undefined } as React.CSSProperties}>
        <EnemyCanvas cast={shrouded ? null : cast} zoom />
        <div className="side-hud" ref={watchHud}>
          {fighterHead(id, nameOf(id))}
          {tf.bots?.[id] && chatter && <BotBubble who={tf.bots[id].who} say={tf.bots[id].say} />}
          <div className="hud-row">
            <OppStatus fight={fight} id={id} cast={cast} hint={mode === 'dummy' && aids.hint} />
          </div>
        </div>
        {fxOn && <StatusFx side={id} view={fight} />}
        {fxOn && <Impacts side="enemy" bolts={cardBolts(fight.bolts, id)} />}
      </div>
    )
  }
  // What each aim zone does right now (shown on your camera while a spell is ready).
  const zoneLabel = (z: Zone) => {
    if (!myR) return ''
    const t = zoneTarget(z, myR.el, myR.shape)
    return t ? nameOf(t) : nameOf(myTarget ?? 'player')
  }
  const signLeft = drawHand === 'right'
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
      <span className="dealt-line" title="Total damage you've dealt since the last reset">Your damage <b>{fight.dealt.player}</b></span>
    </div>
  )
  const result = fight.over ? (fight.over === 'player' ? 'You win!' : 'You lose') : null
  // The result goes across the middle of the arena (it's about you, not the enemy's half).
  // Practice: the result shows for a moment, then you're back in the tower (it doesn't linger over the floors).
  if ((fight.over ?? null) !== lastOver.current) {
    if (fight.over) practiceOverAt.current = clock
    if (fight.over && mode === 'practice') queueMicrotask(() => setReview(true))
    // A Tower wizard beaten: saved (your account, or this browser), and their portrait unlocks.
    if (fight.over === 'player' && mode === 'practice') queueMicrotask(() => void markBeaten(difficulty))
    lastOver.current = fight.over ?? null
  }
  const floorIdx = LADDER.findIndex((b) => b.id === difficulty)
  const nextFloor = fight.over === 'player' && floorIdx >= 0 && floorIdx < LADDER.length - 1 ? LADDER[floorIdx + 1].id : null
  const showResult = !!result && (mode === 'practice' ? review && !countdownEnds : net && lobby?.phase === 'over' && clock - overAt.current <= RESULT_MS)
  // Online: the lobby screen covers the arena except during the countdown and the fight (and the result,
  // which shows for RESULT_MS before going back to the lobby).
  // Before the first word from the server there's no lobby info yet: still the lobby screen (never the arena).
  const askForfeit = useCallback(() => setMenu('forfeit'), [])
  // Play's Ranked tab: "Sign in" goes to the account page (stable, so the memoized Play menu never redraws for it).
  const accountRef = useRef(onAccount)
  accountRef.current = onAccount
  const signIn = useCallback(() => accountRef.current?.(), [])
  // The opponent's drawing starts right below their HUD, at its real height (Nov 26): status and power rows
  // take only the room they need, and the drawing area moves down when they grow, so nothing ever covers it.
  const hudWatch = useMemo(
    () =>
      typeof ResizeObserver === 'undefined'
        ? null
        : new ResizeObserver((entries) => {
            for (const e of entries) {
              const hud = e.target as HTMLElement
              hud.parentElement?.style.setProperty('--hud-live', `${Math.ceil(hud.offsetHeight)}px`)
            }
          }),
    [],
  )
  const watchHud = useCallback((el: HTMLDivElement | null) => void (el && hudWatch?.observe(el)), [hudWatch])
  // Training dummy: its buttons can be tucked away (a small button brings them back); remembered here.
  const [dockOpen, setDockOpenState] = useState(() => {
    try {
      return localStorage.getItem('spells-dummy-dock') !== '0'
    } catch {
      return true
    }
  })
  const setDockOpen = (open: boolean) => {
    setDockOpenState(open)
    try {
      localStorage.setItem('spells-dummy-dock', open ? '1' : '0')
    } catch {
      /* not saved */
    }
  }
  // The pause menu opens where you left it (also after a trip to the Spellbook).
  const menuScroll = useRef(0)
  const keepMenuScroll = useCallback((el: HTMLDivElement | null) => {
    if (el) el.scrollTop = menuScroll.current
  }, [])
  const showLobby = mode === 'online' && (!lobby || (lobby.phase === 'over' ? clock - overAt.current > RESULT_MS : lobby.phase !== 'countdown' && lobby.phase !== 'fighting'))

  return (
    <main className="page duel-page">
      <div className="corner-bar">
        {net && lobby && !showLobby && (mode === 'online' || lobby.phase === 'countdown' || lobby.phase === 'fighting') && <OnlineChip lobby={lobby} clock={clock} arena={online.current} onForfeit={askForfeit} />}
        {/* One small round button (Home is inside the menu): the corner stays clear of the fight. */}
        <button className="small icon-btn menu-btn" onClick={() => setMenu('main')} title="Menu (Esc)" aria-label="Menu">
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M5 7h14M5 12h14M5 17h14" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" />
          </svg>
        </button>
      </div>

      {showLobby &&
        (lobby ? (
          <LobbyScreen lobby={lobby} joinCode={joinCode} setJoinCode={setJoinCode} arena={online.current} onReconnect={goOnline} onHome={goHome} onSignIn={onAccount ? signIn : undefined} onFind={findMatch} />
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
          {['F', 'I', 'L', 'E', 'W', 'A', 'U', ...(COMBOS_ON ? Object.keys(COMBO_SHAPE) : [])].map((el) =>
            [...shapesFor(el), ...(el in BEATS ? [COUNTER] : []), ...(canQuick(el) ? [QUICK] : [])].map((shape) => (
              <button key={el + shape} className="small" onClick={() => debugCast(el, shape)}>
                {el} {shape}
              </button>
            )),
          )}
        </section>
      )}

      <section className="duel">
        <div className="duel-side you" ref={youRef} data-fid="player">
          <div className="camera">
            <video ref={videoRef} playsInline muted />
            <canvas ref={canvasRef} />
          </div>
          <div className="side-hud">
            {fighterHead('player')}
            <div className="hud-row">
            <div className="status-strip">
              <span className="sub-line">
                {fight.running && fight.silenced.player > 0
                  ? '' // the Silenced timer says it
                  : readyName
                    ? '' // "PUSH" shows on your hand
                    : drawing
                      ? 'drawing…'
                      : seeing && `seeing: ${seeing}`}
              </span>
            </div>
            </div>
          </div>
          {!camOn && mode !== 'online' ? (
            <div className="cam-gate">
              <svg viewBox="0 0 48 48" aria-hidden="true">
                <rect x="5" y="14" width="28" height="22" rx="5" fill="none" stroke="currentColor" strokeWidth="3.5" />
                <path d="M33 21 L43 15 V35 L33 29 Z" fill="none" stroke="currentColor" strokeWidth="3.5" strokeLinejoin="round" />
              </svg>
              <b>Turn on your camera</b>
              <p>You cast spells with your hands, so this needs your camera. Your video stays on your device. It's never saved or shown to anyone.</p>
              <button onClick={turnOnCamera}>Turn on camera</button>
            </div>
          ) : setupOn ? null : (
            status && <p className="status side-status">{status}</p>
          )}
          {/* Every online match (Nov 27, Custom too Nov 28): a 20 s setup, on your own side (it's your camera it
              waits for, and its problems show here). Try a sign or a line meanwhile (white, counts for nothing);
              Ready (once the camera runs) cuts it to 3 s when everyone has pressed it. */}
          {setupOn && (
            <div className="setup-overlay">
              <div className="setup-card">
                <b className="countdown setup-count">{Math.max(1, Math.ceil(((lobby!.countdownEnds ?? clock) - clock) / 1000))}</b>
                {(lobby!.countdownEnds ?? 0) - clock > 3500 && (
                  <>
                    {lobby!.seats[lobby!.you]?.ready ? (
                      <b className="setup-line">You're ready</b>
                    ) : (
                      <button className="setup-btn" disabled={!camReady} onClick={() => online.current?.ready()}>
                        {camReady ? 'Ready' : camBlocked ? 'Camera blocked' : 'Starting camera'}
                      </button>
                    )}
                    {camBlocked && <small className="setup-help">Allow the camera for this site in your browser, then reload.</small>}
                    {/* Who you're waiting for: each player, Ready (camera on and pressed) or still setting up. */}
                    <ul className="setup-who">
                      {lobby!.seats.map((s, i) => (
                        <li key={i} className={s.ready ? 'ok' : ''}>
                          <span>{s.name ?? (i === lobby!.you ? 'You' : 'Opponent')}</span>
                          <b>{s.ready ? 'Ready' : s.here ? 'Setting up' : 'Reconnecting'}</b>
                        </li>
                      ))}
                    </ul>
                  </>
                )}
              </div>
            </div>
          )}
          {fxOn && <StatusFx side="player" view={fight} />}
          {fxOn && <Impacts side="player" bolts={isTeam ? cardBolts(fight.bolts, 'player') : fight.bolts} />}
          {fxOn && parryTimer && <ParryRings side="player" bolts={isTeam ? fight.bolts.filter((b) => b.to === 'player') : fight.bolts} windowMs={PARRY_WINDOW_MS} />}
          {isTeam && allies.map(allyCard)}
          {isTeam && allies.length > 0 && <div className="ally-minis">{allies.map(allyMini)}</div>}
          {isTeam && myR && fight.running && zoneTarget('left', myR.el, myR.shape) !== null && (
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
          {mode === 'dummy' && (
            <div className={`dummy-dock ${dockOpen ? '' : 'tucked'}`}>
              <button className="small icon-btn dock-toggle" onClick={() => setDockOpen(!dockOpen)} aria-label={dockOpen ? 'Hide training buttons' : 'Show training buttons'} title={dockOpen ? 'Hide' : 'Show training buttons'}>
                <Icon d={dockOpen ? 'M15 6l-6 6 6 6' : 'M9 6l6 6-6 6'} />
              </button>
              {dockOpen && dummyBar}
            </div>
          )}
          {!isTeam && <EnemyCanvas cast={fight.running && !(fight.shroud.enemy > 0) ? fight.enemyCast : null} />}
          {!isTeam && <div className="side-hud" ref={watchHud}>
            {fighterHead('enemy')}
            {mode === 'practice' && bubble && (
              <p className="chat-bubble" key={bubble.n}>
                {bubble.text}
              </p>
            )}
            <div className="hud-row">
              {mode !== 'tutorial' && <OppStatus fight={fight} hint={mode === 'dummy' && aids.hint} />}
            </div>
          </div>}
          {mode === 'tutorial' && <Tutorial notes={fight.notes} onHome={goHome} drawHand={drawHand} onTry={tutorialTry} />}
          {/* Practice: picking an opponent, you're inside the tower (brick walls fill this half). It fades out as the fight starts. */}
          {mode === 'practice' && <div className={`tower-room ${fight.running || review ? '' : 'on'}`} aria-hidden="true" />}
          {mode === 'duo' && <div className={`tower-room ${duoIdle ? 'on' : ''}`} aria-hidden="true" />}
          {mode === 'practice' && !fight.running && !review && (
            <div className={`stage-center solo-stage ${countdownEnds ? 'leaving' : ''}`}>
              {onMode && !countdownEnds && <TowerSwitch duo={false} onPick={() => onMode('duo')} />}
              <Tower value={difficulty} onPick={setDifficulty} />
              {countdownEnds ? (
                <b className="countdown">{secsLeft(countdownEnds) || 1}</b>
              ) : (
                <button className="cta" onClick={startPractice}>Start battle</button>
              )}
            </div>
          )}
          {duoIdle && (
            <div className="stage-center duo-stage">
              {onMode && (
                <TowerSwitch
                  duo
                  onPick={() => {
                    leaveOnline()
                    onMode('practice')
                  }}
                />
              )}
              <DuoPanel lobby={lobby} arena={online.current} joinCode={joinCode} setJoinCode={setJoinCode} lastOver={fight.over} onReconnect={goOnline} />
            </div>
          )}
          {!isTeam && fxOn && <StatusFx side="enemy" view={fight} />}
          {!isTeam && fxOn && <Impacts side="enemy" bolts={fight.bolts} />}
        </div>

        {fxOn && <BoltLayer bolts={fight.bolts} team={isTeam} />}
        {showResult && <div className={`result-banner ${fight.over === 'player' ? 'won' : 'lost'}`}>{result}</div>}
        {mode === 'practice' && review && !countdownEnds && (
          <div className="result-actions">
            {nextFloor && (
              <button className="cta" onClick={() => { setDifficulty(nextFloor); startPractice() }}>
                Next floor
              </button>
            )}
            <button className={nextFloor ? '' : 'cta'} onClick={startPractice}>
              Fight again
            </button>
            <button onClick={() => setReview(false)}>Tower</button>
          </div>
        )}
        {mode === 'practice' && review && countdownEnds && <b className="countdown result-countdown">{secsLeft(countdownEnds) || 1}</b>}
      </section>
      {menu === 'main' && (
        <div className="menu-overlay" onClick={() => setMenu(null)}>
          {/* The in-match menu (Nov 24): Resume up top, settings as rows with switches, the rest as small buttons. */}
          <div className="menu-card pause-menu dm" onClick={(e) => e.stopPropagation()} ref={keepMenuScroll} onScroll={(e) => (menuScroll.current = e.currentTarget.scrollTop)}>
            <b className="leave-title pm-title">Paused</b>
            {/* Equal tiles, icon over a word (Nov 25): Resume first and green; leaving ones red. Up top (Nov 26),
                so a phone never has to scroll to reach them; the settings below scroll. */}
            <div className="pm-tiles">
              <button className="pm-tile go" onClick={() => setMenu(null)}>
                <Icon d="M8 5v14l11-7z" />
                Resume
              </button>
              {mode !== 'tutorial' && (
                <button className="pm-tile" onClick={() => setMenu('help')}>
                  <Icon d={BOOK} />
                  Spellbook
                </button>
              )}
              {mode === 'practice' && fight.running && (
                <button
                  className="pm-tile stop"
                  onClick={() => {
                    practice.current.stop()
                    setMenu(null)
                  }}
                >
                  <Icon d="M6 6h12v12H6z" />
                  End match
                </button>
              )}
              {net && lobby?.code && (
                <button className="pm-tile" onClick={() => setMenu('chat')}>
                  <Icon d="M4 5h16v11H9l-5 4z" />
                  Quick chat
                </button>
              )}
              <button className="pm-tile stop" onClick={() => (inRoom || inPracticeMatch ? setMenu('leave') : goHome())}>
                <Icon d="M3 11l9-8 9 8 M5 9v12h5v-6h4v6h5V9" />
                Home
              </button>
            </div>
            <SlabSection title="Controls">
              <SlabChoice label="Draw with" value={drawHand} options={[{ v: 'left', name: 'Left' }, { v: 'right', name: 'Right' }]} onChange={(h) => (h !== drawHand ? swapDrawHand() : undefined)} />
              <PushSlab />
              <SignDelaySlab />
            </SlabSection>
            <SlabSection title="Display">
              <DrawingZoomSlab />
              <AllyViewSlab />
            </SlabSection>
            <SlabSection title="Sound">
              <VolumeSlab />
              {mode === 'practice' && (
                <SlabChoice
                  label="Chatter"
                  value={chatter ? 'on' : 'off'}
                  options={[{ v: 'off', name: 'Off' }, { v: 'on', name: 'On' }]}
                  onChange={(v) => {
                    const on = v === 'on'
                    saveChatter(on)
                    setChatter(on)
                    if (!on) setBubble(null)
                  }}
                />
              )}
            </SlabSection>
          </div>
        </div>
      )}
      {menu === 'dummy' && (
        <div className="menu-overlay" onClick={() => setMenu(null)}>
          <div className="menu-card dm-card" onClick={(e) => e.stopPropagation()}>
            <DummyMenu twoFoes={twoFoes} pools={dummyPools} pace={pace} aids={aids} {...menuApi} />
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
            <button className="btn-forfeit" onClick={goHome}>Leave</button>
            <button className="btn-stay" onClick={() => setMenu('main')}>Stay</button>
          </div>
        </div>
      )}
      {menu === 'forfeit' && (
        <div className="menu-overlay" onClick={() => setMenu(null)}>
          <div className="menu-card pause-menu" onClick={(e) => e.stopPropagation()}>
            <b className="leave-title">Forfeit the match?</b>
            <p className="leave-text">
              {lobby && lobby.seats.filter((s) => s.team === lobby.seats[lobby.you]?.team).length > 1
                ? 'Your team forfeits once your teammate agrees too.'
                : 'Your team loses this fight.'}
            </p>
            <button className="btn-forfeit" onClick={() => (online.current?.forfeit(), setMenu(null))}>Forfeit</button>
            <button onClick={() => setMenu(null)}>Keep fighting</button>
          </div>
        </div>
      )}
      {menu === 'chat' && (
        <div className="menu-overlay" onClick={() => setMenu(null)}>
          <div className="menu-card pause-menu" onClick={(e) => e.stopPropagation()}>
            <QuickChat muted={chatMuted} {...chatApi} />
          </div>
        </div>
      )}
      {menu === 'help' && (
        <div className="book-overlay">
          <Spellbook inMatch onHome={() => setMenu('main')} />
        </div>
      )}
    </main>
  )
}

const CHAT_SHOW_MS = 4000
const CHAT_MUTE_KEY = 'quick-chat-muted'

/** Quick chat lines to pick from (memoized: the fight keeps redrawing the page behind it). */
const QuickChat = memo(function QuickChat({ muted, say, setMuted, onBack }: { muted: boolean; say: (line: number) => void; setMuted: (on: boolean) => void; onBack: () => void }) {
  return (
    <>
      <b className="leave-title">Quick chat</b>
      <div className="quick-chat-lines">
        {QUICK_CHAT.map((t, i) => (
          <button key={t} onClick={() => say(i)}>
            {t}
          </button>
        ))}
      </div>
      <button className="btn-stay" onClick={() => setMuted(!muted)}>
        {muted ? 'Show chat' : 'Mute chat'}
      </button>
      <button onClick={onBack}>Back</button>
    </>
  )
})

/** The opponent's drawing in its true shape: points are fractions of a box `view.aspect` wide / tall
 *  (a player's visible camera view, or the AI's square), drawn without stretching. A player's view
 *  fills this half the way their camera filled theirs (cover); the AI's box is shown whole.
 *  `zoom` (2v2 cards, Nov 26): a small drawing is zoomed in (up to ZOOM_MAX, centered, eased) so it stays
 *  readable on a narrow card; a big one is left as drawn. Line widths don't change (non-scaling strokes). */
const FRAME_H = 1000
const ZOOM_MAX = 2.5
const ZOOM_FILL = 0.75 // a zoomed drawing fills this much of the visible area
/** fit (Nov 28, the phone teammate panel): show the whole drawing, scaled to fill the box, however wide or short
 *  the box is (never cropped), whatever the Drawing zoom setting. */
function EnemyCanvas({ cast, zoom = false, fit = false }: { cast: Snapshot['enemyCast']; zoom?: boolean; fit?: boolean }) {
  const fw = FRAME_H * (cast?.view.aspect ?? 16 / 9)
  const pts = cast?.points ?? []
  const d = pts.map((p, i) => `${i ? 'L' : 'M'}${(p.x * fw).toFixed(1)} ${(p.y * FRAME_H).toFixed(1)}`).join(' ')
  const meet = fit || cast?.view.fit === 'contain'
  const box = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState<[number, number] | null>(null)
  useEffect(() => {
    if (!(zoom || fit) || !box.current || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(([e]) => setSize([e.contentRect.width, e.contentRect.height]))
    ro.observe(box.current)
    return () => ro.disconnect()
  }, [zoom, fit])
  let transform = 'none'
  if ((fit || (zoom && getDrawingZoom())) && size && pts.length > 1) {
    const xs = pts.map((p) => p.x * fw)
    const ys = pts.map((p) => p.y * FRAME_H)
    const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)]
    // The part of the frame the card actually shows, in frame units (meet: all of it; slice: the middle).
    const sc = meet ? Math.min(size[0] / fw, size[1] / FRAME_H) : Math.max(size[0] / fw, size[1] / FRAME_H)
    const [vw, vh] = [size[0] / sc, size[1] / sc]
    const k = Math.min(ZOOM_MAX, (ZOOM_FILL * vw) / Math.max(x1 - x0, 1), (ZOOM_FILL * vh) / Math.max(y1 - y0, 1))
    if (k > 1.05) transform = `translate(${(fw / 2 - k * (x0 + x1) / 2).toFixed(1)}px, ${(FRAME_H / 2 - k * (y0 + y1) / 2).toFixed(1)}px) scale(${k.toFixed(3)})`
  }
  return (
    <div ref={box} className={`enemy-canvas ${cast?.phase === 'ready' ? 'ready' : ''}`} style={{ color: cast?.color ?? 'var(--sub)' }}>
      <svg viewBox={`0 0 ${fw.toFixed(1)} ${FRAME_H}`} preserveAspectRatio={`xMidYMid ${meet ? 'meet' : 'slice'}`}>
        <g className="enemy-zoom" style={{ transform }}>
          {d && <path d={d} className="enemy-ink" />}
          {d && <path d={d} className="enemy-stroke" />}
        </g>
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

/** Your charge's power when below full (an element, or a combo: the average of its two), else null. */

/** Notes for "can't act" moments: the symbol on your hand says it, not the message line. (A fizzle keeps its
 *  line: it says why the drawing failed.) */
const MENU_REDRAW_MS = 250 // while a menu is open, the page behind it redraws at most this often

const POWER_ORDER = ['F', 'I', 'W', 'E', 'L', 'A', 'U', PARRY_POWER]
/** Power: only the elements below full ("F42"), packed from the left, in room that always fits all 8 (one row on a
 *  wide bar, 4 x 2 on a 2v2 card), so however many show, nothing below ever moves or gets covered. */
function PowerGrid({ power }: { power: Record<string, number> | undefined }) {
  const shown = POWER_ORDER.filter((e) => (power?.[e] ?? 100) < 100)
  return (
    <div className="power-grid" aria-label="Element power">
      {shown.map((e) => (
        <span key={e} style={{ '--el': e === PARRY_POWER ? '#ffffff' : ELEMENTS[e].color } as React.CSSProperties}>
          {e === PARRY_POWER ? (
            <svg className="power-shield" viewBox="0 0 24 24" aria-label="Parry">
              <path d="M12 3l7 3v5c0 5-3 8.5-7 10-4-1.5-7-5-7-10V6z" />
            </svg>
          ) : (
            <b>{e}</b>
          )}
          {power![e]}
        </span>
      ))}
    </div>
  )
}

/** A fighter's charge as words for their health bar, in three lengths (the bar's width picks one):
 *  an element is its name; a combo always shows its elements: "Sunfire: Angelic + Fire", then
 *  "Sunfire: A + F", then "Sunfire: A+F" (a long name cut to its first word). While mixing: just the elements. */
function chargeWords(el: string | null, mix: string[]): { full: string; short: string; tiny: string; len: string } | null {
  if (!el) return null
  const one = (w: string) => ({ full: w, short: w, tiny: w, len: '' })
  if (el === '?') return one('Hidden')
  const parts = el === COMBO ? mix : COMBO_MIX[el]
  if (!parts) return one(chargeInfo(el).name)
  if (!parts.length) return one('Combo')
  const name = el === COMBO ? '' : `${chargeInfo(el).name}: `
  const full = name + parts.map((e) => ELEMENTS[e].name).join(' + ')
  const short = name + parts.join(' + ')
  const tiny = (el === COMBO ? '' : `${chargeInfo(el).name.split(' ')[0]}: `) + parts.join('+')
  const len = full.length >= 24 ? 'len-l' : full.length >= 20 ? 'len-m' : full.length >= 15 ? 'len-s' : ''
  return { full, short, tiny, len: `combo ${len}` }
}

/** The counter hint under a fighter's bar (Training dummy aid, or a practice bot's intro hint), if any. Their
 *  charge is the badge and the bar's glow; the spell they've readied shows big over their drawing. */
function OppStatus({ fight, id = 'enemy', cast, hint: showHint }: { fight: Snapshot; id?: Fid; cast?: Snapshot['enemyCast']; hint?: boolean }) {
  const c = cast === undefined ? fight.enemyCast : cast
  const silenced = fight.running && fight.silenced[id] > 0
  if (silenced || fight.shroud[id] > 0) return null
  const el = fight.charge[id] ?? (c && c.el !== '?' ? c.el : null)
  // An element: the one that beats it. A locked combo: C + the two that beat its mix.
  const dummyHint = !showHint ? null : el && el in COMBO_MIX ? mixCounter(COMBO_MIX[el].map(beaterOf)) : c && c.el in BEATS ? beaterOf(c.el) : null
  const hint = dummyHint ?? (id === 'enemy' ? fight.hint ?? null : null)
  if (!hint) return null
  return (
    <div className="status-strip">
      <span className="sub-line" style={{ color: chargeInfo(hint).color }}>
        {isMixCounter(hint) ? `Counter with C, ${ELEMENTS[hint[1]].name}, ${ELEMENTS[hint[2]].name}` : `Counter with ${ELEMENTS[hint].name}`}
      </span>
    </div>
  )
}

/** A Duo Tower bot's line, as a bubble under its name (like a tower bot's), gone after a few seconds. */
const BotBubble = memo(
  function BotBubble({ who, say }: { who: string; say: BotInfo['say'] }) {
    const [shown, setShown] = useState<{ text: string; n: number } | null>(null)
    const n = say?.n ?? 0
    useEffect(() => {
      if (!say || !n) return
      const text = duoLine(who, say.key, say.i ?? 0)
      if (!text) return
      setShown({ text, n })
      play('ui_click', { vol: 0.35, pitch: 1.7 })
      const t = setTimeout(() => setShown((b) => (b?.n === n ? null : b)), say.key === 'win' || say.key === 'lose' ? 5000 : 3500)
      return () => clearTimeout(t)
    }, [n]) // eslint-disable-line react-hooks/exhaustive-deps
    return shown ? (
      <p className="chat-bubble" key={shown.n}>
        {shown.text}
      </p>
    ) : null
  },
  (a, b) => a.who === b.who && (a.say?.n ?? 0) === (b.say?.n ?? 0),
)

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
  onSignIn?: () => void
  onFind: (mode: 'casual' | 'ranked', size: '1v1' | '2v2') => void
}) {
  const { lobby, joinCode, setJoinCode, arena, onReconnect, onHome, onSignIn, onFind } = props
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
      // Play: Casual, Ranked, Custom (Duel's join/create lives in Custom).
      body = <PlayMenu arena={arena} joinCode={joinCode} setJoinCode={setJoinCode} onSignIn={onSignIn} queue={lobby.queue} onFind={onFind} you={lobby.name} party={lobby.party} />
      break
  }
  if (inRoom)
    body = (
      <>
        {/* A queue match has no code to share, and no HP or team settings (the server refuses them too). */}
        {!lobby.quick && (
          <div className="lobby-code">
            <span className="sub-line">Room code</span>
            <b className="room-code">{lobby.code}</b>
          </div>
        )}
        {lobby.rated && <RatedCard rated={lobby.rated} />}
        <RoomTeams lobby={lobby} arena={arena} />
        <div className="lobby-actions">
          {lobby.ranked ? (
            <span className="sub-line">Ranked matches don't rematch. Find another from Play.</span>
          ) : lobby.seats.length < 2 ? (
            <span className="sub-line">Share the code. Up to 4 players, 2 per team.</span>
          ) : (
            <span className="ready-wrap">
              <button className={`cta ${me?.ready ? 'is-ready' : ''}`} onClick={() => (me?.ready ? arena?.unready() : arena?.ready())}>
                {me?.ready ? 'Unready' : lobby.phase === 'over' ? 'Rematch' : 'Ready'}
              </button>
            </span>
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
        {lobby.phase !== 'menu' && <b className="lobby-title">{lobby.duo ? 'Duo Tower' : lobby.ranked ? 'Ranked match' : lobby.quick ? 'Casual match' : 'Custom game'}</b>}
        {body}
        {lobby.awayUntil !== null && <span className="note-line">A player disconnected. Their seat is held 15 s.</span>}
        {lobby.note && <span className="note-line">{lobby.note}</span>}
        <HomeButton className="lobby-home" onClick={onHome} />
      </div>
    </section>
  )
}

function FlagIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M6 21V4" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" />
      <path d="M6 4.5h11l-2.5 4 2.5 4H6z" fill="currentColor" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
    </svg>
  )
}

const TOAST_MS = 4000 // an online notice shows this long

/** During a match: the room code and Forfeit in the corner by Esc, and notices as a small toast. */
function OnlineChip({ lobby, clock, arena, onForfeit }: { lobby: LobbyInfo; clock: number; arena: OnlineArena | null; onForfeit: () => void }) {
  const f = lobby.forfeit
  // The card of whoever dropped shows the countdown, so this is a heads-up that fades. A teammate's forfeit
  // vote and a paused fight stay up: they need you or explain a frozen screen.
  const kind = f && !f.mine ? 'forfeit' : lobby.awayUntil !== null ? 'away' : lobby.paused ? 'paused' : lobby.note ? `note:${lobby.note}` : ''
  const seen = useRef({ kind: '', at: 0 })
  if (seen.current.kind !== kind) seen.current = { kind, at: clock }
  const fresh = kind === 'forfeit' || kind === 'paused' || clock - seen.current.at < TOAST_MS
  const notice = !fresh
    ? null
    : kind === 'forfeit'
      ? `Your teammate wants to forfeit. Press the flag to agree.`
      : kind === 'away'
        ? 'A player disconnected'
        : kind === 'paused'
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
            <button className="small icon-btn forfeit-btn voted" onClick={() => arena?.forfeit()} title="Take back your forfeit vote" aria-label="Take back your forfeit vote">
              <FlagIcon />
              <span className="forfeit-count">{f.votes}/{f.needed}</span>
            </button>
          ) : (
            <button className="small icon-btn forfeit-btn" onClick={() => (f ? arena?.forfeit() : onForfeit())} title="Forfeit" aria-label="Forfeit">
              <FlagIcon />
            </button>
          ))}
      </div>
      {notice && <div className="online-toast">{notice}</div>}
    </>
  )
}

/** The host's HP box: type any whole number from HP_MIN to HP_MAX (kept in range); set on Enter or leaving the box. */
function HpBox({ hp, onSet }: { hp: number; onSet: (v: number) => void }) {
  const [text, setText] = useState(String(hp))
  useEffect(() => setText(String(hp)), [hp])
  const commit = () => {
    const v = Math.round(Number(text))
    if (!Number.isFinite(v) || !text.trim()) return setText(String(hp))
    const c = Math.min(HP_MAX, Math.max(HP_MIN, v))
    setText(String(c))
    if (c !== hp) onSet(c)
  }
  return (
    <label className="hp-box">
      <input
        type="number"
        inputMode="numeric"
        min={HP_MIN}
        max={HP_MAX}
        step={1}
        value={text}
        aria-label="HP"
        onChange={(e) => setText(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => e.key === 'Enter' && (e.currentTarget as HTMLInputElement).blur()}
      />
      <b>HP</b>
    </label>
  )
}

/** Host's HP for one seat: a black box to type in (kept to HP_MIN..HP_MAX), with a pencil so it reads as editable. */
function LobbyHp({ hp, who, onSet }: { hp: number; who: string; onSet: (v: number) => void }) {
  return (
    <span className="room-hp room-hp-chip" role="group" aria-label={`HP for ${who}`}
      onClick={(e) => e.currentTarget.querySelector('input')?.focus()}
      onFocus={(e) => (e.target as HTMLInputElement).select?.()}>
      <HpBox hp={hp} onSet={onSet} />
    </span>
  )
}

/** The room's two teams: who's on each, ready or not, and their HP (the host sets HP). */
/** The Tower page's Solo / Duo switch (Duo: you and a friend against a pair of the tower's wizards). */
function TowerSwitch({ duo, onPick }: { duo: boolean; onPick: (duo: boolean) => void }) {
  return (
    <span className="mode-seg tower-switch" role="group" aria-label="Solo or duo">
      <button className={duo ? '' : 'on'} onClick={() => duo && onPick(false)}>
        Solo
      </button>
      <button className={duo ? 'on' : ''} onClick={() => !duo && onPick(true)}>
        Duo
      </button>
    </span>
  )
}

/** The Tower page in Duo: the pairs' tower, and a room for you and a partner (a code to share). Make a room or
 *  join one; in it, the host picks the floor and both ready up (or one, going alone). */
function DuoPanel(props: { lobby: LobbyInfo | null; arena: OnlineArena | null; joinCode: string; setJoinCode: (c: string) => void; lastOver: Side | null; onReconnect: () => void }) {
  const { lobby, arena, joinCode, setJoinCode, lastOver, onReconnect } = props
  const duo = lobby?.duo
  if (!lobby?.code || !duo || (lobby.phase !== 'lobby' && lobby.phase !== 'over')) {
    // Not in a room yet: the floors you've reached, and how to start.
    const top = Math.min(DUO_TOP, duoProgress() + 1)
    return (
      <>
        <DuoTower floor={top} unlocked={top} onPick={null} />
        {/* The buttons are always laid out (hidden while connecting) and the note line always holds its space,
            so nothing shifts the tower when the server answers. */}
        <div className="duo-start">
          {lobby?.phase === 'offline' ? (
            <button className="cta" onClick={onReconnect}>
              Reconnect
            </button>
          ) : (
            <div className={`duo-start-row ${!lobby || lobby.phase === 'connecting' || lobby.phase === 'reconnecting' ? 'waiting' : ''}`}>
              <button className="cta" onClick={() => arena?.create()}>
                Create room
              </button>
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
              <span className="sub-line duo-connecting">Connecting…</span>
            </div>
          )}
        </div>
        <span className="note-line">{lobby?.note ?? ' '}</span>
      </>
    )
  }
  const me = lobby.seats[lobby.you]
  const host = lobby.you === lobby.host
  const partner = lobby.seats.find((_, i) => i !== lobby.you)
  const won = lastOver === 'player' && lobby.phase === 'over'
  return (
    <>
      <div className="duo-room">
        <span className="duo-code">
          Room <b>{lobby.code}</b>
        </span>
        <span className="sub-line">{partner ? (partner.here ? (partner.ready ? 'Partner ready' : 'Partner joined') : 'Partner away') : 'Share the code, or go alone'}</span>
      </div>
      {won && <span className="duo-result won">{duo.floor === DUO_TOP && duo.unlocked === DUO_TOP ? 'Floor cleared!' : `Floor cleared! Next up: floor ${duo.floor}`}</span>}
      <DuoTower floor={duo.floor} unlocked={duo.unlocked} onPick={host ? (n) => arena?.setFloor(n) : null} />
      <div className="duo-start">
        <button className={`cta ${me?.ready ? 'is-ready' : ''}`} onClick={() => (me?.ready ? arena?.unready() : arena?.ready())}>
          {me?.ready ? 'Unready' : 'Ready'}
        </button>
        <button className="small" onClick={() => arena?.leave()}>
          Leave room
        </button>
      </div>
      {lobby.note && <span className="note-line">{lobby.note}</span>}
    </>
  )
}

function RoomTeams({ lobby, arena }: { lobby: LobbyInfo; arena: OnlineArena | null }) {
  const host = lobby.you === lobby.host && !lobby.quick
  const team = (t: 'player' | 'enemy', label: string) => {
    const seats = lobby.seats.map((s, i) => ({ ...s, i })).filter((s) => s.team === t)
    return (
      <div className={`room-team ${t === 'player' ? 'one' : 'two'}`}>
        <b className="room-team-name">{label}</b>
        {seats.map((s) => (
          <div key={s.i} className={`room-seat ${s.here ? '' : 'away'} ${s.i === lobby.you ? 'mine' : ''}`}>
            {/* Everyone by the name the others see (Nov 26); yours is the outlined seat (Nov 28: no "You" tag,
                so long names keep their room). */}
            <span className="room-seat-name">
              <span className="room-seat-text" title={s.name ?? undefined}>{s.name ?? `Player ${s.i + 1}`}</span>
            </span>
            {host ? (
              <LobbyHp hp={s.hp} who={s.i === lobby.you ? 'you' : `player ${s.i + 1}`} onSet={(v) => arena?.setHp(s.i, v)} />
            ) : (
              <span className="room-hp">{s.hp} HP</span>
            )}
            {/* Ready as a check (Nov 28: words took the names' room); away is a dash. */}
            <span className={`room-ready ${s.ready ? 'on' : ''} ${s.here ? '' : 'away'}`} role="img" aria-label={s.ready ? 'Ready' : s.here ? 'Not ready' : 'Away'} title={s.ready ? 'Ready' : s.here ? 'Not ready' : 'Away'}>
              <svg viewBox="0 0 20 20" aria-hidden="true">
                <circle cx="10" cy="10" r="8.5" />
                {s.ready ? <path d="M5.5 10.5 L8.7 13.5 L14.5 7" /> : !s.here && <path d="M6 10 H14" />}
              </svg>
            </span>
          </div>
        ))}
        {!seats.length && <span className="sub-line">Empty</span>}
        {!lobby.quick && lobby.seats[lobby.you]?.team !== t && seats.length < TEAM_MAX && (
          <button className="small" onClick={() => arena?.switchTeam()}>
            Join this team
          </button>
        )}
      </div>
    )
  }
  return (
    <>
      <div className="room-teams">
        {team('player', 'Team 1')}
        {team('enemy', 'Team 2')}
      </div>
      {host && <span className="room-hp-range">HP can be set from {HP_MIN} to {HP_MAX}</span>}
    </>
  )
}

/** Training dummy settings: a second enemy on or off, and the spells each enemy casts. */
type Pace = DummyPace
const DummyMenu = memo(function DummyMenu(props: { twoFoes: boolean; setTwoFoes: (on: boolean) => void; pools: [string[], string[]]; setPool: (pool: string[], second: boolean) => void; pace: Pace; setPace: (p: Pace) => void; aids: DummyAids; setAids: (a: DummyAids) => void; onDone: () => void }) {
  const { twoFoes, setTwoFoes, pools, setPool, pace, setPace, aids, setAids, onDone } = props
  // What the cast time % means: the default times (charge + draw + ready) for a light, heavy and signature spell.
  const total = (el: string, shape: string, pct = pace.castPct) => {
    const sp = dummyTimes(el, shape, pct / 100)
    return (sp.chargeMs + sp.drawMs + sp.readyMs) / 1000
  }
  const secs = (shape: string) => total('F', shape).toFixed(1)
  const comboSecs = Object.entries(COMBO_SHAPE).map(([c, sh]) => total(c, sh))
  // Match a wizard: every spell set to that wizard's cast time (an estimate for spells it never uses); '' = default.
  const applyWizard = (id: string) => {
    if (!id) return setPace({ ...pace, spellPct: {}, template: null, castPct: 100 })
    const spellPct = Object.fromEntries(
      ALL_DUMMY_SPELLS.map((k) => {
        const [el, sh] = k.split(':')
        const pct = (wizardCastMs(id as Difficulty, el, sh) / (total(el, sh, 100) * 1000)) * 100
        return [k, Math.min(SPELL_PCT.max, Math.max(SPELL_PCT.min, Math.round(pct)))]
      }),
    )
    setPace({ ...pace, spellPct, template: id, castPct: 100 })
  }
  // One spell's own speed (from the edit button on its card); null = back to default.
  const setSpellPct = (k: string, pct: number | null) => {
    const spellPct = { ...pace.spellPct }
    if (pct === null) delete spellPct[k]
    else spellPct[k] = Math.min(SPELL_PCT.max, Math.max(SPELL_PCT.min, Math.round(pct * 10) / 10))
    setPace({ ...pace, spellPct, template: null })
  }
  const [which, setWhich] = useState(0)
  const second = twoFoes && which === 1
  const pool = pools[second ? 1 : 0]
  const gap = (ms: number) => `${(ms / 1000).toFixed(ms % 1000 ? 2 : 0).replace(/0$/, '')} s`
  // Cast speed as a multiplier (0.5× to 2× in 0.25 steps); castPct stays the share of the default cast time.
  const speedPct = Math.round(10000 / pace.castPct / 25) * 25
  const combo = `${Math.min(...comboSecs).toFixed(1)} to ${Math.max(...comboSecs).toFixed(1)} s`
  return (
    <div className="dm">
      <header className="dm-head">
        <b className="leave-title">Dummy settings</b>
      </header>
      <div className="dm-body">
        <h3 className="dm-section">Behavior</h3>
        <div className="dm-rows slab-section">
          <label className="dm-row dm-add">
            <span className="dm-label">Match a wizard</span>
            <select value={pace.template ?? ''} onChange={(e) => applyWizard(e.target.value)}>
              <option value="">{Object.keys(pace.spellPct).length ? 'Custom' : 'Default speeds'}</option>
              {LADDER.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </select>
          </label>
          <StepRow label="Cast time" value={speedPct} min={CAST_PCT.min} max={CAST_PCT.max} step={25} show={`${speedPct / 100}×`} lo="Slow" hi="Fast" onChange={(v) => setPace({ ...pace, castPct: 10000 / v })}>
            {Object.keys(pace.spellPct).length ? (
              <p className="slab-hint">Each spell's time is on its card below.</p>
            ) : (
            <div className="dm-times">
              <span>Light <b>{secs('line')} s</b></span>
              <span>Heavy <b>{secs('h')} s</b></span>
              <span>Signature <b>{secs('flame')} s</b></span>
              <span>Combo <b>{combo}</b></span>
            </div>
            )}
          </StepRow>
          <StepRow label="Rest" value={pace.gapMs} min={GAP_MS.min} max={GAP_MS.max} step={250} show={gap(pace.gapMs)} lo="Relentless" hi="Relaxed" onChange={(v) => setPace({ ...pace, gapMs: v })} />
          <StepRow label="Parry chance" value={pace.parryPct} min={0} max={100} step={5} show={`${pace.parryPct}%`} lo="Never" hi="Always" onChange={(v) => setPace({ ...pace, parryPct: v })} />
        </div>
        <h3 className="dm-section">Help</h3>
        <div className="dm-rows slab-section">
          <SwitchRow label="Counter hint" on={aids.hint} onChange={(on) => setAids({ ...aids, hint: on })} />
          <SwitchRow label="Parry timer" on={aids.parryTimer} onChange={(on) => setAids({ ...aids, parryTimer: on })} />
        </div>
        <h3 className="dm-section">Dummies</h3>
        <div className="dm-rows slab-section">
          <SwitchRow label="How many" on={twoFoes} onChange={setTwoFoes} off="One" onLabel="Two" />
          {twoFoes && <SwitchRow label="Editing spells of" on={which === 1} onChange={(on) => setWhich(on ? 1 : 0)} off="Left" onLabel="Right" />}
        </div>
        <h3 className="dm-section">
          Spells{twoFoes ? ` (${which ? 'right' : 'left'} dummy)` : ''}
        </h3>
        <DummySpells key={second ? 2 : 1} pool={pool} onChange={(p) => setPool(p, second)} spellPct={pace.spellPct} allPct={pace.castPct} onSpellPct={setSpellPct} />
      </div>
      <footer className="dm-foot">
        <span className="dm-count">
          <b>{pool.length}</b> of {ALL_DUMMY_SPELLS.length} spells on
        </span>
        <span className="dm-seg" role="group" aria-label="Select spells">
          <button onClick={() => setPool(ALL_DUMMY_SPELLS, second)}>All</button>
          <button onClick={() => setPool([], second)}>None</button>
        </span>
        <button className="dm-done" onClick={onDone}>
          Done
        </button>
      </footer>
    </div>
  )
})

/** A dummy setting as a slab: name, a slider with end words, the value in a box. */
function StepRow(props: { label: string; value: number; min: number; max: number; step: number; show: string; lo: string; hi: string; onChange: (v: number) => void; children?: React.ReactNode }) {
  const { label, value, min, max, step, show, lo, hi, onChange, children } = props
  return (
    <SlabSlider label={label} min={min} max={max} step={step} value={value} show={show} lo={lo} hi={hi} onChange={(v) => onChange(Math.min(max, Math.max(min, v)))}>
      {children}
    </SlabSlider>
  )
}

/** An Off / On (or any two-choice) switch, as a slab. */
function SwitchRow({ label, on, onChange, off = 'Off', onLabel = 'On' }: { label: string; on: boolean; onChange: (on: boolean) => void; off?: string; onLabel?: string }) {
  return <SlabChoice label={label} value={on ? 'on' : 'off'} options={[{ v: 'off', name: off }, { v: 'on', name: onLabel }]} onChange={(v) => onChange(v === 'on')} />
}
