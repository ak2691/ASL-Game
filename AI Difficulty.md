# Practice AI: how each opponent plays

The practice ladder has 13 opponents. The first 8 are intro bots that each teach one thing; the last 5 are full wizards that get faster and smarter as you climb. Numbers come from the `AI` table in `apps/web/src/battle.ts` (keep this file in sync when it changes).

## The ladder

| # | Opponent | In one line |
|---|---|---|
| 1 | Pebble | Slow Earth and Water heavies, taking turns. Shows you the counter. |
| 2 | Ember | Fire and Lightning, never the same twice. |
| 3 | Frost | Ice and Fire, sometimes interrupts you. First combo: Thermal Shock. |
| 4 | Cleric | Water, heals a lot, hides behind Aegis. |
| 5 | Hexer | Earth plus curses (Doom, Shroud, Execute). Throws Grave. |
| 6 | Tide | Water, Ice, Lightning, counters a quarter of the time. Throws Storm. |
| 7 | Zealot | Fire plus Holy and Unholy. Throws Sunfire and Twilight. |
| 8 | Warden | All five elements, punishes spam. Throws Magma and Advancing Glacier. |
| 9 | Adept | A real wizard: every spell. Only punishes mashing. |
| 10 | Magus | Reads your habits, punishes a silence, starts countering your combos. |
| 11 | Archmage | Faster, dodges your counters, smashes your Glacier. |
| 12 | Lich | Very fast, reads you almost perfectly, every combo. |
| 13 | Ascendant | The finale: the whole kit, used on purpose, no mistakes. |

## The five wizards

| | Adept | Magus | Archmage | Lich | Ascendant |
|---|---|---|---|---|---|
| Wait between casts | 2.35 s | 1.41 s | 0.94 s | 0.71 s | 0.72 s |
| Cast speed (share of base time, lower = faster) | 1.05 | 0.82 | 0.70 | 0.53 | 0.56 |
| Speeds up during the fight | no | up to 10% | up to 10% | up to 10% | up to 10% |
| Reaction time | 1.3–1.8 s | 0.9–1.2 s | 0.65–1.0 s | 0.53–0.82 s | 0.56–0.82 s |
| Counters your charge | never | 32% | 52% | 54% | 60% |
| Counters with a full circle (vs an interrupt) | n/a | 41% | 45% | 54% | 60% |
| Counter mistakes (wrong element) | n/a | 12% | 12% | 5% | 0% |
| Counters the same element 3x in a row | 45% | 77% | 81% | 81% | 85% |
| Reads your patterns | no | 45% | 54% | 90% | 100% |
| Counters your heal | never | 59% | 72% | 81% | 85% |
| Drops its own spell to counter you | never | 9% | 18% | 36% | 40% |
| Dodges your counter | never | never | 18% | 36% | 40% |
| Punishes when you're silenced | no | yes | yes | yes | yes |
| Heals itself below | 25% HP | 35% | 40% | 40% | 40% |
| Holy/Unholy spell chance per cast | 5% | 15% | 22% | 28% | 30% |
| Combo chance per cast | 10% | 12% | 15% | 18% | 24% |
| Counters your combo | never | 30% | 60% | 80% | always |

**Cast speed** scales the base times: charge 0.7 s, draw (line 0.6 s, H 1.8 s, signatures 1.8–2.5 s, Holy/Unholy 1.8–2.4 s, combos 2.4–2.9 s, circle 0.7 s), then 0.5 s before it throws. 0.53 means about half of those.

- **Adept:** slow and never counters on its own. It only punishes mashing: it interrupts an element you repeat and throws stoppers at unanswered spam.
- **Magus:** the same brain as Archmage at half strength. Punishes a silence, makes more mistakes, never dodges.
- **Archmage:** faster, leans on your patterns, punishes a silence with its biggest safe spell, and starts dodging your counters.
- **Lich:** very fast and reads you almost fully. A second heal soon after the first may get punished with a Thunderbolt instead of countered.
- **Ascendant:** everything Lich does, a touch slower, with no mistakes and every combo used at the right moment.

## The intro bots

They never read you, never punish a silence and never dodge. Each one only counters with its own elements. Most show "Counter with X" under their charge.

