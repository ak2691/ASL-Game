// A wizard's profile (mockup 7 in plans/mockups/accounts.html): rank, casting stats, record, Tower, recent
// matches. Nov 28: no badges, no cast speeds (they depend on the spell), and no favorite element or spell (it would
// tell opponents what you like to throw). Public: opponents' names in Recent matches open their profiles.
import { useEffect, useState } from 'react'
import { Avatar } from './Avatar'
import { RankBadge } from './PlayMenu'
import { loadProfile, type Profile } from './account'
import { PLACEMENTS, rankOf } from './ranks'

const pct = (x: number | null) => (x == null ? 'None yet' : `${Math.round(x * 100)}%`)
const MODES: Record<string, string> = { ranked: 'Ranked', casual: 'Casual', custom: 'Custom' }

export function ProfileView({ name, onOpen }: { name: string; onOpen: (name: string) => void }) {
  const [p, setP] = useState<Profile | string | null>(null)
  useEffect(() => {
    let live = true
    setP(null)
    loadProfile(name).then((r) => live && setP(r))
    return () => {
      live = false
    }
  }, [name])
  if (!p) return <section className="info-card account-card">Loading</section>
  if (typeof p === 'string') return <section className="info-card account-card account-error">{p}</section>

  const c = p.casting
  const rec = (r: { wins: number; losses: number }) => `${r.wins} W ${r.losses} L`
  const all = p.record.ranked.wins + p.record.ranked.losses + p.record.casual.wins + p.record.casual.losses
  const wins = p.record.ranked.wins + p.record.casual.wins
  return (
    <section className="profile">
      <div className="profile-head">
        <Avatar name={p.username} />
        <div>
          <h2 className="profile-name">{p.username}</h2>
          <p className="account-note">Wizard since {new Date(p.since).toLocaleDateString(undefined, { month: 'short', year: 'numeric' })}</p>
        </div>
      </div>
      <RankCard title="Ranked 1v1" r={p.ranked} />
      {p.ranked2.games > 0 && <RankCard title="Ranked 2v2" r={p.ranked2} />}

      <div className="info-card">
        <span className="account-label">Spellcasting</span>
        <Stat k="Drawings that read right" v={pct(c.readRate)} />
        <Stat k="Spells cast" v={String(c.casts)} />
        <Stat k="Parries landed" v={String(c.parries)} />
        <Stat k="Stuns landed" v={String(c.silences)} />
      </div>

      <div className="info-card">
        <span className="account-label">Record</span>
        <Stat k="Ranked" v={rec(p.record.ranked)} />
        <Stat k="Casual" v={rec(p.record.casual)} />
        <Stat k="Win rate" v={all ? pct(wins / all) : 'None yet'} />
        <Stat k="Best win streak" v={String(p.record.bestStreak)} />
        <Stat k="Tower wizards beaten" v={`${p.towerBeaten} of ${p.towerTotal}`} />
      </div>

      <div className="info-card">
        <span className="account-label">Recent matches</span>
        {p.recent.length === 0 && <p className="account-note">No online matches yet.</p>}
        {p.recent.map((m) => (
          <div key={m.id} className="profile-match">
            <b className={m.won ? 'win' : 'loss'}>{m.won ? 'W' : 'L'}</b>
            <span>
              {MODES[m.mode] ?? m.mode} {m.size} vs{' '}
              {m.foes.map((f, i) => (
                <span key={i}>
                  {i > 0 && ' and '}
                  {f.guest ? f.name : <NameLink name={f.name} onOpen={onOpen} />}
                </span>
              ))}
              {m.mates.length > 0 && (
                <small className="account-note">
                  With{' '}
                  {m.mates.map((f, i) => (
                    <span key={i}>
                      {i > 0 && ' and '}
                      {f.guest ? f.name : <NameLink name={f.name} onOpen={onOpen} />}
                    </span>
                  ))}
                </small>
              )}
            </span>
            {m.change !== null && <b className={m.change >= 0 ? 'win' : 'loss'}>{m.change >= 0 ? `+${m.change}` : m.change}</b>}
          </div>
        ))}
      </div>
    </section>
  )
}

function Stat({ k, v, color }: { k: string; v: string; color?: string }) {
  return (
    <div className="profile-stat">
      <span>{k}</span>
      <b style={color ? { color } : undefined}>{v}</b>
    </div>
  )
}

function RankCard({ title, r }: { title: string; r: Profile['ranked'] }) {
  const placed = r.rating !== null && r.games >= PLACEMENTS
  return (
    <div className="info-card profile-rank">
      <RankBadge rating={placed ? r.rating : null} size={48} />
      <div>
        <span className="account-label">{title}</span>
        {placed ? (
          <>
            <b className="profile-tier" style={{ color: rankOf(r.rating!).color }}>
              {rankOf(r.rating!).label}
            </b>
            <p className="account-note">
              Rating {r.rating}
              {r.peak ? `, peak ${rankOf(r.peak).label}` : ''}
            </p>
          </>
        ) : (
          <p className="account-note">
            Placement {Math.min(r.games, PLACEMENTS)} of {PLACEMENTS}
          </p>
        )}
      </div>
    </div>
  )
}

/** A player's name in a match line: opens their profile, and wraps like the text around it. */
function NameLink({ name, onOpen }: { name: string; onOpen: (name: string) => void }) {
  return (
    <a
      className="profile-link"
      href={`#${encodeURIComponent(name)}`}
      onClick={(e) => {
        e.preventDefault()
        onOpen(name)
      }}
    >
      {name}
    </a>
  )
}
