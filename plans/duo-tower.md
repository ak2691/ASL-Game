# Duo Tower (2v2 PvE) — built Nov 26

Two players, one room, climbing a tower of AI **pairs**. Each floor is a duo with a team habit: the lesson is how
the two bots play *together*, not each bot alone.

## Setup
- **Online only.** The duo makes a room (code or invite, later a queue). Seats: 2 humans on `player` team,
  2 bots on `enemy` team. The server already runs `Combat` with teams; bots are just seats with no socket.
- **Bots run on the server.** Move the bot brain (battle.ts AI + team.ts pool/casting) into a shared module the
  server imports, like it already imports `combat.ts`. The server ticks each bot and calls `sign/drew/push/parry`
  for it. Clients get bot casts the same way they get a human foe's (OppEvent), so no new UI for foes.
- **Solo fallback (later).** One human + an AI teammate, using the same brain on our side. Good for testing and
  for players without a partner.
- **Progress** is saved per pair? Simpler: per player, a floor counts when you beat it with anyone. Floors
  unlock in order.
- **HP.** Bots get a bit more HP than players per floor (2v2 fights are faster and messier). Tune in balance.md.

## Pair brain (new)
On top of each bot's own habit, a small shared layer:
- **Focus:** both pick the same target (lowest HP, or whoever just whiffed).
- **Setup + payoff:** one bot sets up (chill, curse, silence), the other throws the big hit into it.
- **Sync:** both throw so spells land in the same window (tests that you know one parry catches both).
- **Stagger:** the opposite: land one after the other, so a single parry can't catch both.
- **Cover:** one guards (counters, Aegis, heals) while the other attacks; kill the support first.
- **Swap:** when one is low, the other pulls aggro (interrupts, aims at whoever is hurting its partner).
Each floor turns on 1–2 of these. Higher floors use them more often and more cleanly (same "habit fades"
rule as ai-personalities.md).

## Floors: the Duet Trials (Nov 26 design, 10 floors)
Story: the school's yearly pairs tournament. Old faces from the 1v1 tower return in new pairs, alongside new
students. Old Bram runs the trials (floor 1) and turns out to be the Archwizard's old duet partner (floor 10).

Same rules as plans/ai-personalities.md: skill rises every floor with no dips; the **pair habit** is the lesson
and fades (Apprentice ~80%, Adept ~60%, Master ~35%); the rest is normal smart play; exam floors (4, 8, 10) mix
what came before; the tower line states the pair habit. No loss tips (Nov 26: not for now).
Difficulty: each bot plays at about the 1v1 floor in the Skill column (there are two of them, so each is a bit
weaker than the 1v1 at the same spot). Bots get 1.2x player HP. Tiers: Apprentice 1-4, Adept 5-8, Master 9-10.

| # | Pair | Pair habit | Teaches | Plays at (1v1 floor numbers) | Wait between casts |
|---|---|---|---|---|---|
| 1 | Old Bram + Pip | **Focus**: both hit the same player | The target parries, the other punishes | Old Bram (1) | x1.8, focus 70% |
| 2 | Ivy + Rowan Fennick (twins) | **Sync**: every spell lands at the same moment | One parry catches both | Old Bram (1) | x1.3 |
| 3 | Miss Hollis + Bruno Kettle | **Setup + payoff**: Hollis chills, Bruno throws the heavy | Stop the setup, parry the payoff | Old Bram (1) | x1.3 |
| 4 | Brother Alden + Sister Wren | Exam: **Cover** (heals on each other) plus 1-3 | Burst one down between heals | Pip (2) | x1.35, heals itself under 25% and every 12 s at most; cover heals under 30%, every 15 s at most |
| 5 | Morwen + Nyx | **Curse + shadow**: Morwen curses one of you, Nyx finishes from Shroud | Cover the cursed partner | Miss Hollis (3) | x1.4, waits 0.7 s before jumping a curse |
| 6 | Master Ito + Kai | **Bait**: Kai throws obvious spells, Ito counters whoever answers | Don't both bite: one answers, one waits | Nyx (7) | x1.15 |
| 7 | Proctor Vell + Proctor Quill | **Stagger**: spells land at least 0.65 s apart | Split parry duty, take turns drawing | Proctor Vell (8) | x1.2 |
| 8 | Rook + Juno Vale | Exam: **Swap** (hit whoever hurts my partner) plus 5-7, combos often | Adept exam | Proctor Vell (8) | x1.3, waits 0.8 s before swapping |
| 9 | Gideon + Lady Glass | **Read and punish**: Glass learns your duo's favorites, Gideon punishes every whiff | Clean, varied play from both | Gideon (10), Tamsin (11) | x1.3 |
| 10 | The Archwizard + Old Bram (unleashed) | Final exam: picks the plan that hurts you most, switches when you adapt | Everything | Lady Glass (12) | x1.2 |

