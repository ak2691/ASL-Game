// Duo Tower (plans/duo-tower.md): two players against a pair of tower bots, 10 floors (the Duet Trials).
// The game server runs the bots. Each one is the 1v1 tower's bot (battle.ts PracticeArena), unchanged, looking
// at the 2v2 through a lens that shows it a 1v1: itself as 'enemy', whoever it's after as 'player'. On top of
// that sits the pair brain: one plan per floor (focus, sync, stagger, setup, cover, curse, bait, swap,
// punish) that picks their targets and nudges their timing, so the two play as a team.
// Shared by the page (names, lines, the floor list) and the server (the bots themselves).
import { AI, PracticeArena, type AiStyle, type Bark, type Difficulty, type FightLike } from './battle'
import { MAX_HP, other, type Combat, type CombatView, type Fid } from './combat'
import { viewMapped } from './teamView'

// ---- Characters --------------------------------------------------------------------------------
type Lines = { start: string; habit: string[]; partnerLow: string; low: string; win: string; lose: string }
export interface DuoChar {
  name: string
  portrait: string // portraits.tsx PEOPLE key
  lines: Lines
}

/** The cast. Returning tower characters keep their 1v1 portraits; Old Bram has a second, unleashed self. */
export const DUO_CHARS: Record<string, DuoChar> = {
  bram: { name: 'Old Bram', portrait: 'pebble', lines: { start: 'Two of you? Good. Pip needs the practice.', habit: ['Same one, Pip. Keep at it.', 'Big one coming. For them, not you, Pip.'], partnerLow: 'Pip, behind me.', low: "Oof. Teamwork's harder on the back.", win: 'Not bad for an old man and a spark.', lose: "Ha! You two talk to each other. That's the trick." } },
  pip: { name: 'Pip', portrait: 'ember', lines: { start: 'Grandpa Bram says I hit whoever he hits!', habit: ['Zap! Same one!', 'That one! Zap that one!'], partnerLow: 'Grandpa!', low: 'Why are there two of you?!', win: 'Teamwork! Zap zap!', lose: 'Okay, okay, you two were good.' } },
  // The twins finish each other's sentences: Ivy says the first half, Rowan the rest (DuoBots echoes it).
  ivy: { name: 'Ivy', portrait: 'ivy', lines: { start: 'We always...', habit: ['Three, two...', 'Together...'], partnerLow: 'Rowan?!', low: "This wasn't...", win: 'Perfect...', lose: 'You parried...' } },
  rowan: { name: 'Rowan', portrait: 'rowan', lines: { start: '...hit together.', habit: ['...one!', '...again!'], partnerLow: 'Ivy!', low: '...the plan.', win: '...timing.', lose: '...both of us?' } },
  hollis: { name: 'Miss Hollis', portrait: 'frost', lines: { start: 'Bruno, posture. Ice first, then you.', habit: ['Chilled. Now, Bruno.', 'Wait for the cold, Bruno.'], partnerLow: 'Bruno, guard up!', low: 'Unacceptable.', win: 'Textbook. Write that down, Bruno.', lose: 'You broke the setup. Full marks.' } },
  bruno: { name: 'Bruno', portrait: 'bruno', lines: { start: '...Hi.', habit: ['Now?', 'Big one.'], partnerLow: 'Miss Hollis!', low: 'Ow.', win: 'We did it, Miss Hollis.', lose: '...Good fight.' } },
  alden: { name: 'Brother Alden', portrait: 'cleric', lines: { start: 'Sister, keep me standing.', habit: ['Heal for you, Wren.', 'Behind the shield.'], partnerLow: "Wren, I've got you.", low: 'Wren? A little help?', win: 'The Light keeps us both.', lose: 'You waited for the heal. Wise.' } },
  wren: { name: 'Sister Wren', portrait: 'wren', lines: { start: 'I heal you, you heal me. Fair.', habit: ["That's your third heal, Alden.", 'Shield up!'], partnerLow: 'Again, Alden?!', low: "Who's healing ME?", win: "Told you I'm the better healer.", lose: 'Fine. Hit the healer first. Smart.' } },
  morwen: { name: 'Morwen', portrait: 'hexer', lines: { start: 'One of you is already doomed. Guess who.', habit: ['Doomed, darling.', 'Nyx. Finish it.'], partnerLow: 'Nyx, not yet!', low: 'How rude.', win: 'Doom always finds its way.', lose: 'You saved each other. How sweet. How annoying.' } },
  nyx: { name: 'Nyx', portrait: 'zealot', lines: { start: '...', habit: ['...', 'Now.'], partnerLow: 'Morwen.', low: 'Hm.', win: 'Gone.', lose: 'Seen.' } },
  ito: { name: 'Master Ito', portrait: 'tide', lines: { start: "Kai, show them everything. I'll watch.", habit: ['Patience.', 'There it is.'], partnerLow: 'Breathe, Kai.', low: 'Mm. Interesting.', win: 'Kai, you were the lesson.', lose: 'Only one of you bit. Well done.' } },
  kai: { name: 'Kai', portrait: 'kai', lines: { start: 'Watch THIS!', habit: ['Big fire! Nobody can stop it!', 'Look over here!'], partnerLow: 'Master!', low: 'Why is nobody looking at me?', win: 'Did you see me? Did you SEE me?', lose: 'Wait, was I the bait?' } },
  vell: { name: 'Proctor Vell', portrait: 'warden', lines: { start: 'Rule one: no drawing during my turn.', habit: ['Interrupted. Penalty applies.', "Your turn's over."], partnerLow: 'Quill, cover.', low: 'This is irregular.', win: 'Exam failed. Resubmit.', lose: 'You took turns. Pass.' } },
  quill: { name: 'Proctor Quill', portrait: 'quill', lines: { start: 'Rule two: no drawing during MY turn.', habit: ['Noted.', 'Next.'], partnerLow: 'Vell! Form 9-B!', low: 'Filing a complaint.', win: 'Logged.', lose: 'Approved. Reluctantly.' } },
  rook: { name: 'Rook', portrait: 'adept', lines: { start: 'Stay out of my way, Vale.', habit: ['Hit her and you answer to me.', 'Combo. Watch and learn, Vale.'], partnerLow: 'Vale, get back!', low: 'Vale, you were supposed to cover me!', win: "We won. Don't get used to it.", lose: 'One at a time. Annoyingly smart.' } },
  juno: { name: 'Juno Vale', portrait: 'juno', lines: { start: 'Try to keep up, Rook.', habit: ['Touch Rook again, I dare you.', 'My combo was better.'], partnerLow: "Rook, you're slipping!", low: 'Rook! Do something!', win: 'I carried. Obviously.', lose: 'Fine. You two are a better team than us.' } },
  gideon: { name: 'Gideon', portrait: 'magus', lines: { start: "Every mistake, I'll be there.", habit: ['Missed. Thank you.', 'Your partner fizzled. Noted.'], partnerLow: 'Glass. Adjust.', low: 'Hm. Clean.', win: 'Two players, twice the mistakes.', lose: 'Not one opening. Impressive.' } },
  glass: { name: 'Lady Glass', portrait: 'lich', lines: { start: "I'm learning both of you.", habit: ["Your team's favorite again.", "I've seen this one."], partnerLow: 'Gideon, change plans.', low: "You've both changed.", win: 'Same team, same answers.', lose: 'You never showed me a pattern.' } },
  archwizard: { name: 'The Archwizard', portrait: 'ascendant', lines: { start: 'Bram. Like old times?', habit: ["Your plan's showing.", "We've done this before."], partnerLow: "Bram! Don't you dare.", low: 'Fifty years, and nobody pushed us this far.', win: 'Still the best duet in the school.', lose: 'Bram... I think they\'re better than we were.' } },
  bramx: { name: 'Old Bram', portrait: 'bramx', lines: { start: 'No more taking it slow.', habit: ['Not so slow now, eh?', 'Remember this one?'], partnerLow: 'On my way, old friend.', low: 'Now THIS is a fight.', win: 'Fifty years, and still.', lose: "Ha! Pip's going to love this." } },
}
const TWINS = ['ivy', 'rowan']

