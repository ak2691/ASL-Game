# Ladder sim results

Run: `npm run sim -- <games per pair>` in apps/web (scripts/ladder-sim.ts). Bot vs bot only: proof of order, not of how hard a floor feels to a person.

## Nov 26, 20 games per pair (after the counter nerf, Tide/Warden buff)

```

Each floor vs the floor below it (win rate of the higher floor; over 50% = it is harder):
  Pip              vs Old Bram           0%   avg 119 s
  Miss Hollis      vs Pip              100%   avg 104 s
  Brother Alden    vs Miss Hollis      100%   avg 139 s
  Morwen           vs Brother Alden     45%   avg 134 s
  Master Ito       vs Morwen            60%   avg 124 s
  Nyx              vs Master Ito        35%   avg 290 s, 8 draws
  Proctor Vell     vs Nyx              100%   avg 87 s
  Rook             vs Proctor Vell      40%   avg 128 s
  Gideon           vs Rook              95%   avg 115 s
  Tamsin           vs Gideon            95%   avg 102 s
  Lady Glass       vs Tamsin            65%   avg 94 s
  The Archwizard   vs Lady Glass        45%   avg 87 s

Each floor vs Nyx (one fixed yardstick; should rise floor by floor):
  Old Bram           0%  
  Pip                0%  
  Miss Hollis        0%  
  Brother Alden     25%  #####
  Morwen            35%  #######
  Master Ito        25%  #####
  Nyx               --  (yardstick)
  Proctor Vell      95%  ###################
  Rook             100%  ####################
  Gideon           100%  ####################
  Tamsin           100%  ####################
  Lady Glass       100%  ####################
  The Archwizard   100%  ####################

```

Out of order: Pip < Old Bram, Morwen = Brother Alden, Nyx < Master Ito (8 draws), Rook < Proctor Vell,
Archwizard = Lady Glass. Cliff: Nyx (yardstick) to Proctor Vell. (Later runs use two yardsticks.)

## Nov 26, 30 games per pair, after tuning

```

Each floor vs the floor below it (win rate of the higher floor; over 50% = it is harder):
  Pip              vs Old Bram          50%   avg 135 s
  Miss Hollis      vs Pip               97%   avg 105 s
  Brother Alden    vs Miss Hollis       97%   avg 132 s
  Morwen           vs Brother Alden     70%   avg 138 s
  Master Ito       vs Morwen            50%   avg 120 s
  Nyx              vs Master Ito        33%   avg 262 s, 7 draws
  Proctor Vell     vs Nyx               97%   avg 91 s
  Rook             vs Proctor Vell      80%   avg 123 s
  Gideon           vs Rook              90%   avg 104 s
  Tamsin           vs Gideon            90%   avg 92 s
  Lady Glass       vs Tamsin            60%   avg 102 s
  The Archwizard   vs Lady Glass        60%   avg 91 s

Each floor vs two fixed yardsticks (Morwen, Rook); each column should rise floor by floor:
  Old Bram           0%     0%
  Pip                7%     0%
  Miss Hollis       13%     0%
  Brother Alden     47%     0%
  Morwen             --     0%
  Master Ito        40%     0%
  Nyx               77%     0%
  Proctor Vell     100%    13%
  Rook              97%     --
  Gideon           100%   100%
  Tamsin           100%    97%
  Lady Glass       100%   100%
  The Archwizard   100%   100%

```

In order by the Morwen yardstick except Master Ito (40%) a hair under Brother Alden (47%), within noise
(about +-9% at 30 games). Nyx loses the direct matchup to Master Ito (Ito counters her heals) but is clearly
stronger overall (77% vs 40% on the yardstick). Cliffs: Nyx to Proctor Vell (reading starts at Vell) and
Rook to Gideon.

## Nov 26, smoothing the jumps (30 games)

