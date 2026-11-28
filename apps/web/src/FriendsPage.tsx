// Friends (plans/accounts.md "Friends and chat"): find wizards by name, requests, the list with who's online,
// party invites, and remove, block or report. No text chat (Nov 28: only quick chat, in matches). Live over the
// app's friends socket (friends.ts).
import { useEffect, useState } from 'react'
import { HomeButton } from './HomeCorner'
import { Avatar } from './Avatar'
import { SUGGEST, searchWizards, useMe, type Found } from './account'
import { ProfileView } from './ProfilePage'
import { RankBadge } from './PlayMenu'
import { clearNote, friendsSend, useFriends } from './friends'
import type { FriendInfo, Presence } from './protocol'

const PRESENCE: Record<Presence, string> = { online: 'Online', queue: 'Finding a match', match: 'In a match', offline: 'Offline' }
const ORDER: Record<Presence, number> = { online: 0, queue: 1, match: 2, offline: 3 }

export function FriendsPage({ onHome, onPlay }: { onHome: () => void; onPlay: () => void }) {
  const me = useMe()
  const f = useFriends()
  const [viewing, setViewing] = useState<string | null>(null) // a profile opened from the list or search
  const signedIn = !!me?.account?.username
  const friends = f.list.filter((x) => x.kind === 'friend').sort((a, b) => ORDER[a.presence] - ORDER[b.presence] || a.name.localeCompare(b.name))
  const incoming = f.list.filter((x) => x.kind === 'incoming')
  const outgoing = f.list.filter((x) => x.kind === 'outgoing')
  const blocked = f.list.filter((x) => x.kind === 'blocked')
  const invite = (name: string) => {
    friendsSend({ t: 'invite', name })
    onPlay() // your party is on the Play menu
  }

  return (
    <main className="page info-page friends-page">
      <div className="info-top">
        <h1 className="logo">{viewing ? 'Profile' : 'Friends'}</h1>
        <HomeButton onClick={onHome} />
      </div>
      {f.note && (
        <p className={`friends-note ${f.note.bad ? 'bad' : ''}`} key={f.note.n} onClick={clearNote}>
          {f.note.text}
        </p>
      )}
      {viewing ? (
        <section className="friends">
          <ProfileActions name={viewing} signedIn={signedIn} onBack={() => setViewing(null)} onInvite={invite} />
          <ProfileView name={viewing} onOpen={setViewing} />
        </section>
      ) : !signedIn ? (
        <section className="friends">
          <Search onView={setViewing} />
          <section className="info-card account-card">Sign in to add friends.</section>
        </section>
      ) : (
        <section className="friends">
          <Search onView={setViewing} onAdd={(name) => friendsSend({ t: 'friends', op: 'add', name })} known={f.list} />

          {incoming.length > 0 && (
            <div className="info-card">
              <span className="account-label">Requests</span>
              {incoming.map((x) => (
                <Row key={x.name} f={x} onOpen={() => setViewing(x.name)}>
                  <button className="friends-yes" onClick={() => friendsSend({ t: 'friends', op: 'accept', name: x.name })}>
                    Accept
                  </button>
                  <button onClick={() => friendsSend({ t: 'friends', op: 'decline', name: x.name })}>Decline</button>
                </Row>
              ))}
            </div>
          )}

          <div className="info-card">
            <span className="account-label">Friends {friends.length > 0 && `(${friends.filter((x) => x.presence !== 'offline').length} online)`}</span>
            {friends.length === 0 && <p className="account-note">{f.on ? 'Find a wizard above and add them.' : 'Connecting'}</p>}
            {friends.map((x) => (
              <Row key={x.name} f={x} onOpen={() => setViewing(x.name)}>
                {x.presence === 'online' && <button onClick={() => invite(x.name)}>Invite</button>}
              </Row>
            ))}
          </div>

          {outgoing.length > 0 && (
            <div className="info-card">
              <span className="account-label">Sent</span>
              {outgoing.map((x) => (
                <Row key={x.name} f={x} line="Waiting for them" onOpen={() => setViewing(x.name)}>
                  <button onClick={() => friendsSend({ t: 'friends', op: 'remove', name: x.name })}>Cancel</button>
                </Row>
              ))}
            </div>
          )}

          {blocked.length > 0 && (
            <div className="info-card">
              <span className="account-label">Blocked</span>
              {blocked.map((x) => (
                <Row key={x.name} f={x} line="Blocked">
                  <button onClick={() => friendsSend({ t: 'friends', op: 'unblock', name: x.name })}>Unblock</button>
                </Row>
              ))}
            </div>
          )}
        </section>
      )}
    </main>
  )
}