/** A character's line. `i` picks among its habit lines. */
export function duoLine(who: string, key: Bark, i = 0): string {
  const l = DUO_CHARS[who]?.lines
  if (!l) return ''
  if (key === 'habit') return l.habit[i % l.habit.length]
  return l[key]
}

// ---- Floors ------------------------------------------------------------------------------------
export type PairPlan = 'split' | 'focus' | 'sync' | 'stagger' | 'setup' | 'cover' | 'curse' | 'bait' | 'swap' | 'punish'
interface DuoBot {
  who: string
  skill: Difficulty // its numbers (speed, reactions, counters, parries): about this 1v1 floor
  kit: Difficulty // its spells and its own habit: this 1v1 bot's
  mod?: Partial<AiStyle> // anything else
}
export interface DuoFloor {
  pair: [DuoBot, DuoBot]
  plan: PairPlan | 'exam' | 'final'
  examOf?: PairPlan[]
  strength: number // share of target and timing choices that follow the plan (fades up the tower)
  slow: number // their wait between casts is this much longer (2v2 is new to most players)
  lag?: number // ms before they act on a curse landing or a partner being hit (people need a moment to see it too)
  habit: string // the tower line: what the pair does
}

const NUMBERS: (keyof AiStyle)[] = ['every', 'setupDelay', 'speed', 'ramp', 'react', 'reactMs', 'circle', 'miss', 'capitalize', 'reroll', 'spamCounter', 'spamAt', 'stun', 'read', 'heal', 'dodge', 'healPunish', 'drop', 'smart', 'comboCounter', 'parry', 'parrySig', 'parryAim', 'reparry', 'bail', 'feintRead', 'fizzlePunish', 'feint']
const ALL_EL = ['F', 'I', 'W', 'E', 'L']

