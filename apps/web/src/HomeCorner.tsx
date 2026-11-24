// Home page corner: How to cast (book), Spell Info (i) and Settings (gear), as icon buttons.
import { useState } from 'react'
import type { Hand } from './recognition'
import { DRAW_HAND_KEY, loadDrawHand } from './settings'
import { VolumeSlider } from './VolumeSlider'
import { PushSlider } from './PushSlider'

const save = (k: string, v: string) => {
  try {
    localStorage.setItem(k, v)
  } catch {
    /* not saved: fine */
  }
}

export const Icon = ({ d }: { d: string }) => (
  <svg viewBox="0 0 24 24" width="24" height="24" aria-hidden fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d={d} />
  </svg>
)
const BOOK = 'M4 3h12a2 2 0 0 1 2 2v12H4z M7 3v14 M18 7h2v14H6v-4 M9 21v-2 M12.5 6.5l.9 1.9 2 .3-1.5 1.4.4 2-1.8-1-1.8 1 .4-2-1.5-1.4 2-.3z'
const INFO = 'M12 3a9 9 0 1 0 0 18a9 9 0 1 0 0-18z M12 11v6 M12 7.5v.5'
export const GEAR =
  'M12 9a3 3 0 1 0 0 6a3 3 0 1 0 0-6z M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z'

export function HomeCorner({ onGuide, onInfo }: { onGuide: () => void; onInfo: () => void }) {
  const [open, setOpen] = useState(false)
  const [draw, setDraw] = useState<Hand>(() => loadDrawHand())
  return (
    <div className="home-corner">
      <div className="corner-icons">
        <button className="icon-btn" onClick={onGuide} aria-label="How to cast" title="How to cast">
          <Icon d={BOOK} />
        </button>
        <button className="icon-btn" onClick={onInfo} aria-label="Spell info" title="Spell info">
          <Icon d={INFO} />
        </button>
        <button className={`icon-btn ${open ? 'on' : ''}`} onClick={() => setOpen(!open)} aria-label="Settings" title="Settings" aria-expanded={open}>
          <Icon d={GEAR} />
        </button>
      </div>
      {open && (
        <div className="settings-panel">
          <b>Settings</b>
          <button
            onClick={() => {
              const n: Hand = draw === 'right' ? 'left' : 'right'
              setDraw(n)
              save(DRAW_HAND_KEY, n)
            }}
          >
            Draw with: {draw === 'right' ? 'Right hand' : 'Left hand'}
          </button>
          <PushSlider />
          <VolumeSlider />
        </div>
      )}
    </div>
  )
}
