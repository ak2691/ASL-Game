// Messages between the browser and the game server (one WebSocket per player, JSON).
import type { CombatView, Fid, Side } from './combat'
import type { BotInfo } from './duo'

export const ROOM_MAX = 4 // up to 2 per team
export const TEAM_MAX = 2
export const HP_MIN = 50 // Nov 25: was 100; custom games set any whole number in range
export const HP_MAX = 700 // Nov 25: was 600

export type ClientMsg =
  | { t: 'hello'; token: string } // first message: who you are (kept across refreshes, so you can rejoin)
  | { t: 'create'; progress?: number; duo?: boolean } // duo: a Duo Tower room (from the Tower page); progress: its floors you've cleared
  | { t: 'join'; code: string; progress?: number; duo?: boolean } // duo: joining from the Tower page (Duo Tower codes only)
  | { t: 'floor'; floor: number } // host only: the Duo Tower floor to fight
  | { t: 'ready' }
  | { t: 'unready' } // take back Ready (lobby only)
  | { t: 'leave' }
  | { t: 'forfeit' } // vote to forfeit (again = take it back); the whole team must vote
  | { t: 'team' } // switch to the other team (lobby only)
  | { t: 'hp'; seat: number; hp: number } // host only: a player's max HP for the next match
  // What your browser recognized. The server decides what it does (charge, ready, throw, fizzle)
  // and relays the results to the others so they can read you:
  | { t: 'sign'; el: string } // a held letter that is an element
  | { t: 'stroke'; pts: [number, number][]; a: number } // new trail points: fractions of your visible (mirrored) view; a = its width / height
  | { t: 'drew'; shape: string | null } // a finished stroke, as recognized (null = not a spell shape)
  | { t: 'cleared' } // a stroke too short to count (just settling the hand)
  | { t: 'aim'; target: Fid | null } // team fights: who your next throw goes to, as you see them ('enemy', 'enemy2', 'ally'; null = default)
  | { t: 'push' } // a push toward the camera
  | { t: 'parry' } // both hands pushed at once
  | { t: 'uncharge' } // an open hand held while charged (nothing drawn): drop the charge
  // Quick match: join or leave the queue; answer "Match found". In a party of 2, only the leader queues (2v2).
  | { t: 'queue'; mode?: 'casual' | 'ranked'; size?: '1v1' | '2v2' } // Ranked: accounts only
  | { t: 'party'; op: 'create' | 'join' | 'leave'; code?: string }
  | { t: 'chat'; line: number } // a QUICK_CHAT line, to everyone in your room
  | { t: 'social' } // a Friends page's own socket (no seat): sends the friends list and live updates
  | SocialMsg
  | { t: 'unqueue' }
  | { t: 'accept' }
  | { t: 'decline' }

/** Friends (accounts only; by wizard name). No text chat: quick chat lines only, in matches (Nov 28). */
export type SocialMsg =
  | { t: 'friends'; op: 'list' }
  | { t: 'friends'; op: 'add' | 'accept' | 'decline' | 'remove' | 'block' | 'unblock'; name: string }
  | { t: 'friends'; op: 'report'; name: string; reason?: string }
  | { t: 'invite'; name: string } // to your party (made if you have none)

export type Presence = 'offline' | 'online' | 'queue' | 'match'
export interface FriendInfo {
  name: string
  portrait: string
  kind: 'friend' | 'incoming' | 'outgoing' | 'blocked'
  presence: Presence // friends only (others show offline)
}

export type OppEvent =
  | { kind: 'charge'; el: string | null }
  | { kind: 'stroke'; pts: [number, number][]; a: number }
  | { kind: 'readied'; el: string; shape: string }
  | { kind: 'cleared' }
  | { kind: 'cast' }

/** Quick match, as you see it: off, searching (since = server time you joined), or a match found waiting for
 *  both Accepts (ms left, who it is, whether you and they have accepted). note: why you're off (a miss, a cooldown). */
