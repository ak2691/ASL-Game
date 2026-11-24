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
| 7 | Zealot | Fire plus Angelic and Unholy. Throws Sunfire and Twilight. |
| 8 | Warden | All five elements, punishes spam. Throws Magma and Advancing Glacier. |
| 9 | Adept | A real wizard: every spell. Only punishes mashing. |
| 10 | Magus | Reads your habits, punishes a silence, starts countering your combos. |
| 11 | Archmage | Faster, dodges your counters, smashes your Glacier. |
| 12 | Lich | Very fast, reads you almost perfectly, every combo. |
| 13 | Ascendant | The finale: the whole kit, used on purpose, no mistakes. |

## The five wizards

| | Adept | Magus | Archmage | Lich | Ascendant |
|---|---|---|---|---|---|
| Wait between casts | 0.95 s | 0.8 s | 0.7 s | 0.65 s | 0.6 s |
| Cast speed (share of base time, lower = faster) | 0.68 | 0.62 | 0.57 | 0.55 | 0.53 |
| Speeds up during the fight | no | no | up to 10% | up to 10% | up to 10% |
| Reaction time | 0.9–1.2 s | 0.8–1.05 s | 0.7–0.95 s | 0.65–0.88 s | 0.58–0.78 s |
| Counters your charge | 40% | 48% | 56% | 60% | 66% |
| Counters with a full circle (vs an interrupt) | 30% | 35% | 45% | 50% | 60% |
| Counter mistakes (wrong element) | 5% | 10% | 7% | 4% | 0% |
| Counters the same element 3x in a row (timed to your pace) | 80% | 85% | 90% | 92% | 95% |
| Reads your patterns | 30% | 45% | 65% | 90% | 100% |
| Counters your heal | 25% | 50% | 65% | 80% | 88% |
| Parries your heavy / signature (tries) | 22% / 28% | 30% / 35% | 42% / 46% | 45% / 50% | 50% / 55% |
| Parry lands (light / heavy / signature) | 42 / 59 / 66% | 45 / 64 / 71% | 48 / 68 / 76% | 50 / 71 / 79% | 53 / 75 / 84% |
| Drops its own spell to counter you | 5% | 15% | 28% | 33% | 38% |
| Dodges your counter | never | 5% | 15% | 32% | 38% |
| Punishes when you're silenced | no | yes | yes | yes | yes |
| Heals itself below | 30% HP | 33% | 36% | 40% | 40% |
| Angelic/Unholy spell chance per cast | 8% | 12% | 20% | 26% | 30% |
| Combo chance per cast | 15% | 17% | 19% | 22% | 26% |
| Counters your combo | 20% | 40% | 65% | 85% | always |

**Cast speed** scales the base times: charge 0.7 s, draw (line 0.6 s, H 1.8 s, signatures 1.8–2.5 s, Angelic/Unholy 1.8–2.4 s, combos 2.4–2.9 s, circle 0.7 s), then 0.5 s before it throws. 0.53 means about half of those.

- **Adept:** counters now and then, punishes mashing (the same element 3 times in a row gets interrupted, timed to land before you throw) and starts parrying.
- **Magus:** the same brain as Archmage at half strength. Punishes a silence, makes more mistakes, never dodges.
- **Archmage:** faster, leans on your patterns, punishes a silence with its biggest safe spell, and starts dodging your counters.
- **Lich:** very fast and reads you almost fully. A second heal soon after the first may get punished with a Thunderbolt instead of countered.
- **Ascendant:** everything Lich does, a touch slower, with no mistakes and every combo used at the right moment.

## The intro bots

They never punish a silence and never dodge; only Warden reads you. Each one only counters with its own elements. Most show "Counter with X" under their charge.

| Bot | Attacks | Angelic/Unholy | Combos | Wait | Speed | Counters you | Spam counter | Parries (heavy / sig) |
|---|---|---|---|---|---|---|---|---|
| Pebble | Earth, Water, mostly heavies, taking turns | none | none | 2 s | 1.0 | 5% | 25% | never |
| Ember | Fire, Lightning, never the same twice | none | none | 1.8 s | 0.95 | 10% | 35% | never |
| Frost | Ice, Fire | none | Thermal Shock (15%) | 1.7 s | 0.9 | 20% | 50% | never |
| Cleric | Water, Ice | Aegis, heals below 60% | none | 1.6 s | 0.9 | 15% | 50% | 10% / 15% |
| Hexer | Earth, Lightning | Doom, Shroud, Execute | Grave (14%) | 1.45 s | 0.85 | 25% | 55% | 12% / 15% |
| Tide | Water, Ice, Lightning | heals below 30% | Storm (17%) | 1.3 s | 0.8 | 35% | 60% | 15% / 20% |
| Zealot | Fire, Earth | all, heals below 35% | Sunfire, Twilight (17%) | 1.25 s | 0.78 | 35% | 60% | 18% / 20% |
| Warden | all 5 elements, reads you a little | rare | Magma, Advancing Glacier (15%) | 1.15 s | 0.75 | 38% | 75% | 20% / 25% |

All of them throw lights, heavies and some signatures.

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

## Angelic and Unholy

Each cast first rolls the Angelic/Unholy chance. If it passes, the spell is picked by the moment:

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
- Nov 24, 2026: balance pass (plans/balance.md). Every opponent ~15–25% faster, spam counters on every rung that can counter and timed to your pace, smart ones rotate elements to avoid wear and wait out their own heavy's wind-up.
- Nov 24, 2026 (later): rebuilt from the balance plan (plans/balance.md). Every rung much faster, intro bots throw signatures, parrying from Cleric up (easier vs bigger spells, more vs a spammed spell), Cleric/Hexer/Zealot got a second element, readers throw big spells while you draw and lights while you're idle. One-hand mode removed, so the AI always parries.
- Nov 25, 2026: playtest fixes. Combos have their own drawing times by complexity (Grave 3 s up to Plasma 4.2 s at speed 1), and faster opponents only speed up simple drawings fully (signatures half, combos 30%). Combo letters and combo counterspells are signed at about a person's pace, and recognizing a combo takes it 0.4 s longer. Fewer combo counters (Adept 10%, Magus 25%, Archmage 50%, Lich 75%). Intro bots 1–7 now actually show "Counter with X" (it was never displayed). Warden combo chance 12%.
- Nov 25, 2026 (later): intro bots also hint the combo counterspell ("Counter with C, Ice, Water") once a combo locks in; Warden shows it for combos only, after 1.5 s.
- Nov 25, 2026 (interrupts): its interrupts follow the same rules as yours: a miss locks it out for 1 s, a landed one locks you out for 0.75 s. Its `miss` share (wrong-element counters) now costs it that second.
