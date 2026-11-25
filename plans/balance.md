# Balance plan (Nov 24, 2026), built Nov 24

Goal: winning takes variety. Mix lights and heavies (jab, then hook when there's an opening), use every element, defend as well as attack. Spamming one thing, or only attacking, or only defending, should lose.


## Rules

| Rule | Value |
|---|---|
| Wear | By element. Light +½ stack; heavy, signature, Angelic/Unholy +1. Each stack −30% damage and heals, floor 30% (Nov 24: was 40%). A stack fades every 8 s (Nov 24: was 5 s; two elements alternated recovered fully). Stacks cap at the floor. Damage only. |
| Combo wear | Hits at the average of its two elements' power, adds 1 stack to each. |
| Heavy | No wind-up. Stricter H (both posts full height, crossbar between): ~1.1 s to draw. |
| Parry windows | Light 100 ms, heavy 150, signature 200, combo 150 (Nov 25: tightened after a playtest; signatures were ~100% parryable when focused). Glacier can't be parried. |
| Flight times | Light 320 ms, heavy 700, signature 850, combo 900. |
| Reflection | First 50%, then 35%, then the chain ends. A reflection flies 1.5× faster and its re-parry window is 100 ms. |
| Static | Every pulse 0.5 s (Storm 0.35 s), gaps unchanged. |
| One-hand mode | Removed. Two hands only. |
| Wear meter | A rail of every element with its %, left-middle of your half; the opponent's on the right (2v2 cards: worn elements only). Your charge shows its power ("Fire 62%"). |

## Spell numbers (changes in bold)

| | Light | Heavy | Effect |
|---|---|---|---|
| Fire | 7 | **18** | burn 4 / 8 |
| Earth | 10 | **24** | |
| Water | 6 | **16** | heals half of what it deals |
| Lightning | 5 | **16** | static: 1 / **3** pulses |
| Ice | 5 | **12** | chill 25% / **50%** |

Signatures: Frozen Prison **24** + 1 s silence + **60%** chill. Tidal Wave heal **28**. Thunderbolt **28** (it was the weakest spell per second). Combos keep the ~30% buff already in place.

## Per-spell math

Cycle = sign to throw for a reliable (not fast) human. Value includes burn, half of Water's heal, and a rough damage-equivalent for chill, static, silence and knock-down.

| Spell | Value | Cycle | DPS (raw) |
|---|---|---|---|
| Light (any) | 8–11 | 1.1 s | 7–10 |
| Heavy (any) | 21–26 | 1.85 s | 11–14 |
| Signature | 48–53 (Thunderbolt 37) | 2.55 s | 19–21 (14.5) |
| Combo | 70–95 | 4.05 s | 17–23 |

The opponent's state decides what's worth throwing (average defender):

| Thrown at… | Light Fire | Heavy Fire | Meteor |
|---|---|---|---|
| An idle opponent (watching, hands free) | 9.5 DPS | 5.4 (35% countered, 25% parried) | 4.8 (42% / 37%) |
| A busy opponent (mid-drawing) | 9.9 | 11.8 (7% / 6%) | 15.4 (8% / 9%) |

Jab when they're idle, hook when they're busy or silenced. Combos are mostly safe from counters (they need C + two elements + circle) but are the hardest to draw: a new player misdraws ~45% of them.

Element loops (heavies back to back, no defense): Fire only 6.3 DPS, Fire/Earth 7.7, Fire/Earth/Water 13.6, all five about the same with the Lightning and Ice utility counted. A fixed loop is also easy for the opponent and the AI to read.

## Ladder

Simulated win rates (model: two fighters on the same rules, 120 fights each). Player types:
- **Day-1 spammer:** Heavy Fire only, no defense.
- **Day-2 attacker:** mixes attacks, slow, misdraws often, barely defends.
- **Week-1:** counters sometimes, parries some heavies, a few combos.
- **Decent** and **good:** faster and more reliable at everything.

| # | Opponent | Day-1 spammer | Day-2 attacker | Week-1 | Decent | Good |
|---|---|---|---|---|---|---|
| | *now* → *proposed* | | | | | |
| 1 | Pebble | 92 → 0% | 100 → 92% | 100% | 100% | 100% |
| 2 | Ember | 100 → 9% | 100 → 92% | 100% | 100% | 100% |
| 3 | Frost | 45 → 0% | 100 → 59% | 97% | 100% | 100% |
| 4 | Cleric | 0% | 88 → 66% | 99% | 100% | 100% |
| 5 | Hexer | 86 → 2% | 100 → 76% | 100% | 100% | 100% |
| 6 | Tide | 0% | 91 → 16% | 100 → 92% | 98% | 100% |
| 7 | Zealot | 0% | 88 → 0% | 100 → 67% | 85% | 100% |
| 8 | Warden | 0% | 82 → 2% | 99 → 62% | 79% | 100% |
| 9 | Adept | 3 → 0% | 79 → 0% | 100 → 39% | 100 → 72% | 99% |
| 10 | Magus | 0% | 13 → 0% | 93 → 12% | 99 → 47% | 100% |
| 11 | Archmage | 0% | 0% | 40 → 0% | 79 → 10% | 100 → 68% |
| 12 | Lich | 0% | 0% | 7 → 0% | 27 → 1% | 97 → 43% |
| 13 | Ascendant | 0% | 0% | 0% | 3 → 0% | 30 → 22% |

- 1–5: an attack-only player still gets through, but spam doesn't.
- 6–8: you need to defend (Week-1 wins about 60–90%).
- 9–10: you need to play well.
- 11–13: you need to be good. Ascendant is about 1 in 5 for a good player. Hard, not impossible.

### Proposed AI settings

Speed is the share of base cast time (lower = faster); wait is the pause between casts.

| # | Opponent | Speed | Wait | Counters | Spam counter | Parry tries (heavy / sig) | Notes |
|---|---|---|---|---|---|---|---|
| 1 | Pebble | 1.0 | 2.0 s | 5% | 25% | — | adds some lights and signatures |
| 2 | Ember | 0.95 | 1.8 s | 10% | 35% | — | adds signatures |
| 3 | Frost | 0.9 | 1.7 s | 20% | 50% | — | Thermal Shock 15% |
| 4 | Cleric | 0.9 | 1.6 s | 15% | 50% | 10% / 15% | Water + Ice; heals below 60%; first bot that parries |
| 5 | Hexer | 0.85 | 1.45 s | 25% | 55% | 12% / 15% | Earth + Lightning, plus curses |
| 6 | Tide | 0.8 | 1.3 s | 35% | 60% | 15% / 20% | Storm 17% |
| 7 | Zealot | 0.78 | 1.25 s | 35% | 60% | 18% / 20% | Fire + Earth, plus Angelic/Unholy |
| 8 | Warden | 0.75 | 1.15 s | 38% | 75% | 20% / 25% | first one that reads patterns |
| 9 | Adept | 0.68 | 0.95 s | 40% | 80% | 22% / 28% | |
| 10 | Magus | 0.62 | 0.8 s | 48% | 85% | 30% / 35% | |
| 11 | Archmage | 0.57 | 0.7 s | 56% | 90% | 42% / 46% | |
| 12 | Lich | 0.55 | 0.65 s | 60% | 92% | 45% / 50% | |
| 13 | Ascendant | 0.53 | 0.6 s | 66% | 95% | 50% / 55% | |

- **Single-element bots get a second element.** Wear would otherwise cripple them; Cleric, Hexer and Zealot keep their identity through their Angelic/Unholy spells.
- **Parry tries go up 1.6× against a spell you've thrown 3 times in a row.**
- **Parry aim goes from ~45% on a heavy at Cleric to ~75% at Ascendant,** following the bigger windows. Signatures are easier to parry than heavies, lights much harder.
- **Smart ones (Warden and up):**
  - Throw heavies and signatures when you're drawing or silenced, lights when you're idle.
  - Rotate toward their least-worn element.
  - Wait out your static pulses.
  - Skip a parry that would cost them a nearly finished heavy or signature.

## Caveats

- The model is rough. It values utility (chill, static, silence) in damage terms and leaves out Angelic/Unholy, Aegis and team play.
- It assumes AI cast times are ~1.55× a reliable human's, and it has no player who adapts mid-fight. Treat the ladder as a starting point.
- After building, rerun the in-game AI sim and playtest, especially rungs 6–8 and Ascendant.

## Defenses (Nov 24, later)

| | What it does | Best against |
|---|---|---|
| Parry | Sends their spell back at half power | Anything already flying |
| Interrupt | Their spell fizzles and they're locked out (no signing, drawing or throwing) for 0.75 s. A miss ("Whiffed") locks you out for 1 s. | Stopping a cast when you're sure |
| Counterspell | Stunned until your next spell hits them, at most 3 s | Signatures, combos, heals, reads |

Every stun (counterspell 3 s, Frozen Prison 1 s, Plasma 2 s) ends early when whoever stunned you hits you: one guaranteed follow-up, never a free chain.

Still open: loosen the circle (testers struggled to draw it) and show a big stun countdown on a stunned opponent.

## Playtest fixes (Nov 25)

- Advancing Glacier takes 6.5 s (was 5 s); no "Crushed!" text; its impact sound no longer plays after it's shattered (impact sounds now play on landing, so parried spells are silent too).
- AI drawing: per-combo times by complexity; signatures and combos barely speed up on harder rungs; combo letters and combo counters at human pace. See AI Difficulty.md.
- Intro bots show "Counter with X" (was computed but never shown).
- Open: audio dropping out under heavy fire, camera lag during Steam/Storm.
- Circle: needs 50% confidence (was 70%), and a closed loop that leans circle (30%+) counts when the drawing would otherwise fizzle.
- Training dummy: combos sign C and both letters 100 ms apart (longer at slower cast times), then draw; the cast-time setting lists combo times; the counter hint covers combos.
- Interrupts (Nov 25): landed = 0.75 s full lockout on them; missed = 1 s lockout on you ("Whiffed"). Missed counterspells have no extra cost. Re-holding the same letter after a throw recharges after 0.1 s (was 0.4 s).

## Rundown after wear passives, Plasma, Grave (Nov 24, late)

Cast time = sign + draw + ready, at a person's pace (sign 0.7 s, combo letters 1.2 s, ready 0.5 s; draw from
battle.ts DRAW_MS). "Value" = damage + heal + a rough worth for the effect. All fresh (100% power).

