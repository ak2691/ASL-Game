"""Generate synthetic J / Z / none motion clips as MediaPipe-style hand point sequences.

Why synthetic: our letter datasets are single frames (no motion), and one signer on one
camera would make a narrow dataset. Instead we take REAL static handshapes from many
signers (I for J, D for Z, all letters for "none") and animate textbook motion paths
with random variation. Real clips are used only for testing (see skills.md).

Textbook paths (signer's view, right hand):
  J: I handshape. Pinky drops down, then the wrist twists so the palm turns toward the
     signer; the pinky tip sweeps toward the thumb side and curls slightly up (a hook).
  Z: index finger out. Whole hand draws Z: across (thumb side -> pinky side), diagonally
     back and down, across again.
  wiggle: quick side-to-side shake of the hand (any handshape), 2+ back-and-forths. The
     "erase" gesture (signers shake off a fingerspelling mistake).
  none: holding letters (incl. I and D still), moving between letters, partial J/Z
     (drop with no twist, only 1-2 strokes), slow sways / one swing / tremor, wandering.
  Any class may end with the hand leaving (sign, then drop the hand or move away at once),
  so the model is sure right as the sign ends instead of after a still moment.

Each clip: FRAMES x 21 x 3 in image coordinates (x right, y down, z depth), like MediaPipe.
Clips are randomly mirrored (left-handed signers / mirrored video).

Usage:  .venv/Scripts/python synth_motion.py [--n 4000] [--preview]
Output: data/motion/synth.npz  (points, labels, kinds)
        data/motion/synth_test.npz (same, only holdout signers' hands, other seed)
        preview/motion_preview.json with --preview (5 J, 5 Z, 5 none for review)
"""

import argparse
import json
from pathlib import Path

import os

import numpy as np

# WARNING (Nov 21, 2026): these loaders now return TRUE-proportion points (x and z times width /
# height), but the app still feeds the motion model raw 0..1 points (motion.ts). Before re-running
# this script, either switch the app's motion input to trueShape() too, or convert back here.
from train_letters import HOLDOUT_SIGNERS, LETTERS, load_aslhg, load_aslnow, load_siruyy

FRAMES = 45  # 1.5 s at 30 fps (long enough for slow or big Js and Zs)
CLASSES = ["none", "J", "Z", "wiggle"]
rng = np.random.default_rng(0)


# ---------- poses ----------

def to_palm_frame(p: np.ndarray) -> np.ndarray:
    """Wrist at origin, scaled so wrist -> middle knuckle = 1 (in x/y)."""
    q = p - p[0]
    return q / (np.linalg.norm(q[9, :2]) or 1.0)


def load_poses(holdout: bool = False) -> dict[str, np.ndarray]:
    """Real static poses per letter. Default: holdout signers excluded.
    holdout=True: ONLY the holdout signers (for a test set of unseen hands)."""
    h, hy, hs = load_aslhg()
    if holdout:
        keep = np.isin(hs, list(HOLDOUT_SIGNERS))
        pts, ys = h[keep], hy[keep]
    else:
        a, ay = load_aslnow()
        s, sy = load_siruyy()
        keep = ~np.isin(hs, list(HOLDOUT_SIGNERS))
        pts = np.concatenate([a, s, h[keep]])
        ys = np.concatenate([ay, sy, hy[keep]])
    return {L: np.array([to_palm_frame(p) for p in pts[ys == i]]) for i, L in enumerate(LETTERS)}


def rodrigues(v: np.ndarray, axis: np.ndarray, ang: float) -> np.ndarray:
    k = axis / np.linalg.norm(axis)
    c, s = np.cos(ang), np.sin(ang)
    return v * c + np.cross(k, v) * s + np.outer(v @ k, k) * (1 - c)


def rot_z(v: np.ndarray, ang: float) -> np.ndarray:
    c, s = np.cos(ang), np.sin(ang)
    out = v.copy()
    out[:, 0], out[:, 1] = v[:, 0] * c - v[:, 1] * s, v[:, 0] * s + v[:, 1] * c
    return out


