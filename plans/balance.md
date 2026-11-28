# Balance plan (Nov 24, 2026), built Nov 24

Goal: winning takes variety. Mix lights and heavies (jab, then hook when there's an opening), use every element, defend as well as attack. Spamming one thing, or only attacking, or only defending, should lose.


## Rules

| Rule | Value |
|---|---|
| Wear | By element. Light and Angelic +½ stack (Nov 25: Angelic was +1); heavy, signature, Unholy +1. Each stack −30% damage and heals, floor 30% (Nov 24: was 40%). A stack fades every 8 s (Nov 24: was 5 s; two elements alternated recovered fully). Stacks cap at the floor. Damage only. |
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

### Execute rework (Nov 24)
Old: 15 + 30% of missing HP, cap 60. At 350 HP it capped at 57% HP left and replaced Meteor all late game.
New: **30, or 60 if the target is cursed when it lands** (burning, chilled, static, Doomed, Exposed, fogged,
no-heal; not stuns, knockdowns or wear). Backfire on a counterspell: half (15 or 30).
- Only combo curses (Twilight 8 s, Steam 6 s, Grave 10 s, Sunfire 6 s, barely Magma/Storm) outlast Execute's
  ~4 s cast in 1v1, so "combo, then Execute" is the play; in 2v2 a teammate's curses count.
- Fresh and cursed: 60 vs Meteor 50, ~16.7/s: top signature (hardest draw), below combos (19-21/s).
- After Grave or Twilight (both wear Unholy): ~50, even with Meteor. A second Execute in the window: ~40.
- Watch: 2v2, where curses are near-constant. Fix if needed: cursed 60 -> 55.
- AI: favors Execute when you're cursed (more so when smart), avoids it when you're not.

### Wear recovery 8 s -> 10 s (Nov 24)
Recovers 30% per 10 s (3%/s). Heavies every ~3.3 s: two elements alternating sink toward ~50-60%; three in
rotation stay near full. Lightning static (70% cutoff) about once per 10 s per element. Plasma's 50% now takes
~17 s to clear (was ~13): stronger, watch it. Execute's second hit in a Grave window: ~38. Player text no longer
says "stack": it says "takes 30% off" and "recovers 30% every 10 s".

### 10 s recovery check (Nov 24, simulated casts per bot, average power of its throws)
At 8 s, two elements alternating recovered exactly in time; at 10 s they sink to the floor. Two-element bots
collapse: Frost 75%, Cleric 56%, Hexer 40% (static only 9% of its Lightning), Zealot 36%. That breaks the
ladder (Zealot far weaker than Tide at 93%). Every other bot stays 91-97%.
Fix: a third element each: Frost I F W (97%), Cleric W I E (96%), Hexer E L I (92%, static 97%), Zealot F E W (91%).
Players: same rule. Two elements is now a losing rotation; three keeps you near full. Combos wear two at once,
so a combo player needs 4+ elements in play. Spell numbers themselves don't change.

### Hardest-draw buffs (Nov 24)
Real drawing time (user): Sunfire takes by far the longest, Plasma next.
- Sunfire burn 50 -> 55: swing back to 130, ~22.8/s. Top value, paid by the longest draw; Grave stops the heal.
- Glacier 95 -> 100: round number; still slow (6.5 s) and only a combo counterspell stops it.
- Plasma hit 42 -> 46 (not 50): with 10 s wear recovery its 50% cap now lasts ~17 s and is worth ~40-60 on
  its own. 46 + 20 burn + interrupt (~15) + cap (~50) = ~131 over ~5.9 s, ~22/s: level with Sunfire. At 50 it
  would be ~25/s, clearly the best combo.

### AI and dummy combo draw times ~2x signatures (Nov 24)
Humans drawing in the air to a camera are far slower than the old times assumed. Combo DRAW_MS (speed 1):
Grave 5.0, Glacier/Magma 5.2, Storm 5.6, Thermal 6.0, Steam/Twilight 6.2, Plasma 7.5, Sunfire 8.0 s (was
3.0-4.2; signatures stay 2.0-2.5). Full casts at speed 1 now ~6.7-9.7 s, so per-second combo values in this
file drop by about a third (about 1.5x slower): combos are big but slow, and far easier to see coming and counter.
Ladder order holds (every combo bot slows the same way); combo-heavy bots (Archmage up) lose a little pace.

### Ladder rework: three tiers, no dips (Nov 24)
Apprentice 1-4 (one mechanic each), Adept 5-9 (one system each), Master 10-13 (same kit, sharper; headline
trait on the tower: Magus Punisher, Archmage Dodger, Lich Mind reader, Ascendant Flawless).
Every skill number now holds or rises floor to floor: speed, gap, reaction, spam counter, parries, smarts,
stuns, reads, heals, dodges, drops, combo counters, circles; counter mistakes only fall (Pebble 30% -> Warden
15% -> Ascendant 0). Magic and combo rates and heal thresholds are personality, not difficulty.
Fixes: Pebble E W F, Ember F L I (3 elements each); Cleric react .2, Glacier at a low rate; Tide smart .32 and
Aegis; Zealot spam counter .65; Warden smart .42, circles .32; Adept smart .45, circles .35, mistakes .12.
Tower element dots now come from the bots' real settings (they had drifted).

### AI pacing: less waiting, slower drawing (Nov 24)
DRAW_MS light 600 -> 800, heavy 1800 -> 2400; every bot's wait between casts halved (Old Bram 2000 -> 1000 ...
Archmage 360, Lich 330, Ascendant 300). Time moves from idle to visible drawing you can react to.
Miss Hollis: the big hit (a heavy) starts the moment the chill is thrown, landing inside the 4 s chill (sim: 26 of
29 chills used by a hit, was ~0). Pip: Lightning while it has static, else its least-worn element; bursts of two
lights then a heavy; 70% less wait after a light. Sim vs an idle player (damage/s): Old Bram 5.1, Pip 3.5,
Miss Hollis 5.1, Brother Alden 4.2 (heals not counted). Pip's number is lower, but lights are near-impossible to
counter while Bram's heavies give ~3.6 s to counter: against a player who counters, Pip is the harder fight.

