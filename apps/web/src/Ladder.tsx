import { Children, Fragment, memo, useEffect, useId, useRef, type ReactElement, type ReactNode } from 'react'
import { AI, LADDER, type Bark, type Difficulty } from './battle'
import { ELEMENTS } from './spells'
import { brawlerPortrait, GLOW, GLOW_COLOR } from './portraits'

/** What each practice opponent says (text only): at the start (also its line on the tower), now and then
 *  when its habit kicks in, once when it's low, and when it wins or loses. Written as the character talking,
 *  hinting at its habit instead of explaining it (plans/ai-personalities.md). */
export const CHAT: Record<Difficulty, Record<Exclude<Bark, 'habit'>, string> & { habit: string[] }> = {
  pebble: {
    start: "Eh? A duel? Fine. Just don't expect me to hurry.",
    habit: ['Here comes a big one. Take your time.', 'Slow and heavy. Always worked for me.'],
    low: 'Oof. My back.',
    win: 'Told you. No hurry.',
    lose: 'Ha! You saw them coming, didn\'t you.',
  },
  ember: {
    start: "Wanna see my lightning? Here's my lightning! And again! And...",
    habit: ['Zap! Zap zap!', 'More lightning! Why would I stop?'],
    low: 'Wait, why is it getting weaker?',
    win: 'Zap zap zap! Again, again!',
    lose: "Okay okay, my lightning runs out. Don't tell anyone.",
  },
  frost: {
    start: "Cold hands, sorry. You'll feel the next part more.",
    habit: ['Just a little chill.', 'There. Now the real one.'],
    low: 'How rude.',
    win: 'Do wear a scarf next time.',
    lose: 'You waited for the big one. Clever.',
  },
  cleric: {
    start: "I'll patch you up after. Probably.",
    habit: ["Hold still, this won't hurt much.", 'A little of everything today.'],
    low: 'Pardon me. I need a moment. And a heal.',
    win: "Come back anytime. I'll have bandages ready.",
    lose: 'Right between my heals. Well done.',
  },
  hexer: {
    start: "Don't mind the mark. Mind what comes after it.",
    habit: ['There. Marked.', 'Cursed already? Perfect.'],
    low: "You're quicker than you look.",
    win: "Should've shaken off that curse, dear.",
    lose: 'You never let the curse sit. Annoying.',
  },
  tide: {
    start: 'Go on. You first. I insist.',
    habit: ['Patience.', 'Hm. I expected that one.'],
    low: 'Ah. You switched late.',
    win: 'You moved first. You always move first.',
    lose: 'Quick little spells. I could not catch them.',
  },
  zealot: {
    start: "You looked right at me. Shame you couldn't see a thing.",
    habit: ['Now you see me.', 'Guess.'],
    low: "...You're watching my timing.",
    win: 'Never saw it coming. Literally.',
    lose: 'Fine. You can stop staring now.',
  },
  warden: {
    start: "A long spell? Bold. Let's see if you finish it.",
    habit: ['Pencils down.', 'That drawing? Incomplete.'],
    low: 'Short spells. Hmph. Acceptable.',
    win: 'Too slow. See me after class.',
    lose: 'You kept it short. Passing grade.',
  },
  adept: {
    start: 'Top of my class. Ask me anything.',
    habit: ['Page forty-two.', 'Read the letters, if you can.'],
    low: "This wasn't in the book.",
    win: 'Study harder.',
    lose: 'You read my letters. Nobody reads my letters.',
  },
  magus: {
    start: "Slip once. That's all I need.",
    habit: ['There it is.', 'Thank you.'],
    low: 'No mistakes? Really?',
    win: 'One slip. Like I said.',
    lose: 'Clean. Not a single opening.',
  },
  archmage: {
    start: "Who am I today? Haven't decided. Neither will you.",
    habit: ['New me!', 'Bored. Changing.'],
    low: 'You keep keeping up.',
    win: "Couldn't keep track of me, could you.",
    lose: 'You changed when I changed. Rude.',
  },
  lich: {
    start: "Show me your favorite spell. I'll remember it.",
    habit: ['Your favorite again?', 'I remember this one.'],
    low: "Oh. You've changed.",
    win: 'Same spell, same answer.',
    lose: 'You never showed me a favorite. Clever.',
  },
  ascendant: {
    start: "I've watched every duel in this tower. Yours too.",
    habit: ['I know this one.', "You've done that before."],
    low: "Hm. You've grown.",
    win: 'Come back when you can surprise me.',
    lose: "You surprised me. That doesn't happen.",
  },
}
/** The line for a bark (habit: one of its lines at random). */
export const chatLine = (d: Difficulty, key: Bark) => (key === 'habit' ? CHAT[d].habit[Math.floor(Math.random() * CHAT[d].habit.length)] : CHAT[d][key])
/** One tip per rung, shown when you lose to it. */
export const TIP: Record<Difficulty, string> = {
  pebble: 'Watch its element while it charges, then counter before it throws.',
  ember: 'Parry its lights. Its Lightning wears down fast, then punish.',
  frost: 'When you are chilled, its next hit is the big one. Parry or counter that one.',
  cleric: 'Hit hard between its heals, and counter the heal itself.',
  hexer: 'When Doomed, throw anything fast. Do not sit cursed while it can Execute.',
  tide: 'Switch elements late, or use lights. They are too quick to counter.',
  zealot: 'You cannot see its spell. Watch its timing and be ready to parry.',
  warden: 'Do not start a big drawing while it is ready. Mix in quick spells.',
  adept: 'Read its combo letters and answer with the combo counterspell.',
  magus: 'Play clean. A stun, a whiff or a fizzle hands it a big spell.',
  archmage: 'When its style changes, change your answer.',
  lich: 'Mix your elements. It learns your favorite and waits for it.',
  ascendant: 'It answers whatever you lean on. Vary everything.',
}
/** The badges: read from the bot itself (battle.ts AI), so they can't drift from what it really throws.
 *  Its attack elements, plus Angelic if it heals or casts Aegis, plus Unholy if it casts any curse. */