def rot_x(v: np.ndarray, ang: float) -> np.ndarray:
    c, s = np.cos(ang), np.sin(ang)
    out = v.copy()
    out[:, 1], out[:, 2] = v[:, 1] * c - v[:, 2] * s, v[:, 1] * s + v[:, 2] * c
    return out


def thumb_side(pose: np.ndarray) -> float:
    """+1 if the thumb is to the image-right of the pinky base, else -1."""
    return 1.0 if pose[2, 0] > pose[17, 0] else -1.0


# ---------- timing ----------

def ease(u: np.ndarray) -> np.ndarray:
    u = np.clip(u, 0, 1)
    return u * u * (3 - 2 * u)


END_AT: int | None = None  # set by generate(): the motion ends this many frames before the window ends


def timeline(dmin: int = 10, dmax: int = 40) -> np.ndarray:
    """Per-frame progress 0..1: hold, move (random speed), hold."""
    dur = rng.integers(dmin, dmax)  # default: motion lasts ~0.33-1.3 s
    start = rng.integers(0, FRAMES - dur + 1) if END_AT is None else max(FRAMES - dur - END_AT, 0)
    t = (np.arange(FRAMES) - start) / dur
    # uneven speed: warp time a little
    w = rng.uniform(0.7, 1.4)
    return np.clip(t, 0, 1) ** w


def polyline(points: np.ndarray, u: np.ndarray) -> np.ndarray:
    """Position along a polyline at arc-length fractions u, corners softened."""
    seg = np.linalg.norm(np.diff(points, axis=0), axis=1)
    cum = np.concatenate([[0], np.cumsum(seg)]) / seg.sum()
    fine = np.linspace(0, 1, 200)
    path = np.stack([np.interp(fine, cum, points[:, d]) for d in range(2)], 1)
    k = int(rng.integers(4, 16))  # corner rounding
    if k > 1:
        pad = np.pad(path, ((k, k), (0, 0)), mode="edge")
        path = np.stack([np.convolve(pad[:, d], np.ones(k) / k, mode="same")[k:-k] for d in range(2)], 1)
    return np.stack([np.interp(u, fine, path[:, d]) for d in range(2)], 1)


# ---------- clip builders (all in palm units, wrist-relative + hand offset) ----------

def base_tilt(pose: np.ndarray) -> np.ndarray:
    """Random natural hand orientation. Half the time the hand is side-on to the camera
    (user recordings: palm ~65 deg from facing it for both J and Z). Applied to every class,
    so hand angle is never a clue for which sign it is (v9 lesson: side-on only in J hurt Z)."""
    p = rot_z(pose, rng.normal(0, 0.15))
    p = rot_x(p, rng.normal(0, 0.2))
    if rng.random() < 0.5 and not os.environ.get('ABL_NO_SIDEON'):
        p = rodrigues(p, p[9] - p[0], rng.choice([-1, 1]) * rng.uniform(np.radians(35), np.radians(75)))
    return p


def curl_others(pose: np.ndarray, strength: float | None = None) -> np.ndarray:
    """Fold middle/ring/pinky tight into the palm (a "1" hand). User's real Zs: those fingers
    at 0.4-0.5 of knuckle distance from the wrist, tighter than the D poses in our data."""
    p = pose.copy()
    k = rng.uniform(0.5, 1.0) if strength is None else strength
    for mcp in (9, 13, 17):
        target = p[mcp] + (p[0] - p[mcp]) * np.array([0.2, 0.45, 0.6])[:, None]
        p[mcp + 1:mcp + 4] += (target - p[mcp + 1:mcp + 4]) * k
    return p