export const DUO_FLOORS: DuoFloor[] = [
  { pair: [{ who: 'bram', skill: 'pebble', kit: 'pebble' }, { who: 'pip', skill: 'pebble', kit: 'ember' }], plan: 'focus', strength: 0.7, slow: 1.8, habit: 'Both hit the same one of you' },
  { pair: [{ who: 'ivy', skill: 'pebble', kit: 'ember', mod: { habit: undefined } }, { who: 'rowan', skill: 'pebble', kit: 'ember', mod: { els: ['W', 'E', 'L'], habit: undefined } }], plan: 'sync', strength: 0.8, slow: 1.3, habit: 'Their spells land together' },
  { pair: [{ who: 'hollis', skill: 'pebble', kit: 'frost' }, { who: 'bruno', skill: 'pebble', kit: 'pebble', mod: { els: ['E', 'F', 'W'], moves: { line: 10, h: 80, signature: 10 } } }], plan: 'setup', strength: 0.8, slow: 1.3, habit: 'She chills, he hits' },
  { pair: [{ who: 'alden', skill: 'ember', kit: 'cleric', mod: { healBelow: 0.25, healGap: 12000 } }, { who: 'wren', skill: 'ember', kit: 'cleric', mod: { els: ['W', 'F', 'L'], healBelow: 0.25, healGap: 12000 } }], plan: 'exam', examOf: ['cover', 'focus', 'sync', 'setup'], strength: 0.5, slow: 1.35, habit: 'Exam: they heal each other' },
  { pair: [{ who: 'morwen', skill: 'frost', kit: 'hexer' }, { who: 'nyx', skill: 'frost', kit: 'zealot' }], plan: 'curse', strength: 0.45, slow: 1.4, lag: 700, habit: 'One curses, the other finishes' },
  { pair: [{ who: 'ito', skill: 'zealot', kit: 'tide' }, { who: 'kai', skill: 'zealot', kit: 'pebble', mod: { els: ['F', 'L', 'E'], moves: { line: 10, h: 60, signature: 30 }, habitStrength: 0.7 } }], plan: 'bait', strength: 0.6, slow: 1.15, habit: 'Kai shows off, Ito punishes' },
  { pair: [{ who: 'vell', skill: 'warden', kit: 'warden' }, { who: 'quill', skill: 'warden', kit: 'warden', mod: { els: ['I', 'W', 'L', 'E'] } }], plan: 'stagger', strength: 0.6, slow: 1.2, habit: 'They take turns' },
  { pair: [{ who: 'rook', skill: 'warden', kit: 'adept' }, { who: 'juno', skill: 'warden', kit: 'adept', mod: { combos: ['storm', 'sunfire', 'thermal'], comboRate: 0.18, habit: 'combo' } }], plan: 'exam', examOf: ['swap', 'swap', 'focus', 'curse', 'bait', 'stagger', 'setup'], strength: 0.45, slow: 1.3, lag: 800, habit: 'Exam: hit one, the other hits back' },
  { pair: [{ who: 'gideon', skill: 'magus', kit: 'magus' }, { who: 'glass', skill: 'archmage', kit: 'lich' }], plan: 'punish', strength: 0.35, slow: 1.3, habit: 'She learns you, he punishes' },
  { pair: [{ who: 'archwizard', skill: 'lich', kit: 'ascendant' }, { who: 'bramx', skill: 'lich', kit: 'pebble', mod: { els: ALL_EL, moves: { line: 15, h: 55, signature: 30 }, magic: ['aegis', 'scythe', 'veil', 'blade'], healBelow: 0.3, habitStrength: 0.35, combos: ['magma', 'glacier', 'grave', 'thermal'], comboRate: 0.2 } }], plan: 'final', strength: 0.35, slow: 1.2, habit: 'Final exam: they change plans when you do' },
]
export const DUO_TOP = DUO_FLOORS.length
/** How much tougher the bots are than you (HP). */
export const DUO_HP = Math.round(MAX_HP * 1.2)

