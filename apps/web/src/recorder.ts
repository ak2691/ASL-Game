// Debug recorder: keeps the last few seconds of what recognition saw, so a failed (or
// successful) attempt can be saved and studied later (see skills.md, "Debug recordings").
// Saves hand points, timing and model outputs only. No video or images.

const KEEP_MS = 6000 // rolling buffer length
export const CLIP_MS = 4000 // how much a saved clip contains

export interface RecFrame {
  t: number // ms (performance.now)
  raw: number[][] | null // raw tracker points [x, y, z] x 21, or null if no hand this frame
  held: boolean // the letter model used a held (frozen) hand this frame
  target: string // letter the player should sign
  targetP: number // target-letter progress/probability shown to the player
  top: [string, number][] // letter model's top 3
  motionP: number | null // motion model's probability for the target J/Z (null for other letters)
  accepted: boolean // the target letter was accepted on this frame
}

export interface RecClip {
  savedAt: string
  label: string // target letter when saved
  outcome: 'worked' | 'missed' // was the target accepted inside this clip
  note: string
  setup: Record<string, string | number>
  frames: RecFrame[]
}

const r4 = (v: number) => Math.round(v * 1e4) / 1e4

export class Recorder {
  private buf: RecFrame[] = []
  clips: RecClip[] = []

  push(f: Omit<RecFrame, 'raw'> & { raw: { x: number; y: number; z: number }[] | null }) {
    this.buf.push({ ...f, raw: f.raw ? f.raw.map((p) => [r4(p.x), r4(p.y), r4(p.z)]) : null, targetP: r4(f.targetP), motionP: f.motionP === null ? null : r4(f.motionP), top: f.top.map(([l, p]) => [l, r4(p)]) })
    const now = f.t
    while (this.buf.length && now - this.buf[0].t > KEEP_MS) this.buf.shift()
  }

  /** Save the last CLIP_MS. Returns the saved clip. */
  save(setup: RecClip['setup'], note = ''): RecClip | null {
    if (!this.buf.length) return null
    const end = this.buf[this.buf.length - 1].t
    const frames = this.buf.filter((f) => end - f.t <= CLIP_MS)
    const label = frames[frames.length - 1].target
    const clip: RecClip = {
      savedAt: new Date().toISOString(),
      label,
      outcome: frames.some((f) => f.accepted && f.target === label) ? 'worked' : 'missed',
      note,
      setup,
      frames,
    }
    this.clips.push(clip)
    return clip
  }

  download() {
    const blob = new Blob([JSON.stringify({ version: 1, clips: this.clips })], { type: 'application/json' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `recordings-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.json`
    a.click()
    URL.revokeObjectURL(a.href)
  }
}
