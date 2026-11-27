# Feints (Nov 27)

Feinting is already in the rules: drop a half-drawn spell (0.5 s fizzle, no wear) or switch element, so the
opponent's counter finds nothing. This file covers how the bots handle feints, both ways. Code: `battle.ts`
(`watch`, `bailCheck`, `dodge`, `baitSpell`); numbers in the `AI` table.

## The trade
| | Cost |
|---|---|
| Feinter | sign + drawing time spent, 0.5 s fizzle lock (no throws; signing still works) |
| Defender throws a counterspell at nothing | its drawing, plus a wear stack |
| Defender throws a quick interrupt at nothing | 1 s whiff lock, plus half a wear stack |
| Defender sees the drop and drops too | its drawing (and a fizzle if its stroke had started) |

## What the bots do
- **Bail** (`bail`): its counter's target is gone (you dropped or switched). After a beat to notice (about 45% of
  its reaction time), it may drop the counter too, fizzling like you would. Without it, the counter flies at nothing.
- **Feint memory** (`feintRead`): each charge you drop after it bit adds to a count (a full one if its counter had
  started, half if it was only planned); each real attack takes half off; the count halves every 20 s. The count
  makes it bite less often and later, and at 1+ it waits for your drawing to start (or a readied spell) before
  committing, for up to 0.6-1.8 s after your sign. Heals and combos aren't affected.
- **Fizzle punish** (`fizzlePunish`): you fizzle while it's free (or right after it bails): a quick light from
  its freshest element.
- **Dodge** (`dodge`, from Pip up now): drops its own spell only when your counter would land before its spell is
  out. Readied counterspell: lands about now. Drawing: at your counterspell pace. It races instead if it's out
  first, or within 0.5 s of done. Each bluff you get away with halves it (unchanged).
- **Baits** (`feint`): a share of its casts is a heavy of an element you can counter (often one you countered
  before). It's a real spell: if you don't bite, it goes out. If you commit, it waits until you're 60% into your
  usual counter drawing (or readied), then dodges at 90% (halved per bluff) and throws a quick light of another element.

## Your counter pace
The middle of your last 3 counterspell drawings (stroke start to readied); 1 s until it has seen two. Only
recent ones count, so it follows how you're playing now. Attack pace (`castTimes`) is separate.

## Rungs
Old Bram has none. It ramps from Pip (bail 5%, feint memory 0.1, baits 2%, dodge 3%) to the Archwizard (70%, 1.0,
20%, 38%); Tamsin's dodge stays at 15%. Full table in `AI Difficulty.md`.

## Sims
The ladder and duo sims take `FEINTS=off` to compare against the old behaviour. Limits: a bot's counter is readied
and thrown in the same tick, so the sims never see a readied counter (dodges and baits run on the drawing path,
pace stays at the 1 s guess). Bots only feint through dodges and baits, so feint memory gets little use there.