### AI drawing per floor (Nov 25)
Drawing time no longer comes from the speed setting (lines/heavies scaled fully, so the top was superhuman).
Per floor, easing geometrically from the bottom (Old Bram) to the top (The Archwizard):
heavy 4.0 -> 1.5 s, light a third of that (1.33 -> 0.5), signatures avg 5.5 -> 2.5 s (Meteor 6.25 -> 2.84),
combos ~10 -> ~6 s (Grave 9.2 / Sunfire 11.6 at the bottom, 5.5 / 7.0 at the top). Counter circles and quick
interrupts unchanged. Sim vs an idle player, damage/s: Old Bram 2.8, Pip 2.3, Miss Hollis 3.6, Brother Alden 3.1,
Morwen 3.4, Master Ito 3.6, Nyx 2.1 (Shroud casts), Proctor Vell 4.3, Rook 4.7, Gideon 5.2, Tamsin 5.2,
Lady Glass 5.8, The Archwizard 5.8. Heavy H check loosened (posts reach the top/bottom quarter, wider bands).

### Morwen and Nyx rework (Nov 25)
Vs a heavy spammer (sim, damage/s dealt / taken): Morwen was 2.3 / 4.4, below Brother Alden; Nyx 1.1 / 3.1.
Morwen (curser): Grave is the main setup (10 s), or an Ice light with an Execute started the moment it's thrown;
Execute drawn 55% faster and only thrown if a curse will still be on you when it lands; Doom only now and then.
Nyx (shadow): while Shrouded, quick hidden heavies (20% faster) instead of a slow signature.
After: Old Bram 2.5/3.9, Pip 2.0/4.4, Miss Hollis 2.7/4.6, Brother Alden 2.5/2.9, Morwen 3.2/4.3 (16 Executes in
6 min, all on a curse), Master Ito 2.3/3.1, Nyx 2.0/3.2, Proctor Vell 3.3/1.4. Watch: Nyx and Ito still trail Morwen.

