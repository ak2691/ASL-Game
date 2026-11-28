// Sign in (Google), then "Make your wizard" (a name) the first time, then your profile.
// Mockups 1 and 2 in plans/mockups/accounts.html.
import { useState } from 'react'
import { HomeButton } from './HomeCorner'
import { ProfileView } from './ProfilePage'
import { devSignIn, saveProfile, signOut, useMe } from './account'

const NAME_RE = /^[A-Za-z0-9_]{3,16}$/

export function AccountPage({ onHome }: { onHome: () => void }) {
  const me = useMe()
  // The provider sent them back with an error (?signin=failed): say so once.
  const [failed] = useState(() => {
    const p = new URLSearchParams(location.search)
    if (!p.has('signin')) return false
    history.replaceState(null, '', location.pathname)
    return true
  })
  const account = me?.account
  // Signed in with a name: your profile first (Edit opens the name form); opponents' names open theirs.
  const [editing, setEditing] = useState(false)
  const [viewing, setViewing] = useState<string | null>(null)
  const ready = !!account?.username
  const title = !account ? 'Sign in' : !ready ? 'Make your wizard' : viewing ? 'Profile' : editing ? 'Edit wizard' : 'Your profile'
  return (
    <main className="page info-page account-page">
      <div className="info-top">
        <h1 className="logo">{title}</h1>
        <HomeButton onClick={onHome} />
      </div>
      {!me ? null : !me.on ? (
        <section className="info-card">Accounts aren't available on this server. Everything else works as a guest.</section>
      ) : !account ? (
        <SignIn failed={failed} onHome={onHome} />
      ) : !ready || editing ? (
        <>
          <WizardForm key={account.id} first={!ready} onDone={onHome} />
          {ready && (
            <button className="account-out profile-back" onClick={() => setEditing(false)}>
              Back to profile
            </button>
          )}
        </>
      ) : (
        <>
          <div className="account-row profile-actions">
            {viewing ? (
              <button className="account-out" onClick={() => setViewing(null)}>
                Your profile
              </button>
            ) : (
              <button className="account-out" onClick={() => setEditing(true)}>
                Edit wizard
              </button>
            )}
          </div>
          <ProfileView name={viewing ?? account.username!} onOpen={(n) => setViewing(n.toLowerCase() === account.username!.toLowerCase() ? null : n)} />
        </>
      )}
    </main>
  )
}

function SignIn({ failed, onHome }: { failed: boolean; onHome: () => void }) {
  const me = useMe()!
  const [devName, setDevName] = useState('Tester')
  const [err, setErr] = useState<string | null>(null)
  return (
    <section className="info-card account-card">
      <p className="account-lead">Sign in for Ranked, a profile, friends, and your progress on every device.</p>
      {failed && <p className="account-error">Sign-in didn't finish. Try again.</p>}
      {/* Full page visits: the provider's sign-in page, then back here with a session cookie. */}
      <a className={`signin-btn google ${me.signIn.google ? '' : 'off'}`} href={me.signIn.google ? '/auth/google' : undefined} aria-disabled={!me.signIn.google}>
        <svg viewBox="0 0 48 48" aria-hidden="true">
          <path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9 3.5l6.7-6.7C35.6 2.4 30.2 0 24 0 14.6 0 6.6 5.4 2.6 13.3l7.8 6C12.3 13.6 17.7 9.5 24 9.5z" />
          <path fill="#4285F4" d="M46.5 24.5c0-1.6-.1-3.1-.4-4.5H24v9h12.7c-.6 3-2.3 5.5-4.8 7.2l7.5 5.8c4.4-4 7.1-10 7.1-17.5z" />
          <path fill="#FBBC05" d="M10.4 28.7c-.5-1.4-.8-3-.8-4.7s.3-3.2.8-4.7l-7.8-6C.9 16.6 0 20.2 0 24s.9 7.4 2.6 10.7l7.8-6z" />
          <path fill="#34A853" d="M24 48c6.5 0 11.9-2.1 15.9-5.8l-7.5-5.8c-2.1 1.4-4.8 2.3-8.4 2.3-6.3 0-11.7-4.1-13.6-9.8l-7.8 6C6.6 42.6 14.6 48 24 48z" />
        </svg>
        Continue with Google
      </a>
      {/* Google only for now (Nov 28); Discord comes back once its sign-in is set up. */}
      {!me.signIn.google && <p className="account-note">Sign-in isn't set up on this server yet.</p>}
      <p className="account-note">No password to remember. We only get your name and email, and never show the email.</p>
      {me.signIn.dev && (
        <div className="account-dev">
          <b>Dev sign-in (this computer only)</b>
          <div className="account-row">
            <input value={devName} onChange={(e) => setDevName(e.target.value)} aria-label="Test account name" maxLength={16} />
            <button onClick={async () => setErr(await devSignIn(devName))}>Sign in</button>
          </div>
          {err && <p className="account-error">{err}</p>}
        </div>
      )}
      <button className="account-guest" onClick={onHome}>
        Play as a guest
      </button>
    </section>
  )
}

/** First time: pick a name. Later: change it, or sign out. (No portraits for now, Nov 28: a letter stands in.) */
function WizardForm({ first, onDone }: { first: boolean; onDone: () => void }) {
  const me = useMe()!
  const account = me.account!
  const [name, setName] = useState(account.username ?? me.suggested ?? '')
  const [err, setErr] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const nameOk = NAME_RE.test(name)
  const changed = name !== account.username
  const save = async () => {
    setBusy(true)
    const e = await saveProfile({ username: name })
    setBusy(false)
    setErr(e)
    if (!e && first) onDone()
  }
  return (
    <section className="info-card account-card">
      <label className="account-label" htmlFor="wizard-name">
        Name
      </label>
      <input id="wizard-name" className="account-name" value={name} maxLength={16} autoComplete="off" spellCheck={false} onChange={(e) => (setName(e.target.value), setErr(null))} />
      <p className="account-note">{first ? '3 to 16 letters, numbers or _. You can change it every 30 days.' : 'You can change your name once every 30 days.'}</p>
      {err && <p className="account-error">{err}</p>}
      <button className="account-save" disabled={!nameOk || busy || (!first && !changed)} onClick={save}>
        {first ? 'Start' : 'Save'}
      </button>
      {!first && (
        <div className="account-row">
          <button className="account-out" onClick={() => signOut()}>
            Sign out
          </button>
          <button className="account-out" onClick={() => signOut(true)} title="Signs out this account on every device">
            Sign out everywhere
          </button>
        </div>
      )}
    </section>
  )
}

/** Home's top-left corner: Sign in, or your name (opens your profile). Nothing when accounts are off. */
export function AccountChip({ onOpen }: { onOpen: () => void }) {
  const me = useMe()
  if (!me?.on) return null
  const a = me.account
  return (
    <button className="account-chip" onClick={onOpen} aria-label={a?.username ? `Your account: ${a.username}` : 'Sign in'}>
      {/* No picture (Nov 28: portraits are gone for now): the person icon, signed in or not. */}
      <svg className="chip-person" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round">
        <circle cx="12" cy="8" r="4" />
        <path d="M4 21c1-4.5 4.2-7 8-7s7 2.5 8 7" />
      </svg>
      <span>{a?.username ?? (a ? 'Make your wizard' : 'Sign in')}</span>
    </button>
  )
}
