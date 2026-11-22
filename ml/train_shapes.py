"""Train the spell-shape network on synthetic drawings (synth_shapes.py).

Model: 326 -> 256 -> 96 -> 19 MLP (same JSON layer format as letters.json).
Usage:  .venv/Scripts/python train_shapes.py
Output: ../apps/web/public/models/shapes.json
"""

import json
from pathlib import Path

import numpy as np
import torch
from sklearn.metrics import classification_report, confusion_matrix
from torch import nn

from synth_shapes import CLASSES, N_FEATURES, dataset

OUT = Path("../apps/web/public/models/shapes.json")
torch.manual_seed(0)

print("generating...")
Xtr, Ytr = dataset(5000, seed=1, none_mult=5, real=True)
Xte, Yte = dataset(400, seed=999, none_mult=5)
print(Xtr.shape, Xte.shape)

model = nn.Sequential(
    nn.Linear(N_FEATURES, 256), nn.ReLU(), nn.Dropout(0.2),
    nn.Linear(256, 96), nn.ReLU(), nn.Dropout(0.1),
    nn.Linear(96, len(CLASSES)),
)
xt, yt = torch.tensor(Xtr), torch.tensor(Ytr, dtype=torch.long)
counts = np.bincount(Ytr, minlength=len(CLASSES))
lossf = nn.CrossEntropyLoss(weight=torch.tensor(counts.sum() / counts / len(CLASSES), dtype=torch.float32))
opt = torch.optim.Adam(model.parameters(), 1e-3, weight_decay=1e-5)
sched = torch.optim.lr_scheduler.CosineAnnealingLR(opt, 60)
for ep in range(60):
    model.train()
    perm = torch.randperm(len(xt))
    for i in range(0, len(xt), 256):
        b = perm[i:i + 256]
        opt.zero_grad()
        lossf(model(xt[b]), yt[b]).backward()
        opt.step()
    sched.step()
    if ep % 10 == 9:
        model.eval()
        with torch.no_grad():
            acc = (model(torch.tensor(Xte)).argmax(1).numpy() == Yte).mean()
        print(f"epoch {ep + 1}: test acc {acc:.3f}")

model.eval()
with torch.no_grad():
    pred = model(torch.tensor(Xte)).argmax(1).numpy()
print(classification_report(Yte, pred, target_names=CLASSES, digits=3))
print("confusion (rows = true):", CLASSES)
print(confusion_matrix(Yte, pred))

layers = []
lin = [m for m in model if isinstance(m, nn.Linear)]
for i, m in enumerate(lin):
    w = m.weight.detach().numpy().T
    layers.append({"inputs": w.shape[0], "outputs": w.shape[1], "activation": "softmax" if i == len(lin) - 1 else "relu",
                   "w": [round(float(v), 5) for v in w.reshape(-1)], "b": [round(float(v), 5) for v in m.bias.detach().numpy()]})
OUT.write_text(json.dumps({"labels": CLASSES, "layers": layers}))
print("wrote", OUT)
