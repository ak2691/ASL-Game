// Game-style setting rows (Nov 25, reference: TETR.IO's config): each setting is its own slab with the name on
// the left in the title font, a full-width control in the middle (end words under a slider), and the exact
// value in a box on the right. Used by the in-match menu and home Settings.
import { useState, type ReactNode } from 'react'
import { ALLY_VIEW_MAX, ALLY_VIEW_MIN, PUSH_MAX, PUSH_MIN, SIGN_DELAY_MAX, getAllyView, getDrawingZoom, setAllyView, getPushGrowth, getSignDelay, setDrawingZoom, setPushGrowth, setSignDelay } from './settings'
import { getVolume, play, setVolume } from './sfx'

export function SlabSlider(p: { label: string; min: number; max: number; value: number; lo: string; hi: string; unit?: string; step?: number; show?: string; onChange: (v: number) => void; onRelease?: () => void; hint?: string; children?: ReactNode }) {
  const fill = ((p.value - p.min) / (p.max - p.min)) * 100
  return (
    <div className="slab">
      <span className="slab-label">{p.label}</span>
      <div className="slab-track">
        <input
          type="range"
          min={p.min}
          max={p.max}
          step={p.step ?? 1}
          value={p.value}
          aria-label={p.label}
          style={{ '--fill': `${fill}%` } as React.CSSProperties}
          onChange={(e) => p.onChange(+e.target.value)}
          onPointerUp={p.onRelease}
        />
        <div className="slab-ends">
          <small>{p.lo}</small>
          <small>{p.hi}</small>
        </div>
      </div>
      <b className="slab-value">
        {p.show ?? (
          <>
            {p.value}
            <small>{p.unit ?? '%'}</small>
          </>
        )}
      </b>
      {p.hint && <p className="slab-hint">{p.hint}</p>}
      {p.children && <div className="slab-hint">{p.children}</div>}
    </div>
  )
}

export function SlabChoice<T extends string>(p: { label: string; value: T; options: { v: T; name: string }[]; onChange: (v: T) => void; hint?: string }) {
  return (
    <div className="slab">
      <span className="slab-label">{p.label}</span>
      <div className="slab-choice" role="group" aria-label={p.label}>
        {p.options.map((o) => (
          <button key={o.v} className={o.v === p.value ? 'on' : ''} aria-pressed={o.v === p.value} onClick={() => p.onChange(o.v)}>
            {o.name}
          </button>
        ))}
      </div>
      {p.hint && <p className="slab-hint">{p.hint}</p>}
    </div>
  )
}

export function DrawingZoomSlab() {
  const [on, setOn] = useState(getDrawingZoom)
  return (
    <SlabChoice
      label="Drawing zoom"
      value={on ? 'on' : 'off'}
      options={[{ v: 'off', name: 'Off' }, { v: 'on', name: 'On' }]}
      hint="In 2v2, zooms in on a foe's small drawing so it's easier to see."
      onChange={(v) => {
        setOn(v === 'on')
        setDrawingZoom(v === 'on')
      }}
    />
  )
}

/** 2v2: how big your teammate's view is (their strip on a phone, their drawing on a computer). */
export function AllyViewSlab() {
  const [px, setPx] = useState(getAllyView)
  return (
    <SlabSlider
      label="Teammate view"
      min={ALLY_VIEW_MIN}
      max={ALLY_VIEW_MAX}
      value={px}
      lo="Small"
      hi="Big"
      hint="In 2v2, how much room your teammate's name, status and drawing get."
      onChange={(v) => {
        setPx(v)
        setAllyView(v)
      }}
    />
  )
}

export function PushSlab() {
  const [pct, setPct] = useState(() => Math.round((getPushGrowth() - 1) * 100))
  return (
    <SlabSlider
      label="Push"
      min={PUSH_MIN}
      max={PUSH_MAX}
      value={pct}
      lo="Gentle"
      hi="Big shove"
      hint="How much closer your hand moves to throw. Lower is easier but can go off by accident."
      onChange={(v) => {
        setPct(v)
        setPushGrowth(1 + v / 100)
      }}
    />
  )
}

export function SignDelaySlab() {
  const [ms, setMs] = useState(getSignDelay)
  return (
    <SlabSlider
      label="Sign delay"
      min={0}
      max={SIGN_DELAY_MAX}
      step={10}
      value={ms}
      unit="ms"
      lo="Instant"
      hi="Steady"
      hint="How long you hold a letter before it counts. Add some if letters go off while you move between them."
      onChange={(v) => {
        setMs(v)
        setSignDelay(v)
      }}
    />
  )
}

export function VolumeSlab() {
  const [vol, setVol] = useState(() => Math.round(getVolume() * 100))
  return (
    <SlabSlider
      label="Volume"
      min={0}
      max={100}
      value={vol}
      lo="Quiet"
      hi="Loud"
      onChange={(v) => {
        setVol(v)
        setVolume(v / 100)
      }}
      onRelease={() => play('charge_F', { vol: 0.6 })}
    />
  )
}

export const SlabSection = ({ title, children }: { title: string; children: ReactNode }) => (
  <section className="slab-section">
    <h3>{title}</h3>
    {children}
  </section>
)

