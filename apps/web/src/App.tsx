import { useEffect, useRef, useState } from 'react'
import { DrawingUtils, HandLandmarker, type NormalizedLandmark } from '@mediapipe/tasks-vision'
import { MotionTracker, isMotionLetter } from './motion'
import { checkForm, directionAdjusted, directionLetter } from './rules'
import { classify, loadRecognizer, type Hand, type Prediction, type Recognizer } from './recognition'
import { getTracker, type TrackerKind } from './trackers'
import { JumpFilter, LandmarkSmoother } from './smoothing'
import { GUIDE, randomWords } from './content'
import { GuidePose } from './GuidePose'
import { CLIP_MS, Recorder } from './recorder'
import './App.css'

// Target-letter scoring: we know which letter the player should sign next,
// so we accept it as soon as the model is fairly sure it sees that letter.
const ACCEPT_PROB = 0.8 // target letter probability needed to accept (it must also be the top guess)
const ACCEPT_MS = 100 // ...held for this long (a short guard against passing shapes)
const RELEASE_PROB = 0.5 // double letters: a dip below this (a brief relax) lets the repeat count...
const RELEASE_MOVE = 0.3 // ...or the whole hand bouncing/sliding this far (palm units)

/** The palm's center and size, for measuring small whole-hand movements. */
interface HandSpot {
  x: number
  y: number
  palm: number
}
function handCenter(lm: NormalizedLandmark[]): HandSpot {
  const ids = [0, 5, 9, 13, 17] // wrist + knuckles: moves with the hand, not with the fingers
  return {
    x: ids.reduce((s, i) => s + lm[i].x, 0) / ids.length,
    y: ids.reduce((s, i) => s + lm[i].y, 0) / ids.length,
    palm: Math.hypot(lm[9].x - lm[0].x, lm[9].y - lm[0].y) || 1,
  }
}
/** Furthest the hand has moved from `from`, in palm units. */
function handMovedSince(from: HandSpot, lm: NormalizedLandmark[]) {
  const now = handCenter(lm)
  return Math.hypot(now.x - from.x, now.y - from.y) / from.palm
}
const MIN_CONFIDENCE = 0.6 // a wrong letter needs this confidence...
const ERROR_MS = 400 // ...held this long to count as an error
const STUCK_MS = 2000 // show the guide automatically after this long without progress
const ZOOMS = [1, 1.5, 2] // digital zoom levels for players sitting farther from the camera
const DROPOUT_GRACE_MS = 200 // if tracking loses the hand briefly, keep the last hand this long
const WORDS_PER_RUN = 30

// Free mode (the casting game's input): no target letter. A static letter counts once it's the
// confident top guess for a moment; J/Z come from the motion model choosing on its own.
const FREE_MIN_PROB = 0.8 // top letter must be this sure...
const FREE_HOLD_MS = 250 // ...for this long (longer than the typing page: no target to filter passing shapes)
const FREE_RELAX_MS = 300 // the same letter again needs a moment of "nothing" in between
const FIXUP_MS = 1500 // a J/Z right after an I/D replaces it ("commit now, correct later", skills.md)

interface FreeEntry {
  letter: string
  t: number
}
const newFree = () => ({
  history: [] as FreeEntry[],
  holdLetter: null as string | null,
  holdSince: 0,
  committed: null as string | null, // last committed static letter, blocks instant repeats
})

let recognizerPromise: Promise<Recognizer> | null = null
const getRecognizer = () => (recognizerPromise ??= loadRecognizer())

function loadHand(): Hand | null {
  try {
    const v = localStorage.getItem('hand')
    return v === 'left' || v === 'right' ? v : null
  } catch {
    return null
  }
}
function saveHand(h: Hand) {
  try {
    localStorage.setItem('hand', h)
  } catch {
    /* ignore */
  }
}