def clip_J(pose):
    """J = drop + wrist rotation + hook. Covers small textbook Js up to big, fast arm Js
    (user recordings, Nov 2026: pinky drops 2-2.7 palm units, whole hand 1-1.6, hook 0.2-0.5,
    moderate twist, often a return movement upward afterwards)."""
    big = rng.random() < 0.6
    u = timeline(7, 30) if big else timeline()
    split = rng.uniform(0.25, 0.55)  # drop first, twist + hook after (overlapping)
    drop = ease(u / (split + 0.2))
    twist = ease((u - split) / (1 - split))
    # Real Js (user, every clip) turn THROUGH edge-on: palm width 0.4 -> 0.06 -> 0.4. So start
    # side-on, turned the same way as the twist (not base_tilt's random side-on turn), and the
    # twist crosses edge-on. "None" clips get side-on hands from base_tilt too, so the J cue
    # is the turn itself, not the hand angle (v9 learned that shortcut; v11 lost J without the turn).
    p0 = rot_x(rot_z(pose, rng.normal(0, 0.15)), rng.normal(0, 0.2))
    axis = p0[9] - p0[0]  # forearm-ish axis
    side = thumb_side(p0)
    # choose rotation sign that moves the pinky toward the thumb side
    sign = 1.0 if (rodrigues(p0[20][None], axis, 0.3)[0, 0] - p0[20][0]) * side > 0 else -1.0
    if rng.random() < 0.85:
        p0 = rodrigues(p0, axis, sign * rng.uniform(np.radians(35), np.radians(75)))
    ang = sign * rng.uniform(np.radians(30), np.radians(80))
    drop_len = rng.uniform(1.0, 2.6) if big else rng.uniform(0.3, 0.9)  # whole-hand drop
    # wrist flexes at the bottom; a big flex points the pinky toward the camera (it looks shorter)
    # Real Js: the pinky tip moves ~1.5 palm units up/down relative to the wrist (pinky goes from
    # pointing up to pointing at the camera), then the hand comes back up so the pinky re-extends.
    bend = rng.uniform(0.9, 1.7) if big else rng.uniform(0.4, 1.1)
    back_share = rng.uniform(0.6, 1.0)  # how much of the flex is undone by the end (1 = all)
    lift = rng.uniform(0.05, 0.3)
    sweep = rng.uniform(0.0, 0.3)  # hook: hand moves toward the thumb side at the bottom
    frames = []
    for d, tw in zip(drop, twist):
        p = rodrigues(p0, axis, ang * tw)
        p = rot_x(p, -bend * np.sin(np.pi * min(tw, 1.0) * (1 - back_share / 2)))  # flex, then partly back
        off = np.array([side * sweep * tw, drop_len * d - lift * tw, 0])
        frames.append(p + off)
    frames = np.array(frames)
    # What the tracker reports during the hook (user recordings, Nov 2026): as the hand turns,
    # the pinky points toward/away from the camera or hides behind the hand, and MediaPipe
    # reports it folded (seen length 1.9 -> 0.4-0.8 palm units); other fingers often look half open.
    w = frames[:, :1]
    if rng.random() < 0.7:
        fold = rng.uniform(0.4, 1.0) * np.sin(np.pi * np.clip(twist, 0, 1))[:, None, None]  # peaks mid-hook
        base = frames[:, 17:18]
        curled = base + (w - base) * np.array([0.1, 0.3, 0.5])[None, :, None]  # folded into the palm
        frames[:, 18:21] = frames[:, 18:21] + (curled - frames[:, 18:21]) * fold
    if rng.random() < 0.5:
        k = [6, 10, 14][rng.integers(3)]  # one of index/middle/ring looks partly open (index matters: v10 without it lost the J gains)
        opn = rng.uniform(0.3, 1.0) * np.sin(np.pi * np.clip(twist, 0, 1))[:, None, None]
        mcp = frames[:, k - 1:k]
        direction = (mcp - w) / (np.linalg.norm(mcp - w, axis=2, keepdims=True) + 1e-6)
        for j in range(3):  # joints out along the knuckle direction, further for outer joints
            frames[:, k + j:k + j + 1] = frames[:, k + j:k + j + 1] * (1 - opn) + (mcp + direction * 0.45 * (j + 1)) * opn
    # often the hand comes back up after the J (a return movement); fill frames after the end
    end = int(np.argmax(u >= 1)) if (u >= 1).any() else FRAMES
    if rng.random() < 0.4 and end < FRAMES - 3:
        back = ease((np.arange(FRAMES - end)) / rng.uniform(4, 10)) * rng.uniform(0.3, 1.0) * drop_len
        frames[end:] -= np.array([0, 1, 0]) * back[:, None, None]
    return frames


