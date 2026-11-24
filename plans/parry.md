# Parry and reflect (built)

A core game feature, not a spell. Mirror is dropped.

## Sign
- Two-handed mode only. One-handed players don't get parry for now; revisit if accessibility needs it.
- **Parry = both hands push toward the camera at once.** Any hand shape, so the drawing hand's shape is still never read (only its size on screen).
- **Throw = only the signing hand pushes.** The drawing hand stays still.
- Tuning: the drawing hand must grow by the same push threshold, and both pushes must start within ~100 ms of each other.
- Opening hands commits nothing. Only the push decides, so there's no cancel and no pen-up wait.

## Timing
- Flight times: light 320, heavy 480, signature 650 ms (`FLY_MS`).
- Parry window: the last 100 ms before impact, the same for every spell. Light spells need prediction; heavy and signature can be reacted to.
- Indicator: a ring that closes on impact and lights up for the window, on the training dummy only. In real fights you time it from the projectile.

## Outcomes
- **Any parry, hit or miss, gives up your own cast:** the drawing in progress, the readied spell and the charge are all dropped. You can't parry and still throw.
- Drawing pauses for ~500 ms after a parry, so the hand coming back doesn't start a line.
- **Hit:** the spell reflects at 100%, then 75%, then 50% of its power; a fourth parry just ends it. No stun.
- **Miss:** a 1 s stagger: no throws and no parries.

## Practice
- Training dummy "Attack me": it throws random light, heavy and signature spells every ~2.6 s, and neither side can be hurt. You can parry or counter them.

## Related settings
- Push size button (Tiny 1.08×, Small 1.14×, Medium 1.25× default, Big 1.4×), shared by throw and parry, in home settings and the Esc menu. The parry's "drawing hand already pushing" wait scales with it (halfway to the size).
- Sign hold 50 ms, pen switch 50 ms (two fight ticks). Dropping a charge with an open hand stays 150 ms.
