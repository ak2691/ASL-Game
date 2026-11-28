// Friends and party invites (plans/accounts.md "Friends and chat"). Accounts only: guests have no friends list.
// No text chat at all (Nov 28): players talk only with quick chat lines in matches.
// Everything runs over the game's WebSocket. The Friends page opens its own socket and says { t: 'social' }
// instead of hello, so it never takes over a seat.
import type { WebSocket } from 'ws'
import { db } from './db.ts'
import type { FriendInfo, Presence, ServerMsg, SocialMsg } from '../apps/web/src/protocol.ts'

const FRIENDS_MAX = 200

export interface SocialDeps {
  send: (ws: WebSocket | null | undefined, msg: ServerMsg) => void
  socketsOf: (userId: string) => WebSocket[] // every open socket on this account (game tabs and Friends pages)
  presenceOf: (userId: string) => Presence
  partyCodeFor: (userId: string) => string // the inviter's party (made if they have none)
}

export function createSocial(d: SocialDeps) {
  const userByName = async (name: string) => {
    const r = await db.query('SELECT id, username FROM users WHERE username_lower = $1', [String(name ?? '').toLowerCase().slice(0, 32)])
    return r.rows[0] as { id: string; username: string } | undefined
  }
  const blockedEither = async (a: string, b: string) => {
    const r = await db.query('SELECT 1 FROM blocks WHERE (user_id = $1 AND blocked_id = $2) OR (user_id = $2 AND blocked_id = $1)', [a, b])
    return r.rowCount! > 0
  }
  const areFriends = async (a: string, b: string) => {
    const r = await db.query(`SELECT 1 FROM friends WHERE user_id = $1 AND friend_id = $2 AND status = 'friends'`, [a, b])
    return r.rowCount! > 0
  }

  async function listFor(userId: string): Promise<FriendInfo[]> {
    const r = await db.query(
      `SELECT u.id, u.username, u.portrait, 'friend' AS kind FROM friends f JOIN users u ON u.id = f.friend_id WHERE f.user_id = $1 AND f.status = 'friends'
       UNION ALL SELECT u.id, u.username, u.portrait, 'outgoing' FROM friends f JOIN users u ON u.id = f.friend_id WHERE f.user_id = $1 AND f.status = 'pending'
       UNION ALL SELECT u.id, u.username, u.portrait, 'incoming' FROM friends f JOIN users u ON u.id = f.user_id WHERE f.friend_id = $1 AND f.status = 'pending'
       UNION ALL SELECT u.id, u.username, u.portrait, 'blocked' FROM blocks b JOIN users u ON u.id = b.blocked_id WHERE b.user_id = $1`,
      [userId],
    )
    return r.rows
      .filter((x) => x.username)
      .map((x) => ({ name: x.username, portrait: x.portrait, kind: x.kind, presence: x.kind === 'friend' ? d.presenceOf(String(x.id)) : 'offline' }))
  }
  async function pushList(userId: string) {
    const socks = d.socketsOf(userId)
    if (!socks.length) return
    const list = await listFor(userId)
    for (const ws of socks) d.send(ws, { t: 'friends', list })
  }
  /** Someone came online, went offline, queued or started a match: their friends' lists change. */
  async function presenceChanged(userId: string) {
    try {
      const r = await db.query(`SELECT friend_id FROM friends WHERE user_id = $1 AND status = 'friends'`, [userId])
      for (const row of r.rows) await pushList(String(row.friend_id))
    } catch (err) {
      console.error('presence update failed', (err as Error).message)
    }
  }

  const err = (ws: WebSocket, msg: string) => d.send(ws, { t: 'error', msg })

  async function onMessage(ws: WebSocket, me: { userId: string; name: string }, msg: SocialMsg) {
    const id = me.userId
    if (msg.t === 'friends' && msg.op === 'list') return void d.send(ws, { t: 'friends', list: await listFor(id) })
    const other = 'name' in msg && msg.name ? await userByName(msg.name) : undefined
    if (!other) return err(ws, 'No wizard by that name.')
    const them = String(other.id)
    if (them === id) return err(ws, "That's you.")

    if (msg.t === 'friends') {
      switch (msg.op) {
        case 'add': {
          if (await blockedEither(id, them)) return err(ws, "You can't add that wizard.")
          const n = await db.query(`SELECT count(*)::int AS n FROM friends WHERE user_id = $1`, [id])
          if (n.rows[0].n >= FRIENDS_MAX) return err(ws, `You can have ${FRIENDS_MAX} friends and requests at most.`)
          const back = await db.query(`SELECT status FROM friends WHERE user_id = $1 AND friend_id = $2`, [them, id])
          if (back.rows[0]?.status === 'pending') return accept(id, them) // they asked first: that's a yes
          await db.query(`INSERT INTO friends (user_id, friend_id, status) VALUES ($1, $2, 'pending') ON CONFLICT DO NOTHING`, [id, them])
          break
        }
        case 'accept': {
          const r = await db.query(`SELECT 1 FROM friends WHERE user_id = $1 AND friend_id = $2 AND status = 'pending'`, [them, id])
          if (!r.rowCount) return err(ws, 'That request is gone.')
          return accept(id, them)
        }
        case 'decline':
        case 'remove':
          await db.query('DELETE FROM friends WHERE (user_id = $1 AND friend_id = $2) OR (user_id = $2 AND friend_id = $1)', [id, them])
          break
        case 'block':
          await db.query('DELETE FROM friends WHERE (user_id = $1 AND friend_id = $2) OR (user_id = $2 AND friend_id = $1)', [id, them])
          await db.query('INSERT INTO blocks (user_id, blocked_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [id, them])
          break
        case 'unblock':
          await db.query('DELETE FROM blocks WHERE user_id = $1 AND blocked_id = $2', [id, them])
          break
        case 'report': {
          const reason = String(msg.reason ?? '').slice(0, 300) || 'No reason given'
          await db.query('INSERT INTO reports (reporter_id, reported_id, reason) VALUES ($1, $2, $3)', [id, them, reason])
          d.send(ws, { t: 'notice', msg: 'Thanks. We got your report.' })
          return
        }
        default:
          return
      }
      await pushList(id)
      await pushList(them)
      return
    }

    if (msg.t === 'invite') {
      if (!(await areFriends(id, them))) return err(ws, 'You can only invite friends.')
      if (d.presenceOf(them) === 'offline') return err(ws, `${other.username} is offline.`)
      const code = d.partyCodeFor(id)
      for (const s of d.socketsOf(them)) d.send(s, { t: 'invite', from: me.name, code })
      d.send(ws, { t: 'notice', msg: `Invited ${other.username}.` })
    }
  }

  async function accept(id: string, them: string) {
    await db.query(`UPDATE friends SET status = 'friends' WHERE user_id = $1 AND friend_id = $2`, [them, id])
    await db.query(`INSERT INTO friends (user_id, friend_id, status) VALUES ($1, $2, 'friends') ON CONFLICT (user_id, friend_id) DO UPDATE SET status = 'friends'`, [id, them])
    await pushList(id)
    await pushList(them)
  }

  return {
    /** A social message from a signed-in player; failures are logged, never thrown. */
    handle: (ws: WebSocket, me: { userId: string; name: string }, msg: SocialMsg) =>
      onMessage(ws, me, msg).catch((e) => {
        console.error('social failed', (e as Error).message)
        err(ws, 'Something went wrong. Try again.')
      }),
    pushList: (id: string) => pushList(id).catch(() => {}),
    presenceChanged,
  }
}
