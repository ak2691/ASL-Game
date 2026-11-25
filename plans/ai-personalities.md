# Practice AI personalities (Nov 24, built)

Goal: each floor teaches something by how the bot plays, not only by how fast it is.

## Rules
- **Two dials.** Skill (speed, reactions, reads, parries, counters) rises every floor, no dips (plans/balance.md).
  Habit is what the bot likes to do. Difficulty comes from skill; the habit is the lesson.
- **Habit strength fades but never vanishes.** Share of its choices that follow the habit:
  Apprentice ~80%, Adept ~60%, Master ~35%. Like real players: beginners lean on one crutch, good players have
  a favourite meta but use everything well. Master bots are very good at their main, not dependent on it.
- **Tier exams.** The last floor of each tier (Cleric 4, Adept 9, Ascendant 13) plays a balanced mix of what that
  tier taught, with only a light lean. Ascendant still has a slight preference (its "main") but adapts.
- **Not cheesable.** The rest of its choices are normal smart play, so a one-answer strategy doesn't win forever.
- **Tell and tip.** The tower line states the habit. On a loss, the result screen shows one tip for that bot.

## Floors
| # | Character (code id) | Habit | Teaches | Loss tip |
|---|---|---|---|---|
| 1 | Old Bram (pebble) | The Wall: slow, telegraphed heavies | Counterspell basics | Watch its element, then counter it before it throws. |
| 2 | Pip (ember) | The Spammer: Lightning lights nonstop | Wear: its Lightning sinks under 70% and loses static | Parry its lights. Once its Lightning wears down, punish. |
| 3 | Miss Hollis (frost) | The Setup: chill, then a big hit | Reading setups | The hit after a chill is the one to parry or counter. |
| 4 | Brother Alden (cleric) | Exam: mix of the above, plus heals and Aegis | Apprentice exam | Burst it down between heals. |
| 5 | Morwen (hexer) | The Curser: Doom, then Execute while you're cursed | Doom forces a throw; don't sit cursed | Throw anything fast when Doomed, and clear curses before its Execute. |
| 6 | Master Ito (tide) | The Counterpuncher: waits and counters what you charge | Feints, switching elements, lights | Switch elements late, or use lights: they're too quick to counter. |
| 7 | Nyx (zealot) | The Shadow: Shrouds most casts | Playing without information | Watch its timing and stay ready to parry. |
| 8 | Proctor Vell (warden) | The Interrupter: interrupts long drawings, stuns patterns | Varying rhythm | Don't start a big drawing while it's ready to interrupt. |
| 9 | Rook (adept) | Exam: mix of 5-8, combos often | Adept exam; combo letters and combo counters | Read its combo letters and answer with the combo counterspell. |
| 10 | Gideon (magus) | The Punisher: aims everything at your stuns, whiffs, fizzles | Clean play | Every mistake is an opening for it. Play safe when it's ready. |
| 11 | Tamsin (archmage) | The Shapeshifter: changes habit every ~20 s | Re-reading mid-fight | When its style changes, change your answer. |
| 12 | Lady Glass (lich) | The Mirror: learns your favourite element and move, counters them | Your habits are a weakness | Mix your elements and moves: it learns your favourites. |
| 13 | The Archwizard (ascendant) | Exam: the right habit against you, flawless | Final exam | It answers your favourite play. Vary everything. |

## Build notes
- Add `habit` and `habitStrength` to AiStyle (battle.ts). Most habits reweight existing choices (moves, element,
  utility, combo pick, react/drop timing); new logic only for: Frost's chill-then-heavy follow-up, Hexer's
  Execute-after-curse (already weighted), Archmage's habit switch timer, Lich's tracking of your element/move counts.
- Lich's Mirror is the biggest piece (tracking the player across the fight).
- Tips: a `TIP` record next to `LINE` in Ladder.tsx, shown with the loss banner in practice mode.
- Build in tiers: Apprentice first, playtest, then Adept, then Master.

## Built (Nov 24)
battle.ts: `habit`, `habitStrength`, `examOf` on each bot; `habitSpell()` (wall, spammer, setup, curser, shadow,
combo, punisher), react() leans (counter, interrupter mid-drawing with quick interrupts, mirror on your
favourite element), Counterpuncher holds its cast while you're charged, Shapeshifter changes every 20 s.
Ladder.tsx: tower lines name the habit; `TIP` shows under Fight again after a loss to that floor.
Sim (idle player, 2 min): Pebble all heavies, Ember 23/31 Lightning lights, Frost Ice then big hits, Hexer
Doom/Execute, Zealot Shroud 10/25. Sim (player rotating elements, heavies): counters per charge
Tide 33%, Warden 62% (its habit; one counter per charge max), Adept 35%, Archmage/Lich/Ascendant ~70%.

## Characters (Nov 24)
Wizard-school cast, named for their habit, each talking in their own voice (text only, no audio): Old Bram (Wall),
Pip (Spammer), Miss Hollis (Setup, now Ice/Earth/Fire), Brother Alden (exam), Morwen (Curser), Master Ito
(Counterpuncher), Nyx (Shadow), Proctor Vell (Interrupter), Rook (exam), Gideon (Punisher), Tamsin
(Shapeshifter), Lady Glass (Mirror), The Archwizard (final exam). Internal ids (pebble...ascendant) unchanged.
Lines (Ladder.tsx CHAT): start (also the tower quote), habit (35% of habit casts, at most one every 15 s), low
(once, under 30% HP), win, lose. Shown as a speech bubble under the opponent's HUD with a soft blip; menu toggle
"Opponent chatter" (saved). Portraits redrawn as people (portraits.tsx PEOPLE), each with a prop hinting the habit.
