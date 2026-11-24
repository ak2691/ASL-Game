# Adding a spell: the AI checklist

Every new spell changes what the practice AI should do: cast it, answer it, or both. Use this before building any spell.

## 1. Sort the spell

| Tier | What it is | AI work |
|---|---|---|
| **Filler** | A plain attack with a small passive (a new light, a heavy, a minor signature) | Add it to the move pool and weights. Nothing else. |
| **Situational** | Strong at a certain moment (a heal, a stun, armor, a curse) | A "when it fits" rule for the AI's own use, and a rule for answering yours |
| **Meta-changing** | Changes how fights are played (invincibility, a new defense, a delayed nuke, a new counter type) | Full design pass: AI use, AI answers, ladder placement, sim check. **Ask the user first** (see 3). |

When in doubt, treat it as the next tier up.

## 2. Where the AI lives (`apps/web/src/battle.ts`)

| Hook | Used for |
|---|---|
| `DRAW_MS` | How long the AI takes to draw it. Complex drawings get their own time; `speedFor` limits how much harder rungs speed them up |
| `ENEMY_MOVES`, `moves`, `LHS` | Weights for attacks |
| `utilitySpell` | Angelic and Unholy spells, with "fits the moment" weights |
| `comboSpell` → `fit` | Combos, weighted by the moment |
| `react` | Countering your charge (elements, heals, combos) |
| `parryCheck` | Parrying your thrown spells |
| `punish` | What it throws after stunning you |
| `aegisCheck`, `breakGlacier`, `punishHeal` | Special answers to one spell |
| `hint` | The "Counter with X" line on intro bots |
| `AI` table / `AiStyle` | Per-rung numbers: which rungs get the spell and how often |

Also update: `AI Difficulty.md` (keep it in sync), the dummy's spell pool (`settings.ts`), the Info page, and the cast guide.

## 3. Questions to ask the user (situational and meta-changing spells)

1. **Which rungs use it?** From which opponent up, and how often (per-cast chance)?
2. **When does the AI cast it?** The moment it's best (e.g. "Aegis when you wind up a heavy"). Should lower rungs cast it randomly instead?
3. **How does the AI answer yours?** Counter it, wait it out, punish after it, ignore it? Does that differ by rung?
4. **Does it break an existing answer?** E.g. does it make Glacier, Doom, counterspells or parries pointless? If so, what's excluded?
5. **Is it a cop-out?** Can a player use it to skip a decision the game wants them to make? (This is why Sanctuary is on hold.)
6. **Should intro bots teach it?** A hint, or a bot whose job is to show it?

## 4. Check it

- `sim.mts`-style headless fights (a scripted player against each rung): the spell shouldn't make one strategy beat the ladder, and the AI shouldn't win only by spamming it.
- The AI's cast time against a reliable human's: a new combo or signature shouldn't be faster for the AI than for a person.
- Playtest the rungs that got it.

## Log

- Nov 25, 2026: Holy renamed Angelic (signed A). Sanctuary (2 s invincibility, ankh drawing) designed but on hold: it was a cop-out answer to Glacier and Doom. If revived: Doom's countdown keeps running, and a Glacier that lands during it waits and hits when it ends.