| Bot | Attacks | Holy/Unholy | Combos | Wait | Speed | Counters you | Shows the counter |
|---|---|---|---|---|---|---|---|
| Pebble | Earth, Water heavies, taking turns | none | none | 4 s | 1.4 | never | yes |
| Ember | Fire, Lightning, light + heavy | none | none | 3.5 s | 1.3 | never | yes |
| Frost | Ice, Fire, light + heavy | none | Thermal Shock (12%) | 3.2 s | 1.25 | 15%, slow | yes |
| Cleric | Water, light + heavy | Aegis, heals below 70% | none | 3.2 s | 1.25 | never | yes |
| Hexer | Earth, light + heavy | Doom, Shroud, Execute | Grave (12%) | 3 s | 1.2 | 15% | yes |
| Tide | Water, Ice, Lightning | heals below 30% | Storm (15%) | 2.8 s | 1.15 | 25% | after 0.9 s |
| Zealot | Fire, light + heavy | all, heals below 35% | Sunfire, Twilight (15%) | 2.6 s | 1.1 | 25% | after 0.9 s |
| Warden | all 5 elements | rare | Magma, Advancing Glacier (12%) | 2.6 s | 1.1 | only vs spam | no |

## Combos

Which ones each opponent throws is in the tables above. How it uses them:

- **Intro bots** throw their combos at random now and then.
- **Magus and up** pick the combo that fits the moment: Grave right after you heal, Plasma or Advancing Glacier while you're drawing, Storm when you spam light attacks, Thermal Shock when you're burning or chilled, Steam after a run of your hits, Magma when you're silenced, Twilight or Sunfire when it's hurt.
- It never throws the same combo twice in a row, and it signs C and both letters like you do, so you can see it coming and counter it.
- **Countering your combos:** a combo you're still mixing isn't a target. Once you start drawing, it may answer with C + the two elements that beat yours + a circle.
- **Your Advancing Glacier:** once per Glacier it may answer with C, Fire, Ice and a circle.

## How the smarter ones think (Magus and up)

- **Memory:** your last 6 throws (light or heavy) and last 5 charged elements.
- **Patterns:** repeats (AA), alternating (ABAB) and 3-step loops (ABC ABC). Longer ones are treated as noise.
- **Expects a heavy:** counters more, faster, mostly with a circle (85%). Each heavy you throw in a row makes its circle 12% faster, down to 55% of normal.
- **Expects a light:** fast interrupts, and sometimes a stopper (Frozen Prison, Earthquake or Lightning).
- **Expects an element:** counters it sooner.
- **Repeat heal within 12 s (Archmage and up):** counters it almost always, at double speed.
- **Learns your pace:** your fastest of the last 3 charge-to-throw times. When it expects your move it reacts in time to land first, but never faster than 250 ms.
- A circle that can't land before your throw becomes a quick interrupt. After any counter it attacks again within 0.25–0.5 s.
- **When you're silenced:** it hits back at once with the biggest spell that lands before you can react.
- **Static pulses:** it holds a finished spell through the pulse and throws in the gap (Adept throws blindly and fizzles).

## Holy and Unholy

Each cast first rolls the Holy/Unholy chance. If it passes, the spell is picked by the moment:

- **Execute:** much more likely when you're under 40% HP; saved until your armor is gone.
- **Doom:** normal odds, more likely while you have armor.
- **Shroud:** never while it's already Shrouded. After its Shroud lands it casts again right away, and that spell leans big.
- **Aegis:** never while it still has armor. When you wind up a heavy or signature it may cast Aegis first (more often on harder levels).
- **Your armor:** it chips it with light attacks. Lich and Ascendant sometimes wait a second to let it drain.
- **Your Shroud:** it's blind. Once per charge it guesses: a random counterspell, or rushing its own spell.
- **Doomed:** it skips its wait and throws a light attack at once.

## Rules it plays by (the same as yours)

- Dropping a half-drawn spell fizzles it (0.5 s throw lock). Switching element takes the same letter hold.
- Dodging needs a real threat: a circle readied, or the counter element charged while drawing. It won't bail in the last 0.5 s, and each bluff you get away with halves its dodge chance.
- Quick interrupts can't be dodged.

## Changes

- Nov 22, 2026: Easy/Medium/Hard/Insane renamed Adept/Magus/Archmage/Lich. After the first playtest all four got 10% easier.
- Nov 23, 2026: combos added across the ladder; Adept to Lich slowed about 7% to make room; Lich now makes rare mistakes; Ascendant added as the final opponent.
