// Messages between the browser and the game server (one WebSocket per player, JSON).
import type { CombatView } from './combat'

export type ClientMsg =
  | { t: 'hello'; token: string } // first message: who you are (kept across refreshes, so you can rejoin)
  | { t: 'create' }
  | { t: 'join'; code: string }
  | { t: 'ready' }
  | { t: 'leave' }
  | { t: 'forfeit' }
  // What your browser recognized. The server decides what it does (charge, ready, throw, fizzle)
  // and relays the results to the opponent so they can read you:
  | { t: 'sign'; el: string } // a held letter that is an element
  | { t: 'stroke'; pts: [number, number][]; a: number } // new trail points: fractions of your visible (mirrored) view; a = its width / height
  | { t: 'drew'; shape: string | null } // a finished stroke, as recognized (null = not a spell shape)
  | { t: 'cleared' } // a stroke too short to count (just settling the hand)
  | { t: 'push' } // a push toward the camera

export type OppEvent =
  | { kind: 'charge'; el: string | null }
  | { kind: 'stroke'; pts: [number, number][]; a: number }
  | { kind: 'readied'; el: string; shape: string }
  | { kind: 'cleared' }
  | { kind: 'cast' }

export type ServerMsg =
  | { t: 'welcome'; resumed: boolean } // resumed = you were put back into your room
  | { t: 'lobby'; code: string; players: number; ready: [boolean, boolean] } // ready = [you, opponent]
  | { t: 'countdown'; ms: number }
  | { t: 'start' }
  | { t: 'state'; view: CombatView; paused: boolean } // from your point of view: you are 'player'
  | { t: 'opp'; ev: OppEvent }
  | { t: 'oppAway'; ms: number } // opponent disconnected; they have this long to come back
  | { t: 'oppBack' }
  | { t: 'oppLeft'; forfeited: boolean }
  | { t: 'error'; msg: string }