### Doom buff and floor tuning (Nov 25)
Doom: only a spell at 70%+ power lifts it (a combo: its average power; counters always lift). Punishes the same
thing wear does; the AI throws its freshest element when Doomed.
Master Ito: when his counter lands, a quick heavy (30% faster draw) follows at once. Nyx: Shroud drawn 30% faster,
hidden heavies 35% faster, reacts .42. Rook reacts .5. The Archwizard's exam drops the slow styles (curser, combo).
Vs a heavy spammer, 16 sims per floor, net damage/s (dealt - taken): Old Bram -1.5, Pip -2.2, Miss Hollis -1.7,
Brother Alden -1.0, Morwen -0.9, Master Ito +0.3, Nyx -0.4, Proctor Vell +2.5, Rook +2.1, Gideon +3.2,
Tamsin +2.6, Lady Glass +3.9, The Archwizard +4.5. Small dips (Nyx/Ito, Rook/Vell, Tamsin/Gideon) are style
matchups vs this one player type (Vell's interrupts are built for heavy drawers), within ~0.6.

### Angelic wears half as fast (Nov 25)
Damage dodges wear by rotating elements; healing is all Angelic, so a second heal within 10 s was 70% and a third
40%. Now heal, regen and Aegis add half a stack (like a light). Steady state: one Angelic spell every 5 s stays at
100% (was ~50%); every 2.5 s settles near 75%; spamming still sinks to the 30% floor. Heal amounts unchanged
(heal 34, regen 45 over 2.5 s, Aegis 45).
Check vs others: a heal every 5 s is ~6.8 HP/s, above most bots' damage/s (2-6) but it's a full draw that
deals nothing, and Grave (10 s no-heal), Lich (punishes heals) and interrupts answer it. Tidal Wave (Water) and
Sunfire heal on other elements and are unchanged. Cleric and other healer bots heal more often at full power:
small buff to those floors. Watch: a heal-every-5 s turtle against the low floors; if it stalls fights, trim
HEAL to 30 rather than bring back the full stack.


### Heal 42 + cleanse (Nov 25)
Why: in an HP race a heal is worth its HP as damage, and two heavies of different elements in the same draw time
deal ~50 with effects, so heal 34 was never the right pick. Star heal 34 -> 42 and it now clears your burns,
chill and static. Not cleansed: Sunfire's leeching burn, Storm's damaging static (combo payoffs) and curses
(Doom, Grave, Exposed, fog), which stay the answers to healing.
Check vs others: 42 + a cleansed effect (a Fire heavy's 8 burn, a 50% chill before a heavy ~12, Thunderbolt
static ~15) is ~50-57 value, level with two fresh heavies (~50), still deals nothing and gives no pressure.
Grave still blocks it; Lich still punishes it. Regen (45 over 2.5 s) and Aegis unchanged; regen no longer the
better heal per draw. Tidal Wave (25 + 28 heal) is now less heal than a star but also hits: fine.
Healer bots (Cleric, Tide, Zealot, Warden up) heal 42 at healBelow: ~24% more per heal, small buff to those
floors; they don't yet heal on purpose to cleanse. Watch: Fire and Ice punch value drops a little vs a healer.

### Regen 60, bots cleanse (Nov 25)
After heal 42 + cleanse, regen (45 over 2.5 s, counterable mid-tick, no cleanse) lost to the star everywhere.
Regen 9 -> 12 per tick: 60 over 2.5 s. Two heals with two jobs: star = 42 now + cleanse; regen = most HP, but
delayed and a counterspell cuts off what's left. Regen ~43% more HP than the star, the same as before (45 vs 34).
Check vs others: 60 over ~hourglass draw + 2.5 s is still below two fresh heavies plus their effects once the
counter risk is counted, deals nothing; Grave blocks it, Lich punishes it. Healer bots' low-HP regen +33%: small
buff to Cleric/Tide/Zealot/Warden and up.
Bots: a healer that's burning, chilled or static and under 90% HP stars it off (chance 25% + 50% x smart,
shares the 6 s heal cooldown). Higher floors cleanse more; Fire/Ice/Lightning setups vs healers are a bit weaker.

### Heal clears every debuff, Grave reworked, Earthquake knockdown needs full Earth (Nov 25)
- Heal (star) now clears every debuff: all burns (Sunfire's and Plasma's too), chill, all static (Storm too),
  Doom, Exposed, Steam fog and Grave. Under a Grave it clears the Grave but heals 0 that time.
- Grave: was "no healing and no Angelic spells". Now: nothing heals them or gives them armor for 10 s (heal,
  regen, Tidal Wave, Water mend, Sunfire leech, Aegis). Other Angelic spells and the Angelic counterspell work.
  Answer to it: a Heal (no HP) to clear it, then heal normally.
- Earthquake: the knockdown (charge and readied spell lost) only happens at 100% Earth power. Worn Earth still
  hits 38 x power, no knockdown.