export type QueueInfo =
  | { state: 'off'; note?: string }
  | { state: 'searching'; since: number; mode: 'casual' | 'ranked'; size: '1v1' | '2v2' }
  | { state: 'found'; ms: number; others: { name: string | null; portrait: string | null; ally: boolean; accepted: boolean }[]; you: boolean }

/** Your party (2 players; the leader finds 2v2 matches for both). here = connected now. */
export interface PartyInfo {
  code: string
  members: { name: string; portrait: string | null; leader: boolean; you: boolean; here: boolean }[]
}

/** Quick chat (Nov 27): preset lines only, no free text with strangers (plans/accounts.md "Friends and chat"). */
export const QUICK_CHAT = ['Good game', 'Nice parry', 'Well played', 'Oops', 'Good luck', 'Thanks'] as const

/** A seat in the lobby, as everyone sees it. */
export interface SeatInfo {
  team: Side // 'player' = team 1, 'enemy' = team 2 (the same for everyone in the room)
  ready: boolean
  hp: number
  here: boolean // connected
  name?: string // signed in: their wizard name (guests have none)
  portrait?: string
}

/** A Duo Tower room: the floor picked, and the highest one anyone in the room may pick. */
export interface DuoRoom {
  floor: number
  unlocked: number
}

export type ServerMsg =
  | { t: 'welcome'; resumed: boolean; name: string; guest: boolean } // resumed = you were put back into your room; name = what others see you as (guests: "Guest48213")
  | { t: 'lobby'; code: string; seats: SeatInfo[]; you: number; host: number; duo?: DuoRoom | null; quick?: boolean; ranked?: boolean; counting?: boolean } // counting = the setup countdown is on (who's Ready changes during it); host = the seat that sets HP; duo = a Duo Tower room; quick = made by the queue; ranked = a Ranked match (no rematch)
  | { t: 'rated'; before: number; after: number; games: number; won: boolean } // your Ranked rating after a match (games = Ranked matches played, placements included)
  | { t: 'queue'; queue: QueueInfo } // your place in quick match (sent on every change)
  | { t: 'party'; party: PartyInfo | null }
  | { t: 'friends'; list: FriendInfo[] }
  | { t: 'invite'; from: string; code: string } // a friend's party invite
  | { t: 'notice'; msg: string } // a plain confirmation to show
  | { t: 'chat'; from: Fid | null; name: string; line: number; you: boolean } // from = the fighter as you see them (null outside a fight)
  | { t: 'countdown'; ms: number }
  | { t: 'start' }
  | { t: 'state'; at: number; d: Partial<StateFields> } // what changed since the last one (see StateFields); at = the server's clock
  | { t: 'opp'; from: Fid; ev: OppEvent } // another fighter's casting, by their id as you see them
  | { t: 'away'; ms: number } // someone disconnected; they have this long to come back
  | { t: 'back' } // ...and they're back
  | { t: 'left'; forfeited: boolean } // someone left for good (forfeited = mid-fight)
  | { t: 'forfeitVote'; votes: number; needed: number; mine: boolean } // your team's forfeit vote (needed 0 = no vote going)
  | { t: 'error'; msg: string }

/** The fight as one player sees it: you are 'player', your team is 'player'. conn: fighters whose player is
 *  disconnected or gone. Sent as changes only: each 'state' message carries just the fields that differ
 *  from the last one sent to you (all of them after a countdown or a reconnect). */
export interface StateFields extends CombatView {
  paused: boolean
  conn: Record<Fid, 'away' | 'left'>
  bots: Record<Fid, BotInfo>
  names: Record<Fid, string> // each player's name (wizard name, or Guest12345), by the ids you see them as
}

/** Fields that count down (ms left). On the wire they're end times on the server's clock (0 = none), so they
 *  stay the same between events and aren't resent; the browser counts them down itself. */
// `power` is sent the same way: for each weakened element, the time it's back to full power (POWER_DECAY_MS per stack).
export const COUNTDOWNS = ['silenced', 'chillMs', 'fizzled', 'staggered', 'locked', 'recover', 'mirror', 'doom', 'shroud', 'guard', 'exposed', 'fog', 'noHeal', 'glacier'] as const satisfies readonly (keyof CombatView)[]