const UNHOLY = ['scythe', 'veil', 'blade']
function elsOf(id: Difficulty) {
  const a = AI[id]
  const magic = a.magic ?? ['aegis', ...UNHOLY]
  const els = [...(a.els ?? ['F', 'I', 'W', 'E', 'L'])]
  if (a.healBelow > 0 || magic.includes('aegis')) els.push('A')
  if (magic.some((m) => UNHOLY.includes(m))) els.push('U')
  return els
}

/** Three tiers (Nov 24): Apprentice teaches one mechanic per floor, Adept adds one system per floor, Master
 *  is the full kit, sharper each floor, with one headline trait shown on its floor. */
type Tier = 'apprentice' | 'adept' | 'master'
const tierOf = (rung: number): Tier => (rung <= 4 ? 'apprentice' : rung <= 9 ? 'adept' : 'master')
const TIER_NAME: Record<Tier, string> = { apprentice: 'Apprentice', adept: 'Adept', master: 'Master' }
const TRAIT: Partial<Record<Difficulty, string>> = { magus: 'Punisher', archmage: 'Shapeshifter', lich: 'Mirror', ascendant: 'Final exam' }

const C = (el: string) => ELEMENTS[el].color
const INK = '#1d1b2e'

/** Glow look: the badge stays put, everything drawn on it glows in the rung's color. */
function GlowParts({ id }: { id: Difficulty }) {
  const parts = Children.toArray((brawlerPortrait(id) as ReactElement<{ children: ReactNode }>).props.children)
  const c = GLOW_COLOR[id]
  const f = useId()
  return (
    <>
      <defs>
        <filter id={f} x="-60%" y="-60%" width="220%" height="220%">
          <feGaussianBlur in="SourceAlpha" stdDeviation="2.4" result="b" />
          <feFlood floodColor={c} />
          <feComposite in2="b" operator="in" result="g" />
          <feMerge>
            <feMergeNode in="g" />
            <feMergeNode in="g" />
            <feMergeNode in="g" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>
      {parts[0]}
      <g filter={`url(#${f})`}>{parts.slice(1)}</g>
    </>
  )
}

/** A portrait for each rung (see portraits.tsx for the style). */
export const Portrait = memo(function Portrait({ id }: { id: Difficulty }) {
  return (
    <svg className="portrait" viewBox="0 0 48 48" aria-hidden="true">
      {GLOW ? <GlowParts id={id} /> : brawlerPortrait(id)}
    </svg>
  )
})

