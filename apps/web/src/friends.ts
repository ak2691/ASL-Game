// Friends and party invites, app-wide (plans/accounts.md "Friends and chat"). Signed in with a
// name, the app keeps one small socket of its own to the game server ({ t: 'social' }, never a seat), so Home
// can show requests and invites and the Friends page updates live. Server side: server/social.ts.
import { useSyncExternalStore } from 'react'
import type { FriendInfo, ServerMsg, SocialMsg } from './protocol'

export interface FriendsState {
  on: boolean // connected
  list: FriendInfo[]
  invite: { from: string; code: string; at: number } | null // the latest party invite, until used or dismissed
  note: { text: string; bad: boolean; n: number } | null // the last error or confirmation
}

const EMPTY: FriendsState = { on: false, list: [], invite: null, note: null }
let state = EMPTY
const subs = new Set<() => void>()
const set = (s: Partial<FriendsState>) => {
  state = { ...state, ...s }
  subs.forEach((f) => f())
}
let ws: WebSocket | null = null
let wanted = false
let retry: ReturnType<typeof setTimeout> | null = null
let noteN = 0

function connect() {
  if (ws || !wanted) return
  const sock = (ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`))
  sock.onopen = () => {
    sock.send(JSON.stringify({ t: 'social' }))
    set({ on: true })
  }
  sock.onmessage = (e) => {
    let m: ServerMsg
    try {
      m = JSON.parse(e.data)
    } catch {
      return
    }
    onMsg(m)
  }
  sock.onclose = () => {
    ws = null
    set({ on: false })
    if (wanted) retry = setTimeout(connect, 3000)
  }
}

function onMsg(m: ServerMsg) {
  switch (m.t) {
    case 'friends':
      return set({ list: m.list })
    case 'invite':
      return set({ invite: { from: m.from, code: m.code, at: Date.now() } })
    case 'notice':
      return set({ note: { text: m.msg, bad: false, n: ++noteN } })
    case 'error':
      return set({ note: { text: m.msg, bad: true, n: ++noteN } })
  }
}

/** Signed in with a name: connected; otherwise not (App calls this when the account changes). */
export function setFriendsOn(on: boolean) {
  wanted = on
  if (on) return connect()
  if (retry) clearTimeout(retry)
  ws?.close()
  ws = null
  state = EMPTY
  subs.forEach((f) => f())
}

export function friendsSend(msg: SocialMsg) {
  if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg))
  else set({ note: { text: "Can't reach the server. Trying again.", bad: true, n: ++noteN } })
}

export const dismissInvite = () => set({ invite: null })
export const clearNote = () => set({ note: null })

export function useFriends() {
  return useSyncExternalStore(
    (f) => (subs.add(f), () => subs.delete(f)),
    () => state,
  )
}

/** Friend requests waiting on you: the number on Home's Friends button. */
export const waitingCount = (s: FriendsState) => s.list.filter((f) => f.kind === 'incoming').length
