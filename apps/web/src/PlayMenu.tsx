// Play (was Duel): Casual, Ranked, Custom. Custom is the room codes as before; Casual and Ranked are the queues
// (plans/accounts.md "Matchmaking", mockup 4). Memoized: the page behind redraws every UI tick.
import { memo, useEffect, useState } from 'react'
import type { OnlineArena, Queue } from './online'
import type { PartyInfo } from './protocol'
import { dismissInvite, useFriends } from './friends'
import { useMe, type Standing } from './account'
import { PLACEMENTS, RANKED_UNLOCK, TIERS, rankOf } from './ranks'
import { Avatar } from './Avatar'

export type PlayTab = 'casual' | 'ranked' | 'custom'
const TAB_KEY = 'play-tab'
const TABS: { id: PlayTab; name: string }[] = [
  { id: 'casual', name: 'Casual' },
  { id: 'ranked', name: 'Ranked' },
  { id: 'custom', name: 'Custom' },
]

function savedTab(): PlayTab {
  try {
    const t = localStorage.getItem(TAB_KEY)
    return t === 'ranked' || t === 'custom' ? t : 'casual'
  } catch {
    return 'casual'
  }
}

/** Props are all stable (the arena, a state setter, a ref-backed callback) or change only on input, so the
 *  page's UI tick never redraws this. */
export const PlayMenu = memo(function PlayMenu(props: {
  arena: OnlineArena | null
  joinCode: string
  setJoinCode: (c: string) => void
  onSignIn?: () => void
  queue: Queue // changes only when the server says so
  onFind: (mode: 'casual' | 'ranked', size: '1v1' | '2v2') => void
  you: string | null // your name as others see it (a guest's is "Guest48213")
  party: PartyInfo | null // changes only when the server says so
}) {
  const { arena, joinCode, setJoinCode, onSignIn, queue, onFind, you, party } = props
  // While searching or answering a match: its own timer (the page behind doesn't redraw this).
  const [, tick] = useState(0)
  useEffect(() => {
    if (queue.state === 'off') return
    const id = setInterval(() => tick((n) => n + 1), 250)
    return () => clearInterval(id)
  }, [queue.state])
  const [tab, setTab] = useState<PlayTab>(savedTab)
  const [picked, setSize] = useState<'1v1' | '2v2'>('1v1')
  const size = party && party.members.length > 1 ? '2v2' : picked // a party of 2 plays 2v2
  if (queue.state === 'found') return <MatchFound queue={queue} arena={arena} />
  const pick = (t: PlayTab) => {
    setTab(t)
    try {
      localStorage.setItem(TAB_KEY, t)
    } catch {
      /* fine */
    }
  }
  return (
    <div className="play-menu">
      <div className="play-tabs" role="tablist" aria-label="Game type">
        {TABS.map((t) => (
          <button key={t.id} role="tab" aria-selected={tab === t.id} className={tab === t.id ? 'on' : ''} onClick={() => pick(t.id)}>
            {t.name}
          </button>
        ))}
      </div>
      {tab === 'custom' ? (
        <div className="play-panel" role="tabpanel">
          <b className="lobby-title">Custom game</b>
          <div className="lobby-join">
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
            <span className="sub-line">or</span>
            <button onClick={() => arena?.create()}>Create room</button>
          </div>
        </div>
      ) : (
        <>
          <QueuePanel ranked={tab === 'ranked'} size={size} setSize={setSize} onSignIn={onSignIn} queue={queue} arena={arena} onFind={onFind} you={you} party={party} />
          <PartyPanel party={party} arena={arena} />
        </>
      )}
    </div>
  )
})