export default function App() {
  const [hand, setHand] = useState<Hand | null>(loadHand)

  const choose = (h: Hand) => {
    saveHand(h)
    setHand(h)
  }

  if (!hand) {
    return (
      <main className="center">
        <h1>ASL Speed</h1>
        <p className="sub">Which hand do you sign with?</p>
        <div className="row">
          <button onClick={() => choose('left')}>Left hand</button>
          <button onClick={() => choose('right')}>Right hand</button>
        </div>
        <p className="note">Your camera video stays on this device and is never uploaded.</p>
      </main>
    )
  }
  return <TypingPage hand={hand} onChangeHand={() => setHand(null)} />
}

interface Stats {
  cameraRes: string // resolution the camera actually delivers
  cameraFps: number // frame rate the camera reports
  processedFps: number // frames we actually ran hand tracking on in the last second
  detectMs: number // average hand-tracking time per frame
  handFound: number // % of frames in the last second where a hand was found
}

interface View {
  stats: Stats | null
  formHint: string | null // why an otherwise-recognized letter wasn't accepted
  status: string
  words: string[]
  wordIdx: number
  letterIdx: number
  seeing: string | null
  top3: string // the model's three most likely letters, e.g. "D 62% · V 30% · K 4%"
  targetProb: number
  accepted: number
  errors: number
  elapsedMs: number
  stuck: boolean
  freeNow: string // free mode: what the model sees right now ("none" if nothing)
  freeHistory: string // free mode: letters signed so far (last one = "last signed")
}

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('')

/** Words for a run: random words, or one letter repeated in letter-practice mode. */
const makeWords = (practice: string | null) =>
  practice ? Array<string>(WORDS_PER_RUN).fill(practice.toLowerCase()) : randomWords(WORDS_PER_RUN)

function newGame(practice: string | null = null) {
  return {
    practice,
    words: makeWords(practice),
    wordIdx: 0,
    letterIdx: 0,
    holdLetter: null as string | null, // top guess, tracked for error counting
    holdStart: 0,
    wrongCounted: false,
    aboveSince: null as number | null, // when the target probability went above ACCEPT_PROB
    motion: new MotionTracker(), // J/Z: always-on motion history (fed every frame)
    needRelease: false,
    releaseFrom: null as HandSpot | null, // where the hand was when a repeatable letter was accepted
    accepted: 0,
    errors: 0,
    startTime: null as number | null,
    lastProgress: performance.now(),
  }
}

