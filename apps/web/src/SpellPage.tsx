// Spellcasting prototype: sign an element letter to charge, then point and draw a shape.
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { DrawingUtils, HandLandmarker, type NormalizedLandmark } from '@mediapipe/tasks-vision'
import { classify, loadRecognizer, type Hand } from './recognition'
import { directionLetter, passesGate } from './rules'
import { getTracker } from './trackers'
import { LandmarkSmoother } from './smoothing'
import { loadShapeModel, pathLength, recognizeShape, shapeFeatures, type Pt } from './shapes'
import { BEATS, COUNTER, ELEMENTS, QUICK, FORMS, PUNCHES, SIGNATURE, TRAITS, isValidSpell, shapesFor, spellName } from './spells'
import { DummyArena, PracticeArena, shapePoints, type Arena, type Difficulty, type Side, type Snapshot } from './battle'
import { BoltLayer, Impacts, SilenceLock, StatusFx, useShake } from './effects'
import { OnlineArena, setOnlineFlag, type LobbyInfo } from './online'
import { Tutorial } from './Tutorial'

const TOUCH = matchMedia('(hover: none)').matches // phones and tablets: no Esc key to point at
const DEBUG = new URLSearchParams(location.search).has('debug') // ?debug: cast with buttons, no camera needed

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
// Fast moves blur the fingers together and can fake a raised finger for a frame or two. So the
// pen-up must be held this long, and only counts while the hand is moving slower than this.
const PEN_UP_HOLD_MS = 100
const PEN_UP_MAX_SPEED = 4 // palm-widths per second
// Push to throw: a readied spell is thrown when the hand grows this much on screen within the window.
const PUSH_GROWTH = 1.3
const PUSH_WINDOW_MS = 300
const MIN_STROKE_PALMS = 1.2 // shorter strokes are ignored (just settling the hand)
const MATCH_SCORE = 0.7 // network probability needed to count as a shape
const SIGNATURE_SCORE = 0.9 // signatures are stricter
const DROPOUT_MS = 150
const RELEASE_MS = 100 // after a throw, the letter must be let go this long before it can charge again
const PREDICT_MS = 400 // how long a just-signed charge shows before the fight must confirm it