Check vs others: Heal is now the universal answer to setups (Doom, Twilight, Steam, Storm, Sunfire, Grave),
but it costs a full star draw that deals nothing and Grave turns one heal into 0 HP. Combo payoffs vs a healer
drop (Sunfire's burn, Storm's pulses, Twilight's window can be wiped mid-way): watch Zealot/Archmage pace.
Earthquake: spamming it loses the knockdown, so its value drops from ~38 + knockdown (~15) to 38 x power when
worn; at full Earth unchanged. Execute vs a healer: cursed bonus easier to wipe.
Bots: healers now star off any debuff (Grave, Doom, Exposed, fog too), same 6 s cooldown and chance.

### Cleanse needs full Angelic power; bot combos 9 s to 4 s (Nov 25)
- Heal's cleanse only happens at 100% Angelic power. A worn heal still heals (x power) but clears nothing, so a
  second heal within ~10 s can't keep you clean. Under a Grave a worn heal does nothing at all.
  Bots only heal to cleanse when their Angelic is fresh.
- Practice AI combo draw (average combo, before each combo's own size factor): was ~10 s to ~6 s geometric;
  now 9 s to 4 s, half geometric and half linear. Floors 1-13: 9.0, 8.5, 8.0, 7.5, 7.1, 6.7, 6.2, 5.8, 5.5,
  5.1, 4.7, 4.3, 4.0 s. Grave/Sunfire still differ from that by sqrt(their DRAW_MS / average).
Check vs others: combo bots (Archmage up) land combos ~25-35% sooner at the top, ~10% at the bottom. Still slower
than a signature (2.5-5.5 s) at every floor, still visible long enough to counter with C + two letters + circle.
With heal's cleanse limited, a combo's payoff is only wiped by a fresh heal. Watch: Archmage/Lich/Ascendant pace.

### Bots cash in their setups; waits vary by what was thrown (Nov 25)
Problem (user, vs Lady Glass): an Ice light, then a slow combo; the chill expired unused.
- New skill setupSense (chance to cash in its own setup): Apprentice 0, Hexer .3, Tide .35, Zealot .4,
  Warden .45, Adept .55, Magus .75, Archmage .85, Lich .95, Ascendant 1.
- Setups: any Ice attack or Frozen Prison (chill, 4 s after it lands), Thermal (chill), Twilight (Exposed, 8 s).
  Not counters or quick interrupts.
- On throwing one, the payoff starts at once (no wait): the first of Execute (if it has it), a signature, a
  heavy, a light, from its freshest non-Ice element, whose charge + draw + push + flight lands inside the
  window. Never a combo. Hand check: Master Ice light -> ~4.07 s window; heavy ~3-3.5 s fits, signature
  ~4.3 s mostly doesn't. Twilight's 8 s fits a signature at every Adept/Master floor.
- Waits between casts now depend on the last throw: x0.6 after a light, x1 heavy, x1.2 signature/Magic,
  x1.4 combo (then the usual +/-20% jitter). Average pace about the same; more rhythm.
Check vs others: chill's +25/50% and Twilight's double damage now actually get used on Adept/Master floors,
so those floors hit harder in bursts (a heavy at +50% after an Ice heavy). Counter play: the payoff is visible
(it starts at once, as a non-Ice element) and interruptible; a full-power heal clears the chill first.
Not simulated (no sim script saved); watch Adept tier (Hexer-Adept) for a difficulty jump.

### Heavy chill 5 s; Adept and up always cash in, after a reaction beat (Nov 25)
- Chill duration: Ice light and Thermal 4 s (unchanged); Ice heavy and Frozen Prison 5 s (was 4). Bonus
  unchanged (+25% light, +50% heavy, +60% Prison). For players too: Ice heavy -> heavy is now a real combo.
- Bots: setupSense (a chance) replaced by setupDelay: every Adept and Master bot follows up its own setup,
  after a reaction beat: Morwen 0.6 s, Ito 0.55, Nyx 0.5, Vell 0.45, Rook 0.4, Gideon 0.3, Tamsin 0.25,
  Lady Glass 0.2, Archwizard 0.15 s. Apprentice bots never do (Miss Hollis keeps her own chill habit).
- Fit check (window from the throw: flight + chill - 0.25 s slack): after an Ice heavy ~5.45 s, after an Ice
  light ~4.07 s. Morwen: 0.6 + heavy ~4.5 = 5.1 s fits after a heavy; after a light only a light fits.
  Rook: 0.4 + heavy ~3.7 = 4.1 s, heavy after a heavy easily, after a light just at the edge. Master: heavy
  or Execute after either; a signature after Twilight (8 s).
Check vs others: Adept floors get a steady chill->heavy rhythm (+50% on the follow-up). Readable: Ice first,
a beat, then a non-Ice heavy you can interrupt; a full-power heal clears the chill. Watch the floor 4 -> 5 jump.

### Faster Master signatures, smaller gap between signatures (Nov 25)
Practice AI signature draw: average 5.5 s (floor 1) to 2.0 s (floor 13), was 2.5 s at the top; each
signature now scales by sqrt(its size / average) like combos (was fully linear, so Meteor was 14% slower than
average and Heal 18% faster). Drawing time only (signing and the push come on top):
  floor:            1     5     9     10    11    12    13
  Meteor          5.86  4.18  2.99  2.75  2.52  2.32  2.13   (was 6.25 ... 2.84 at 13)
  Earthquake/Exec 5.74  4.10  2.93  2.69  2.47  2.27  2.09
  Thunder/Tidal   5.50  3.93  2.80  2.58  2.37  2.18  2.00
  Prison/Aegis    5.24  3.74  2.67  2.46  2.26  2.07  1.91
  Heal/Doom       4.97  3.55  2.53  2.33  2.14  1.97  1.81   (was 4.50 ... 2.05 at 13)
Check vs others: Master signatures land ~0.3-0.7 s sooner, still slower than a heavy (1.5-1.9 s) so still
readable and interruptible; punisher/Ito/Nyx speed-ups stack on top as before. Low floors: big signatures a
bit quicker, small ones (Heal, Doom) a bit slower; average unchanged. Twilight payoffs fit a signature more
often. Watch: Gideon-Archwizard pace and Meteor/Earthquake burst.

### Fastest heavy 1.2 s (Nov 25)
Practice AI heavy draw, floor 1 to 13 (geometric): 4.0, 3.62, 3.27, 2.96, 2.68, 2.42, 2.19, 1.98, 1.79, 1.62,
1.47, 1.33, 1.20 s (was 4.0 ... 1.5 at the top; floor 9 was 2.08). Lights are a third: 0.4 s at the top.
Keeps a ~0.8 s step to the average signature (2.0 s). Interrupt window vs the top heavy: ~1.2 s draw + 0.7 s
flight. Adept follow-ups fit more easily (Morwen heavy 2.68 s, was 2.88). Watch: Archwizard lights (0.4 s)
and whether Master heavies are still readable.

### Bot combos 8.5 s to 3.5 s (Nov 25)
Average combo draw, floors 1-13 (half geometric, half linear): 8.5, 7.99, 7.5, 7.03, 6.58, 6.14, 5.73, 5.32,
4.94, 4.56, 4.2, 3.84, 3.5 s (was 9.0 ... 4.0). Per combo (sqrt of its size), floor 1 / floor 13: Grave
7.8 / 3.2, Glacier and Magma 8.0 / 3.3, Storm 8.3 / 3.4, Thermal 8.6 / 3.5, Steam and Twilight 8.7 / 3.6,
Plasma 9.6 / 4.0, Sunfire 9.9 / 4.1 s. Still ~1.5 s slower than a signature (2.0 s) at the top, plus ~0.6 s of
signing three letters: readable and counterable. Watch Archmage-Archwizard combo pressure.

### Storm: four bumps (Nov 25)
Storm's drawing now has exactly four bumps (was three): it was barely slower to draw than Thunderbolt for a
combo. Bolt line lengths are free (only 3 lines matter). Bot Storm draw time scales up: DRAW_MS 5600 -> 6100,
so 8.6 s on floor 1, 3.6 s at the Archwizard (was 8.3 / 3.4). No damage change: a slightly longer draw makes
it a touch easier to see coming and counter. Watch: Tide (its only combo) and top combo bots.

### Storm drawn as fast as Magma (Nov 25)
User: four bumps and a 3-line bolt is a simple drawing, about Magma's difficulty. Bot DRAW_MS cloud 6100 -> 5200
(= Magma, Glacier): 8.0 s on floor 1, 3.3 s at the Archwizard (was 8.6 / 3.6). Magma unchanged. No damage
change; Storm (25 + 5 pulses of 10, throws in a pulse fizzle and cost 15) lands a little sooner, so its
pulses catch more throws. Watch Tide (Storm is its only combo).

### Parry reflects at full power, no lock on a landed parry (Nov 25)
User: 50% didn't pay for the risk (drop your cast, a miss takes the full hit and staggers, it can be sent back).
REFLECT_POWER [0.5, 0.35] -> [1, 0.5]; a third parry still destroys it. A landed parry no longer stops your
throws (PARRY_HIT_MS 500 removed, along with its "Parried" icon); a miss is unchanged (staggered). Vs all: big
hits (Meteor, Doom, Execute, combos) are now a real gamble for the caster against high-parry bots (Archmage,
Lich), but their windows are already light on reflects (1.5x speed, 100 ms window). Glacier stays unparryable.
Watch: the Lich's reparry (0.12) now returns 50% where it used to return 35%.

### Parry window 100 ms for every spell (Nov 25)
User: with full-power reflects, and heavies/signatures now flying slower (easy to read), the bigger windows
(heavy 150, signature 200, combo 150) made parrying them too easy. All now 100 ms, same as lights. Offsets the
reflect buff above; the user will playtest that it isn't too hard. Bots' parry rates unchanged (watch them).

### Parry wear, bots punish turtling (Nov 25)
User: pure parrying (no casting) did better vs the Archwizard than casting. No cooldowns (only stagger/stun).
Parry now has its own wear ('P', a "Parry" chip): each landed parry is one full stack (-30%, floor 30%, a stack
back every 10 s), multiplying the reflect: 100 -> 70 -> 40 -> 30%. Misses add none (stagger already punishes).
Bots with read > 0 (Warden up): if your parry is worn and you haven't attacked for 4 s, they bait with lights
(each parry wears you more) and throw signatures once your parry is at 70% or less; capitalize bots also throw
a signature while you're staggered; smart bots pick Glacier (unparryable) 3x as often. Vs all: casting is
unchanged, and a player who mixes parries in at most one per 10 s stays at full reflect.

### Worn parry lets damage through (Nov 25)
User idea. A parry at power p (parry wear) sends back p and the other (1 - p) of the spell lands on you at
once (effects scaled the same way, like a worn spell). Fresh parry: blocks everything. At the 30% floor: 70%
gets through, so turtling no longer means taking no damage. Bot bait (lights, then a signature at <= 70%) now
also deals real damage through the worn parry.

### Plasma caps parry wear too (Nov 25)
Plasma's overload (every element above 50% down to 50%) now includes parry: the target's next parry
reflects at most 50% and lets 50% through. Plasma (hardest combo) gains a real answer to a parry-heavy player.

### Worn parry leaks damage only (Nov 25)
What gets through a worn parry is now only the spell's direct hit (scaled); no burn, chill, static, silence,
charge knock-off, Plasma cap, Doom or curses. A landed parry wins the exchange. Twilight and Doom leak nothing.
Signature/combo hit numbers moved to SIG_HIT / COMBO_HIT tables (same values) so leak and land() agree.

### Missed parries wear too (Nov 25)
User: every push should cost, so spam-parrying is never free. A miss now adds a parry wear stack (same as a
landed parry) on top of the stagger. Bots' turtle check (parry worn + no attack for 4 s) now also catches misses.

### Thermal and Steam draw faster for bots (Nov 26)
User: both easier to draw than their times said; Thermal easier than Steam. DRAW_MS thermo 6000 -> 5300, puff
6200 -> 5600 (COMBO_AVG still ~5900). Bots: Thermal 8.6 -> 8.1 s on floor 1, 3.5 -> 3.3 s at the top; Steam 8.7 ->
8.3 s, 3.6 -> 3.4 s. Dummy at 100%: 5.3 s and 5.6 s. Both land a little sooner; no damage change.

### Counterspells and interrupts wear, and need 70% power (Nov 26)
User: nothing should be spammable, and wear should be strategy: drain the element that beats yours, then they can't
stop you. Was: counters/interrupts added no wear. Now an interrupt adds half a stack, a counterspell a full stack
(combo counterspell: both its elements). Their stun/lock times never shrink (Silence 3 s, lock 0.75 s unchanged);
instead they need COUNTER_CUTOFF 70% power, judged before the cast (same cutoff as Static and Doom). Under it they
land and do nothing: an interrupt whiffs (you're locked 1 s), a counterspell misses. From fresh: 2 interrupts in a
row fine, the 3rd (at 55%) fails; one heavy (70%) still counters, two heavies (40%) can't. Smart/reading bots
skip counters too worn to work (and won't try to break a Glacier with worn Fire/Ice); intro bots still try and fail.
Watch: Lightning players can be drained of their Earth-counter, etc.; bots' counter rate drops after heavy attacking.

### Tower after the counter nerf: bots play the wear game (Nov 26)
User: counters/interrupts got a big nerf (testers found constant counters frustrating), so counter-heavy bots lost
strength. Not restored by countering more. Readers (read > 0: Warden up) now:
- exploit: if your element that beats one of theirs is under COUNTER_CUTOFF, they throw that element (chance
  lerp(0.5, 1, read)) and go big (signature, lerp(0.5, 0.9, read));
- reserve: they don't attack with the element that counters yours (your charge, else your last throw) if that
  would drop it under the cutoff (chance lerp(0.4, 0.9, smart)), picking their freshest other element.
No stat changes. Not measured (no bot-vs-player sim). Watch: Tide (counter habit, read 0: gets neither) and
Warden (interrupter: forced interrupts now whiff after 2 in a row) likely got easier; if so, give Tide read 0.1
or compensate with speed / comboRate rather than more counters.

### Tide and Warden buffed after the counter nerf (Nov 26)
Tide: read 0 -> 0.1 (now plays the wear game: exploits your worn counters, keeps its own), comboRate 0.17 -> 0.2.
Warden: every 1010 -> 960 ms (still slower than Adept 850), comboRate 0.12 -> 0.16. No counter changes. Unmeasured.

### Ladder sim tuning (Nov 26; plans/ladder-sim.md)
Old Bram every 1600 -> 2600, miss 0.3 -> 0.33, signatures 20% -> 5% (and the wall habit 15% -> 5%): he out-healed
Pip with Tidal Waves. Pip every 1460 -> 1300; his spam habit picks Lightning 35% of the time, not always (softest
lights). Brother Alden heals below 45% (was 60%: endless stalls). Morwen every 1230 -> 1060, comboRate 0.14 -> 0.18.
Master Ito back to read 0 and comboRate 0.17, every 1110 -> 1150. Nyx every 1090 -> 980, comboRate 0.17 -> 0.24,
heals below 25% (was 35%), Shroud at most every 10 s (was spending half its turns on it). Proctor Vell every
960 -> 1080 (earlier buff undone and then some), comboRate back to 0.12, read 0.25 -> 0.15. Archwizard every 570 -> 520, comboRate 0.26 -> 0.3.

### Smoothing the ladder jumps (Nov 26; plans/ladder-sim.md)
Proctor Vell every 1080 -> 1120, miss 0.15 -> 0.17, read 0.15 -> 0.1. Nyx comboCounter 0 -> 0.3 (she could never break
Vell's Glacier). Rook every 850 -> 800, comboCounter 0.1 -> 0.25, read 0.3 -> 0.35. Gideon every 730 -> 760.
Archwizard every 520 -> 500.

### Plasma and Sunfire draw faster for bots (Nov 26)
User: a bit faster. DRAW_MS plasma 7500 -> 6800, sun 8000 -> 7200 (COMBO_AVG left at 5900 so other combos keep
their times). Bots: Plasma 9.6 -> 9.1 s on floor 1, 3.9 -> 3.8 s at the top; Sunfire 9.9 -> 9.4 s, 4.1 -> 3.9 s.
Dummy at 100%: 6.8 s and 7.2 s. Both stay the slowest combos.

### Bot counters: less often, human pace (Nov 26)
User/testers: top floors countered almost every charge, near-instantly. All bots now:
- chance to counter a charge (not a heal or combo) capped at COUNTER_CHANCE_MAX 0.7; reading you raises it to at
  most lerp(react, 0.7, read) (was 0.9) or lerp(react, 0.65, read) for an expected element (was 0.8); counter
  habits lean to 0.8 (was 0.95); a reroll on the same long charge counts half (was a full new chance).
- reaction: never under COUNTER_REACT_MIN_MS 450 ms (was 250, only on the predicted path); predicted speedups
  softened (light guess x0.7, heavy x0.75, expected x0.75; were 0.45, 0.5, 0.6).
- counter circle: at least COUNTER_DRAW_MIN_MS 500 ms to draw (top bots drew it in ~0.2-0.4 s); the heavy-streak
  speedup bottoms at 0.8 (was 0.55).
Heals and combo counters unchanged. Ladder sim (30 games): order kept; Master Ito (counter habit) dropped under
Morwen, so every 1150 -> 1080 (now beats her 70%).

### Faster top-floor combos (Nov 26)
AI_DRAW.combo top 3500 -> 2700 ms: at the top, Grave (fastest) 3.2 -> 2.5 s to draw, Sunfire (slowest) 4.0 -> 3.0 s,
all in proportion (late in a fight ~10% faster still). Floor 1 unchanged; mid floors ~0.3 s quicker. Quick sim
(10 games, about +-16%): order within noise of earlier runs; no other changes.
Then top 2700 -> 3000 (user: signatures already fast): Grave 2.76 s, Sunfire 3.3 s at the top.

### Thermal Shock: the strongest chill (Nov 26)
User: a combo's chill was weaker and shorter than Frozen Prison's (+50% for 4 s vs +60% for 5 s). Now +75% for 6 s
(THERMAL.chill 0.5 -> 0.75, new chillMs 6000). Vs all: 38 hit + 22 burn = 60 alone (Magma 90); with a heavy Earth
follow-up (24 -> 42) about 102, so it beats Magma only if the follow-up lands in time: still a setup spell. Bots'
setup follow-up window uses the 6 s. Prison keeps its stun as its edge.

### Parry: one push catches every spell in its window (Nov 26)
User: against two foes, spells arriving together should both be parried if the push lands inside both windows.
`parry()` now reflects (or destroys) every parryable spell in its window at the push; a spell outside its window
just lands, no stagger. Parry wear: one stack per push, so a double parry is a bit stronger than two single
ones. 1v1 is unchanged (one spell in flight at you at a time). Checked in the browser with the real Combat:
40 ms apart, push 30 ms before the first: both reflected; 150 ms apart: first reflected, second lands.

## Nov 26: Counterspell is a null sign

The counterspell is now a circle with a diagonal line through it (25-65 degrees, through the middle, touching
both sides; a little past is fine), judged by a rule (`nullSign` in shapes.ts) instead of the network. The plain
circle and its closed-loop fallback are gone. Bots draw it a little slower: 900 ms (was 700), floor 650 ms (was
500). Against every other spell: counters land about 150-200 ms later, so heavies and signatures are a touch
safer to throw; quick interrupts (no drawing) are unchanged and become the relatively faster answer to lights.
No other shape passes the rule (plain circle, horizontal/vertical lines, half circle, hourglass, cage tested).

### Feints: bots bail, remember, punish and bait (Nov 27; plans/feints.md)
Every rung from Pip up: drops its counter when you drop yours, waits longer after you bait it, a quick light on
your fizzle, baits with heavies it drops late, and dodges only a counter that would land first. Dodge now from
Pip (3%) up; Rook 0 -> 15%, Gideon 5 -> 20%, Tamsin 15 -> 25%. Bots now start their stroke when drawing starts
(not at the sign), so dodges and baits read real drawings, in the sims too.
Ladder sim, 40 games, feints on / off (noise about +-15%): order kept. Morwen vs Brother Alden 50 / 35%, Gideon vs
Rook 93 / 80%, Lady Glass vs Tamsin 57 / 75% (gap narrowed: Tamsin's dodge and bail went up the most), Archwizard
vs Lady Glass 48 / 53% (near even before too). Duo sim, 48 games, reference table: every floor at or a little
under its 1v1 pair (floor 6 40 / 60%, floor 7 50 / 65%, the rest within noise). Scripted feinter (80% feints, 10 min)
vs Lady Glass: 17 of its counters bailed, 17 wasted; Old Bram: 0 bailed, 18 wasted.
Then Tamsin's dodge 0.25 -> 0.15 (back to before). Ladder sim, 60 games: Lady Glass vs Tamsin 68%, Archwizard vs
Lady Glass 67%, Tamsin vs Gideon 83%; order kept, every floor 48-98% over the one below.

## Nov 27: Shroud on a teammate
Shroud can now be aimed at a teammate (same zones as heals); no aim = yourself. 1v1 unchanged. Team modes: no stacking
(one Shroud timer per fighter, recast just resets it), same 6 s / min 3 s and draw time, so it trades your own cover for
theirs. Watch in 2v2: Shrouding a partner mid-heavy hides the throw; if parries feel impossible, cap it at 4 s on others.
