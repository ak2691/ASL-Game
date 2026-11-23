# Bot difficulty & custom bots

Ladder implemented Nov 22 2026 (see `AI Difficulty.md`). Custom difficulty still planned.

Problem: practice AI is hard even on easy. Learning curve = elements + counters + spells all at once. Keep current AI as is; add easier, configurable options.

## Element limits
- Bot uses a chosen subset of elements, minimum 2.
- Fewer elements = fewer counters to remember (e.g. Earth + Water: Ice counters Earth, Lightning counters Water).
- Gives a learning progression: unlock more elements as the player improves.

## Personalities (presets)
- Named bots tied to element pairs, e.g. "one with the planet" = Earth + Water.
- Beginner/practice bot: only casts heavies, slowly, so new players learn to counter.
- No separate AI per combo; presets are just saved settings over one AI.

## Custom difficulty
Normal settings:
- Elements used
- Cast speed
- Wait time between casts
- Chance to counter
- Counter reaction speed
- Attack vs defend preference

Advanced settings (optional):
- Pattern recognition
- "Thinking" / decision logic knobs
- Any other tuning values already in the AI

## Notes
- Expose existing AI tuning constants as settings rather than writing new behaviour.
- Respect combos-disabled rule: no combos/Mirror in any of this UI.

## Bot ladder (draft, Nov 22 2026)
Counter cycle: Water > Fire > Ice > Earth > Lightning > Water.
Intro bots don't react to the player; each bot adds one new thing.

| # | Bot | Elements | Spells | Pace | Behaviour | Teaches |
|---|---|---|---|---|---|---|
| 1 | Pebble | Earth, Water | Heavies only | Very slow (~7 s cycle) | Alternates E, W. Never counters, never heals | Ice beats Earth, Lightning beats Water |
| 2 | Ember | Fire, Lightning | Heavies + lights | Slow | Random, no repeats. Never counters | Water beats Fire, Earth beats Lightning. Lights are faster, so read quicker |
| 3 | Frost | Ice, Fire | Heavies, lights | Slow | Sometimes interrupts your spell (15%, slow). Never full circle | Fire beats Ice; you can get countered, so vary |
| 4 | Cleric | Holy, Water | Water heavies/lights, heals, Aegis | Slow | Heals often, Aegis on your wind-up. Never counters | Countering heals, chipping armor with lights |
| 5 | Hexer | Unholy, Earth | Earth attacks, Doom, Shroud, Execute | Slow | Doom often, Execute when you're low. Sometimes interrupts | Holy beats Unholy, beating the Doom timer, playing blind under Shroud |
| 6 | Tide | Water, Ice, Lightning | + signatures, heals | Medium-slow | Counters 25% (circles too). Heals low | 3 elements at once, signatures, heals |
| 7 | Zealot | Holy, Unholy, Fire | Fire attacks, heals, Aegis, Doom, Shroud, Execute | Medium-slow | Swaps between Holy and Unholy, Fire for damage. Counters 25% | Telling Holy from Unholy fast and picking the right answer |
| 8 | Warden | All 5 | Full kit, rare Holy/Unholy | Medium-slow | Punishes spam (3x same element). No reads | Everything, still forgiving |
| — | Novice | All + Holy/Unholy | Full | Current Easy | Current Easy AI | |
| — | Normal | | | Current Medium | | |
| — | Hard | | | Current Hard | | |
| — | Insane | | | Current Insane | | |

- Bots 1–3 cover every counter element (Ice, Lightning, Water, Earth, Fire).
- Early bots show a "counter with X" hint on incoming spells (1–5 on, 6–7 fade, 8 off).