/** The practice ladder as a cut-away wizard tower: each floor a room with the bot in its window, tier bands
 *  between the tiers, Pebble at the door, Ascendant in the crowned top room. */
export const Tower = memo(function Tower({ value, onPick }: { value: Difficulty; onPick: (d: Difficulty) => void }) {
  const box = useRef<HTMLDivElement>(null)
  // A thumb that lands on a floor and then scrolls the tower must not pick that floor: a tap only counts if
  // the finger barely moved and the tower didn't scroll in between.
  const down = useRef<{ x: number; y: number; top: number } | null>(null)
  const pressed = (e: React.PointerEvent) => {
    down.current = { x: e.clientX, y: e.clientY, top: box.current?.scrollTop ?? 0 }
  }
  const tapped = (e: React.MouseEvent, id: Difficulty) => {
    const d = down.current
    down.current = null
    if (d && e.detail > 0 && (Math.hypot(e.clientX - d.x, e.clientY - d.y) > 10 || Math.abs((box.current?.scrollTop ?? 0) - d.top) > 4)) return
    onPick(id)
  }
  // Keep the chosen floor in view (the tower scrolls; it starts at the bottom).
  useEffect(() => {
    const show = () => box.current?.querySelector('.floor.active')?.scrollIntoView({ block: 'nearest' })
    show()
    // The tower changed size (a phone rotated, the layout reflowed): bring the chosen floor back into view.
    const ro = new ResizeObserver(() => requestAnimationFrame(show))
    if (box.current) ro.observe(box.current)
    return () => ro.disconnect()
  }, [value])
  return (
    <div className="tower-wrap">
      {/* The roof keeps its shape at any width (no stretching): a fixed pitch, eaves past the walls, a star on top. */}
      <svg className="spire" viewBox="0 0 220 46" aria-hidden="true">
        <path d="M4 44 L110 5 L216 44 Z" fill="var(--tower-roof)" stroke={INK} strokeWidth="3" strokeLinejoin="round" />
        <path d="M40 35 L110 9.5 L180 35" fill="none" stroke="#8a6fd0" strokeWidth="2.5" strokeLinecap="round" opacity="0.7" />
        <path d="M110 17 l3.5 7.5 8 .8 -6 5.4 1.8 7.9 -7.3 -4.2 -7.3 4.2 1.8 -7.9 -6 -5.4 8 -.8z" fill="#ffd24d" stroke={INK} strokeWidth="2" strokeLinejoin="round" />
      </svg>
      <div className="tower" ref={box}>
        {[...LADDER].reverse().map((b, i, all) => {
          const rung = LADDER.indexOf(b) + 1
          const tier = tierOf(rung)
          const band = i === 0 || tierOf(LADDER.indexOf(all[i - 1]) + 1) !== tier
          const els = elsOf(b.id)
          return (
            <Fragment key={b.id}>
              {band && (
                <div className={`tier-band ${tier}`} aria-hidden="true">
                  <span>{TIER_NAME[tier]}</span>
                </div>
              )}
              <button className={`floor ${tier} ${value === b.id ? 'active' : ''} ${rung === LADDER.length ? 'top' : ''}`} onPointerDown={pressed} onClick={(e) => tapped(e, b.id)}>
                <span className="rung">{rung}</span>
                <span className="window">
                  <Portrait id={b.id} />
                </span>
                <span className="floor-text">
                  <span className="floor-name">{b.name}</span>
                  {TRAIT[b.id] && <span className="trait">{TRAIT[b.id]}</span>}
                </span>
                <span className="els">
                  {els.length >= 7 ? (
                    <i className="all" style={{ background: `linear-gradient(90deg, ${els.map(C).join(', ')})` }} title="All elements" />
                  ) : (
                    els.map((el) => <i key={el} style={{ background: C(el) }} title={ELEMENTS[el].name} />)
                  )}
                </span>
              </button>
            </Fragment>
          )
        })}
        <div className="tower-door" aria-hidden="true" />
      </div>
      <span className="sub-line tower-quote">&ldquo;{CHAT[value].start}&rdquo;</span>
    </div>
  )
})