### Characters
New: Ivy and Rowan (twins), Bruno Kettle, Sister Wren, Kai, Proctor Quill, Juno Vale. Returning: Old Bram,
Pip, Miss Hollis, Brother Alden, Morwen, Nyx, Master Ito, Proctor Vell, Rook, Gideon, Lady Glass, the Archwizard.

- **Old Bram (1, 10):** runs the trials. Floor 1 he's babysitting Pip; floor 10 he stops holding back.
- **Pip (1):** still only throws lightning, now with someone to show off for.
- **Ivy + Rowan:** twins who finish each other's sentences (their lines are split between them).
- **Miss Hollis + Bruno:** a strict teacher and the big quiet kid she's coaching. She does the talking.
- **Brother Alden + Sister Wren:** temple siblings who bicker about who heals whom.
- **Morwen + Nyx:** a gothic double act. Morwen is theatrical; Nyx barely speaks.
- **Master Ito + Kai:** a calm master and his loud, eager student, who is the bait and doesn't know it.
- **Proctor Vell + Proctor Quill:** two exam proctors. Everything is a rule, a form or a penalty.
- **Rook + Juno Vale:** rivals from different schools forced to team up. They argue the whole fight.
- **Gideon + Lady Glass:** a cold, polite duo taking notes on you.
- **The Archwizard + Old Bram:** the original duet, fifty years ago. Old friends having fun.

### Lines (start / habit x2 / partner low / low / win / lose)
"Partner low" is new: said when the other bot drops under 30%.

1. **Old Bram:** "Two of you? Good. Pip needs the practice." / "Same one, Pip. Keep at it." "Big one coming. For them, not you, Pip." / "Pip, behind me." / "Oof. Teamwork's harder on the back." / "Not bad for an old man and a spark." / "Ha! You two talk to each other. That's the trick."
   **Pip:** "Grandpa Bram says I hit whoever he hits!" / "Zap! Same one!" "That one! Zap that one!" / "Grandpa!" / "Why are there two of you?!" / "Teamwork! Zap zap!" / "Okay, okay, you two were good."
2. **Ivy + Rowan** (split lines): "We always..." "...hit together." / "Three, two..." "...one!" and "Together..." "...again!" / "Rowan?!" and "Ivy!" / "This wasn't..." "...the plan." / "Perfect..." "...timing." / "You parried..." "...both of us?"
3. **Miss Hollis:** "Bruno, posture. Ice first, then you." / "Chilled. Now, Bruno." "Wait for the cold, Bruno." / "Bruno, guard up!" / "Unacceptable." / "Textbook. Write that down, Bruno." / "You broke the setup. Full marks."
   **Bruno:** "...Hi." / "Now?" "Big one." / "Miss Hollis!" / "Ow." / "We did it, Miss Hollis." / "...Good fight."
4. **Brother Alden:** "Sister, keep me standing." / "Heal for you, Wren." "Behind the shield." / "Wren, I've got you." / "Wren? A little help?" / "The Light keeps us both." / "You waited for the heal. Wise."
   **Sister Wren:** "I heal you, you heal me. Fair." / "That's your third heal, Alden." "Shield up!" / "Again, Alden?!" / "Who's healing ME?" / "Told you I'm the better healer." / "Fine. Hit the healer first. Smart."
5. **Morwen:** "One of you is already doomed. Guess who." / "Doomed, darling." "Nyx. Finish it." / "Nyx, not yet!" / "How rude." / "Doom always finds its way." / "You saved each other. How sweet. How annoying."
   **Nyx:** "..." / "..." "Now." / "Morwen." / "Hm." / "Gone." / "Seen."
6. **Master Ito:** "Kai, show them everything. I'll watch." / "Patience." "There it is." / "Breathe, Kai." / "Mm. Interesting." / "Kai, you were the lesson." / "Only one of you bit. Well done."
   **Kai:** "Watch THIS!" / "Big fire! Nobody can stop it!" "Look over here!" / "Master!" / "Why is nobody looking at me?" / "Did you see me? Did you SEE me?" / "Wait, was I the bait?"