function TypingPage({ hand, onChangeHand }: { hand: Hand; onChangeHand: () => void }) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const game = useRef(newGame())
  const [freeMode, setFreeMode] = useState(false)
  const freeRef = useRef(false) // read by the camera loop
  const free = useRef(newFree())
  const [guideOn, setGuideOn] = useState(true)
  // Debug recorder: S (or the button) saves the last few seconds; Download exports them all.
  const recorder = useRef(new Recorder())
  const setupRef = useRef<Record<string, string | number>>({})
  const [recInfo, setRecInfo] = useState({ count: 0, msg: '' })
  const saveRecording = () => {
    const clip = recorder.current.save(setupRef.current)
    if (!clip) return
    setRecInfo({ count: recorder.current.clips.length, msg: `saved ${clip.label} (${clip.outcome})` })
  }
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() === 's' && !e.repeat && !(e.target instanceof HTMLInputElement)) saveRecording()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
  const [trackerKind, setTrackerKind] = useState<TrackerKind>(() => {
    try {
      return localStorage.getItem('tracker') === 'old' ? 'old' : 'new'
    } catch {
      return 'new'
    }
  })
  // Digital zoom (1×, 1.5×, 2×): read by the camera loop through a ref, so changing it
  // doesn't restart the camera.
  const [zoom, setZoom] = useState<number>(() => {
    try {
      const z = Number(localStorage.getItem('zoom'))
      return ZOOMS.includes(z) ? z : 1
    } catch {
      return 1
    }
  })
  const zoomRef = useRef(zoom)
  const cycleZoom = () => {
    const next = ZOOMS[(ZOOMS.indexOf(zoom) + 1) % ZOOMS.length]
    zoomRef.current = next
    setZoom(next)
    try {
      localStorage.setItem('zoom', String(next))
    } catch {
      /* ignore */
    }
  }
  const switchTracker = () => {
    const next = trackerKind === 'new' ? 'old' : 'new'
    try {
      localStorage.setItem('tracker', next)
    } catch {
      /* ignore */
    }
    setView((v) => ({ ...v, stats: null, status: 'Loading hand tracking…' }))
    setTrackerKind(next)
  }
  const [view, setView] = useState<View>({
    stats: null,
    formHint: null,
    status: 'Loading hand tracking and letter model…',
    words: game.current.words,
    wordIdx: 0,
    letterIdx: 0,
    seeing: null,
    top3: '',
    targetProb: 0,
    accepted: 0,
    errors: 0,
    elapsedMs: 0,
    stuck: false,
    freeNow: 'none',
    freeHistory: '',
  })

  useEffect(() => {
    let stopped = false
    let raf = 0
    let stream: MediaStream | null = null
    let stats: Stats | null = null
    let lastViewUpdate = 0

    async function start() {
      try {
        const [rec, tracker] = await Promise.all([getRecognizer(), getTracker(trackerKind)])
        if (stopped) return
        setView((v) => ({ ...v, status: 'Starting camera…' }))
        // Higher resolution = more finger detail for the tracker; higher frame rate = less blur.
        // ("ideal" lets cameras that can't do this fall back to what they support.)
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
        game.current.lastProgress = performance.now()
        setView((v) => ({ ...v, status: '' }))

        // Diagnostics: how many frames per second we actually process, how long hand
        // tracking takes per frame, and how often a hand was found.
        const settings = stream.getVideoTracks()[0].getSettings()
        const cameraFps = Math.round(settings.frameRate ?? 0)
        const cameraRes = `${settings.width ?? '?'}×${settings.height ?? '?'}`
        const recent: { t: number; found: boolean; ms: number }[] = []

        // Run once per new camera frame. requestVideoFrameCallback fires exactly once per
        // frame; the requestAnimationFrame fallback can see the same frame twice.
        const perFrame = 'requestVideoFrameCallback' in video
        const schedule = () => {
          if (perFrame) video.requestVideoFrameCallback(loop)
          else raf = requestAnimationFrame(loop)
        }
        const smoother = new LandmarkSmoother()
        const jumpFilter = new JumpFilter()
        let lastHand: { lm: NormalizedLandmark[]; t: number } | null = null
        let lastVideoTime = -1
        let busy = false // the old tracker is asynchronous: skip frames that arrive mid-detection

        // Digital zoom: the tracker sees only the middle of the camera picture, enlarged, so a
        // hand at normal sitting distance takes up more of the image. The preview is zoomed the
        // same way (CSS), and the skeleton canvas covers exactly the cropped area.
        const crop = document.createElement('canvas')
        const cropCtx = crop.getContext('2d')!
        let lastZoom = zoomRef.current

        const loop = async () => {
          if (stopped) return
          schedule()
          if (busy || video.currentTime === lastVideoTime) return
          lastVideoTime = video.currentTime
          const now = performance.now()

          const zoom = zoomRef.current
          if (zoom !== lastZoom) {
            // Coordinates change meaning when the zoom changes: start the hand fresh.
            lastZoom = zoom
            lastHand = null
            smoother.reset()
            jumpFilter.reset()
            game.current.motion.reset()
          }
          const vw = video.videoWidth
          const vh = video.videoHeight
          const cw = Math.round(vw / zoom)
          const ch = Math.round(vh / zoom)
          if (canvas.width !== cw || canvas.height !== ch) {
            canvas.width = cw
            canvas.height = ch
          }
          let source: HTMLVideoElement | HTMLCanvasElement = video
          if (zoom !== 1) {
            if (crop.width !== cw || crop.height !== ch) {
              crop.width = cw
              crop.height = ch
            }
            cropCtx.drawImage(video, (vw - cw) / 2, (vh - ch) / 2, cw, ch, 0, 0, cw, ch)
            source = crop
          }

          busy = true
          const found = await tracker.detect(source, now)
          busy = false
          if (stopped) return
          const detectMs = performance.now() - now
          recent.push({ t: now, found: found !== null, ms: detectMs })
          while (recent.length && now - recent[0].t > 1000) recent.shift()
          stats = {
            cameraRes: zoom === 1 ? cameraRes : `${cameraRes} (tracking ${cw}×${ch} at ${zoom}× zoom)`,
            cameraFps,
            processedFps: recent.length,
            detectMs: Math.round(recent.reduce((s, r) => s + r.ms, 0) / recent.length),
            handFound: Math.round((100 * recent.filter((r) => r.found).length) / recent.length),
          }

          // Smooth the skeleton; if the hand blinks out briefly, keep using the last one
          // (drawn faded) so a split-second tracking drop doesn't reset the letter.
          let lm: NormalizedLandmark[] | null = null
          let held = false
          if (found) {
            lm = smoother.smooth(jumpFilter.filter(found, now), now)
            lastHand = { lm, t: now }
          } else if (lastHand && now - lastHand.t < DROPOUT_GRACE_MS) {
            lm = lastHand.lm
            held = true
          } else {
            lastHand = null
            smoother.reset()
            jumpFilter.reset()
          }

          ctx.clearRect(0, 0, canvas.width, canvas.height)
          let pred: Prediction | null = null
          if (lm) {
            ctx.globalAlpha = held ? 0.35 : 1
            drawer.drawConnectors(lm, HandLandmarker.HAND_CONNECTIONS, { color: '#e2b714', lineWidth: 3 })
            drawer.drawLandmarks(lm, { color: '#ffffff', radius: 3 })
            ctx.globalAlpha = 1
            pred = classify(rec, lm, hand)
          }
          // The motion model gets the raw tracker output: no smoothing, no jump filter, no held
          // frames. Its own gap fill handles dropouts, matching how it was trained (skills.md).
          step(pred, lm, now, found)
        }
        loop()
      } catch (err) {
        setView((v) => ({ ...v, status: `Couldn't start: ${(err as Error).message}` }))
      }
    }

    // Free mode: no target. Commit whatever is signed; show "now" and "last signed".
    function freeStep(pred: Prediction | null, lm: NormalizedLandmark[] | null, now: number, raw: NormalizedLandmark[] | null) {
      const f = free.current
      const g = game.current
      const motion = g.motion.updateFree(raw, now)
      const top = pred && pred.confidence >= FREE_MIN_PROB ? directionLetter(pred.letter, lm) : null
      const seen = top && !checkForm(top, lm) ? top : null
      if (motion) {
        // J starts as I and Z as D, so that letter was probably just committed: replace it.
        const base = motion === 'J' ? 'I' : 'D'
        const last = f.history[f.history.length - 1]
        if (last && last.letter === base && now - last.t < FIXUP_MS) f.history[f.history.length - 1] = { letter: motion, t: now }
        else f.history.push({ letter: motion, t: now })
        f.committed = base // the I/D still on screen after the motion doesn't count again
        f.holdLetter = null
      } else {
        if (seen !== f.holdLetter) {
          f.holdLetter = seen
          f.holdSince = now
        }
        if (!seen) {
          if (now - f.holdSince >= FREE_RELAX_MS) f.committed = null
        } else if (seen !== f.committed && now - f.holdSince >= FREE_HOLD_MS) {
          f.history.push({ letter: seen, t: now })
          f.committed = seen
        }
      }
      if (f.history.length > 60) f.history.shift()

      recorder.current.push({
        t: now,
        raw,
        held: lm !== null && raw === null,
        target: 'free',
        targetP: 0,
        top: pred ? pred.top(3).map((x) => [x.letter, x.prob] as [string, number]) : [],
        motionP: g.motion.prob,
        accepted: motion !== null,
      })

      if (!motion && now - lastViewUpdate < 50) return
      lastViewUpdate = now
      setView((v) => ({
        ...v,
        stats,
        freeNow: motion ?? seen ?? 'none',
        freeHistory: f.history.map((e) => e.letter).join(''),
        top3: pred
          ? pred
              .top(3)
              .map((t) => `${t.letter} ${Math.round(t.prob * 100)}%`)
              .join(' · ')
          : '',
      }))
    }

    // Advance the game based on what the model sees this frame.
    function step(pred: Prediction | null, lm: NormalizedLandmark[] | null, now: number, raw: NormalizedLandmark[] | null) {
      if (freeRef.current) return freeStep(pred, lm, now, raw)
      const g = game.current
      const word = g.words[g.wordIdx]
      const target = word[g.letterIdx].toUpperCase()
      const motion = isMotionLetter(target)
      let p: number
      let ready: boolean
      let formHint: string | null = null
      let motionP: number | null = null
      // Feed the motion history every frame (not only when J/Z is the target), so a J/Z
      // started while the previous letter was still being confirmed is seen in full.
      const motionProgress = g.motion.update(raw, now, isMotionLetter(target) ? target : null)

      if (isMotionLetter(target)) {
        // J and Z: the motion model reads the last 1.5 s of hand movement.
        p = motionProgress
        motionP = g.motion.prob
        ready = p >= 1
      } else {
        // K/P and G/Q: same handshape, so finger direction decides between them.
        const adjusted = pred ? directionAdjusted(target, pred.prob, lm) : null
        p = adjusted ?? (pred ? pred.prob(target) : 0)
        // Form rules can block a letter the model likes (e.g. P with the thumb sticking out).
        formHint = p >= ACCEPT_PROB ? checkForm(target, lm) : null
        if (formHint) p = Math.min(p, ACCEPT_PROB - 0.01)
        // Double letters (the OO in BOOK, or repeats in letter practice): the repeat counts after a
        // small bounce/slide of the whole hand (how signers do it) or a brief relax of the shape.
        if (g.needRelease) {
          const moved = lm && g.releaseFrom ? handMovedSince(g.releaseFrom, lm) : 0
          if (p < RELEASE_PROB || moved >= RELEASE_MOVE) g.needRelease = false
        }
        // Accept the target as soon as it's likely enough for a moment.
        const topIsTarget = pred !== null && directionLetter(pred.letter, lm) === target
        if (!g.needRelease && p >= ACCEPT_PROB && topIsTarget) g.aboveSince ??= now
        else g.aboveSince = null
        ready = g.aboveSince !== null && now - g.aboveSince >= ACCEPT_MS
      }

      if (ready) {
        g.accepted++
        g.startTime ??= now
        g.lastProgress = now
        g.aboveSince = null
        g.letterIdx++
        if (g.letterIdx >= word.length) {
          g.letterIdx = 0
          g.wordIdx++
          if (g.wordIdx >= g.words.length - 5) g.words = [...g.words, ...makeWords(g.practice)]
        }
        const next = g.words[g.wordIdx][g.letterIdx].toUpperCase()
        g.needRelease = next === target && !motion
        g.releaseFrom = g.needRelease && lm ? handCenter(lm) : null
      }

      // Debug recorder: remember this frame (raw points, timing, both models' outputs).
      setupRef.current = {
        camera: stats?.cameraRes ?? '?',
        cameraFps: stats?.cameraFps ?? 0,
        trackingFps: stats?.processedFps ?? 0,
        handFoundPct: stats?.handFound ?? 0,
        zoom: zoomRef.current,
        tracker: trackerKind,
        hand,
      }
      recorder.current.push({
        t: now,
        raw,
        held: lm !== null && raw === null,
        target,
        targetP: p,
        top: pred ? pred.top(3).map((x) => [x.letter, x.prob] as [string, number]) : [],
        motionP,
        accepted: ready,
      })

      // Errors: a confident wrong letter held for a while (counted once per hold).
      const seen = pred && pred.confidence >= MIN_CONFIDENCE ? directionLetter(pred.letter, lm) : null
      if (seen !== g.holdLetter) {
        g.holdLetter = seen
        g.holdStart = now
        g.wrongCounted = false
      }
      // (Not for J/Z: their starting shapes look like I and D to the letter model.)
      if (!motion && seen && seen !== target && now - g.holdStart >= ERROR_MS && !g.wrongCounted) {
        g.errors++
        g.wrongCounted = true
      }

      // Redraw the page at most ~20 times a second (instantly when a letter is accepted),
      // so React re-rendering doesn't slow down hand tracking.
      if (!ready && now - lastViewUpdate < 50) return
      lastViewUpdate = now
      setView((v) => ({
        ...v,
        stats,
        formHint,
        words: g.words,
        wordIdx: g.wordIdx,
        letterIdx: g.letterIdx,
        seeing: seen,
        top3: pred
          ? pred
              .top(3)
              .map((t) => `${t.letter} ${Math.round(t.prob * 100)}%`)
              .join(' · ')
          : '',
        targetProb: g.needRelease ? 0 : p,
        accepted: g.accepted,
        errors: g.errors,
        elapsedMs: g.startTime ? now - g.startTime : 0,
        stuck: now - g.lastProgress > STUCK_MS,
      }))
    }

    start()
    return () => {
      stopped = true
      cancelAnimationFrame(raf)
      stream?.getTracks().forEach((t) => t.stop())
    }
  }, [hand, trackerKind])

  const [practice, setPractice] = useState<string | null>(null) // null = words mode
  const setFree = (on: boolean) => {
    freeRef.current = on
    setFreeMode(on)
    free.current = newFree()
    game.current.motion.reset()
    setView((v) => ({ ...v, freeNow: 'none', freeHistory: '' }))
  }
  const startRun = (letter: string | null) => {
    setFree(false)
    setPractice(letter)
    const g = (game.current = newGame(letter))
    // Show the new run right away (the camera loop also refreshes this every frame).
    setView((v) => ({ ...v, words: g.words, wordIdx: 0, letterIdx: 0, accepted: 0, errors: 0, elapsedMs: 0, targetProb: 0, stuck: false }))
  }
  const restart = () => startRun(practice)

  const word = view.words[view.wordIdx]
  const target = word[view.letterIdx].toUpperCase()
  const minutes = view.elapsedMs / 60000
  const lpm = minutes > 0 ? Math.round(view.accepted / minutes) : 0
  const secs = Math.floor(view.elapsedMs / 1000)
  const showGuide = guideOn || view.stuck
  const upcoming = view.words.slice(view.wordIdx, view.wordIdx + 8)

  return (
    <main className="page">
      <header>
        <span className="logo">ASL Speed</span>
        <div className="row">
          <button className={`small ${!freeMode && practice === null ? 'active' : ''}`} onClick={() => startRun(null)}>
            Words
          </button>
          <button className={`small ${!freeMode && practice !== null ? 'active' : ''}`} onClick={() => startRun(practice ?? 'A')}>
            Letters
          </button>
          <button className={`small ${freeMode ? 'active' : ''}`} onClick={() => setFree(true)} title="Sign any letter; see what it reads">
            Free
          </button>
          <button className="small" onClick={cycleZoom} title="Zoom in if your hand looks small on camera">
            Zoom: {zoom}×
          </button>
          <button className="small" onClick={switchTracker} title="Switch hand tracker (for comparing)">
            Tracker: {trackerKind === 'new' ? 'New' : 'Old'}
          </button>
          <button className="small" onClick={onChangeHand}>
            {hand === 'right' ? 'Right' : 'Left'} hand
          </button>
          <button className="small" onClick={() => setGuideOn((g) => !g)}>
            Guide: {guideOn ? 'ON' : 'OFF'}
          </button>
          <button className="small" onClick={restart}>
            Restart
          </button>
          <button className="small" onClick={saveRecording} title={`Save the last ${CLIP_MS / 1000} s of hand tracking for debugging (shortcut: S)`}>
            Save clip (S)
          </button>
          {recInfo.count > 0 && (
            <button className="small" onClick={() => recorder.current.download()} title="Download all saved clips as one JSON file">
              Download {recInfo.count}
            </button>
          )}
        </div>
      </header>

      {freeMode && (
        <section className="free" aria-live="polite">
          <div className="free-last">
            <span className="free-label">last signed</span>
            <b>{view.freeHistory.slice(-1) || '–'}</b>
          </div>
          <div className="free-now">
            now: <b>{view.freeNow}</b>
          </div>
          <div className="free-history">
            {view.freeHistory || 'Sign any letter…'}
            {view.freeHistory && (
              <button className="small" onClick={() => setFree(true)}>
                Clear
              </button>
            )}
          </div>
        </section>
      )}

      {!freeMode && practice !== null && (
        <section className="alphabet" aria-label="Pick a letter to practice">
          {ALPHABET.map((l) => (
            <button key={l} className={`small ${l === practice ? 'active' : ''}`} onClick={() => startRun(l)}>
              {l}
            </button>
          ))}
        </section>
      )}

      {!freeMode && <section className="words">
        {upcoming.map((w, i) =>
          i === 0 ? (
            <span key={view.wordIdx} className="word current">
              {w.split('').map((ch, j) => (
                <span
                  key={j}
                  className={j < view.letterIdx ? 'done' : j === view.letterIdx ? 'next' : ''}
                >
                  {ch}
                </span>
              ))}
            </span>
          ) : (
            <span key={view.wordIdx + i} className="word">
              {w}
            </span>
          ),
        )}
      </section>}

      {view.status && <p className="status">{view.status}</p>}

      <section className="panels">
        <div className="panel">
          <div className="camera">
            <video ref={videoRef} playsInline muted style={{ transform: `scale(${zoom})` }} />
            <canvas ref={canvasRef} />
          </div>
          {!freeMode && <div className="seeing">
            <Ring progress={Math.min(1, view.targetProb / ACCEPT_PROB)} />
            <span>
              {target}: <b>{Math.round(view.targetProb * 100)}%</b>
            </span>
            <span className="top-guess">top guess: {view.seeing ?? '–'}</span>
          </div>}
          {view.top3 && <div className="top3">model: {view.top3}</div>}
          {view.formHint && <div className="form-hint">{view.formHint}</div>}
        </div>

        {!freeMode && showGuide && (
          <div className="panel guide">
            <div className="guide-title">GUIDE</div>
            <div className="guide-letter">{target}</div>
            <GuidePose letter={target} hand={hand} />
            <div className="guide-legend">example hand · pink dot = thumb tip</div>
            <p>{GUIDE[target] ?? 'No guide for this letter yet.'}</p>
          </div>
        )}
      </section>

      <footer>
        {!freeMode && (
          <>
            <span>time {Math.floor(secs / 60)}:{String(secs % 60).padStart(2, '0')}</span>
            <span>letters/min {lpm}</span>
            <span>errors {view.errors}</span>
          </>
        )}
        {recInfo.msg && <span>{recInfo.msg}</span>}
        {practice !== null && (
          <span>
            {practice} signed: <b className="count">{view.accepted}</b>
          </span>
        )}
        {view.stats && (
          <span className="stats">
            camera {view.stats.cameraRes} @ {view.stats.cameraFps} fps · tracking {view.stats.processedFps} fps · {view.stats.detectMs} ms/frame ·
            hand found {view.stats.handFound}%
          </span>
        )}
      </footer>
    </main>
  )
}

function Ring({ progress }: { progress: number }) {
  const r = 10
  const c = 2 * Math.PI * r
  return (
    <svg width="28" height="28" viewBox="0 0 28 28" aria-hidden>
      <circle cx="14" cy="14" r={r} fill="none" stroke="var(--sub)" strokeWidth="3" />
      <circle
        cx="14"
        cy="14"
        r={r}
        fill="none"
        stroke="var(--main)"
        strokeWidth="3"
        strokeDasharray={c}
        strokeDashoffset={c * (1 - progress)}
        transform="rotate(-90 14 14)"
      />
    </svg>
  )
}
