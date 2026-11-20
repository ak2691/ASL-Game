// Messages between the browser and the game server (one WebSocket per player, JSON).
import type { CombatView } from './combat'

export type ClientMsg =
  | { t: 'hello'; token: string } // first message: who you are (kept across refreshes, so you can rejoin)
  | { t: 'create' }
  | { t: 'join'; code: string }
  | { t: 'ready' }
  | { t: 'leave' }
  | { t: 'forfeit' }
  // Your own casting steps, relayed to the opponent so they can read you:
  | { t: 'charge'; el: string | null }
  | { t: 'stroke'; pts: [number, number][] } // new trail points (0..1 of your camera frame)
  | { t: 'readied'; el: string; shape: string }
  | { t: 'cleared' }
  | { t: 'cast'; el: string; shape: string }

export type OppEvent =
  | { kind: 'charge'; el: string | null }
  | { kind: 'stroke'; pts: [number, number][] }
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
