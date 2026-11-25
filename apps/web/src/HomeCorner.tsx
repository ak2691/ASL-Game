// Home page corner: the Spellbook (book) and Settings (gear), as icon buttons.
import { useState } from 'react'
import type { Hand } from './recognition'
import { DRAW_HAND_KEY, loadDrawHand } from './settings'
import { PushSlab, SlabChoice, SlabSection, VolumeSlab } from './SettingRows'

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
export const BOOK = 'M4 3h12a2 2 0 0 1 2 2v12H4z M7 3v14 M18 7h2v14H6v-4 M9 21v-2 M12.5 6.5l.9 1.9 2 .3-1.5 1.4.4 2-1.8-1-1.8 1 .4-2-1.5-1.4 2-.3z'
export const GEAR =
  'M12 9a3 3 0 1 0 0 6a3 3 0 1 0 0-6z M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z'

export function HomeCorner({ onGuide }: { onGuide: () => void }) {
  const [open, setOpen] = useState(false)
  const [draw, setDraw] = useState<Hand>(() => loadDrawHand())
  return (
    <div className="home-corner">
      <div className="corner-icons">
        <button className="icon-btn" onClick={onGuide} aria-label="Spellbook" title="Spellbook">
          <Icon d={BOOK} />
        </button>
        <button className={`icon-btn ${open ? 'on' : ''}`} onClick={() => setOpen(!open)} aria-label="Settings" title="Settings" aria-expanded={open}>
          <Icon d={GEAR} />
        </button>
      </div>
      {open && (
        <div className="settings-panel">
          <b className="pm-title">Settings</b>
          <SlabSection title="Controls">
            <SlabChoice
              label="Draw with"
              value={draw}
              options={[{ v: 'left', name: 'Left' }, { v: 'right', name: 'Right' }]}
              onChange={(n) => {
                setDraw(n)
                save(DRAW_HAND_KEY, n)
              }}
            />
            <PushSlab />
          </SlabSection>
          <SlabSection title="Sound">
            <VolumeSlab />
          </SlabSection>
        </div>
      )}
    </div>
  )
}

/** The one Home button (Nov 25): red, with a house (or a back arrow for Back), on every page that leaves. */
export function HomeButton({ onClick, back, className = '' }: { onClick: () => void; back?: boolean; className?: string }) {
  return (
    <button className={`small book-home ${className}`} onClick={onClick}>
      <Icon d={back ? 'M15 5l-7 7 7 7' : 'M3 11l9-8 9 8 M5 9v12h5v-6h4v6h5V9'} />
      {back ? 'Back' : 'Home'}
    </button>
  )
}