def clip_Z(pose):
    """Z drawn with the index. User recordings (Nov 2026): narrow (0.7-0.8 palm units wide,
    ~1 tall), a tight "1" hand, side-on, and much of the sideways stroke comes from the wrist
    turning rather than the whole arm moving."""
    if rng.random() < 0.6:
        pose = curl_others(pose)
    p0 = rot_x(base_tilt(pose), -rng.uniform(0, 0.6))  # index points up to toward camera
    W, H = rng.uniform(0.5, 1.6), rng.uniform(0.6, 1.4)
    side = -thumb_side(p0)  # first stroke goes from thumb side toward pinky side
    slant = rng.normal(0, 0.12)
    corners = np.array([[0, 0], [W, slant], [rng.uniform(-0.15, 0.15), H], [W * rng.uniform(0.8, 1.2), H + slant]])
    corners[:, 0] *= side
    corners += rng.normal(0, 0.05, corners.shape)
    xy = polyline(corners, timeline())
    arm = rng.uniform(0.3, 1.0)  # share of the sideways stroke done by moving the arm; the rest by the wrist
    L = np.linalg.norm(p0[8, :2] - p0[0, :2]) or 1.0
    roll = rng.normal(0, 0.1)
    frames = []
    for i, (x, y) in enumerate(xy):
        p = rot_z(p0, roll * (i / FRAMES) + (1 - arm) * x / L)  # wrist turn swings the fingertip sideways
        frames.append(p + [arm * x, y, 0])
    return np.array(frames)


def clip_hold(pose, curl: bool = False):
    if curl:
        pose = curl_others(pose)
    p0 = base_tilt(pose)
    drift = np.cumsum(rng.normal(0, 0.01, (FRAMES, 3)), 0) * [1, 1, 0.3]
    return np.array([p0 + d for d in drift])


def clip_transition(pa, pb):
    a, b = base_tilt(pa), base_tilt(pb)
    u = ease(timeline())
    move = rng.normal(0, 0.3, 3) * [1, 1, 0]
    return np.array([a * (1 - k) + b * k + move * k for k in u])


def clip_partial_J(pose):
    """I that drops straight (no rotation, no hook; small or big), or twists a little in place.
    The J/none line: a visible hook + rotation at the bottom = J; a straight drop = none."""
    p0 = base_tilt(pose)
    u = ease(timeline(7, 40))
    if rng.random() < 0.6:
        d = rng.uniform(0.2, 0.7)
        wob = rng.normal(0, 0.03)
        return np.array([p0 + [wob * k, d * k, 0] for k in u])
    ang = rng.uniform(-0.25, 0.25)
    return np.array([rodrigues(p0, p0[9] - p0[0], ang * k) for k in u])


def clip_partial_Z(pose):
    """Only one or two strokes of the Z."""
    if rng.random() < 0.6 and not os.environ.get('ABL_NO_NONE_CURL'):
        pose = curl_others(pose)  # same "1" hand as real Zs, so the hand shape alone isn't a Z clue
    p0 = base_tilt(pose)
    W, H = rng.uniform(0.6, 1.5), rng.uniform(0.5, 1.2)
    side = -thumb_side(p0)
    pts = np.array([[0, 0], [W, 0], [0, H]])[: rng.integers(2, 4)] * [side, 1]
    xy = polyline(pts, timeline())
    return np.array([p0 + [x, y, 0] for x, y in xy])


