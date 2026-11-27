# Bot tags: spells described by what they do, bots pick by tag

Goal: a new signature, combo, or Angelic/Unholy spell needs only tags, a draw time, and one sim run. No per-bot edits.

## Now
- Skill knobs (`AiStyle` in battle.ts) don't depend on specific spells. Keep them.
- Tied to specific spells: per-bot `combos`/`magic` lists, the combo fit table in `comboSpell`, spell names inside habits (setup, curser, shadow, spammer) and in `utilitySpell`.

## 1. Tags on spells (spells.ts)
One table, `SPELL_TAGS: Record<spellId, Tag[]>`, next to `COMBOS`/`SIGNATURE`. Tags (first set):
- `setup`: puts a debuff on the target (chill, Exposed, no-heal, doom)
- `payoff`: hits harder into a debuff (Execute)
- `antiHeal`: punishes or blocks a heal (Grave)
- `antiDraw`: good while the target is drawing (Plasma, Glacier)
- `antiLight`: punishes light spam (Storm)
- `burst`: big damage for a stunned or silenced target (Magma)
- `stopper`: stuns, locks, or freezes
- `shield`, `stealth`, `selfHeal`, `comeback` (good when low: Twilight)
- `fast` / `slow` (read off draw time, not tagged by hand)

## 2. Fit rules by tag (battle.ts)
Replace the name-keyed `fit` table with tag rules:
`antiHeal: youHealed ? 5 : 0.3`, `antiDraw: drawing ? 4 : 0.8`, `burst: silenced > 1200 ? 4 : 1`…
A spell's weight is the max of its tags' weights. A new combo is played well right away.

## 3. Kits by tag or tier
- `combos`/`magic` per bot become optional filters: `comboTags?: Tag[]`, or `comboTier` (all combos up to tier N).
- Keep explicit lists only where a bot's identity needs them (Hexer = Grave). A new combo then reaches every bot whose filter matches.

## 4. Habits by tag
- setup: any `setup` spell it has, then the best `payoff`/heavy that lands in time (payoffSpell already works this way).
- curser: `setup` with a long debuff → `payoff`. shadow: `stealth`. spammer: freshest `fast` light.
- utilitySpell: weights by tag (`payoff` when target is cursed and unarmored, `shield` when not shielded…).

## 5. Check
- Before changing anything, run ladder-sim and duo-sim and save the win rates as a baseline.
- After each step, re-run. Win rates should match the baseline within noise (10–40 games per pairing swings ±10–20%); look for order breaking, not small shifts.
- Then add a test spell with only tags, check that bots use it at sensible moments, and remove it.

## Status (Nov 27): steps 1–4 done
Sims after each step matched the baseline within noise. Tag filters checked:
`comboTags: ['antiHeal', 'antiDraw']` → Plasma + Grave; `magicTags: ['payoff']` → Execute. No bot uses the tag filters yet.
Spells only in game rules (Shroud hides casts, Doom isn't a direct hit) stay by name: those are what the spell does, not bot choices.

## Order
1 → 2 → (sim) → 4 → (sim) → 3 → (sim). Each step is a separate, revertible change.

## Later: spell batches + patch notes (only once the game is advertised / on paid hosting)
Not now: the game is early and changes fast. When it launches publicly:
- Add spells in batches (3–6): tags, draw times, sims, fix outliers, playtest, ship together.
- In-game "What's new" screen on the first open after an update: new spells, changed numbers, changed tower wizards.
- Mark changed wizards on the ladder ("updated" / "Not cleared since update") so players have a reason to fight them again.
- Ranked: apply balance patches at season start.

## New spell checklist (after this)
Tags, draw time in `DRAW_MS`, ladder-sim + duo-sim, balance.md entry. Hand-tune a bot only if the sim flags it.