// Shape guide icons (40×40), and a suggested start point for each.
export const SHAPE_PATHS: Record<string, string> = {
  line: 'M6 34 L34 6',
  w: 'M4 8 L12 32 L20 14 L28 32 L36 8',
  hourglass: 'M8 6 L32 6 L8 34 L32 34 Z',
  star: 'M20 4 L29.4 32.9 L4.8 15.1 L35.2 15.1 L10.6 32.9 Z',
  flame: 'M5 18 L9 5 L12.5 14 L16 6 L19.5 14 L23 5 L26.5 14 L31 6 L35 18 A15 17 0 0 1 5 18',
  cage: 'M8 8 L32 8 L32 32 L8 32 L8 8 L32 32 L32 8 L8 32',
  zigzag7: 'M3 8 L8 32 L13 14 L18 32 L23 14 L28 32 L33 14 L38 32',
  battlements: 'M3 30 L3 14 L9 14 L9 30 L15 30 L15 14 L21 14 L21 30 L27 30 L27 14 L33 14 L33 30',
  circle: 'M20 6 A14 14 0 1 1 19.9 6',
  spiral: 'M20 20 A2 2 0 0 1 24 20 A4 4 0 0 1 16 20 A6 6 0 0 1 28 20 A8 8 0 0 1 12 20 A10 10 0 0 1 32 20 A12 12 0 0 1 8 20 A14 14 0 0 1 36 20',
}
export const SHAPE_STARTS: Record<string, [number, number]> = {
  line: [6, 34],
  w: [4, 8],
  hourglass: [8, 6],
  star: [20, 4],
  flame: [5, 18],
  cage: [8, 8],
  zigzag7: [3, 8],
  battlements: [3, 30],
  spiral: [20, 20],
  circle: [20, 6],
}

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
 *  for a sign). Easy pen-up (a setting, for players who can't make a full 5): any second finger up. */
function isOpen(lm: NormalizedLandmark[], easy: boolean) {
  const w = lm[0]
  const up = (tip: number) => dist(w, lm[tip]) > dist(w, lm[tip - 2]) * 1.15
  if (easy) return thumbOut(lm) || [12, 16, 20].some(up)
  return thumbOut(lm) && [8, 12, 16, 20].every(up)
}
const EASY_PEN_KEY = 'spells-easy-pen'
function loadEasyPen() {
  try {
    return localStorage.getItem(EASY_PEN_KEY) === '1'
  } catch {
    return false
  }
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
  const [menu, setMenu] = useState<null | 'main' | 'help'>(null)
  const [easyPen, setEasyPen] = useState(loadEasyPen)
  const easyPenRef = useRef(easyPen) // read by the camera loop
  const toggleEasyPen = () => {
    const on = !easyPenRef.current
    easyPenRef.current = on
    setEasyPen(on)
    try {
      localStorage.setItem(EASY_PEN_KEY, on ? '1' : '0')
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
  const goHome = () => {
    leaveOnline()
    onHome()
  }
  const [difficulty, setDifficulty] = useState<Difficulty>('easy')
  const startPractice = () => practice.current.start(performance.now(), difficulty)
  useEffect(() => {
    if (mode === 'online') goOnline()
  }, [])
  // ?debug: cast a spell without the camera (for testing online play with two tabs).
  const debugCast = (el: string, shape: string) => {
    const a = arena.current
    a.sign(el)
    if (shape !== QUICK) {
      a.stroke(shapePoints(shape))
      setTimeout(() => a.drew(shape), 300)
    }
    setTimeout(() => a.push(), 700)
  }

  useEffect(() => {
    let stopped = false
    let stream: MediaStream | null = null

    async function start() {
      try {
        const [rec, tracker, shapeModel] = await Promise.all([loadRecognizer(), getTracker(), loadShapeModel()])
        if (stopped) return
        stream = await navigator.mediaDevices.getUserMedia({
          // Front camera on phones. Turned sideways, the browser rotates the frames itself.
          video: { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 60 } },
        })
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
        let sizes: { t: number; s: number }[] = [] // recent hand sizes on screen
        let wasSilenced = false
        let sentSign: { el: string; t: number } | null = null // last element sent, so it isn't resent every frame
        let lastCharge: string | null = null // to spot a new charge (see the push below)
        // After a throw your hand is often still in that letter's shape. It mustn't recharge you: the
        // letter has to be let go (another shape for a moment) before it can charge again.
        let release: { el: string; since: number | null } | null = null
        let knockedSeen = 0

        const finishStroke = (now: number) => {
          const pts = stroke
          const palm = palmSum / Math.max(pts.length, 1)
          stroke = []
          palmSum = 0
          setDrawing(false)
          if (pts.length < 8) return arena.current.cleared()
          const palms = pathLength(pts) / palm
          if (palms < MIN_STROKE_PALMS) {
            // Tiny strokes are usually just settling the hand; only mention ones close to the limit.
            arena.current.cleared()
            if (palms > 0.5) setLog((l) => [{ name: 'Too short', detail: 'Draw bigger', color: '#888', ok: false, t: now }, ...l].slice(0, 8))
            return
          }
          const m = recognizeShape(shapeModel, pts)
          const need = Object.values(SIGNATURE).includes(m.name) ? SIGNATURE_SCORE : MATCH_SCORE
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
          fade = { pts, color: fits ? ELEMENTS[el].color : '#888', t: now }
          if (!shape) log({ name: 'Fizzle', detail: m.name === 'none' ? 'Not a spell shape' : 'Shape unclear', color: '#888', ok: false, t: now })
        }
        const log = (c: Cast) => setLog((l) => [c, ...l].slice(0, 8))

        const loop = async () => {
          if (stopped) return
          video.requestVideoFrameCallback(loop)
          if (video.currentTime === lastVideoTime) return
          lastVideoTime = video.currentTime
          const now = performance.now()
          const found = await tracker.detect(video, now)
          if (stopped) return

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
          const view = fightRef.current
          const myCharge = shownCharge(now, view.charge.player)
          // A new charge: forget earlier hand movement, so raising your hand to sign isn't read as a
          // push. Only a push that starts after the charge throws (e.g. a quick interrupt).
          if (myCharge !== lastCharge) {
            lastCharge = myCharge
            sizes = []
          }
          const myReady = view.ready.player
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
          const pred = lm ? classify(rec, lm, hand) : null
          const signingL = pred !== null && pred.letter === 'L' && pred.confidence >= L_VETO_PROB
          const pointing = lm && !silenced ? isPointing(lm) && !signingL : false
          let letter = ''
          if (lm && pred) {
            // Fizzle lockout: the hand goes dim and grey until you can throw again.
            const dim = view.fizzled.player > 0
            if (dim) ctx.globalAlpha = 0.3
            drawer.drawConnectors(lm, HandLandmarker.HAND_CONNECTIONS, { color: dim ? '#888' : myCharge ? ELEMENTS[myCharge].color : '#e2b714', lineWidth: 3 })
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
            if (!pointing && stroke.length === 0 && !silenced && !myReady) {
              // Not drawing: read the handshape as a letter, to charge an element.
              letter = pred.confidence >= CHARGE_PROB ? directionLetter(pred.letter, lm) : ''
              if (letter && !passesGate(letter, lm)) letter = '' // e.g. an open palm read as F
              let el = ELEMENTS[letter] ? letter : null
              if (release) {
                if (el === release.el) release.since = null
                else if ((release.since ??= now) && now - release.since >= RELEASE_MS) release = null
                if (release && el === release.el) el = null // still holding the thrown letter
              }
              if (el !== holdLetter) {
                holdLetter = el
                holdSince = now
              } else if (el && el !== myCharge && now - holdSince >= CHARGE_MS && (sentSign?.el !== el || now - sentSign.t > 300)) {
                arena.current.sign(el) // the fight decides (e.g. not right after a throw)
                sentSign = { el, t: now }
                if (!silenced) predicted.current = { el, t: now }
              }
            }
          }

          // Pen: the index fingertip, in pixels (so circles aren't squashed by the 16:9 frame).
          if (lm && pointing) {
            if (stroke.length === 0) setDrawing(true) // drawing with a spell readied drops it (the fight decides)
            stroke.push({ x: lm[8].x * W, y: lm[8].y * H })
            arena.current.stroke([{ x: 1 - lm[8].x, y: lm[8].y }]) // mirrored: as you see it on screen
            palmSum += Math.hypot((lm[0].x - lm[9].x) * W, (lm[0].y - lm[9].y) * H)
            lastPointT = now
          }
          // Hand speed (palm-widths per second), from the smoothed wrist.
          let speed = 0
          if (lm) {
            const palm = dist(lm[0], lm[9]) || 1
            if (prevWrist) speed = Math.hypot(lm[0].x - prevWrist.x, lm[0].y - prevWrist.y) / palm / (Math.max(now - prevWrist.t, 1) / 1000)
            prevWrist = { x: lm[0].x, y: lm[0].y, t: now }
          } else prevWrist = null
          // The speed limit applies only when the pen-up starts (that's when blur fakes it); once
          // started it holds through a fast move, so pushing right away doesn't cancel it.
          if (found && lm && !pointing && (isOpen(found, easyPenRef.current) || signingL) && (openSince !== null || speed < PEN_UP_MAX_SPEED)) openSince ??= now
          else openSince = null
          const penUpStart = openSince
          if (stroke.length && !pointing && ((openSince !== null && now - openSince >= PEN_UP_HOLD_MS) || now - lastPointT > LOST_GRACE_MS)) {
            openSince = null
            finishStroke(now)
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
          if ((myReady || (myCharge && myCharge in BEATS)) && sizes.length > 1 && stroke.length === 0 && !pointing) {
            const s = sizes[sizes.length - 1].s
            if (s / Math.min(...sizes.map((x) => x.s)) >= PUSH_GROWTH) {
              arena.current.push()
              if (myCharge) release = { el: myCharge, since: null }
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
              ctx.fillStyle = ELEMENTS[myReady.el].color
              ctx.shadowColor = ELEMENTS[myReady.el].color
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
          trail(stroke, myCharge ? ELEMENTS[myCharge].color : '#ffffff', 0.9)
          if (fade) {
            const a = 1 - (now - fade.t) / 1200
            if (a <= 0) fade = null
            else trail(fade.pts, fade.color, a)
          }

          if (now - lastUi > 100) {
            lastUi = now
            setSeeing(pointing ? 'pointing (drawing)' : letter || '–')
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
        {fight.chill[side] > 0 && <span className="tag chill">chilled +{fight.chill[side]}</span>}
      </div>
      <div className="hp-bar">
        <div className="hp-fill" style={{ width: `${fight.maxHp[side] === Infinity ? 100 : (100 * fight.hp[side]) / fight.maxHp[side]}%`, background: side === 'player' ? 'var(--you)' : 'var(--foe)' }} />
        <span className="hp-text">
          {fight.maxHp[side] === Infinity ? '∞' : `${Math.ceil(fight.hp[side])} / ${fight.maxHp[side]}`}
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
  const result = fight.over ? (fight.over === 'player' ? 'You win!' : 'You lose.') : null

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
          debug cast:
          {['F', 'I', 'L', 'E', 'W', 'H'].map((el) =>
            [...shapesFor(el), ...(el in BEATS ? [COUNTER, QUICK] : [])].map((shape) => (
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
              <span className="charge" style={{ color: charge ? ELEMENTS[charge].color : undefined }}>
                {charge ? `${ELEMENTS[charge].name} charged` : 'no charge'}
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
          <EnemyCanvas cast={fight.running ? fight.enemyCast : null} />
          <div className="side-hud">
            {fighterHead('enemy')}
            {mode !== 'dummy' && mode !== 'tutorial' && <CastBar fight={fight} />}
          </div>
          {mode === 'tutorial' && <Tutorial notes={fight.notes} onHome={goHome} />}
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
              {result && <b className="result">{result}</b>}
              <div className="row">
                {(['easy', 'medium', 'hard', 'insane'] as const).map((d) => (
                  <button key={d} className={`small ${difficulty === d ? 'active' : ''}`} onClick={() => setDifficulty(d)}>
                    {d[0].toUpperCase() + d.slice(1)}
                  </button>
                ))}
              </div>
              <button onClick={startPractice}>{result ? 'Fight again' : 'Start battle'}</button>
            </div>
          )}
          {mode === 'online' && !fight.running && (
            <div className="stage-center">
              {result && lobby && (lobby.phase === 'over' || lobby.phase === 'lobby') ? (
                <b className="result">{result}</b>
              ) : (
                <span className="sub-line">{lobby?.phase === 'countdown' ? 'Get ready…' : 'Waiting for the match to start'}</span>
              )}
            </div>
          )}
          <StatusFx side="enemy" view={fight} />
          <Impacts side="enemy" bolts={fight.bolts} />
        </div>

        <BoltLayer bolts={fight.bolts} />
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
            <button onClick={toggleEasyPen}>Easy pen-up: {easyPen ? 'on' : 'off'}</button>
            <small className="menu-hint">
              {easyPen ? 'Raising any second finger finishes a drawing.' : 'Open your whole hand to finish a drawing. Turn on if that’s hard.'}
            </small>
            <button onClick={goHome}>Home</button>
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
            <div className="spell-help">
              <b>1. Charge</b> — sign an element letter and hold:
              <ul>
                {Object.entries(ELEMENTS).map(([l, e]) => (
                  <li key={l} style={{ color: e.color }}>
                    <img className="asl-mini" src={`/asl/${l}.svg`} alt={`ASL ${l}`} /> {l} = {e.name}
                  </li>
                ))}
              </ul>
              <b>2. Draw</b> — point your index finger up (thumb tucked, finger visible) and trace a shape. Open your hand, all five fingers up, to finish. (With Easy pen-up on in the Esc menu, any second finger up finishes it.)
              <div className="guide-sub">Attacks + counterspell (every element)</div>
              <div className="shape-guide">
                {[...PUNCHES, COUNTER].map((sh) => [sh, FORMS[sh]]).map(([sh, fm]) => (
                  <div key={sh} className="shape-card">
                    <svg viewBox="0 0 40 40" width="48" height="48" aria-hidden>
                      <path d={SHAPE_PATHS[sh]} fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
                      <circle cx={SHAPE_STARTS[sh][0]} cy={SHAPE_STARTS[sh][1]} r="3" fill="var(--main)" />
                    </svg>
                    <span>{fm}</span>
                  </div>
                ))}
              </div>
              <div className="guide-sub">Signatures (harder, stronger)</div>
              <div className="shape-guide">
                {Object.entries(SIGNATURE).map(([el, sh]) => (
                  <div key={sh} className="shape-card" style={{ color: ELEMENTS[el].color }}>
                    <svg viewBox="0 0 40 40" width="48" height="48" aria-hidden>
                      <path d={SHAPE_PATHS[sh]} fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
                      <circle cx={SHAPE_STARTS[sh][0]} cy={SHAPE_STARTS[sh][1]} r="3" fill="var(--main)" />
                    </svg>
                    <span>{FORMS[sh]}</span>
                  </div>
                ))}
              </div>
              <div className="guide-sub">Heal (H)</div>
              <div className="shape-guide">
                {['star', 'hourglass'].map((sh) => (
                  <div key={sh} className="shape-card" style={{ color: ELEMENTS.H.color }}>
                    <svg viewBox="0 0 40 40" width="48" height="48" aria-hidden>
                      <path d={SHAPE_PATHS[sh]} fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
                      <circle cx={SHAPE_STARTS[sh][0]} cy={SHAPE_STARTS[sh][1]} r="3" fill="var(--main)" />
                    </svg>
                    <span>{FORMS[sh]}</span>
                  </div>
                ))}
              </div>
              <div className="shape-note">yellow dot = a place to start (any start or direction works)</div>
              <div className="guide-sub">What each element's attacks do</div>
              <ul>
                {Object.entries(TRAITS).map(([el, t]) => (
                  <li key={el} style={{ color: ELEMENTS[el].color }}>
                    {ELEMENTS[el].name}: {t}
                  </li>
                ))}
              </ul>
              <b>3. Throw</b> — push your hand toward the camera.
              <p>
                <b>Counter cycle</b> — Water → Fire → Ice → Earth → Lightning → Water (each beats the next).
              </p>
              <p>
                <b>Counterspell</b> — sign an element, draw a <b>circle</b>, push. If your opponent is still charged with the element
                yours beats when it lands, they're silenced for 2 s and lose their charge. Otherwise it's wasted. They can see the
                circle coming, so throwing first or switching elements dodges it. A counterspell of <b>any</b> element also stops a
                heal (a Heal charge, or a regen still ticking).
              </p>
              <p>
                <b>Interrupt</b> — sign the element that beats theirs and just push, no drawing. Faster to land but weaker: 0.5 s
                silence. It can't stop heals.
              </p>
              <p className="shape-note">Fast strokes are fine — just keep your hand in view. A charge fades after 3 s if you don't draw.</p>
            </div>
          </div>
        </div>
      )}
    </main>
  )
}

/** The enemy's drawing: its element glow while charging, then its shape tracing itself. */
function EnemyCanvas({ cast }: { cast: Snapshot['enemyCast'] }) {
  const d = cast?.points.map((p, i) => `${i ? 'L' : 'M'}${(p.x * 100).toFixed(1)} ${(p.y * 100).toFixed(1)}`).join(' ') ?? ''
  const tip = cast?.points[cast.points.length - 1]
  return (
    <div className={`enemy-canvas ${cast?.phase === 'ready' ? 'ready' : ''}`} style={{ color: cast?.color ?? 'var(--sub)' }}>
      <svg viewBox="0 0 100 100">
        {cast && <circle cx="50" cy="50" r="46" fill="currentColor" opacity={cast.phase === 'charge' ? 0.18 : 0.07} />}
        {d && <path d={d} fill="none" stroke="currentColor" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" style={{ filter: 'drop-shadow(0 0 4px currentColor)' }} />}
        {tip && cast?.phase === 'draw' && <circle cx={tip.x * 100} cy={tip.y * 100} r="3.5" fill="#fff" />}
      </svg>
      {cast && <span className="enemy-el">{cast.el}</span>}
    </div>
  )
}

/** The opponent's cast as a progress bar with a label. */
function CastBar({ fight }: { fight: Snapshot }) {
  const c = fight.enemyCast
  if (!c)
    return (
      <div className="cast-bar">
        <span className="hp-text idle">{fight.running ? 'idle' : ''}</span>
      </div>
    )
  const elName = ELEMENTS[c.el]?.name ?? ''
  const progress = c.progress ?? (c.phase === 'ready' ? 1 : c.phase === 'draw' ? 0.6 : 0.25)
  const label = c.phase === 'charge' ? `${elName} charged` : c.phase === 'draw' ? `${elName ? elName + ': ' : ''}drawing…` : `${c.name} ready!`
  return (
    <div className="cast-bar">
      <div className="cast-fill" style={{ width: `${progress * 100}%`, background: c.color }} />
      <span className="hp-text">{label}</span>
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