/** Above a profile: Back, and what you can do with this wizard (add, invite, remove, block, report). */
function ProfileActions({ name, signedIn, onBack, onInvite }: { name: string; signedIn: boolean; onBack: () => void; onInvite: (name: string) => void }) {
  const me = useMe()
  const f = useFriends()
  const [more, setMore] = useState(false)
  const mine = me?.account?.username?.toLowerCase() === name.toLowerCase()
  const known = f.list.find((x) => x.name.toLowerCase() === name.toLowerCase())
  const send = (op: 'add' | 'remove' | 'block') => {
    friendsSend({ t: 'friends', op, name })
    if (op !== 'add') onBack()
  }
  return (
    <>
      <div className="account-row">
        <button className="account-out" onClick={onBack}>
          Back
        </button>
        {signedIn && !mine && !known && (
          <button className="friends-yes" onClick={() => send('add')}>
            Add friend
          </button>
        )}
        {known?.kind === 'friend' && (
          <button className="friends-yes" disabled={known.presence !== 'online'} onClick={() => onInvite(name)}>
            Invite to party
          </button>
        )}
        {signedIn && !mine && (
          <button className="account-out" onClick={() => setMore(!more)} aria-expanded={more}>
            More
          </button>
        )}
      </div>
      {more && (
        <div className="account-row">
          {known?.kind === 'friend' && (
            <button className="account-out" onClick={() => send('remove')}>
              Remove friend
            </button>
          )}
          {known?.kind !== 'blocked' && (
            <button className="account-out" onClick={() => send('block')}>
              Block
            </button>
          )}
          <button
            className="account-out"
            onClick={() => {
              const reason = prompt(`Why are you reporting ${name}?`)
              if (reason !== null) friendsSend({ t: 'friends', op: 'report', name, reason })
            }}
          >
            Report
          </button>
        </div>
      )}
    </>
  )
}

function Row({ f, line, onOpen, children }: { f: FriendInfo; line?: string; onOpen?: () => void; children?: React.ReactNode }) {
  return (
    <div className={`friend-row ${f.kind === 'friend' ? f.presence : ''}`}>
      <button className="friend-who" onClick={onOpen} disabled={!onOpen} aria-label={onOpen ? `${f.name}'s profile` : f.name}>
        <Avatar name={f.name} />
        <span>
          <b>{f.name}</b>
          <small>{line ?? (f.kind === 'friend' ? PRESENCE[f.presence] : 'Wants to be friends')}</small>
        </span>
      </button>
      <div className="friend-acts">{children}</div>
    </div>
  )
}

/** Find a wizard by name: a few suggestions as you type (from 2 letters), the full list (up to 20) on Enter.
 *  Each opens their profile. */
function Search({ onView, onAdd, known = [] }: { onView: (name: string) => void; onAdd?: (name: string) => void; known?: FriendInfo[] }) {
  const me = useMe()
  const [q, setQ] = useState('')
  const [res, setRes] = useState<Found[] | null>(null)
  const [full, setFull] = useState(false) // Enter pressed for this text
  useEffect(() => {
    if (q.trim().length < 2) return setRes(null)
    // Wait for a pause in typing, and drop an answer that's no longer wanted.
    const ctl = new AbortController()
    const t = setTimeout(
      () => {
        searchWizards(q.trim(), full, ctl.signal)
          .then(setRes)
          .catch(() => {})
      },
      full ? 0 : 250,
    )
    return () => {
      clearTimeout(t)
      ctl.abort()
    }
  }, [q, full])
  const mine = me?.account?.username?.toLowerCase()
  const kindOf = (name: string) => known.find((x) => x.name.toLowerCase() === name.toLowerCase())?.kind
  return (
    <div className="friends-search">
      <input value={q} onChange={(e) => (setQ(e.target.value), setFull(false))} onKeyDown={(e) => e.key === 'Enter' && setFull(true)} placeholder="Find a wizard" maxLength={16} aria-label="Find a wizard by name" autoComplete="off" spellCheck={false} enterKeyHint="search" />
      {res && (
        <div className="info-card search-results">
          {res.length === 0 && <p className="account-note">No wizards start with that.</p>}
          {res.map((x) => {
            const kind = kindOf(x.name)
            return (
              <div key={x.name} className="friend-row">
                <button className="friend-who" onClick={() => onView(x.name)} aria-label={`${x.name}'s profile`}>
                  <Avatar name={x.name} />
                  <span>
                    <b>{x.name}</b>
                    <small>{x.name.toLowerCase() === mine ? 'You' : kind === 'friend' ? 'Friend' : kind === 'outgoing' ? 'Request sent' : kind === 'incoming' ? 'Wants to be friends' : 'View profile'}</small>
                  </span>
                  {x.rating !== null && <RankBadge rating={x.rating} size={26} />}
                </button>
                {onAdd && !kind && x.name.toLowerCase() !== mine && (
                  <div className="friend-acts">
                    <button onClick={() => onAdd(x.name)}>Add</button>
                  </div>
                )}
              </div>
            )
          })}
          {!full && res.length >= SUGGEST && <p className="account-note">Press Enter for more.</p>}
        </div>
      )}
    </div>
  )
}