def shake_env(cycles_min: float, cycles_max: float, fmin: float, fmax: float):
    """Side-to-side phase (radians) and envelope per frame: still, shake for a few cycles, still."""
    f = rng.uniform(fmin, fmax)  # back-and-forths per second
    cycles = rng.uniform(cycles_min, cycles_max)
    dur = int(np.clip(round(cycles / f * 30), 4, FRAMES))
    start = rng.integers(0, FRAMES - dur + 1) if END_AT is None else max(FRAMES - dur - END_AT, 0)
    t = (np.arange(FRAMES) - start) / 30.0
    on = (t >= 0) & (t <= dur / 30)
    ramp = np.clip(np.minimum(t, dur / 30 - t) / 0.08, 0, 1) * on  # quick fade in/out
    phase = 2 * np.pi * f * np.clip(t, 0, dur / 30) * (1 + rng.normal(0, 0.05) * np.sin(t * 7))
    return phase, ramp


def open_hand(pose: np.ndarray) -> np.ndarray:
    """A B pose with the fingers spread and the thumb out (a "5" hand, which no letter uses).
    Each finger turns about its knuckle in the image plane: index toward the thumb, pinky away."""
    p = pose.copy()
    side = thumb_side(p)
    a = rng.uniform(0.0, 0.45)  # spread (radians) of the outer fingers
    for mcp, k in ((5, 1.0), (9, 0.35), (13, -0.35), (17, -1.0)):
        p[mcp + 1:mcp + 4] = rot_z(p[mcp + 1:mcp + 4] - p[mcp], side * a * k) + p[mcp]
    p[2:5] = rot_z(p[2:5] - p[1], side * rng.uniform(0.2, 0.8)) + p[1]  # thumb out from the palm
    return p


def clip_wiggle(pose):
    """Erase gesture: the OPEN hand shakes side to side 2-6 times, quickly (2.5-6 per second).
    Whole-hand shake, wrist wag, or both; a little up/down bob. The same shake with a letter
    handshape (a fist, ...) is "none" (letter_shake): user test, a shaken fist read as S after."""
    p0 = base_tilt(pose)
    phase, env = shake_env(2, 6, 2.5, 6)
    kind = rng.random()
    amp = rng.uniform(0.25, 0.9) if kind < 0.7 else rng.uniform(0.05, 0.3)  # palm units
    wag = rng.uniform(0.25, 0.7) if kind >= 0.4 else 0.0  # radians
    bob = rng.uniform(0, 0.15)
    out = []
    for ph, e in zip(phase, env):
        p = rot_z(p0, wag * e * np.sin(ph + 0.3))
        out.append(p + [amp * e * np.sin(ph), bob * e * np.sin(2 * ph), 0])
    return np.array(out)


def clip_wave(pose):
    """Not a wiggle: a slow sway, a single swing, or a tiny tremor."""
    p0 = base_tilt(pose)
    r = rng.random()
    if r < 0.4:  # slow sway (under 1.5 per second)
        phase, env = shake_env(0.5, 2.5, 0.4, 1.5)
        amp = rng.uniform(0.1, 0.8)
    elif r < 0.7:  # one swing over and back (half to one cycle)
        phase, env = shake_env(0.5, 1.2, 1.5, 4)
        amp = rng.uniform(0.2, 0.9)
    else:  # tremor: fast but tiny
        phase, env = shake_env(2, 6, 3, 7)
        amp = rng.uniform(0.01, 0.05)
    if rng.random() < 0.5:
        return np.array([p0 + [amp * e * np.sin(ph), 0, 0] for ph, e in zip(phase, env)])
    return np.array([rot_z(p0, amp * 0.8 * e * np.sin(ph)) for ph, e in zip(phase, env)])  # wrist wag


def add_exit(clip: np.ndarray, n: int) -> np.ndarray:
    """The hand leaves right after the sign: over the last n frames it speeds away (mostly down,
    out of view) and often relaxes/turns. The window then ends mid-exit, like a hand that just left."""
    if n <= 0:
        return clip
    out = clip.copy()
    ang = rng.normal(np.pi / 2, 0.6) if rng.random() < 0.7 else rng.uniform(0, 2 * np.pi)  # image y is down
    dist = rng.uniform(0.6, 3.5)
    k = (np.arange(n) + 1) / n
    disp = (k ** rng.uniform(1.3, 2.2)) * dist  # accelerating
    spin = rng.normal(0, 0.4)
    for i, d in enumerate(disp):
        j = len(out) - n + i
        w = out[j, :1]
        out[j] = rot_z(out[j] - w, spin * k[i]) + w + [np.cos(ang) * d, np.sin(ang) * d, 0]
    return out