```

Each floor vs the floor below it (win rate of the higher floor; over 50% = it is harder):
  Pip              vs Old Bram          60%   avg 137 s
  Miss Hollis      vs Pip              100%   avg 103 s
  Brother Alden    vs Miss Hollis      100%   avg 121 s
  Morwen           vs Brother Alden     53%   avg 128 s
  Master Ito       vs Morwen            50%   avg 126 s
  Nyx              vs Master Ito        47%   avg 256 s, 9 draws
  Proctor Vell     vs Nyx              100%   avg 124 s
  Rook             vs Proctor Vell      73%   avg 104 s
  Gideon           vs Rook              83%   avg 135 s
  Tamsin           vs Gideon            83%   avg 90 s
  Lady Glass       vs Tamsin            63%   avg 112 s
  The Archwizard   vs Lady Glass        50%   avg 88 s

Each floor vs two fixed yardsticks (Morwen, Rook); each column should rise floor by floor:
  Old Bram           0%     0%
  Pip                0%     0%
  Miss Hollis       23%     0%
  Brother Alden     47%     3%
  Morwen             --     0%
  Master Ito        57%     0%
  Nyx               90%     0%
  Proctor Vell     100%    33%
  Rook             100%     --
  Gideon           100%    90%
  Tamsin           100%    97%
  Lady Glass       100%   100%
  The Archwizard   100%    97%

```

Nyx to Proctor Vell smoothed (Vell vs the Rook yardstick 13% -> 33%). Rook to Gideon still steep (Gideon 90% vs Rook):
its edge is structural (capitalize = punishes openings, combo counterspells), not pace (every 730 -> 810 changed
nothing, reverted). A later fix would be giving Rook capitalize too, or lowering Gideon's.

Tried Nov 26: Rook capitalize false -> true: Gideon vs Rook 90% -> 97% (no help, within noise), reverted. Pace and
capitalize ruled out; next suspects are Gideon's heal 0.5 vs 0.25 and his reroll.
Tried Nov 26: Rook heal 0.25 -> 0.5 and reroll 0 -> 2400 (Gideon's): Gideon vs Rook still 90%, reverted. Not the habits
either: the top half climbs steeply everywhere (each floor beats the one below 85-97%), from per-floor draw times
(AI_DRAW eases ~8% faster a floor) on top of the stat ramp. It's the curve, not one bad step; flattening it means
slowing AI_DRAW's top end, which makes the top floors easier for people too.

## Nov 26, after capping bot counters (30 games)

```

Each floor vs the floor below it (win rate of the higher floor; over 50% = it is harder):
  Pip              vs Old Bram          50%   avg 134 s
  Miss Hollis      vs Pip              100%   avg 100 s
  Brother Alden    vs Miss Hollis      100%   avg 135 s
  Morwen           vs Brother Alden     47%   avg 134 s
  Master Ito       vs Morwen            33%   avg 134 s
  Nyx              vs Master Ito        60%   avg 241 s, 7 draws
  Proctor Vell     vs Nyx               87%   avg 119 s
  Rook             vs Proctor Vell      73%   avg 118 s
  Gideon           vs Rook              90%   avg 99 s
  Tamsin           vs Gideon            90%   avg 84 s
  Lady Glass       vs Tamsin            63%   avg 100 s
  The Archwizard   vs Lady Glass        70%   avg 99 s

Each floor vs two fixed yardsticks (Morwen, Rook); each column should rise floor by floor:
  Old Bram           0%     0%
  Pip                3%     0%
  Miss Hollis        7%     0%
  Brother Alden     33%     0%
  Morwen             --     0%
  Master Ito        40%     0%
  Nyx               63%     0%
  Proctor Vell      97%    17%
  Rook             100%     --
  Gideon           100%    83%
  Tamsin           100%   100%
  Lady Glass       100%   100%
  The Archwizard   100%   100%

```
Then Master Ito every 1150 -> 1080: Ito vs Morwen 33% -> 70% (quick run).