/** A floor bot's style: its skill floor's numbers, its kit's spells and habit, the floor's slowdown. */
function styleOf(b: DuoBot, slow: number): AiStyle {
  const num = Object.fromEntries(NUMBERS.filter((k) => k in AI[b.skill]).map((k) => [k, AI[b.skill][k]]))
  const s: AiStyle = { ...AI[b.kit], ...num, ...b.mod } as AiStyle
  return { ...s, every: s.every * slow }
}
const LADDER_IDS: Difficulty[] = ['pebble', 'ember', 'frost', 'cleric', 'hexer', 'tide', 'zealot', 'warden', 'adept', 'magus', 'archmage', 'lich', 'ascendant']

// ---- The lens: a 2v2 shown to one bot as a 1v1 ---------------------------------------------------
class Lens {
  target: Fid
  private cache: { at: number; target: Fid; v: CombatView } | null = null
  private c: Combat
  readonly me: Fid
  private ids: Fid[]
  constructor(c: Combat, me: Fid, ids: Fid[]) {
    this.c = c
    this.me = me
    this.ids = ids
    this.target = ids.find((x) => c.teamOf(x) !== c.teamOf(me)) ?? me
  }
  private real = (x: Fid) => (x === 'enemy' ? this.me : x === 'player' ? this.target : x)
  /** Real ids -> what the bot sees: it's 'enemy', its target 'player', its partner 'enemy2', the other player 'ally'. */
  private map() {
    const m: Record<Fid, Fid> = { [this.me]: 'enemy', [this.target]: 'player' }
    for (const x of this.ids) if (!(x in m)) m[x] = this.c.teamOf(x) === this.c.teamOf(this.me) ? 'enemy2' : 'ally'
    return m
  }
  /** A pair on the players' side (the duo sim: pair against pair) sees the teams swapped, like any bot. */
  private get flip() {
    return this.c.teamOf(this.me) === 'player'
  }
  get winner() {
    const w = this.c.winner
    return w && this.flip ? other(w) : w
  }
  view(now: number) {
    const k = this.cache
    if (k && k.at === now && k.target === this.target) return k.v
    const v = viewMapped(this.c.view(now), this.map(), this.flip)
    this.cache = { at: now, target: this.target, v }
    return v
  }
  update() {} // the server advances the fight once per tick, not each bot
  chargeOf = (s: Fid) => this.c.chargeOf(this.real(s))
  clearCast = (s: Fid) => this.c.clearCast(this.real(s))
  cursed = (s: Fid, now: number) => this.c.cursed(this.real(s), now)
  drawing = (s: Fid, now: number) => this.c.drawing(this.real(s), now)
  drew = (s: Fid, shape: string | null, now: number) => this.c.drew(this.real(s), shape, now)
  isLocked = (s: Fid, now: number) => this.c.isLocked(this.real(s), now)
  isSilenced = (s: Fid, now: number) => this.c.isSilenced(this.real(s), now)
  parry = (s: Fid, now: number) => this.c.parry(this.real(s), now)
  powerOf = (s: Fid, el: string, now: number) => this.c.powerOf(this.real(s), el, now)
  push = (s: Fid, now: number) => {
    if (s === 'enemy') this.c.aim(this.me, this.target) // attacks go to its target; heals still go to the most hurt friend
    return this.c.push(this.real(s), now)
  }
  sign = (s: Fid, el: string, now: number) => this.c.sign(this.real(s), el, now)
  staticAt = (s: Fid, now: number) => this.c.staticAt(this.real(s), now)
  strokeCancelled = (s: Fid) => this.c.strokeCancelled(this.real(s))
  strokeSince = (s: Fid) => this.c.strokeSince(this.real(s))
  uncharge = (s: Fid) => this.c.uncharge(this.real(s))
}