### Elements (light 1.8 s, heavy 3.0 s)
| El | Light | Heavy | Why it's viable |
|---|---|---|---|
| E | 10 | 24 | Hardest raw hits, no effect. The baseline. |
| F | 7+4 | 18+8 | Most damage over time; burn now worn too. |
| W | 6 (+3) | 16 (+8) | Lower hit, heals half. Best sustain. |
| L | 5 +1 pulse | 16 +3 pulses | Lowest hit; static stops their throws. Only at 70%+ power, so only the first L every ~5 s. |
| I | 5 +25% | 12 +50% | Lowest hit; chill boosts your next hit (scaled by wear). |
Heavies land at 8-9 value/s, lights 5.5-6/s but are hard to counter and wear half as much. Fine.

### Signatures (3.2-3.7 s)
| Spell | Value | /s | Note |
|---|---|---|---|
| Meteor | 50 | 13.5 | Most damage. |
| Tidal Wave | 25 + 28 heal | 15.6 | **Watch:** best swing of any signature. |
| Thunderbolt | 28 + 3 tight pulses | ~10 | Lockdown, not damage. |
| Earthquake | 38 + knockdown | ~12 | Wastes their sign. |
| Frozen Prison | 24 + 1 s silence + 60% chill | ~11 | Works on any element. |

