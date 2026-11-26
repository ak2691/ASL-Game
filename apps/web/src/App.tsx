import { useState } from 'react'
import { flushSync } from 'react-dom'
import type { Hand } from './recognition'
import { SpellPage, type Mode } from './SpellPage'
import { getOnlineFlag } from './online'
import { Spellbook } from './Spellbook'
import { PrivacyPage } from './PrivacyPage'
import { HomeCorner } from './HomeCorner'
import { HomeBackdrop } from './HomeBackdrop'
import { Portrait } from './Ladder'
import './App.css'

// The letter model was trained on mirrored copies, so either hand works; we normalize to right.
const HAND: Hand = 'right'
const SLIDE_OUT_MS = 180 // matches page-slide-out in App.css

export default function App() {
  // A refresh goes back home, except mid online room (the server puts you back in your seat).
  const [mode, setMode] = useState<Mode | 'guide' | 'privacy' | null>(() => (getOnlineFlag() ? 'online' : null))
  // Every page change: the old screen slides out first, then the new one slides in (TETR.IO-style); the
  // background stays put.
  const slideTo = (m: Mode | 'guide' | 'privacy' | null) => {
    if (document.body.classList.contains('page-leaving')) return
    document.body.classList.add('page-leaving')
    setTimeout(() => {
      // Swap the page first, then drop the class: the other order shows the old page again for a frame (its
      // slide-out ends and nothing covers it yet).
      flushSync(() => setMode(m))
      document.body.classList.remove('page-leaving')
    }, SLIDE_OUT_MS)
  }
  // One backdrop behind every page, kept mounted across page changes so a transition never shows the bare page
  // background. Game screens hide it (CSS), except while one is sliding out.
  return (
    <>
      <HomeBackdrop />
      {mode === 'guide' ? (
        <Spellbook onHome={() => slideTo(null)} />
      ) : mode === 'privacy' ? (
        <PrivacyPage onHome={() => slideTo(null)} />
      ) : mode ? (
        <SpellPage key={mode} hand={HAND} mode={mode} onHome={() => slideTo(null)} />
      ) : (
        <Home slideTo={slideTo} />
      )}
    </>
  )
}

function Home({ slideTo }: { slideTo: (m: Mode | 'guide' | 'privacy') => void }) {
  return (
    <main className="home">
      <HomeCorner onGuide={() => slideTo('guide')} />
      <div className="home-brand">
        <img className="hero-logo" src="/logo.svg" alt="" />
        <h1 className="logo">ASL Wizard</h1>
      </div>
      {/* Modes as wide bars with a line saying what each is (reference: TETR.IO's menu), so the tower behind
          stays visible. Fighting first, learning last. */}
      <nav className="home-menu" aria-label="Game modes">
        {MODES.map((m) => (
          <button key={m.mode} className={`mode-bar mode-${m.mode}`} onClick={() => slideTo(m.mode)}>
            <span className="mode-icon" aria-hidden="true">
              {m.icon}
            </span>
            <span className="mode-text">
              <b>{m.name}</b>
              <small>{m.line}</small>
            </span>
          </button>
        ))}
      </nav>
      <p className="home-privacy">
        This game needs your camera. Your video stays on your device: it's never saved or shown to anyone.{' '}
        <a href="#privacy" onClick={(e) => (e.preventDefault(), slideTo('privacy'))}>
          Privacy
        </a>
      </p>
    </main>
  )
}


const ICON = { fill: 'none', stroke: 'currentColor', strokeWidth: 3, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const }
/** The home menu, in order. Practice AI is "The Tower" (its floors are the ladder); Online is "Duel". */
const MODES: { mode: Mode; name: string; line: string; icon: React.ReactNode }[] = [
  { mode: 'practice', name: 'The Tower', line: 'Climb 13 floors of wizards', icon: <Portrait id="ascendant" /> },
  {
    mode: 'online',
    name: 'Duel',
    line: 'Fight a friend with a room code',
    icon: (
      <svg viewBox="0 0 40 40">
        <path d="M8 32 L28 12 M12 32 L8 28 M32 32 L12 12 M28 32 L32 28" {...ICON} />
        <path d="M28 12 l3 -6 l3 3 Z M12 12 l-3 -6 l-3 3 Z" fill="currentColor" />
      </svg>
    ),
  },
  {
    mode: 'dummy',
    name: 'Training dummy',
    line: 'Practice your spells, no pressure',
    icon: (
      <svg viewBox="0 0 40 40">
        <circle cx="20" cy="20" r="14" {...ICON} />
        <circle cx="20" cy="20" r="7" {...ICON} />
        <circle cx="20" cy="20" r="1.8" fill="currentColor" />
      </svg>
    ),
  },
  {
    mode: 'tutorial',
    name: 'Tutorial',
    line: 'Learn to cast',
    icon: (
      <svg viewBox="0 0 40 40">
        <path d="M6 10 Q13 7 20 11 Q27 7 34 10 L34 31 Q27 28 20 32 Q13 28 6 31 Z M20 11 V32" {...ICON} />
      </svg>
    ),
  },
]