// ---- The pair brain ----------------------------------------------------------------------------
export interface BotInfo {
  who: string
  cast: ReturnType<PracticeArena['castInfo']>
  say: { key: Bark; n: number; i?: number } | null
}
interface Seat {
  id: Fid
  who: string
  arena: PracticeArena
  lens: Lens
  castId: number | null
  follows: boolean // this cast follows the plan's timing (rolled once per cast)
  lastTalk: number
  lastHeal: number
  saidN: number // the last line of its own it said (to spot new ones)
}
const SPLIT_KEYS: Bark[] = ['start', 'habit', 'low', 'win', 'lose']
const FINAL_PLANS: PairPlan[] = ['focus', 'sync', 'stagger', 'setup', 'swap', 'punish', 'curse']

export class DuoBots {
  private bots: Seat[]
  private floor: DuoFloor
  private plan: PairPlan = 'split'
  private planUntil = 0
  private focus: { id: Fid; until: number } | null = null
  private hitPartner: Record<Fid, { by: Fid; at: number }> = {} // the last player to hit each bot
  private cursedSince: Record<Fid, number> = {} // when each player's current curse was first seen
  private boltsSeen = new Set<number>()
  private lowSaid = new Set<Fid>()
  private queue: { bot: Seat; key: Bark; i: number; at: number }[] = []
  private score: Partial<Record<PairPlan, { dmg: number; ms: number }>> = {} // final exam: how well each plan did
  private planStart = { at: 0, hp: 0 }

  private combat: Combat
  private humans: Fid[]
  /** `floor`: 1..DUO_TOP (or a floor of its own: the duo sim's reference pairs). `ids`: the two bots' fighter
   *  ids; `humans`: whoever they fight (the players, or another pair in the duo sim). */
  constructor(combat: Combat, floor: number | DuoFloor, ids: [Fid, Fid], humans: Fid[]) {
    this.combat = combat
    this.humans = humans
    this.floor = typeof floor === 'number' ? DUO_FLOORS[Math.min(DUO_TOP, Math.max(1, floor)) - 1] : floor
    const all = [...humans, ...ids]
    this.bots = ids.map((id, k) => ({ id, who: this.floor.pair[k].who, arena: new PracticeArena(), lens: new Lens(combat, id, all), castId: null, follows: false, lastTalk: -Infinity, lastHeal: -Infinity, saidN: 0 }))
    // Rowan only ever finishes Ivy's sentences.
    for (const b of this.bots) if (b.who === 'rowan') SPLIT_KEYS.forEach((k) => b.arena.quiet.add(k))
  }