7. **Proctor Vell:** "Rule one: no drawing during my turn." / "Interrupted. Penalty applies." "Your turn's over." / "Quill, cover." / "This is irregular." / "Exam failed. Resubmit." / "You took turns. Pass."
   **Proctor Quill:** "Rule two: no drawing during MY turn." / "Noted." "Next." / "Vell! Form 9-B!" / "Filing a complaint." / "Logged." / "Approved. Reluctantly."
8. **Rook:** "Stay out of my way, Vale." / "Hit her and you answer to me." "Combo. Watch and learn, Vale." / "Vale, get back!" / "Vale, you were supposed to cover me!" / "We won. Don't get used to it." / "One at a time. Annoyingly smart."
   **Juno Vale:** "Try to keep up, Rook." / "Touch Rook again, I dare you." "My combo was better." / "Rook, you're slipping!" / "Rook! Do something!" / "I carried. Obviously." / "Fine. You two are a better team than us."
9. **Gideon:** "Every mistake, I'll be there." / "Missed. Thank you." "Your partner fizzled. Noted." / "Glass. Adjust." / "Hm. Clean." / "Two players, twice the mistakes." / "Not one opening. Impressive."
   **Lady Glass:** "I'm learning both of you." / "Your team's favorite again." "I've seen this one." / "Gideon, change plans." / "You've both changed." / "Same team, same answers." / "You never showed me a pattern."
10. **The Archwizard:** "Bram. Like old times?" / "Your plan's showing." "We've done this before." / "Bram! Don't you dare." / "Fifty years, and nobody pushed us this far." / "Still the best duet in the school." / "Bram... I think they're better than we were."
    **Old Bram (unleashed):** "No more taking it slow." / "Not so slow now, eh?" "Remember this one?" / "On my way, old friend." / "Now THIS is a fight." / "Fifty years, and still." / "Ha! Pip's going to love this."

### Pair brain notes for the build
- One shared plan per pair: focus target, sync, stagger, setup chain, cover, bait, swap. Each floor weights its
  habit; the rest is a normal mix (exam floors weight all of their tier).
- Per bot: `partner`, `habit`, `habitStrength`, plus the 1v1 skill row for its floor.
- New barks: `partnerLow`, and split lines for the twins.
- Floor 10: the Archwizard's Shapeshifter switch, applied to the pair plan and chosen by what your duo is
  weakest to.

