// Spellcasting prototype: sign an element letter to charge, then point and draw a shape.
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { DrawingUtils, HandLandmarker, type NormalizedLandmark } from '@mediapipe/tasks-vision'
import { classify, loadRecognizer, type Hand } from './recognition'
import { directionLetter } from './rules'
import { getTracker } from './trackers'
import { LandmarkSmoother } from './smoothing'
import { defaultRecognizer, pathLength, strokeFeatures, type Pt } from './dollar'
import { BEATS, COUNTER, ELEMENTS, FORMS, PUNCHES, SIGNATURE, TRAITS, isValidSpell, shapesFor, spellName } from './spells'
import { DummyArena, PracticeArena, shapePoints, type Arena, type Side, type Snapshot } from './battle'
import { OnlineArena, getOnlineFlag, setOnlineFlag, type LobbyInfo } from './online'

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
const CHARGE_MS = 300 // ...held this long
const CHARGE_LIFE_MS = 3000 // a charge fades after this long without drawing (switching elements is instant)
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
const READY_LIFE_MS = 3000 // a readied spell fades if not thrown
// After a throw, the hand is still in its pen-up/push pose, which can read as a letter (often F).
// New charges wait this long after a throw.
const AFTER_THROW_MS = 500
const MIN_STROKE_PALMS = 1.2 // shorter strokes are ignored (just settling the hand)
const MATCH_SCORE = 0.8 // $1 score needed to count as a shape
const DROPOUT_MS = 150