  start(now: number) {
    this.bots.forEach((b, k) => {
      const d = this.floor.pair[k]
      b.lens.target = this.splitTarget(k) ?? b.lens.target
      b.arena.startWith(now, styleOf(d, this.floor.slow), LADDER_IDS.indexOf(d.skill) / (LADDER_IDS.length - 1), b.lens as unknown as FightLike)
      b.saidN = b.arena.saying?.n ?? 0
    })
    // One at a time: the second one answers the first (a twin finishes the first one's sentence).
    const b = this.bots[1]
    b.arena.hush()
    b.saidN = 0
    this.queue.push({ bot: b, key: 'start', i: 0, at: now + (this.isTwins() ? 1100 : 2600) })
    this.planStart = { at: now, hp: this.humanHp() }
  }

  private isTwins() {
    return this.bots.every((b) => TWINS.includes(b.who))
  }
  private alive(id: Fid) {
    return !this.combat.isOut(id)
  }
  private aliveHumans() {
    return this.humans.filter((h) => this.alive(h))
  }
  private humanHp() {
    const v = this.combat.view(0)
    return this.humans.reduce((t, h) => t + Math.max(0, v.hp[h] ?? 0), 0)
  }
  /** Each bot's own player: bot 1 the first, bot 2 the second (or whoever's left). */
  private splitTarget(k: number): Fid | null {
    const h = this.aliveHumans()
    if (!h.length) return null
    const mine = this.humans[k % this.humans.length]
    return h.includes(mine) ? mine : h[0]
  }
  private hpShare(v: CombatView, id: Fid) {
    return v.hp[id] / v.maxHp[id]
  }

  /** The plan right now (exam floors re-pick it; the final exam keeps what works). */
  private planFor(now: number): PairPlan {
    const f = this.floor
    if (f.plan !== 'exam' && f.plan !== 'final') return f.plan
    if (now < this.planUntil) return this.plan
    if (f.plan === 'exam') {
      this.plan = f.examOf![Math.floor(Math.random() * f.examOf!.length)]
      this.planUntil = now + 12000
      return this.plan
    }
    // Final exam: score the plan that just ran (your HP it took per second), then keep the best one most of
    // the time. When you adapt and it stops working, its score drops and they switch.
    const ms = now - this.planStart.at
    if (ms > 0 && this.planUntil > 0) {
      const s = (this.score[this.plan] ??= { dmg: 0, ms: 0 })
      s.dmg = s.dmg * 0.5 + (this.planStart.hp - this.humanHp())
      s.ms = s.ms * 0.5 + ms
    }
    const rate = (p: PairPlan) => (this.score[p] ? this.score[p]!.dmg / Math.max(1, this.score[p]!.ms) : 0.02) // untried plans look decent
    const best = [...FINAL_PLANS].sort((a, b) => rate(b) - rate(a))
    this.plan = Math.random() < 0.6 && best[0] !== this.plan ? best[0] : FINAL_PLANS.filter((p) => p !== this.plan)[Math.floor(Math.random() * (FINAL_PLANS.length - 1))]
    this.planUntil = now + 15000
    this.planStart = { at: now, hp: this.humanHp() }
    return this.plan
  }

