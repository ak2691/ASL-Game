"""Extract MediaPipe hand points from the ASL-HG dataset (processed version).

ASL-HG: Pranto et al., "A comprehensive image dataset of American Sign Language hand
gestures", Data in Brief (2026). Mendeley Data, doi:10.17632/j4y5w2c8w9.1, CC BY 4.0.
10 signers, 1,000 photos per letter, indoor/outdoor, varied lighting and angles.
We use the Hugging Face mirror (juanjodurillo/asl-hg, same CC BY 4.0 data, much faster
to download than Mendeley). It has the "processed" hand crops; file names start with the
signer id (e.g. P10_...), which we keep for honest unseen-signer testing.

Uses the same hand model as the web app (MediaPipe Hand Landmarker, float16 v1), so the
training points match what the game sees. Crops get a 30% black border first: tight crops
made MediaPipe miss 11% of hands; with the border it found 100% in a test of 300.

Usage:  .venv/Scripts/python extract_aslhg.py
Input:  data/aslhg-hf/data/*.parquet   (download: see README in ml/ or skills.md)
Output: data/aslhg/points.npz  (points: N x 21 x 3, letters: N, signers: N)
"""

import mediapipe as mp  # import before pyarrow: the other order fails to load on Windows
from mediapipe.tasks.python import BaseOptions
from mediapipe.tasks.python.vision import HandLandmarker, HandLandmarkerOptions, RunningMode

import io
from pathlib import Path

import numpy as np
import pyarrow.parquet as pq
from PIL import Image, ImageOps

PARQUETS = sorted(Path("data/aslhg-hf/data").glob("*.parquet"))
OUT = Path("data/aslhg/points.npz")
MODEL = Path("data/hand_landmarker.task")
LABELS = [str(d) for d in range(10)] + list("ABCDEFGHIJKLMNOPQRSTUVWXYZ")  # dataset's label order
BORDER = 0.3


def main():
    detector = HandLandmarker.create_from_options(HandLandmarkerOptions(
        base_options=BaseOptions(model_asset_path=str(MODEL)),
        running_mode=RunningMode.IMAGE, num_hands=1, min_hand_detection_confidence=0.3))

    points, letters, signers = [], [], []
    missed, done = 0, 0
    for path in PARQUETS:
        table = pq.read_table(path)
        images, labels = table.column("image").to_pylist(), table.column("label").to_pylist()
        for img, label in zip(images, labels):
            letter = LABELS[label]
            if not letter.isalpha():
                continue  # skip digits
            im = Image.open(io.BytesIO(img["bytes"])).convert("RGB")
            im = ImageOps.expand(im, border=int(max(im.size) * BORDER), fill=(0, 0, 0))
            if max(im.size) < 300:
                im = im.resize((im.width * 2, im.height * 2))
            result = detector.detect(mp.Image(image_format=mp.ImageFormat.SRGB, data=np.asarray(im)))
            done += 1
            if not result.hand_landmarks:
                missed += 1
                continue
            points.append([[p.x, p.y, p.z] for p in result.hand_landmarks[0]])
            letters.append(letter)
            signers.append(img["path"].split("_")[0])  # e.g. "P10"
            if done % 2000 == 0:
                print(f"{done} images, {missed} without a hand", flush=True)

    OUT.parent.mkdir(parents=True, exist_ok=True)
    np.savez_compressed(OUT, points=np.array(points, dtype=np.float32),
                        letters=np.array(letters), signers=np.array(signers))
    print(f"saved {OUT}: {len(points)} hands from {done} images ({missed} without a hand)")


if __name__ == "__main__":
    main()