const clockText = (ms: number) => {
  const s = Math.floor(ms / 1000)
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

/** Everyone has ACCEPT time to say yes (mockup 5). 2v2: your team on the left. */
function MatchFound({ queue, arena }: { queue: Extract<Queue, { state: 'found' }>; arena: OnlineArena | null }) {
  const me = useMe()
  const left = Math.max(0, queue.endsAt - performance.now())
  const allies = queue.others.filter((o) => o.ally)
  const foes = queue.others.filter((o) => !o.ally)
  const card = (key: string, avatarName: string | null, name: string, ok: boolean) => (
    <span key={key}>
      <Avatar name={avatarName} />
      <b>{name}</b>
      <small>{ok ? 'Accepted' : 'Waiting'}</small>
    </span>
  )
  return (
    <div className="play-menu">
      <div className="match-found" role="alertdialog" aria-label="Match found">
        <b className="lobby-title">Match found!</b>
        <div className={`match-vs ${foes.length > 1 ? 'two' : ''}`}>
          <div className="match-team">
            {card('you', me?.account?.username ?? null, 'You', queue.you)}
            {allies.map((o, i) => card(`a${i}`, o.name, o.name ?? 'A guest', o.accepted))}
          </div>
          <b className="match-vs-mark">VS</b>
          <div className="match-team">{foes.map((o, i) => card(`f${i}`, o.name, o.name ?? 'A guest', o.accepted))}</div>
        </div>
        <div className="match-bar" aria-hidden="true">
          <i style={{ width: `${(left / 10000) * 100}%` }} />
        </div>
        {queue.you ? (
          <p className="play-line">Waiting for everyone to accept. {Math.ceil(left / 1000)} s left.</p>
        ) : (
          <div className="match-buttons">
            <button className="match-decline" onClick={() => arena?.declineMatch()}>
              Decline
            </button>
            <button className="match-accept" onClick={() => arena?.acceptMatch()}>
              Accept
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

/** Your party: make one and share its code, or join a friend's. The leader finds 2v2 matches for both. */
function PartyPanel({ party, arena }: { party: PartyInfo | null; arena: OnlineArena | null }) {
  const [code, setCode] = useState('')
  // A friend's invite (friends.ts): one tap to join their party.
  const { invite } = useFriends()
  const invited = invite && invite.code !== party?.code ? (
    <div className="invite-line">
      <span>
        <b>{invite.from}</b> invited you to their party.
      </span>
      <div className="account-row">
        <button className="friends-yes" onClick={() => (arena?.joinParty(invite.code), dismissInvite())}>
          Join
        </button>
        <button className="account-out" onClick={dismissInvite}>
          Not now
        </button>
      </div>
    </div>
  ) : null
  if (!party)
    return (
      <div className="play-panel party-panel">
        <b className="party-title">Party</b>
        {invited}
        <p className="play-line dim">Play 2v2 with a friend.</p>
        <div className="lobby-join">
          <form
            className="row"
            onSubmit={(e) => {
              e.preventDefault()
              arena?.joinParty(code)
            }}
          >
            <input className="code-input" value={code} maxLength={4} placeholder="CODE" autoCapitalize="characters" autoComplete="off" autoCorrect="off" spellCheck={false} enterKeyHint="go" aria-label="Party code" onChange={(e) => setCode(e.target.value.toUpperCase())} />
            <button type="submit" disabled={code.length !== 4}>
              Join
            </button>
          </form>
          <span className="sub-line">or</span>
          <button onClick={() => arena?.makeParty()}>Make a party</button>
        </div>
      </div>
    )
  return (
    <div className="play-panel party-panel">
      <b className="party-title">Party</b>
      {invited}
      <div className="party-members">
        {party.members.map((m, i) => (
          <span key={i} className={`party-member ${m.here ? '' : 'away'}`}>
            <Avatar name={m.name} />
            <b>{m.you ? 'You' : m.name}</b>
            <small>{!m.here ? 'Offline' : m.leader ? 'Leader' : 'Member'}</small>
          </span>
        ))}
      </div>
      {party.members.length < 2 && (
        <p className="play-line">
          Share this code with a friend: <b className="party-code">{party.code}</b>
        </p>
      )}
      <button className="play-cancel" onClick={() => arena?.leaveParty()}>
        Leave party
      </button>
    </div>
  )
}

/** A tier badge (Nov 28): a rune sigil, picked over the shield ("Breaking the seal", plans/mockups/rank-sigils.html).
 *  Inside: a magic circle in the tier's color whose shape gains a side each tier (triangle, square, pentagon,
 *  hexagon, octagon), an inner ring from Apprentice, runes from Mage. Outside, the climb shows as points breaking
 *  out of the circle: 4 small (Apprentice), 4 long (Mage), 8 (High Mage), 16 in two lengths (Archmage). The
 *  division (1-3) is that many marks at the top. Before placement: a dashed grey circle. No animation. */
export function RankBadge({ rating, size = 34 }: { rating: number | null; size?: number }) {
  const r = rating === null ? null : rankOf(rating)
  const ink = '#15132e'
  const C = 50
  if (!r)
    return (
      <svg className="rank-badge" width={size} height={size} viewBox="0 0 100 100" aria-hidden="true">
        <circle cx={C} cy={C} r="30" fill={ink} stroke="#8a87c0" strokeWidth="5" strokeDasharray="8 7" />
        <circle cx={C} cy={C} r="5" fill="#8a87c0" />
      </svg>
    )
  const t = TIERS.findIndex((x) => x.name === r.tier)
  const pt = (a: number, rad: number) => [C + rad * Math.cos(a), C + rad * Math.sin(a)]
  const path = (ps: number[][]) => ps.map(([x, y], k) => `${k ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)}`).join(' ') + ' Z'
  const sides = [3, 4, 5, 6, 8][t]
  const shape = path(Array.from({ length: sides }, (_, k) => pt(-Math.PI / 2 + (k * 2 * Math.PI) / sides, 17)))
  // Points breaking out of the circle: [count, outer radius, half width (radians), turn].
  const all: [number, number, number, number][][] = [
    [],
    [[4, 37, 0.12, -Math.PI / 4]],
    [[4, 42, 0.14, -Math.PI / 2]],
    [[8, 43, 0.1, -Math.PI / 2]],
    [[8, 39, 0.12, -Math.PI / 2 + Math.PI / 8], [8, 48, 0.1, -Math.PI / 2]],
  ]
  const sets = all[t]
  const spikes = sets.flatMap(([n, out, w, turn]) =>
    Array.from({ length: n }, (_, k) => {
      const a = turn + (k * 2 * Math.PI) / n
      return path([pt(a - w, 30), pt(a, out), pt(a + w, 30)])
    }),
  )
  const runes = t >= 2 ? Array.from({ length: 8 }, (_, k) => pt(Math.PI / 8 + (k * Math.PI) / 4, 26)) : [] // off the top, where the division marks go
  const marks = Array.from({ length: r.division }, (_, k) => (k - (r.division - 1) / 2) * 0.26)
  return (
    <svg className="rank-badge" width={size} height={size} viewBox="0 0 100 100" aria-hidden="true">
      {spikes.map((d, k) => (
        <path key={k} d={d} fill={r.color} stroke={ink} strokeWidth="2" strokeLinejoin="round" />
      ))}
      <circle cx={C} cy={C} r="30" fill={ink} stroke={r.color} strokeWidth="5" />
      {t >= 1 && <circle cx={C} cy={C} r="22" fill="none" stroke={r.color} strokeWidth="2.5" />}
      <path d={shape} fill="none" stroke={r.color} strokeWidth="3.2" strokeLinejoin="round" />
      {runes.map(([x, y], k) => (
        <circle key={k} cx={x} cy={y} r={t >= 4 ? 2.8 : 2} fill={r.color} />
      ))}
      <circle cx={C} cy={C} r={4 + t} fill={r.color} />
      {marks.map((a, k) => {
        const [x1, y1] = [C + 20 * Math.sin(a), C - 20 * Math.cos(a)]
        const [x2, y2] = [C + 26 * Math.sin(a), C - 26 * Math.cos(a)]
        return <line key={k} x1={x1} y1={y1} x2={x2} y2={y2} stroke="#fffaf0" strokeWidth="3.2" strokeLinecap="round" />
      })}
    </svg>
  )
}

/** Your Ranked line: the tier and rating, or placements, or what's still needed to unlock it. */
function standingText(s: Standing | null | undefined, size: '1v1' | '2v2' = '1v1') {
  if (!s) return { title: `Ranked ${size}`, line: '' }
  if (s.casualPlayed < RANKED_UNLOCK) return { title: 'Locked', line: `Play ${RANKED_UNLOCK} Casual matches to unlock Ranked (${s.casualPlayed} of ${RANKED_UNLOCK}).` }
  if (s.games < PLACEMENTS || s.rating === null) return { title: `Placement ${s.games} of ${PLACEMENTS}`, line: 'Your rank shows after your placement matches.' }
  return { title: rankOf(s.rating).label, line: `${s.rating.toLocaleString()} rating` }
}

/** After a Ranked match: the change, your tier, and how far to the next division (mockup 6). */
export const RatedCard = memo(function RatedCard({ rated }: { rated: { before: number; after: number; games: number; won: boolean } }) {
  const diff = rated.after - rated.before
  const placing = rated.games < PLACEMENTS
  const r = rankOf(rated.after)
  return (
    <div className="rated-card">
      {placing ? (
        <b className="rated-title">Placement {rated.games} of {PLACEMENTS}</b>
      ) : (
        <span className="rated-tier">
          <RankBadge rating={rated.after} size={40} />
          <b className="rated-title">{r.label}</b>
        </span>
      )}
      <b className={`rated-diff ${diff >= 0 ? 'up' : 'down'}`}>{diff >= 0 ? `+${diff}` : diff}</b>
      <span className="play-line dim">
        {placing
          ? `${PLACEMENTS - rated.games} more to see your rank.`
          : r.next
            ? `${rated.after.toLocaleString()} rating. ${r.next - rated.after} more to the next division.`
            : `${rated.after.toLocaleString()} rating. The top division.`}
      </span>
    </div>
  )
})

function QueuePanel(props: { ranked: boolean; size: '1v1' | '2v2'; setSize: (s: '1v1' | '2v2') => void; onSignIn?: () => void; queue: Queue; arena: OnlineArena | null; onFind: (mode: 'casual' | 'ranked', size: '1v1' | '2v2') => void; you: string | null; party: PartyInfo | null }) {
  const { ranked, size, setSize, onSignIn, queue, arena, onFind, you, party } = props
  const duo = !!party && party.members.length > 1
  const follower = duo && !party.members.find((m) => m.you)?.leader
  const me = useMe()
  const mine = size === '2v2' ? me?.ranked2 : me?.ranked
  const account = me?.account?.username ? me.account : null
  const locked = ranked && (me?.ranked?.casualPlayed ?? 0) < RANKED_UNLOCK
  // Ranked needs an account (plans/accounts.md); guests get a way in instead of a dead button.
  if (ranked && !account)
    return (
      <div className="play-panel" role="tabpanel">
        <b className="lobby-title">Ranked</b>
        <p className="play-line">Sign in to play Ranked and keep a rating.</p>
        {me?.on && onSignIn ? <button className="play-find" onClick={onSignIn}>Sign in</button> : <p className="play-line dim">Accounts aren't on for this server.</p>}
      </div>
    )
  return (
    <div className="play-panel" role="tabpanel">
      <div className="play-sizes" role="radiogroup" aria-label="Match size">
        {(['1v1', '2v2'] as const).map((s) => (
          <button key={s} role="radio" aria-checked={size === s} className={size === s ? 'on' : ''} disabled={duo && s === '1v1'} onClick={() => setSize(s)}>
            <b>{s}</b>
            <small>{ranked ? standingText(s === '1v1' ? me?.ranked : me?.ranked2, s).title : s === '1v1' ? 'You against one wizard' : 'You and a teammate'}</small>
          </button>
        ))}
      </div>
      <div className="play-you">
        {ranked ? <RankBadge rating={mine && mine.games >= PLACEMENTS ? mine.rating : null} size={40} /> : null}
        <Avatar name={account?.username ?? you} />
        <span>
          <b>{account?.username ?? you ?? 'Guest'}</b>
          <small>{size === '2v2' && !duo ? 'Solo: you get a teammate' : ranked ? standingText(mine, size).title : `Casual ${size}${account ? '' : ' against other guests'}`}</small>
        </span>
      </div>
      {queue.state === 'searching' && queue.mode === (ranked ? 'ranked' : 'casual') && queue.size === size ? (
        <div className="play-searching">
          <b className="play-clock">{clockText(performance.now() - queue.since)}</b>
          <p className="play-line">{ranked ? `Finding a Ranked ${size} near your rating` : `Finding a Casual ${size}`}</p>
          <button className="play-cancel" onClick={() => arena?.cancelMatch()}>
            Cancel
          </button>
        </div>
      ) : (
        <>
          <button className="play-find" disabled={locked || follower || queue.state === 'searching'} onClick={() => onFind(ranked ? 'ranked' : 'casual', size)}>
            Find match
          </button>
          <p className="play-line dim">
            {queue.state === 'off' && queue.note
              ? queue.note
              : follower
                ? 'Your party leader finds matches.'
                : queue.state === 'searching'
                  ? `You're in the ${queue.mode === 'ranked' ? 'Ranked' : 'Casual'} ${queue.size} queue.`
                  : ranked && standingText(mine, size).line
                    ? standingText(mine, size).line
                    : 'Your camera turns on when the match starts.'}
          </p>
        </>
      )}
    </div>
  )
}