### Combos (4.7-5.9 s)
| Combo | Value | /s | Note |
|---|---|---|---|
| Magma | 90 | 18.8 | The plain big one. Easy draw. |
| Glacier | 95 | 19.8 | Slow (6.5 s), only a combo counter stops it. |
| Storm | 75 + zaps | 15 | Punishes throwing. |
| Thermal | 60 + 50% chill | ~13.5 | Middle. |
| Steam | 32 + 6 s fog | ~11-13 | Only as good as their attack rate. **Weakest on paper.** |
| Twilight | 0 + 8 s x2 / x0.5 | ~20 if you follow up | Setup spell; worthless alone. |
| Sunfire | 75 + 55 heal | 22.8 | **Watch: biggest swing.** Hard draw (4.0 s) earns some of it; trim the burn to 45 if it dominates. |
| Plasma | 62 + interrupt + 50% cap | ~19-21 | Cap saves ~30-50 over ~8 s and kills their static. Now level with Magma for the hardest draw. |
| Grave | 34 + 10 s no-heal | 7 (no healer) / 16-20 (healer) | Situational now; easy draw no longer a free 42. |

### Unholy / Angelic
Doom (30 or a forced throw), Execute (15 + 30% missing, cap 60), Shroud (6 s, min 3 s), Heal 34, Regen 45,
Aegis 45. All worn by wear. No issues.