def clip_wander(pose):
    p0 = base_tilt(pose)
    v = np.cumsum(rng.normal(0, 0.04, (FRAMES, 3)), 0) * [1, 1, 0]
    path = np.cumsum(v, 0) * 0.3
    return np.array([p0 + d for d in path])


# ---------- camera + tracking realism ----------

def to_image(clip: np.ndarray) -> np.ndarray:
    """Palm units -> image coords with random hand size/position, MediaPipe-like noise, dropouts."""
    scale = rng.uniform(0.08, 0.2)  # palm size as a share of the frame
    center = rng.uniform([0.3, 0.35], [0.7, 0.75])
    out = clip * scale
    out[:, :, :2] += center - out[:, :1, :2].mean(0)
    out = out + rng.normal(0, rng.uniform(0.0008, 0.0025), out.shape)
    # fast frames get extra jitter (blur), especially fingertips
    speed = np.linalg.norm(np.diff(out[:, 0, :2], axis=0, prepend=out[:1, 0, :2]), axis=1)
    out[:, 4::4] += rng.normal(0, 1, out[:, 4::4].shape) * (speed[:, None, None] * 0.08)
    if rng.random() < 0.5:
        out[:, :, 0] = 1 - out[:, :, 0]
    return out.astype(np.float32)


# ---------- bad camera + the app's gap fill (must match apps/web/src/motion.ts) ----------

WINDOW_MS = 1500  # window length (exported to motion.json; motion.ts reads it)
GAP_MS = 400  # motion.ts GAP_MS: a longer gap clears the history


def sample_at(times: np.ndarray, frames: np.ndarray, t: float) -> np.ndarray:
    """motion.ts sampleAt: hold the first frame before the buffer, straight line across gaps."""
    if t <= times[0]:
        return frames[0]
    i = int(np.searchsorted(times, t))
    if i >= len(times):
        return frames[-1]
    a, b = times[i - 1], times[i]
    w = (t - a) / ((b - a) or 1)
    return frames[i - 1] + (frames[i] - frames[i - 1]) * w


def gap_fill(times: np.ndarray, frames: np.ndarray, n: int = FRAMES) -> np.ndarray:
    """What motion.ts feeds the model: the last WINDOW_MS before the newest frame, resampled to n."""
    T = times[-1]
    return np.array([sample_at(times, frames, T - WINDOW_MS + i * WINDOW_MS / (n - 1)) for i in range(n)])


def bad_camera(clip: np.ndarray):
    """Film a clean FRAMES-long (WINDOW_MS) clip with a random bad webcam, then repair it like the app does.
    Returns (repaired clip, share of the motion that was lost)."""
    fps = rng.uniform(12, 30)
    src_t = np.arange(FRAMES) * WINDOW_MS / (FRAMES - 1)
    # camera frame times: uneven spacing, newest frame at the end of the clip (the app judges on a real frame)
    step = 1000 / fps
    t = [src_t[-1]]
    while t[-1] > -step:
        t.append(t[-1] - step * rng.uniform(0.8, 1.25))
    cam_t = np.array(t[::-1])
    cam = np.array([sample_at(src_t, clip, max(x, 0)) for x in cam_t])
    # speed per camera frame (palm units / frame) -> fast frames blur and drop more
    palm = np.linalg.norm(clip[0, 9, :2] - clip[0, 0, :2]) or 1
    speed = np.linalg.norm(np.diff(cam[:, 0, :2], axis=0, prepend=cam[:1, 0, :2]), axis=1) / palm
    cam[:, 4::4] += rng.normal(0, 1, cam[:, 4::4].shape) * (speed[:, None, None] * palm * rng.uniform(0.05, 0.25))
    p_drop = np.clip(rng.uniform(0, 0.1) + speed * rng.uniform(0.2, 1.0), 0, 0.8)
    keep = rng.random(len(cam)) > p_drop
    # occasional burst dropout (hand lost for a moment)
    if rng.random() < 0.3:
        i = rng.integers(0, len(cam))
        keep[i:i + rng.integers(2, 8)] = False
    keep[-1] = True  # the model only runs when a real frame arrives
    times, frames = cam_t[keep], cam[keep]
    # a gap longer than GAP_MS clears the history: keep only what came after it
    gaps = np.where(np.diff(times) > GAP_MS)[0]
    if len(gaps):
        times, frames = times[gaps[-1] + 1:], frames[gaps[-1] + 1:]
    # how much of the motion survived (moving camera frames that were dropped or cut off)
    moving = speed > 0.03
    lost_mask = ~keep | (cam_t < times[0])
    lost = (moving & lost_mask).sum() / max(moving.sum(), 1)
    return gap_fill(times, frames).astype(np.float32), lost


