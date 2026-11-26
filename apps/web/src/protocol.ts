// Messages between the browser and the game server (one WebSocket per player, JSON).
import type { CombatView, Fid, Side } from './combat'

export const ROOM_MAX = 4 // up to 2 per team
export const TEAM_MAX = 2
export const HP_MIN = 50 // Nov 25: was 100; custom games set any whole number in range
export const HP_MAX = 700 // Nov 25: was 600

export type ClientMsg =
  | { t: 'hello'; token: string } // first message: who you are (kept across refreshes, so you can rejoin)
  | { t: 'create' }
  | { t: 'join'; code: string }
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

export type OppEvent =
  | { kind: 'charge'; el: string | null }
  | { kind: 'stroke'; pts: [number, number][]; a: number }
  | { kind: 'readied'; el: string; shape: string }
  | { kind: 'cleared' }
  | { kind: 'cast' }

/** A seat in the lobby, as everyone sees it. */
export interface SeatInfo {
  team: Side // 'player' = team 1, 'enemy' = team 2 (the same for everyone in the room)
  ready: boolean
  hp: number
  here: boolean // connected
}

export type ServerMsg =
  | { t: 'welcome'; resumed: boolean } // resumed = you were put back into your room
  | { t: 'lobby'; code: string; seats: SeatInfo[]; you: number; host: number } // host = the seat that sets HP
  | { t: 'countdown'; ms: number }
  | { t: 'start' }
  | { t: 'state'; view: CombatView; paused: boolean } // from your point of view: you are 'player', your team is 'player'
  | { t: 'opp'; from: Fid; ev: OppEvent } // another fighter's casting, by their id as you see them
  | { t: 'away'; ms: number } // someone disconnected; they have this long to come back
  | { t: 'back' } // ...and they're back
  | { t: 'left'; forfeited: boolean } // someone left for good (forfeited = mid-fight)
  | { t: 'forfeitVote'; votes: number; needed: number; mine: boolean } // your team's forfeit vote (needed 0 = no vote going)
  | { t: 'error'; msg: string }
