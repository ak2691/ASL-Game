"""Check shapes.json: which near-miss kinds leak (at the game's thresholds), and re-read real strokes."""
import glob, json, sys
import numpy as np
from synth_shapes import CLASSES, Gen, features

m = json.load(open(sys.argv[1] if len(sys.argv)>1 else "../apps/web/public/models/shapes.json"))
def run(f):
    x = f
    for l in m["layers"]:
        x = x @ np.array(l["w"]).reshape(l["inputs"], l["outputs"]) + np.array(l["b"])
        if l["activation"] == "relu": x = np.maximum(x, 0)
    e = np.exp(x - x.max()); return e / e.sum()
SIG = {"flame", "cage", "zigzag7", "battlements", "spiral", "aegis", "mirror", "scythe", "veil", "blade", "volcano", "cloud", "trefoil", "yinyang"}
def accepted(p):
    i = int(p.argmax()); n = CLASSES[i]
    return n if n != "none" and p[i] >= (0.9 if n in SIG else 0.7) else "none"

g = Gen(4242)
kinds = {
 "flame 3 spikes": lambda: g.flame(n=3), "flame 5 spikes": lambda: g.flame(n=5), "flame 2 spikes": lambda: g.flame(n=2), "crown only": lambda: g.flame(bowl=False), "flame round": lambda: g.flame(round_tips=True),
 "battle 2 humps": lambda: g.battlements(n=2), "battle 4 humps": lambda: g.battlements(n=4), "battle slant": lambda: g.battlements(slant=0.4),
 "battle round": lambda: g.battlements(round_tops=True), "unfinished": g.unfinished, "almost done": g.almost, "circle+X": g.circle_x, "sideways": g.sideways,
 "M": lambda: g.w(flip=True), "W": lambda: g.w(), "H half leg": lambda: g.h(half=True), "H one leg": lambda: g.h(legs=1), "zig 6/8": lambda: g.zigzag(n=int(g.r.choice([6, 8]))),
 "shield no line": lambda: g.aegis(line=False), "vertical 8": lambda: g.mirror(vertical=True), "half 8": lambda: g.mirror(loops=0.55),
 "easy scythe": lambda: g.hook(), "doom stage 3": lambda: g.scythe(stage=3), "doom stage 2": lambda: g.scythe(stage=2), "wave": lambda: g.veil(flat=True), "2 loops": lambda: g.veil(loops=2), "cane": lambda: g.hook(blade=0.15),
 "J": lambda: g.hook(upside=True), "box+post": lambda: g.blade(tri=False), "box+blade": lambda: g.blade(post=False),
 "old execute": lambda: g.blade(old=True), "volcano no smoke": lambda: g.volcano(smoke=False), "cloud no bolt": lambda: g.cloud(bolt=False),
 "cloud 2/5 bumps": lambda: g.cloud(bumps=int(g.r.choice([2, 5]))), "4/5 petals": lambda: g.trefoil(k=int(g.r.choice([2, 5]))),
 "circle+line": lambda: g.yinyang(inner="line"), "hairpin": lambda: g.hook(hairpin=True),
}
for k, fn in kinds.items():
    res = [accepted(run(features(fn()))) for _ in range(300)]
    leak = [r for r in res if r != "none"]
    print(f"{k:16s} leak {len(leak)/3:5.1f}%  {dict(zip(*np.unique(leak, return_counts=True))) if leak else ''}")
for c in CLASSES[1:]:
    ok = np.mean([accepted(run(features(g.make(c)))) == c for _ in range(300)])
    print(f"accept {c:12s} {ok*100:5.1f}%")
S = [s for f in sorted(glob.glob("data/strokes/*.json")) for s in json.load(open(f))]
print(" ".join(f"{i}:{accepted(run(features(np.array(s['points'], float))))}" for i, s in enumerate(S)))