  /** Who bot `k` goes after for its next cast, by the plan (or its own player, when it doesn't follow it). */
  private pickTarget(k: number, plan: PairPlan, v: CombatView, now: number): { target: Fid | null; hurry: boolean } {
    const b = this.bots[k]
    const partner = this.bots[1 - k]
    const h = this.aliveHumans()
    const own = this.splitTarget(k)
    if (!h.length) return { target: null, hurry: false }
    const pickFocus = () => {
      if (!this.focus || now > this.focus.until || !h.includes(this.focus.id)) this.focus = { id: [...h].sort((x, y) => this.hpShare(v, x) - this.hpShare(v, y))[0], until: now + 6000 }
      return this.focus.id
    }
    switch (plan) {
      case 'focus':
      case 'sync':
      case 'stagger':
        return { target: pickFocus(), hurry: false }
      case 'setup': {
        // The first sets up on its own player; the second goes after whoever is chilled, at once.
        if (k === 0) return { target: own, hurry: false }
        const chilled = h.find((x) => (v.chill[x] ?? 0) > 0 || (v.exposed[x] ?? 0) > 0)
        return chilled ? { target: chilled, hurry: true } : { target: partner.lens.target, hurry: false }
      }
      case 'curse': {
        if (k === 0) return { target: own, hurry: false }
        const lag = this.floor.lag ?? 0
        const cursed = h.find((x) => this.cursedSince[x] !== undefined && now - this.cursedSince[x] >= lag)
        return cursed ? { target: cursed, hurry: true } : { target: partner.lens.target, hurry: false }
      }
      case 'bait': {
        // Kai (second) shows off at his own player; Ito (first) watches for whoever starts charging.
        if (k === 1) return { target: own, hurry: false }
        const charging = h.find((x) => v.charge[x])
        return { target: charging ?? own, hurry: false }
      }
      case 'swap': {
        const hit = this.hitPartner[partner.id]
        const lag = this.floor.lag ?? 0
        return hit && now - hit.at >= lag && now - hit.at < 5000 + lag && h.includes(hit.by) ? { target: hit.by, hurry: true } : { target: pickFocus(), hurry: false }
      }
      case 'punish': {
        const open = h.find((x) => (v.silenced[x] ?? 0) > 0 || (v.locked[x] ?? 0) > 0 || (v.fizzled[x] ?? 0) > 0 || (v.staggered[x] ?? 0) > 0)
        return open ? { target: open, hurry: k === 0 } : { target: own, hurry: false }
      }
      case 'cover':
      case 'split':
      default:
        void b
        return { target: own, hurry: false }
    }
  }

  update(now: number) {
    const v = this.combat.view(now)
    // Who hit whom (swap: hit my partner and I come for you).
    for (const bolt of v.bolts) {
      if (!bolt.landed || this.boltsSeen.has(bolt.id)) continue
      this.boltsSeen.add(bolt.id)
      if (this.humans.includes(bolt.by) && this.bots.some((b) => b.id === bolt.to)) this.hitPartner[bolt.to] = { by: bolt.by, at: now }
    }
    for (const x of this.humans) {
      const cursed = (v.doom[x] ?? 0) > 0 || (v.noHeal[x] ?? 0) > 0 || (v.exposed[x] ?? 0) > 0
      if (!cursed) delete this.cursedSince[x]
      else this.cursedSince[x] ??= now
    }
    const plan = this.planFor(now)
    const roll = () => Math.random() < this.floor.strength
    this.bots.forEach((b, k) => {
      if (!this.alive(b.id)) return
      // Between casts: pick who the next one goes after.
      if (!b.arena.busy) {
        const follow = roll()
        const { target, hurry } = follow ? this.pickTarget(k, plan, v, now) : { target: this.splitTarget(k), hurry: false }
        if (target) b.lens.target = target
        if (follow && hurry) {
          b.arena.hurry(now)
          this.talk(b, now, 0.3)
        }
        // Cover: its partner is low, so its next cast is a heal (heals go to the most hurt on its side).
        const partner = this.bots[1 - k]
        if (plan === 'cover' && this.alive(partner.id) && this.hpShare(v, partner.id) < 0.3 && now - b.lastHeal > 15000 && follow) {
          b.lastHeal = now
          b.arena.healSoon()
          this.talk(b, now, 0.5)
        }
      }
      b.arena.update(now)
      const c = b.arena.castInfo(now)
      if (c && c.id !== b.castId) {
        b.castId = c.id
        b.follows = roll()
      } else if (!c) b.castId = null
    })
    this.timing(plan, now)
    this.chatter(v, now)
  }

