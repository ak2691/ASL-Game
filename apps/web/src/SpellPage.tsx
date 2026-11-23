// Spellcasting prototype: sign an element letter to charge, then pinch (or point) and draw a shape.
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { DrawingUtils, HandLandmarker, type NormalizedLandmark } from '@mediapipe/tasks-vision'
import { openCamera, type CameraInfo } from './camera'
import { classify, loadRecognizer, trueShape, type Hand } from './recognition'
import { directionLetter, passesGate } from './rules'
import { getTracker } from './trackers'
import { LandmarkSmoother } from './smoothing'
import { CastGuide } from './CastGuide'
import { loadShapeModel, pathLength, recognizeShape, shapeFeatures, type Pt } from './shapes'
import { STRICT_SHAPES, BEATS, canQuick, COMBO, COMBOS_ON, COUNTER, ELEMENTS, chargeInfo, QUICK, isValidSpell, shapesFor, signsFor, COMBO_SHAPE, spellName } from './spells'
import { Tower } from './Ladder'
import { DummyArena, PracticeArena, shapePoints, type Arena, type Difficulty, type Side, type Snapshot } from './battle'
import { BoltLayer, Impacts, SilenceLock, StatusFx, useShake } from './effects'
import { play, useFightSfx } from './sfx'
import { VolumeSlider } from './VolumeSlider'
import { DRAW_HAND_KEY, TWO_HANDS_KEY, loadDrawHand, loadTwoHands } from './settings'
import { OnlineArena, setOnlineFlag, type LobbyInfo } from './online'
import { Tutorial } from './Tutorial'

const TOUCH = matchMedia('(hover: none)').matches // phones and tablets: no Esc key to point at
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
const CHARGE_MS = 150 // ...held this long
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
const PUSH_GROWTH = 1.3
const PUSH_WINDOW_MS = 300
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
const PEN_SWITCH_MS = 100 // the signing hand must hold a change (letter / open) this long to flip the pen
type Wrist = { x: number; y: number } | null
/** Which hand signs and which draws. The video isn't mirrored, so the player's right hand is on the
 *  left of the frame (smaller x). One hand in view: whichever hand was last nearest, else by side. */