FINGERS = [[1, 2, 3, 4], [5, 6, 7, 8], [9, 10, 11, 12], [13, 14, 15, 16], [17, 18, 19, 20]]
SNAP_SHARE = 0.35  # share of clips with finger glitches


def finger_snap(clip: np.ndarray, keep: int | None = None) -> np.ndarray:
    """Tracker glitch: a finger briefly 'snaps' somewhere it isn't (user: fingers jump onto the
    nose when signing in front of the face). 1-2 fingers jump out/up for a few frames, then return.
    keep: finger index left alone (the drawing finger of a J/Z; a glitch there erases the sign itself)."""
    out = clip.copy()
    palm = np.linalg.norm(clip[0, 9, :2] - clip[0, 0, :2]) or 1
    for _ in range(rng.integers(1, 3)):
        choices = [k for k in range(5) if k != keep]
        f = FINGERS[choices[rng.integers(len(choices))]]
        start, n = rng.integers(0, FRAMES - 2), rng.integers(2, 11)
        jump = np.array([rng.normal(0, 0.6), -abs(rng.normal(0.6, 0.4)), 0]) * palm  # mostly up/out
        for k, j in enumerate(f):  # joints further out move more
            out[start:start + n, j] += jump * (k + 1) / len(f)
    return out


CLASS_SHARE = [0.4, 0.2, 0.2, 0.2]  # none, J, Z, wiggle
EXIT_SHARE = 0.4  # share of clips that end with the hand leaving
BAD_SHARE = 0.7  # share of clips filmed with a bad camera
LOST_LIMIT = float(os.environ.get('LOST_LIMIT', 0.5))  # a J/Z that lost more than this much of its motion is relabeled "none"