## Co-op ideas that make it a team game
- Ally heals/shields and "aim at the foe hitting my partner" already exist; floors should demand them.
- Possible later: duo combos (both players' spells landing together = bonus). Only if 2v2 needs it.

## Room (Nov 26: lives in the Tower, not Duel)
- The Tower page has a **Solo / Duo** switch over the tower. Duo shows the pairs' tower with Create room and
  a code box to Join. In a room: the code, your partner's status ("Share the code, or go alone"), the floor
  picker (host picks, up to one past the room's best), Ready and Leave room. 1 or 2 players.
- After a fight the result shows, then the Duo tower again (a win: "Floor cleared! Next up: floor N").
- Duel rooms are Versus only. The server keeps the two apart: a Duo code typed in Duel (or the reverse) is
  refused with a line saying where to join it. A refresh mid-room reopens the page the room belongs to.
- Switching to Solo leaves the room.

## Drops (decided Nov 26)
- Keep the existing 15 s hold (server GRACE_MS), then the seat is removed (already built).
- Pausing during the hold: **not for now** (Nov 26). Revisit if Duo Tower drops feel unfair.
- Built Nov 26 (all online team fights): the dropped player's card shows "Reconnecting N s", then OUT
  (written in the empty HP bar, same as a knockout); the toast sits under the HP bars and fades after 4 s (a forfeit vote or pause stays up).
- After the kick: a 3 s countdown and the fight resumes, you vs both bots. Win clears the floor; a loss or
  forfeit costs nothing. Back in the room with 1/2 seats; the code still works for a new partner.
- Mockup shown in chat Nov 26 (room, paused 12 s, Left, solo).

## Open questions
- Raid boss fits here as the top floor or a separate mode (see below).

## Raid boss (later, same infra)
Progress = **phases, not floors**. One boss, big HP, changes rules at 66% / 33%: e.g. phase 2 summons a shield
only a combo breaks, phase 3 throws synced pairs you must parry. Unlock harder bosses by beating the last;
weekly boss rotation for replay.

## Roguelike run (later)
The "fun and crazy" mode: after each win pick 1 of 3 wild modifiers (spells chain, parry reflects 3x, every
heavy splits in two). Fine if it bends skill; it's the party mode.

## Built (Nov 26)
- `apps/web/src/duo.ts`: roster, lines, floors, and `DuoBots` (the pair brain). Each bot is the 1v1 tower bot
  (battle.ts PracticeArena) seeing the 2v2 through a lens as a 1v1 (it's 'enemy', its target 'player'). Its style
  = its skill floor's numbers + its kit bot's spells/habit + floor mods; `slow` stretches its wait between casts.
- Pair plans steer targets (between casts) and timing: sync/stagger hold a spell so landings line up / stay
  650 ms apart. Twins: Ivy starts each line, Rowan finishes it 1.1 s later.
- Server (`server/index.ts`): a room made from the Tower's Duo is a Duo room; up to 2 players on one team vs
  bots b0/b1 (420 HP); host picks a floor up to one past the room's best; a win advances the room a floor.
  State carries `bots` (who, cast shape/progress, last line); the page draws the cast and the bubble.
- Progress is per browser (localStorage `duo-progress`), sent on create/join.
- Page: the Tower's Solo / Duo switch and Duo panel (SpellPage `DuoPanel`, mode 'duo'), the DuoTower floor
  picker (`DuoTower.tsx`), bot names and speech bubbles on the foe cards. New portraits in portraits.tsx.
- Check: `npm run duo-sim` (each floor vs two idle players). Nov 26: kills in 133, 115, 88, 105, 85, 82, 50, 55,
  46, 33 s; sync lands 62% together on floor 2, stagger 0% on floor 7, focus 76-92% same target.
- Not tested with real hands yet (camera blocked in the preview): difficulty for real duos is unproven.

## Duo sim tuning (Nov 26, `npm run duo-sim -- 8`)
Bot vs bot only. Duos are harder for people (twice the information), so each floor should sit at or under two
plain tower bots of its matching floor, and above the floor below. "Plays at" = the 1v1 bot whose numbers
(reactions, counters, parries, drawing speed) it uses; low floors play a floor or two under their 1v1 selves.
| Floor | Beats the floor below | vs 2 plain 1v1 bots |
|---|---|---|
| 1 | | 13% (2x Old Bram) |
| 2 | 75% | 13% (2x Pip) |
| 3 | 100% | 0% (2x Miss Hollis) |
| 4 | 100% | 0%, 6 draws (2x Brother Alden: a heal wall either way) |
| 5 | 60% (2 draws) | 50% (2x Morwen) |
| 6 | 75% | 38% (2x Nyx) |
| 7 | 100% | 63% (2x Proctor Vell) |
| 8 | 90% | 30% (2x Rook) |
| 9 | 100% (vs the new 8) | 38% (2x Gideon) |
| 10 | 88% | 38% (2x Lady Glass) |
Nov 26 later (10 games, rows for 4, 5, 8): floor 5 follows curses less (60% -> 45%) and waits 0.7 s before jumping
a curse; Wren heals herself only under 30%; floor 8 plays at Proctor Vell's numbers, Juno combos less, and
waits 0.8 s before swapping onto whoever hit its partner (`lag`: people need a moment to see it too).
Watch with real duos: fight length on floors 1-2
(bot vs bot ~3.5 min; with two players attacking it'll be shorter).

### Full re-run (Nov 26, 20 games; floors 4-5 rows after the last floor-4 change)
| Floor | Beats the floor below | vs 2 plain 1v1 bots |
|---|---|---|
| 1 | | 0% |
| 2 | 85% | 20% |
| 3 | 100% | 5% |
| 4 | 100% | 5% (3 draws) |
| 5 | 70% (1 draw) | 35% |
| 6 | 95% | 45% |
| 7 | 100% | 65% |
| 8 | 70% | 30% |
| 9 | 100% | 45% |
| 10 | 90% | 40% |
Floor 4 heals less (Nov 26: `healGap` 12 s, heals itself under 25%). The remaining draws aren't healing (3-7
heals a fight): one bot on each side is out by minute 2 and the two slowed survivors trade countered hits until
the cap. A bot-vs-bot endgame; with people attacking it shouldn't happen. 20 games after the change: 4 beats 3
100%, 5 beats 4 45% (4 draws), 4 vs 2x cleric 20% (4 draws).
Later (Nov 26): floor 4 plays at Pip's numbers (was Miss Hollis's). 20 games: 4 beats 3 100%, 5 beats 4 70%
(1 draw), 4 vs 2x cleric 5% (3 draws).