  /** Sync: hold the earlier spell so both land together (one parry can take both). Stagger: keep their landings
   *  apart, so one parry can't take both. Either way only by holding a spell, never by rushing one. */
  private timing(plan: PairPlan, now: number) {
    const [a, b] = this.bots
    const la = a.arena.landsAt()
    const lb = b.arena.landsAt()
    if (la === null || lb === null || !a.follows || !b.follows) return
    if (plan === 'sync' && Math.abs(la - lb) < 2500) {
      const t = Math.max(la, lb)
      a.arena.landAt(t)
      b.arena.landAt(t)
      if (Math.abs(la - lb) > 300) this.talk(a, now, 0.15)
    } else if (plan === 'stagger' && Math.abs(la - lb) < 650) {
      ;(la <= lb ? b : a).arena.landAt(Math.min(la, lb) + 650)
    }
  }

  /** The pair talks: a plan line now and then, "partner low" once, and the twins' split sentences. */
  private talk(b: Seat, now: number, chance: number) {
    if (now - b.lastTalk < 12000 || Math.random() >= chance) return
    b.lastTalk = now
    this.say(b, 'habit', now, Math.floor(Math.random() * 1000))
  }
  private say(b: Seat, key: Bark, now: number, i: number) {
    if (this.isTwins() && SPLIT_KEYS.includes(key)) {
      // Ivy starts the sentence, Rowan finishes it.
      const [ivy, rowan] = this.bots[0].who === 'ivy' ? this.bots : [this.bots[1], this.bots[0]]
      ivy.arena.say(key, now, i)
      ivy.saidN = ivy.arena.saying!.n
      this.queue.push({ bot: rowan, key, i, at: now + (key === 'win' || key === 'lose' ? 0 : 1100) }) // the fight's over: no time to wait
      return
    }
    b.arena.say(key, now, i)
    b.saidN = b.arena.saying!.n
  }
  private chatter(v: CombatView, now: number) {
    // Lines a bot came up with itself (its habit, low, win, lose): the twins route them through Ivy.
    for (const b of this.bots) {
      const s = b.arena.saying
      if (s && s.n !== b.saidN) {
        b.saidN = s.n
        b.lastTalk = now
        if (this.isTwins() && SPLIT_KEYS.includes(s.key) && b.who === 'ivy') this.queue.push({ bot: this.bots.find((x) => x.who === 'rowan')!, key: s.key, i: s.i ?? 0, at: now + (s.key === 'win' || s.key === 'lose' ? 0 : 1100) })
      }
    }
    // "Partner low": once, from the one still standing.
    this.bots.forEach((b, k) => {
      const partner = this.bots[1 - k]
      if (this.lowSaid.has(partner.id) || !this.alive(b.id) || !this.alive(partner.id) || this.hpShare(v, partner.id) >= 0.3) return
      this.lowSaid.add(partner.id)
      this.say(b, 'partnerLow', now, 0)
    })
    // Lines waiting their turn.
    for (const q of this.queue.filter((x) => now >= x.at)) {
      q.bot.arena.say(q.key, now, q.i)
      q.bot.saidN = q.bot.arena.saying!.n
    }
    this.queue = this.queue.filter((x) => now < x.at)
  }

  /** What the players see of each bot: who it is, its cast in progress, its last line. */
  info(now: number): Record<Fid, BotInfo> {
    return Object.fromEntries(this.bots.map((b) => [b.id, { who: b.who, cast: this.alive(b.id) ? b.arena.castInfo(now) : null, say: b.arena.saying }]))
  }
}