function splitHands(hands: NormalizedLandmark[][], signHand: Hand, prev: { sign: Wrist; draw: Wrist }) {
  const signLeftInFrame = signHand === 'right'
  if (hands.length >= 2) {
    const [a, b] = [...hands].sort((p, q) => p[0].x - q[0].x)
    return signLeftInFrame ? { sign: a, draw: b } : { sign: b, draw: a }
  }
  if (hands.length === 0) return { sign: null, draw: null }
  const h = hands[0]
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

export function SpellPage({ hand, mode, onHome }: { hand: Hand; mode: Mode; onHome: () => void }) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [status, setStatus] = useState('Loading hand tracking and letter model…')
  const [seeing, setSeeing] = useState('')
  const [drawing, setDrawing] = useState(false)
  const [log, setLog] = useState<Cast[]>([])
  const [menu, setMenu] = useState<null | 'main' | 'help' | 'leave'>(null)
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
  const practice = useRef(new PracticeArena())
  const online = useRef<OnlineArena | null>(null)
  const arena = useRef<Arena>(mode === 'practice' ? practice.current : dummy.current)
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
  useShake(fight.bolts, sideRefs)
  useFightSfx(fight, 'player', mode === 'practice' || mode === 'online')
  const [lobby, setLobby] = useState<LobbyInfo | null>(null)
  const [clock, setClock] = useState(0)
  const charge = shownCharge(clock, fight.charge.player)
  const [joinCode, setJoinCode] = useState('')
  useEffect(() => {
    const id = setInterval(() => {
      const t = performance.now()
      const snap = arena.current.update(t)
      fightRef.current = snap
      setFight(snap)
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
    }, 50)
    return () => {
      clearInterval(id)
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
        let lastPointT = 0
        let fade: { pts: Pt[]; color: string; t: number } | null = null
        let lastUi = 0
        let prevWrist: { x: number; y: number; t: number } | null = null
        let openSince: number | null = null
        let openFastSince: number | null = null // open hand, ignoring the speed limit (a pen-up straight into a push)
        let sizes: { t: number; s: number }[] = [] // recent hand sizes on screen
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
          // Meteor: its 4 spikes are checked by a counting rule (shapes.ts), so the normal bar is enough.
          const need = STRICT_SHAPES.has(m.name) && m.name !== 'flame' ? SIGNATURE_SCORE : MATCH_SCORE
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
            const split = splitHands(all.image, signHand, roles)
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
            const dim = view.fizzled.player > 0
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
              ctx.fillText('Fizzled', 0, 0)
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
              if (now - openHoldSince >= CHARGE_MS && now - sentUncharge > 300) {
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
              } else if (el && view.running && el !== myCharge && now - holdSince >= CHARGE_MS && (sentSign?.el !== el || now - sentSign.t > 300)) {
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
          if (penHand && pen && pointing) {
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
            palmSum += Math.hypot((penHand[0].x - penHand[9].x) * W, (penHand[0].y - penHand[9].y) * H) 
            lastPointT = now
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
          // Recent hand sizes on screen (for push detection), recorded every frame.
          if (lm && found) {
            const px = (a: number, b: number) => Math.hypot((lm[a].x - lm[b].x) * W, (lm[a].y - lm[b].y) * H)
            // Three palm edges, so a wrist turn changes the size less than one edge would.
            sizes.push({ t: now, s: (px(0, 5) + px(0, 17) + px(5, 17)) / 3 })
            while (sizes.length && now - sizes[0].t > PUSH_WINDOW_MS) sizes.shift()
          } else sizes = []

          // Push: the hand quickly grows on screen (moves toward the camera). Reported only with something
          // to throw (a readied spell, or a counter element for a quick interrupt) and no stroke in
          // progress, so drawing never throws by accident. The fight decides what it throws, if anything.
          // Two hands: holding the letter already puts the pen down, so a push still counts while the line is
          // only a dot (the dot is thrown away). That's the quick interrupt: sign, then push before you draw.
          if ((myReady || (myCharge && canQuick(myCharge))) && sizes.length > 1 && (two ? !committed : stroke.length === 0 && !pointing)) {
            const s = sizes[sizes.length - 1].s
            if (s / Math.min(...sizes.map((x) => x.s)) >= PUSH_GROWTH) {
              dropDot()
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

  const latest = log[0]
  const oppName = mode === 'online' ? 'Opponent' : mode === 'dummy' || mode === 'tutorial' ? 'Training dummy' : 'Enemy'
  const fighterHead = (side: Side) => (
    <div className="fighter">
      <div className="fighter-name">
        {side === 'player' ? 'You' : oppName}
        {fight.static[side] && <span className={`tag static ${fight.static[side]}`}>⚡ {fight.static[side] === 'on' ? 'static' : 'gap'}</span>}
        {fight.chill[side] > 0 && <span className="tag chill">chilled +{fight.chill[side]}%</span>}
      </div>
      <div className="hp-bar">
        <div
          className="hp-fill"
          style={{ width: `${fight.maxHp[side] === Infinity ? 100 : (100 * fight.hp[side]) / fight.maxHp[side]}%`, background: fight.shield[side] > 0 ? 'var(--armor-hp)' : side === 'player' ? 'var(--you)' : 'var(--foe)' }}
        />
        <ArmorBar hp={fight.hp[side]} max={fight.maxHp[side]} armor={fight.shield[side]} />
        <span className="hp-text">
          {fight.maxHp[side] === Infinity ? '∞' : `${Math.ceil(fight.hp[side])} / ${fight.maxHp[side]}`}
          {fight.shield[side] > 0 && <b className="armor-text">+{fight.shield[side]}</b>}
        </span>
        <SilenceLock ms={fight.running ? fight.silenced[side] : 0} />
        {fight.floats
          .filter((f) => f.side === side)
          .map((f) => (
            <span key={f.id} className="float" style={{ color: f.color }}>
              {f.text}
            </span>
          ))}
      </div>
    </div>
  )
  const result = fight.over ? (fight.over === 'player' ? 'You win!' : 'You lose') : null
  // The result goes across the middle of the arena (it's about you, not the enemy's half).
  const showResult = !!result && (mode === 'practice' ? !countdownEnds : mode === 'online' && !!lobby && (lobby.phase === 'over' || lobby.phase === 'lobby'))

  return (
    <main className="page duel-page">
      <button className="small menu-btn" onClick={() => setMenu('main')} title="Menu (Esc)">
        {TOUCH ? 'Menu' : 'Esc'}
      </button>

      {mode === 'online' && lobby && (
        <OnlinePanel lobby={lobby} clock={clock} joinCode={joinCode} setJoinCode={setJoinCode} arena={online.current} onReconnect={goOnline} />
      )}

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
          <Impacts side="player" bolts={fight.bolts} />
        </div>

        <div className="duel-side opp" ref={oppRef}>
          <EnemyCanvas cast={fight.running && !(fight.shroud.enemy > 0) ? fight.enemyCast : null} />
          <div className="side-hud">
            {fighterHead('enemy')}
            {mode !== 'dummy' && mode !== 'tutorial' && <OppStatus fight={fight} />}
          </div>
          {mode === 'tutorial' && <Tutorial notes={fight.notes} onHome={goHome} drawHand={drawHand} twoHands={twoHands} />}
          {mode === 'dummy' && (
            <div className="stage-center">
              <b className="result">{fight.dealt.player}</b>
              <span className="sub-line">damage dealt</span>
              <button className="small" onClick={() => dummy.current.reset()}>
                Reset
              </button>
            </div>
          )}
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
              {!showResult && <span className="sub-line">{lobby?.phase === 'countdown' ? 'Get ready…' : 'Waiting for the match to start'}</span>}
            </div>
          )}
          <StatusFx side="enemy" view={fight} />
          <Impacts side="enemy" bolts={fight.bolts} />
        </div>

        <BoltLayer bolts={fight.bolts} />
        {showResult && <div className={`result-banner ${fight.over === 'player' ? 'won' : 'lost'}`}>{result}</div>}
        <p className="privacy-note">Your camera stays on your device. Online, your opponent only sees your drawings and element.</p>
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
            <button onClick={() => (inRoom || inPracticeMatch ? setMenu('leave') : goHome())}>Home</button>
            <VolumeSlider />
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
function OppStatus({ fight }: { fight: Snapshot }) {
  const c = fight.enemyCast
  const silenced = fight.running && fight.silenced.enemy > 0
  // The fight's view shows a combo's mix as it grows.
  const el = fight.charge.enemy ?? (c && c.el !== '?' ? c.el : null)
  if (fight.shroud.enemy > 0 && !silenced)
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
        {chargeLabel(el, fight.mix.enemy)}
      </span>
      <span className="sub-line">{silenced ? 'Silenced!' : c?.phase === 'ready' ? `${c.name} ready!` : c?.phase === 'draw' ? 'drawing…' : ''}</span>
      {fight.hint && !silenced && (
        <span className="sub-line" style={{ color: ELEMENTS[fight.hint].color }}>
          Counter with {ELEMENTS[fight.hint].name}
        </span>
      )}
    </div>
  )
}

/** Online: create or join a room, ready up, countdown, rematch. */
function OnlinePanel(props: {
  lobby: LobbyInfo
  clock: number
  joinCode: string
  setJoinCode: (c: string) => void
  arena: OnlineArena | null
  onReconnect: () => void
}) {
  const { lobby, clock, joinCode, setJoinCode, arena, onReconnect } = props
  const [you, opp] = lobby.ready
  let body: ReactNode = null
  switch (lobby.phase) {
    case 'connecting':
      body = <span>Connecting to the game server…</span>
      break
    case 'reconnecting':
      body = <span>Reconnecting…</span>
      break
    case 'offline':
      body = <button onClick={onReconnect}>Reconnect</button>
      break
    case 'menu':
      body = (
        <>
          <button onClick={() => arena?.create()}>Create room</button>
          <span className="sub-line">or</span>
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
        </>
      )
      break
    case 'lobby':
    case 'over':
      body = (
        <>
          <span>
            Room <b className="room-code">{lobby.code}</b>
          </span>
          {lobby.players < 2 ? (
            <span className="sub-line">Share this code with your opponent</span>
          ) : (
            <>
              <button onClick={() => arena?.ready()} disabled={you}>
                {you ? 'Ready ✓' : lobby.phase === 'over' ? 'Rematch' : 'Ready'}
              </button>
              <span className="sub-line">opponent: {opp ? 'ready ✓' : 'not ready'}</span>
            </>
          )}
          <button className="small" onClick={() => arena?.leave()}>
            Leave
          </button>
        </>
      )
      break
    case 'countdown':
      body = <b className="countdown">Starting in {Math.max(1, Math.ceil(((lobby.countdownEnds ?? clock) - clock) / 1000))}…</b>
      break
    case 'fighting':
      body = (
        <>
          <span className="sub-line">Fight!</span>
          <button className="small" onClick={() => window.confirm('Forfeit this match?') && arena?.forfeit()}>
            Forfeit
          </button>
        </>
      )
      break
  }
  return (
    <section className="online-panel">
      {body}
      {lobby.oppAwayUntil !== null && (
        <span className="note-line">
          Opponent disconnected. Waiting {Math.max(0, Math.ceil((lobby.oppAwayUntil - clock) / 1000))} s…
        </span>
      )}
      {lobby.paused && lobby.oppAwayUntil === null && <span className="note-line">Fight paused while a player reconnects…</span>}
      {lobby.note && <span className="note-line">{lobby.note}</span>}
    </section>
  )
}