def generate(n: int, poses: dict[str, np.ndarray], bad_share: float = BAD_SHARE):
    pick = lambda L: poses[L][rng.integers(len(poses[L]))]  # noqa: E731
    any_letter = lambda: pick(LETTERS[rng.integers(len(LETTERS))])  # noqa: E731
    none_kinds = {
        "hold": lambda: clip_hold(pick("D"), curl=rng.random() < 0.6 and not os.environ.get('ABL_NO_NONE_CURL')) if rng.random() < 0.2
        else clip_hold(pick("I")) if rng.random() < 0.25 else clip_hold(any_letter()),
        "transition": lambda: clip_transition(any_letter(), any_letter()) if rng.random() < 0.6
        else clip_transition(pick(rng.choice(["I", "D"])), any_letter()),
        "partial_J": lambda: clip_partial_J(pick("I")),
        "partial_Z": lambda: clip_partial_Z(pick("D")),
        "sway": lambda: clip_wave(any_letter()),
        # The open hand without a real shake (user, v16: just opening the hand erased letters,
        # because open hands only ever appeared in wiggle clips): hold, open up, sway, one swing, move.
        "open_hold": lambda: clip_hold(open_hand(pick("B"))),
        "open_up": lambda: clip_transition(any_letter(), open_hand(pick("B"))) if rng.random() < 0.7
        else clip_transition(open_hand(pick("B")), any_letter()),
        "open_sway": lambda: clip_wave(open_hand(pick("B"))),
        "open_wander": lambda: clip_wander(open_hand(pick("B"))),
        "letter_shake": lambda: clip_wiggle(pick([L for L in LETTERS if L != "B"][rng.integers(len(LETTERS) - 1)] if rng.random() < 0.5 else rng.choice(["A", "S", "E", "O", "C", "W", "V", "I", "D"]))),
        "wander": lambda: clip_wander(any_letter()),
    }
    global END_AT
    X, y, kinds = [], [], []
    for i in range(n):
        c = int(rng.choice(4, p=CLASS_SHARE))
        # Sign, then leave at once: the motion ends just before the window does, and the hand
        # speeds away (or is gone: a 0-2 frame tail). Also on "none", so leaving isn't a clue.
        n_exit = int(rng.integers(0, 10)) if rng.random() < EXIT_SHARE else -1
        END_AT = max(n_exit + int(rng.integers(-1, 3)), 0) if n_exit >= 0 else None
        if c == 1:
            clip, kind = clip_J(pick("I")), "J"
        elif c == 2:
            clip, kind = clip_Z(pick("D")), "Z"
        elif c == 3:
            clip, kind = clip_wiggle(open_hand(pick("B")) if rng.random() < 0.8 else pick("B")), "wiggle"
        else:
            kind = list(none_kinds)[rng.integers(len(none_kinds))]
            clip = none_kinds[kind]()
        END_AT = None
        if n_exit >= 0:
            clip = add_exit(clip, n_exit)
            kind += "+exit"
        img = to_image(clip)
        if c == 0 and rng.random() < SNAP_SHARE * (bad_share > 0):  # glitches only on "none" (glitch != sign); clean test stays glitch-free
            img = finger_snap(img)  # J: pinky draws, Z: index draws
        if rng.random() < bad_share:
            img, lost = bad_camera(img)
            if c != 0 and lost > LOST_LIMIT:
                c, kind = 0, f"lost_{kind}"  # too little of the J/Z survived: not a guess, "none"
        X.append(img)
        y.append(c)
        kinds.append(kind)
    return np.array(X), np.array(y), np.array(kinds)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--n", type=int, default=6000)
    ap.add_argument("--preview", action="store_true")
    args = ap.parse_args()
    poses = load_poses()
    print("poses:", {k: len(v) for k, v in poses.items() if k in "ID"})
    if args.preview:
        X, y, kinds = generate(60, poses)
        out, seen = [], {}
        for clip, c, k in zip(X, y, kinds):
            label = CLASSES[c]
            want = 5 if label != "none" else 1  # one of each none kind (6 total)
            key = label if label != "none" else k
            if seen.get(key, 0) < want:
                seen[key] = seen.get(key, 0) + 1
                out.append({"label": label, "kind": k, "frames": np.round(clip, 4).tolist()})
        Path("preview").mkdir(exist_ok=True)
        Path("preview/motion_preview.json").write_text(json.dumps(out))
        print("preview clips:", [(o["label"], o["kind"]) for o in out])
        return
    X, y, kinds = generate(args.n, poses)
    Path("data/motion").mkdir(parents=True, exist_ok=True)
    np.savez_compressed("data/motion/synth.npz", points=X, labels=y, kinds=kinds)
    print("saved", X.shape, np.bincount(y))
    # test set: unseen signers' hands, different random seed
    global rng
    rng = np.random.default_rng(1)
    test_poses = load_poses(holdout=True)
    Xt, yt, kt = generate(args.n // 4, test_poses, bad_share=0)
    np.savez_compressed("data/motion/synth_test.npz", points=Xt, labels=yt, kinds=kt)
    Xb, yb, kb = generate(args.n // 4, test_poses, bad_share=1)
    np.savez_compressed("data/motion/synth_test_bad.npz", points=Xb, labels=yb, kinds=kb)
    print("saved tests (holdout signers): clean", Xt.shape, "bad camera", Xb.shape, np.bincount(yb))


if __name__ == "__main__":
    main()
