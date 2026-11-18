"""Extract MediaPipe hand points from the ASL-HG photo dataset.

ASL-HG: Pranto et al., "A comprehensive image dataset of American Sign Language hand
gestures", Data in Brief (2026). Mendeley Data, doi:10.17632/j4y5w2c8w9.1, CC BY 4.0.
10 signers, 1,000 photos per letter, indoor/outdoor, varied lighting and angles.

Uses the same hand model as the web app (MediaPipe Hand Landmarker, float16 v1), so the
training points match what the game sees.

Usage:  .venv/Scripts/python extract_aslhg.py
Input:  data/downloads/ASL_Raw_Images.zip
Output: data/aslhg/points.npz  (points: N x 21 x 3, letters: N, files: N)
"""

import io
import sys
import urllib.request
import zipfile
from pathlib import Path

import mediapipe as mp
import numpy as np
from mediapipe.tasks.python import BaseOptions
from mediapipe.tasks.python.vision import HandLandmarker, HandLandmarkerOptions, RunningMode
from PIL import Image, ImageOps

ZIP = Path("data/downloads/ASL_Raw_Images.zip")
OUT = Path("data/aslhg/points.npz")
MODEL = Path("data/hand_landmarker.task")
MODEL_URL = "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task"
LETTERS = set("ABCDEFGHIJKLMNOPQRSTUVWXYZ")
MAX_SIDE = 960  # downscale big phone photos (faster; plenty of detail for the hand model)


def main():
    if not MODEL.exists():
        MODEL.parent.mkdir(parents=True, exist_ok=True)
        urllib.request.urlretrieve(MODEL_URL, MODEL)
    detector = HandLandmarker.create_from_options(HandLandmarkerOptions(
        base_options=BaseOptions(model_asset_path=str(MODEL)),
        running_mode=RunningMode.IMAGE, num_hands=1, min_hand_detection_confidence=0.3))

    points, letters, files = [], [], []
    missed = {}
    with zipfile.ZipFile(ZIP) as z:
        names = [n for n in z.namelist() if n.lower().endswith((".jpg", ".jpeg", ".png"))]
        for k, name in enumerate(names):
            # The class is the folder name, e.g. .../A/xxx.jpg
            letter = Path(name).parent.name.strip().upper()
            if letter not in LETTERS:
                continue  # digits etc.
            img = ImageOps.exif_transpose(Image.open(io.BytesIO(z.read(name)))).convert("RGB")
            img.thumbnail((MAX_SIDE, MAX_SIDE))
            result = detector.detect(mp.Image(image_format=mp.ImageFormat.SRGB, data=np.asarray(img)))
            if result.hand_landmarks:
                points.append([[p.x, p.y, p.z] for p in result.hand_landmarks[0]])
                letters.append(letter)
                files.append(name)
            else:
                missed[letter] = missed.get(letter, 0) + 1
            if k % 1000 == 0:
                print(f"{k}/{len(names)}  hands found: {len(points)}", flush=True)

    OUT.parent.mkdir(parents=True, exist_ok=True)
    np.savez_compressed(OUT, points=np.array(points, dtype=np.float32), letters=np.array(letters),
                        files=np.array(files))
    print(f"saved {OUT}: {len(points)} hands")
    print("no hand found:", dict(sorted(missed.items())))


if __name__ == "__main__":
    sys.exit(main())