### Findings
1. **Sunfire** has the biggest swing (130). Watch it first.
2. **Tidal Wave** is the best signature by swing; Water overall is the sustain element. OK while counterable.
3. **Steam** is the weakest combo; consider STEAM_HIT 32 -> 40 if it goes unpicked.
4. Grave and Plasma now sit where intended.

### Practice AI check
Already handled: knockdowns (Plasma, Earthquake) restart its cast; Plasma's combo pick favors you mid-drawing
(it interrupts now); Grave favored after you heal; Warden and up pick fresher elements (power^3).
Gaps:
- **Frost-Zealot ignore wear**: random element, ~50% repeats with 2 elements, ~85% average power vs ~93%
  rotating. Makes them a bit softer; fix: give them `order: 'fresh'`.
- **Anti-light stoppers ignore the static cutoff**: it throws L line/heavy to stop your light spam even when its L
  is under 70% (no static). Fix: skip L stoppers when powerOf('enemy','L') < STATIC_CUTOFF.
- Combos and signatures don't check their own wear. Minor.
- It never targets *your* wear (e.g. Plasma when you're fresh). Fine below Lich; nice-to-have for Lich/Ascendant.

### Ladder (each rung vs the one before)
Gap between casts 2000 -> 600 ms and draw speed 1.0 -> 0.53 fall every rung, so raw pace always rises.
On top: Pebble alternates 2 elements; Ember never repeats and adds Lightning static; Frost adds chill + Thermal;
Cleric adds healing, Aegis, parrying (lower react than Frost, paid for by sustain); Hexer adds Unholy + Grave and
hints later; Tide 3 elements, circles, Storm; Zealot all magic, two combos; Warden reads you (25%) and stuns
your patterns, trades utility for that; Adept full ruleset, drops its own spell to counter; Magus capitalizes on
silences and rerolls; Archmage ramps and dodges; Lich punishes heals, reads 90%; Ascendant no mistakes, every
number above Lich. Two soft spots: Adept's smart 0.3 < Zealot's 0.4, and Tide = Zealot on spam counter (0.6);
both are covered by the faster pace.

### Applied after the rundown (Nov 24)
- **Sunfire** burn 55 -> 50 (heals what it burns): swing 130 -> 120, ~21/s. Still the top value, paid for by a
  hard draw, counterspells, and Grave (which stops its heal mid-burn, like any heal).
- **Steam**: no more 50% luck. Hit 32 -> 40; their next 2 attacks thrown within 6 s miss for sure (counted on the
  throw, so spells already flying land; counterspells get through). Worth ~40 + two of their throws: ~60-100
  over 5.5 s, 11-18/s. Below Magma, now a sure tempo/anti-big-spell pick. Two lights clear it (~3.6 s of theirs).
- **AI**: Frost-Zealot rotate elements (`fresh`); anti-light Lightning skipped under the static cutoff; smart
  bots clear Steam's misses with lights.
