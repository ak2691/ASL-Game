// Training dummy with a second enemy (Future Plans.md, "Team modes"): you against two dummies, each with
// its own spells. Nobody can be hurt. The fight engine supports teams; this is the first use of it.
import { signsFor } from './spells'
import { Combat, type Fid, type FighterSpec } from './combat'
import { DUMMY_EVERY_MS, dummyPick, spellOf, type Arena, type OppCast, type Pt01, type Snapshot } from './battle'

export const FOES: Fid[] = ['enemy', 'enemy2'] // left, right
const JITTER = 0.2

const SPECS: FighterSpec[] = [
  { id: 'player', team: 'player', maxHp: Infinity },
  { id: 'enemy', team: 'enemy', maxHp: Infinity },
  { id: 'enemy2', team: 'enemy', maxHp: Infinity },
]

type BotCast = ReturnType<typeof spellOf> & { start: number; ends: number; signs?: { at: number; el: string }[] }

export interface TeamSnapshot extends Snapshot {
  casts: Record<Fid, OppCast | null> // each dummy's spell in progress
}

export class TeamArena implements Arena {
  private combat = new Combat({ fighters: SPECS })
  attacking = false
  castPct = 100 // cast time, as a share of the default (same setting as the single dummy)
  gapMs = DUMMY_EVERY_MS // time between casts
  pools: Record<Fid, string[]> = { enemy: [], enemy2: [] } // spells each may throw, as "element:shape"
  private casts: Record<Fid, BotCast | null> = {}
  private nextAt: Record<Fid, number> = {}
  private knockedSeen: Record<Fid, number> = {}

  reset() {
    this.combat = new Combat({ fighters: SPECS })
    this.restartCasts()
  }
  setAttacking(on: boolean) {
    this.attacking = on
    this.restartCasts()
  }
  private restartCasts() {
    const now = performance.now()
    this.casts = {}
    this.knockedSeen = {}
    FOES.forEach((id, k) => (this.nextAt[id] = now + 1000 + 1300 * k)) // staggered, so they don't cast in sync
  }

  sign(el: string) {
    this.combat.sign('player', el, performance.now())
  }
  stroke(_points: Pt01[], _aspect: number) {
    this.combat.drawing('player', performance.now())
  }
  drew(shape: string | null) {
    this.combat.drew('player', shape, performance.now())
  }
  cleared() {
    this.combat.strokeCancelled('player')
  }
  uncharge() {
    this.combat.uncharge('player')
  }
  push() {
    this.combat.push('player', performance.now())
  }
  parry() {
    this.combat.parry('player', performance.now())
  }
  /** Your aim (null = your default target). */
  aim(target: Fid | null) {
    this.combat.aim('player', target)
  }
  /** Who your spell would go to right now (for the highlight). */
  targetFor(el: string, shape: string) {
    return this.combat.targetOf('player', el, shape)
  }

  private bot(id: Fid, now: number) {
    // Interrupted or knocked down: its spell is gone; it starts over a bit later.
    const knocked = this.combat.view(now).knocked[id]
    if (this.casts[id] && (this.combat.isSilenced(id, now) || !this.combat.chargeOf(id) || knocked !== (this.knockedSeen[id] ?? 0))) {
      this.casts[id] = null
      this.nextAt[id] = now + this.gapMs / 2
    }
    this.knockedSeen[id] = knocked
    const pool = this.pools[id] ?? []
    if (!this.casts[id] && pool.length && now >= (this.nextAt[id] ?? 0) && !this.combat.isSilenced(id, now)) {
      const [el, shape] = dummyPick(pool, this.combat.view(now).shroud[id] > 0)
      const sp = spellOf(el, shape, this.castPct / 100)
      const signs = signsFor(el) // a combo: C, then its two letters, spread over the charge
      this.casts[id] = { ...sp, start: now, ends: now + sp.chargeMs + sp.drawMs + sp.readyMs, signs: signs.slice(1).map((l, i) => ({ at: now + (sp.chargeMs * (i + 1)) / signs.length, el: l })) }
      // Aimed as it starts, so you can see it's coming at you.
      this.combat.aim(id, el === 'H' ? null : 'player')
      this.combat.sign(id, signs[0], now)
    }
    const c = this.casts[id]
    while (c?.signs?.length && now >= c.signs[0].at) this.combat.sign(id, c.signs.shift()!.el, now)
    if (c) this.combat.drawing(id, now)
    if (c && now >= c.ends) {
      this.casts[id] = null
      this.nextAt[id] = now + this.gapMs * (1 + (Math.random() * 2 - 1) * JITTER)
      this.combat.drew(id, c.shape, now)
      this.combat.push(id, now)
    }
  }

  private castView(id: Fid, now: number): OppCast | null {
    const e = this.casts[id]
    if (!e) return null
    const t = now - e.start
    const phase = t < e.chargeMs ? 'charge' : t < e.chargeMs + e.drawMs ? 'draw' : 'ready'
    const drawn = e.drawMs ? Math.max(0, Math.min(1, (t - e.chargeMs) / e.drawMs)) : 1
    return {
      el: e.el,
      name: phase === 'ready' ? e.name : null,
      color: e.color,
      phase,
      points: e.points.slice(0, Math.max(0, Math.ceil(drawn * e.points.length))),
      view: { aspect: 1, fit: 'contain' },
      progress: t / (e.ends - e.start),
    }
  }

  update(now: number): TeamSnapshot {
    this.combat.update(now)
    if (this.attacking) for (const id of FOES) this.bot(id, now)
    const casts: Record<Fid, OppCast | null> = {}
    for (const id of FOES) casts[id] = this.attacking ? this.castView(id, now) : null
    return { ...this.combat.view(now), casts, enemyCast: casts.enemy ?? null, running: true }
  }
}