// Shape guide icons (40×40), and a suggested start point for each.
const SHAPE_PATHS: Record<string, string> = {
  line: 'M6 34 L34 6',
  w: 'M4 8 L12 32 L20 14 L28 32 L36 8',
  hourglass: 'M8 6 L32 6 L8 34 L32 34 Z',
  star: 'M20 4 L29.4 32.9 L4.8 15.1 L35.2 15.1 L10.6 32.9 Z',
  flame: 'M6 24 L6 34 A4.67 6 0 0 1 15.3 34 A4.67 6 0 0 1 24.7 34 A4.67 6 0 0 1 34 34 L34 24 A14 20 0 0 0 6 24',
  cage: 'M8 8 L32 8 L32 32 L8 32 L8 8 L32 32',
  zigzag7: 'M3 8 L8 32 L13 14 L18 32 L23 14 L28 32 L33 14 L38 32',
  battlements: 'M5 32 L5 10 L15 10 L15 32 L25 32 L25 10 L35 10 L35 32',
  circle: 'M20 6 A14 14 0 1 1 19.9 6',
  arches: 'M4 32 L4 20 A5.33 5.33 0 0 1 14.7 20 L14.7 32 L14.7 20 A5.33 5.33 0 0 1 25.3 20 L25.3 32 L25.3 20 A5.33 5.33 0 0 1 36 20 L36 32',
}
const SHAPE_STARTS: Record<string, [number, number]> = {
  line: [6, 34],
  w: [4, 8],
  hourglass: [8, 6],
  star: [20, 4],
  flame: [6, 24],
  cage: [8, 8],
  zigzag7: [3, 8],
  battlements: [5, 32],
  arches: [4, 32],
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

/** Pen-up: the middle, ring or pinky finger clearly raised. */
/** Thumb noticeably out to the side (as in L): not drawing. Tip-to-middle-knuckle, in palm sizes. */
function thumbOut(lm: NormalizedLandmark[]) {
  return dist(lm[4], lm[9]) / (dist(lm[0], lm[9]) || 1) > THUMB_OUT
}

/** Pen-up: the middle, ring or pinky finger clearly raised, or the thumb out. */
function isOpen(lm: NormalizedLandmark[]) {
  const w = lm[0]
  return thumbOut(lm) || [12, 16, 20].some((tip) => dist(w, lm[tip]) > dist(w, lm[tip - 2]) * 1.15)
}

interface Cast {
  name: string
  detail: string
  color: string
  ok: boolean
  t: number
}

export function SpellPage({ hand, onBack }: { hand: Hand; onBack: () => void }) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [status, setStatus] = useState('Loading hand tracking and letter model…')
  const [charge, setCharge] = useState<string | null>(null)
  const [seeing, setSeeing] = useState('')
  const [drawing, setDrawing] = useState(false)
  const [readyName, setReadyName] = useState<string | null>(null)
  const [log, setLog] = useState<Cast[]>([])
  const [menu, setMenu] = useState(false)
  const [strokeCount, setStrokeCount] = useState(0)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMenu((m) => !m)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
  // The fight: practice (AI enemy) or online (server). Polled on its own timer, separate from the camera loop.
  const [mode, setMode] = useState<'dummy' | 'practice' | 'online'>('dummy')
  const dummy = useRef(new DummyArena())
  const practice = useRef(new PracticeArena())
  const online = useRef<OnlineArena | null>(null)
  const arena = useRef<Arena>(dummy.current)
  const [fight, setFight] = useState<Snapshot>(() => dummy.current.update(0))
  const fightRef = useRef(fight) // read by the camera loop (e.g. "am I silenced?")
  const [lobby, setLobby] = useState<LobbyInfo | null>(null)
  const [clock, setClock] = useState(0)
  const [joinCode, setJoinCode] = useState('')
  useEffect(() => {
    const id = setInterval(() => {
      const t = performance.now()
      const snap = arena.current.update(t)
      fightRef.current = snap
      setFight(snap)
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
  const goPractice = () => {
    leaveOnline()
    arena.current = practice.current
    setMode('practice')
  }
  const goDummy = () => {
    leaveOnline()
    arena.current = dummy.current
    setMode('dummy')
  }
  const goOnline = () => {
    online.current?.close()
    online.current = new OnlineArena()
    arena.current = online.current
    setMode('online')
  }
  const startPractice = () => practice.current.start(performance.now())
  // A refresh while in an online room reopens online mode; the server puts you back in your seat.
  useEffect(() => {
    if (getOnlineFlag()) goOnline()
  }, [])
  // ?debug: cast a spell without the camera (for testing online play with two tabs).
  const debugCast = (el: string, shape: string) => {
    const a = arena.current
    a.charge(el)
    a.stroke(shapePoints(shape))
    a.readied(el, shape)
    setTimeout(() => {
      a.cast(el, shape, performance.now())
      a.charge(null)
    }, 700)
  }

  useEffect(() => {
    let stopped = false
    let stream: MediaStream | null = null
    const recognizer = defaultRecognizer()

    async function start() {
      try {
        const [rec, tracker] = await Promise.all([loadRecognizer(), getTracker()])
        if (stopped) return
        stream = await navigator.mediaDevices.getUserMedia({
          video: { width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 60 } },
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

        const chargeTo = (el: string | null) => {
          setCharge(el)
          arena.current.charge(el)
        }
        const smoother = new LandmarkSmoother()
        let last: { lm: NormalizedLandmark[]; t: number } | null = null
        let lastVideoTime = -1
        // Charge state
        let charged: { el: string; t: number; since: number } | null = null // t = last activity (idle fade), since = when charged
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
        // Readied spell, waiting for a push toward the camera.
        let ready: { name: string; detail: string; color: string; el: string; shape: string; t: number } | null = null
        let sizes: { t: number; s: number }[] = [] // recent hand sizes on screen
        let wasSilenced = false
        let lastThrow = -Infinity
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
            if (palms > 0.5) setLog((l) => [{ name: 'Too short', detail: `stroke ${palms.toFixed(1)} palms, need ${MIN_STROKE_PALMS}`, color: '#888', ok: false, t: now }, ...l].slice(0, 8))
            return
          }
          const m = recognizer.recognize(pts)
          const shape = m.score >= MATCH_SCORE ? m.name : null
          const el = charged?.el ?? null
          if (DEBUG) {
            const ft = strokeFeatures(pts)
            strokeLog.push({
              t: new Date().toISOString(),
              charge: el,
              points: pts.map((q) => [Math.round(q.x), Math.round(q.y)]),
              read: m.name,
              score: Math.round(m.score * 1000) / 1000,
              rejected: m.rejected ?? null,
              corners: ft.corners,
              turns: Math.round(ft.turns * 100) / 100,
            })
            if (strokeLog.length > 300) strokeLog.shift()
            setStrokeCount(strokeLog.length)
          }
          let cast: Cast
          if (!shape)
            cast = {
              name: 'Fizzle',
              detail: m.rejected ? `looked like a ${m.rejected}` : `shape not recognized (closest: ${m.name} ${Math.round(m.score * 100)}%)`,
              color: '#888',
              ok: false,
              t: now,
            }
          else if (!el) cast = { name: 'Fizzle', detail: `${shape} drawn with no element charged`, color: '#888', ok: false, t: now }
          else if (!isValidSpell(el, shape))
            cast = { name: 'Fizzle', detail: `${ELEMENTS[el].name} can't use ${shape} (it uses: ${shapesFor(el).join(', ')})`, color: '#888', ok: false, t: now }
          else {
            // A good shape doesn't cast yet: the spell is readied, and a push throws it.
            ready = {
              name: spellName(el, shape),
              detail: `${ELEMENTS[el].name} + ${shape} (${FORMS[shape]}) · ${Math.round(m.score * 100)}%`,
              color: ELEMENTS[el].color,
              el,
              shape,
              t: now,
            }
            setReadyName(ready.name)
            if (charged) charged.t = now
            arena.current.readied(el, shape)
            fade = { pts, color: ready.color, t: now }
            return
          }
          fade = { pts, color: cast.color, t: now }
          log(cast)
          if (charged) charged.t = now // a fizzle keeps your charge; the 3 s idle clock restarts
          arena.current.cleared()
        }
        const log = (c: Cast) => setLog((l) => [c, ...l].slice(0, 8))
        const clearReady = () => {
          ready = null
          setReadyName(null)
        }

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

          const W = canvas.width
          const H = canvas.height
          ctx.clearRect(0, 0, W, H)
          if (charged && !ready && stroke.length === 0 && now - charged.t > CHARGE_LIFE_MS) {
            charged = null
            chargeTo(null)
          }
          // Silenced (a counterspell landed on you): your charge, drawing and ready spell are gone,
          // and you can't charge or draw until it ends.
          const silenced = fightRef.current.running && fightRef.current.silenced.player > 0
          if (silenced && !wasSilenced) {
            if (charged) {
              charged = null
              chargeTo(null)
            }
            if (ready) clearReady()
            if (stroke.length) {
              stroke = []
              palmSum = 0
              setDrawing(false)
            }
            holdLetter = null
            log({ name: 'Interrupted!', detail: 'silenced for 2 s', color: '#ff6a3d', ok: false, t: now })
          }
          wasSilenced = silenced
          // Earthquake knocked your charge off: your charge, drawing and ready spell are gone.
          const knocked = fightRef.current.knocked.player
          if (knocked > knockedSeen) {
            if (charged) {
              charged = null
              chargeTo(null)
            }
            if (ready) clearReady()
            if (stroke.length) {
              stroke = []
              palmSum = 0
              setDrawing(false)
            }
            log({ name: 'Knocked off!', detail: 'Earthquake: re-sign your element', color: ELEMENTS.E.color, ok: false, t: now })
          }
          knockedSeen = knocked
          const inStatic = fightRef.current.running && fightRef.current.static.player === 'on'

          // The letter model runs every frame: a confident L (index up, thumb out) is Lightning
          // being signed, never drawing, even if the geometry check alone would call it pointing.
          const pred = lm ? classify(rec, lm, hand) : null
          const signingL = pred !== null && pred.letter === 'L' && pred.confidence >= L_VETO_PROB
          const pointing = lm && !silenced ? isPointing(lm) && !signingL : false
          let letter = ''
          if (lm && pred) {
            drawer.drawConnectors(lm, HandLandmarker.HAND_CONNECTIONS, { color: charged ? ELEMENTS[charged.el].color : '#e2b714', lineWidth: 3 })
            // No charging while a spell is ready (you've committed to it) or right after a throw.
            if (!pointing && stroke.length === 0 && !silenced && !ready && now - lastThrow >= AFTER_THROW_MS) {
              // Not drawing: read the handshape as a letter, to charge an element.
              letter = pred.confidence >= CHARGE_PROB ? directionLetter(pred.letter, lm) : ''
              const el = ELEMENTS[letter] ? letter : null
              if (el !== holdLetter) {
                holdLetter = el
                holdSince = now
              } else if (el && el !== charged?.el && now - holdSince >= CHARGE_MS) {
                charged = { el, t: now, since: now }
                chargeTo(el)
              }
            }
          }

          // Pen: the index fingertip, in pixels (so circles aren't squashed by the 16:9 frame).
          if (lm && pointing) {
            if (stroke.length === 0) {
              setDrawing(true)
              if (ready) {
                // Pointing again before throwing = redraw: the readied spell is dropped.
                log({ name: 'Redraw', detail: `${ready.name} dropped`, color: '#888', ok: false, t: now })
                clearReady()
                arena.current.cleared()
              }
            }
            stroke.push({ x: lm[8].x * W, y: lm[8].y * H })
            arena.current.stroke([{ x: 1 - lm[8].x, y: lm[8].y }]) // mirrored: as you see it on screen
            palmSum += Math.hypot((lm[0].x - lm[9].x) * W, (lm[0].y - lm[9].y) * H)
            lastPointT = now
            if (charged) charged.t = now // drawing keeps the charge alive
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
          if (found && lm && !pointing && (isOpen(found) || signingL) && (openSince !== null || speed < PEN_UP_MAX_SPEED)) openSince ??= now
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

          // Push to throw: the hand quickly grows on screen (moves toward the camera). Only while
          // a spell is ready and no stroke is in progress, so drawing never throws by accident.
          if (ready) {
            if (now - ready.t > READY_LIFE_MS) {
              log({ name: 'Fizzle', detail: `${ready.name} faded (no push)`, color: '#888', ok: false, t: now })
              clearReady()
              arena.current.cleared()
            } else if (sizes.length > 1 && stroke.length === 0) {
              const s = sizes[sizes.length - 1].s
              const smallest = Math.min(...sizes.map((x) => x.s))
              if (s / smallest >= PUSH_GROWTH) {
                if (inStatic) {
                  // Lightning static: the throw fizzles. The spell is lost, the charge is kept.
                  log({ name: 'Fizzled (static)', detail: `${ready.name} lost — wait for the gap`, color: ELEMENTS.L.color, ok: false, t: now })
                  clearReady()
                  if (charged) charged.t = now
                  arena.current.cleared()
                } else {
                  log({ name: ready.name, detail: ready.detail, color: ready.color, ok: true, t: now })
                  arena.current.cast(ready.el, ready.shape, now)
                  lastThrow = now
                  holdLetter = null
                  charged = null
                  chargeTo(null)
                  clearReady()
                }
                sizes = []
              }
            }
            if (ready && lm) {
              // The readied spell glows on the hand, pulsing.
              const cx = ((lm[0].x + lm[9].x) / 2) * W
              const cy = ((lm[0].y + lm[9].y) / 2) * H
              ctx.globalAlpha = 0.35 + 0.25 * Math.sin(now / 120)
              ctx.fillStyle = ready.color
              ctx.shadowColor = ready.color
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
            ctx.lineCap = ctx.lineJoin = 'round'
            ctx.shadowColor = color
            ctx.shadowBlur = 20
            ctx.beginPath()
            ctx.moveTo(pts[0].x, pts[0].y)
            for (const p of pts) ctx.lineTo(p.x, p.y)
            ctx.stroke()
            ctx.shadowBlur = 0
            ctx.globalAlpha = 1
          }
          trail(stroke, charged ? ELEMENTS[charged.el].color : '#ffffff', 0.9)
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
  const oppName = mode === 'online' ? 'Opponent' : mode === 'dummy' ? 'Training dummy' : 'Enemy'
  const fighterHead = (side: Side) => (
    <div className="fighter">
      <div className="fighter-name">
        {side === 'player' ? 'You' : oppName}
        {fight.static[side] && <span className={`tag static ${fight.static[side]}`}>⚡ {fight.static[side] === 'on' ? 'static' : 'gap'}</span>}
        {fight.chill[side] > 0 && <span className="tag chill">chilled +{fight.chill[side]}</span>}
        {fight.silenced[side] > 0 && <span className="tag silenced">silenced {(fight.silenced[side] / 1000).toFixed(1)}s</span>}
      </div>
      <div className="hp-bar">
        <div className="hp-fill" style={{ width: `${fight.maxHp[side] === Infinity ? 100 : (100 * fight.hp[side]) / fight.maxHp[side]}%`, background: side === 'player' ? '#6be38a' : '#ff6a3d' }} />
        <span className="hp-text">
          {fight.maxHp[side] === Infinity ? `∞ · damage taken ${fight.dealt.player}` : `${Math.ceil(fight.hp[side])} / ${fight.maxHp[side]}`}
        </span>
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
      <header>
        <span className="logo">ASL Spells</span>
        <div className="row">
          <button className={`small ${mode === 'dummy' ? 'active' : ''}`} onClick={goDummy}>
            Dummy
          </button>
          <button className={`small ${mode === 'practice' ? 'active' : ''}`} onClick={goPractice}>
            Practice (AI)
          </button>
          <button className={`small ${mode === 'online' ? 'active' : ''}`} onClick={() => mode !== 'online' && goOnline()}>
            Online
          </button>
          <button className="small" onClick={() => setMenu(true)} title="Shortcut: Esc">
            How to cast (Esc)
          </button>
          <button className="small" onClick={onBack}>
            Back to typing
          </button>
        </div>
      </header>

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
            [...shapesFor(el), ...(el in BEATS ? [COUNTER] : [])].map((shape) => (
              <button key={el + shape} className="small" onClick={() => debugCast(el, shape)}>
                {el} {shape}
              </button>
            )),
          )}
        </section>
      )}

      {status && <p className="status">{status}</p>}

      <section className="duel">
        <div className="duel-side">
          {fighterHead('player')}
          <div className="status-strip">
            <span className="charge" style={{ color: charge ? ELEMENTS[charge].color : undefined }}>
              {charge ? `${charge} · ${ELEMENTS[charge].name} charged` : 'no charge'}
            </span>
            <span className="sub-line">
              {fight.running && fight.silenced.player > 0
                ? 'Silenced!'
                : readyName
                  ? `${readyName} ready — push!`
                  : drawing
                    ? 'drawing…'
                    : charge && charge in BEATS
                      ? `circle = counter ${ELEMENTS[BEATS[charge]].name} · or attack`
                      : `seeing: ${seeing}`}
            </span>
          </div>
          <div className="stage">
            <div className="camera">
              <video ref={videoRef} playsInline muted />
              <canvas ref={canvasRef} />
            </div>
            {latest && (
              <div className="cast stage-overlay" key={latest.t} style={{ color: latest.color }}>
                {latest.name}
                <span>{latest.detail}</span>
              </div>
            )}
          </div>
        </div>

        <div className="duel-side">
          {fighterHead('enemy')}
          {mode !== 'dummy' && <CastBar fight={fight} />}
          <div className="stage">
            <EnemyCanvas cast={fight.running ? fight.enemyCast : null} />
            {mode === 'dummy' && (
              <div className="stage-center">
                <b className="result">{fight.dealt.player}</b>
                <span className="sub-line">total damage · it never fights back</span>
                <button className="small" onClick={() => dummy.current.reset()}>
                  Reset
                </button>
              </div>
            )}
            {mode === 'practice' && !fight.running && (
              <div className="stage-center">
                {result && <b className="result">{result}</b>}
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
          </div>
        </div>
      </section>

      <p className="note privacy-note">
        Your camera stays on your device and is never uploaded. Online, your opponent only sees your spell drawings and element.
      </p>

      {menu && (
        <div className="menu-overlay" onClick={() => setMenu(false)}>
          <div className="menu-card" onClick={(e) => e.stopPropagation()}>
            <div className="menu-head">
              <b>How to cast</b>
              <button className="small" onClick={() => setMenu(false)}>
                Close (Esc)
              </button>
            </div>
            <div className="spell-help">
              <b>1. Charge</b> — sign an element letter and hold:
              <ul>
                {Object.entries(ELEMENTS).map(([l, e]) => (
                  <li key={l} style={{ color: e.color }}>
                    {l} = {e.name}
                  </li>
                ))}
              </ul>
              <b>2. Draw</b> — point your index finger up (thumb tucked, finger visible) and trace a shape. Raise another finger to finish.
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
                circle coming, so throwing first or switching elements dodges it.
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
      body = <span>Connection lost — reconnecting… (your seat is held for 15 s)</span>
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
            <input className="code-input" value={joinCode} maxLength={4} placeholder="CODE" onChange={(e) => setJoinCode(e.target.value.toUpperCase())} />
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
            <span className="sub-line">Waiting for an opponent — share this code.</span>
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
          <span className="sub-line">Room {lobby.code} · fight!</span>
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
          Opponent disconnected — fight paused. Waiting {Math.max(0, Math.ceil((lobby.oppAwayUntil - clock) / 1000))} s for them to come back…
        </span>
      )}
      {lobby.paused && lobby.oppAwayUntil === null && <span className="note-line">Fight paused while a player reconnects…</span>}
      {lobby.note && <span className="note-line">{lobby.note}</span>}
    </section>
  )
}
