"""9:16 framing for shorts: find the people, work out who is talking, and keep them centred.

Per clip, ~4 frames a second are analysed:
  * faces: YuNet (OpenCV's DNN face detector; catches small, turned and side-on faces), Haar as a fallback
  * tracks: each person is followed across frames; things that never move (a face icon in a score overlay) are
    dropped
  * speaker: while someone is speaking, the face whose mouth moves most is the active speaker (with hysteresis, so
    the camera doesn't flick between people on tiny differences)
  * composition: if the speaker and the people next to them fit in the 9:16 frame, frame the group; otherwise centre
    the speaker, keeping their whole face inside the frame
  * no faces at all: look for whole people (HOG body detector); if there are none either, zoom into the centre
"""
from __future__ import annotations

import subprocess
from dataclasses import dataclass, field
from pathlib import Path

import numpy as np

OUT_W, OUT_H = 1080, 1920
YUNET = Path(__file__).resolve().parent / "models" / "face_detection_yunet_2023mar.onnx"
STEP = 0.25           # seconds between analysed frames
DET_W = 800           # detection width (small faces need pixels)


@dataclass
class Framing:
    mode: str               # face | speaker | group | body | zoom | blur | center | vertical
    video_filter: str       # filter chain from [0:v] -> [vf]
    face_ratio: float = 0.0
    segments: int = 0
    notes: list = field(default_factory=list)


@dataclass
class Det:
    track: int
    cx: float   # normalised 0..1 of frame width
    cy: float
    w: float    # normalised width
    h: float
    mouth: float = 0.0
    body: bool = False


# --------------------------------------------------------------------------- detection

def _frames(src: str, start: float, span: float, w: int, h: int):
    """Yield BGR frames (h, w, 3) every STEP seconds from one sequential decode."""
    FFMPEG = globals().get("FFMPEG", "ffmpeg")

    proc = subprocess.Popen(
        [FFMPEG, "-hide_banner", "-loglevel", "error", "-ss", f"{start:.3f}", "-t", f"{span:.3f}", "-i", src,
         "-an", "-vf", f"fps=1/{STEP:.4f},scale={w}:{h}", "-pix_fmt", "bgr24", "-f", "rawvideo", "-"],
        stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
    size = w * h * 3
    try:
        while True:
            buf = proc.stdout.read(size)
            if len(buf) < size:
                break
            yield np.frombuffer(buf, dtype=np.uint8).reshape(h, w, 3)
    finally:
        proc.stdout.close()
        proc.wait()


def _detect(src: str, start: float, end: float, width: int, height: int):
    """(times, [[Det...] per frame]) with tracks, mouth activity and overlay faces removed."""
    import cv2

    dw = DET_W if width >= DET_W else width
    dh = int(round(dw * height / max(width, 1))) // 2 * 2
    yunet = None
    if YUNET.exists():
        try:
            yunet = cv2.FaceDetectorYN.create(str(YUNET), "", (dw, dh), 0.6, 0.3, 5000)
        except cv2.error:
            yunet = None
    haar = None if yunet is not None else cv2.CascadeClassifier(
        cv2.data.haarcascades + "haarcascade_frontalface_default.xml")
    hog = cv2.HOGDescriptor()
    hog.setSVMDetector(cv2.HOGDescriptor_getDefaultPeopleDetector())

    tracks: dict[int, dict] = {}   # id -> {"cx", "cy", "w", "last", "patch"}
    next_id = 0
    frames: list[list[Det]] = []
    cuts: list[bool] = []          # a scene cut happened just before this frame
    diffs: list[float] = []
    motion: list[tuple[float, float]] = []  # (centre x of movement, amount) per frame
    prev_thumb = None
    last_cut = -10
    for fi, img in enumerate(_frames(src, start, end - start, dw, dh)):
        gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
        thumb = cv2.resize(gray, (64, 36)).astype(np.float32)
        diff = float(np.mean(np.abs(thumb - prev_thumb))) if prev_thumb is not None else 0.0
        # a cut is a big jump that clearly stands out from the recent frame-to-frame change (pans and moving
        # cameras change a lot too, but steadily), at least 0.75 s after the previous cut
        recent = float(np.median(diffs[-6:])) if diffs else 0.0
        cut = diff > 45.0 and diff > 1.8 * recent and fi - last_cut >= 3
        if cut:
            last_cut = fi
        # where things move (ignoring the top 10% and bottom 20%, where overlays and tickers live)
        if prev_thumb is not None and not cut:
            m = np.abs(thumb - prev_thumb)[4:29, :]
            col = m.sum(axis=0)
            amount = float(m.mean())
            motion.append((float((col * np.arange(64)).sum() / max(col.sum(), 1e-6)) / 63.0, amount))
        else:
            motion.append((0.5, 0.0))
        diffs.append(diff)
        prev_thumb = thumb
        cuts.append(cut)
        if cut:  # new shot: people may be anywhere, don't carry tracks across the cut
            for tr in tracks.values():
                tr["last"] = -100
        boxes = []  # (x, y, w, h, mouth_box | None)
        if yunet is not None:
            _, faces = yunet.detect(img)
            for f in faces if faces is not None else []:
                x, y, w, h = f[:4]
                rcx, rcy, lcx, lcy = f[10:14]
                mx0, mx1 = min(rcx, lcx) - 0.1 * w, max(rcx, lcx) + 0.1 * w
                my = (rcy + lcy) / 2
                boxes.append((x, y, w, h, (mx0, my - 0.18 * h, mx1, my + 0.18 * h)))
        else:
            for x, y, w, h in haar.detectMultiScale(cv2.equalizeHist(gray), 1.1, 6, minSize=(20, 20)):
                boxes.append((x, y, w, h, (x + 0.25 * w, y + 0.62 * h, x + 0.75 * w, y + 0.95 * h)))
        dets: list[Det] = []
        for x, y, w, h, mb in boxes:
            cx, cy = (x + w / 2) / dw, (y + h / 2) / dh
            # match to an existing track: nearest centre, similar size, seen recently
            best, bd = None, 0.09
            for tid, tr in tracks.items():
                if fi - tr["last"] > 8:
                    continue
                d = abs(tr["cx"] - cx) + 0.5 * abs(tr["cy"] - cy)
                if d < bd and 0.6 < (w / dw) / max(tr["w"], 1e-6) < 1.6:
                    best, bd = tid, d
            if best is None:
                best = next_id
                next_id += 1
                tracks[best] = {"cx": cx, "cy": cy, "w": w / dw, "last": fi, "patch": None, "pos": []}
            tr = tracks[best]
            # lip movement: how much the mouth area changed since this person's previous frame
            mouth = 0.0
            x0, y0, x1, y1 = (int(max(0, v)) for v in mb)
            x1, y1 = min(dw, max(x1, x0 + 2)), min(dh, max(y1, y0 + 2))
            patch = cv2.resize(gray[y0:y1, x0:x1], (32, 16)).astype(np.float32) if x1 > x0 and y1 > y0 else None
            if patch is not None and tr["patch"] is not None and fi - tr["last"] <= 2:
                mouth = float(np.mean(np.abs(patch - tr["patch"])))
            tr.update(cx=cx, cy=cy, w=w / dw, last=fi, patch=patch)
            tr["pos"].append((cx, cy))
            dets.append(Det(best, cx, cy, w / dw, h / dh, mouth))
        if not any(d.w >= 0.04 for d in dets):
            # no real-sized face (only tiny ones, e.g. overlay icons, or a turned head): look for whole people
            rects, weights = hog.detectMultiScale(gray, winStride=(8, 8), padding=(8, 8), scale=1.06)
            for (x, y, w, h), sc in zip(rects, np.ravel(weights) if len(rects) else []):
                if sc > 0.5 and h > 0.18 * dh:
                    dets.append(Det(-1, (x + w / 2) / dw, (y + h * 0.2) / dh, w / dw, h / dh, 0.0, body=True))
        frames.append(dets)

    # overlays: a "face" that sits still in the same spot all clip long (score overlay avatars, logos)
    n = max(1, len(frames))
    overlay = set()
    for tid, tr in tracks.items():
        pos = np.array(tr["pos"])
        if len(pos) >= 0.5 * n and pos.std(axis=0).max() < 0.004 and tr["w"] < 0.08:
            overlay.add(tid)
    frames = [[d for d in f if d.track not in overlay] for f in frames]
    times = np.arange(len(frames)) * STEP
    return times, frames, len(overlay), np.array(cuts, dtype=bool), motion


# --------------------------------------------------------------------------- who to frame

def _speaking(times: np.ndarray, speech: list[tuple[float, float]] | None) -> np.ndarray:
    mask = np.zeros(len(times), dtype=bool)
    for a, b in speech or []:
        mask |= (times >= a - 0.15) & (times <= b + 0.15)
    return mask


def _targets(times, frames, speech, crop_frac: float, cuts: np.ndarray | None = None,
             motion: list[tuple[float, float]] | None = None) -> tuple[np.ndarray, str]:
    """Normalised x centre per frame (NaN = nobody), and the dominant framing kind."""
    n = len(frames)
    talking = _speaking(times, speech)
    # smoothed mouth activity per track (1 s window), only counted while someone is speaking
    act: dict[int, np.ndarray] = {}
    for i, f in enumerate(frames):
        for d in f:
            if d.track >= 0:
                act.setdefault(d.track, np.zeros(n))[i] = d.mouth if talking[i] else 0.0
    smooth = {t: np.convolve(a, np.ones(4) / 4, mode="same") for t, a in act.items()}

    out = np.full(n, np.nan)
    kinds: list[str] = []
    speaker = None
    missing = 0
    for i, f in enumerate(frames):
        if cuts is not None and cuts[i]:
            speaker = None  # new shot: choose again
        faces = [d for d in f if not d.body]
        bodies = [d for d in f if d.body]
        if bodies and not any(d.w >= 0.04 for d in faces):  # only tiny faces: follow the person's body
            main = max(bodies, key=lambda d: d.h)
            out[i] = main.cx
            kinds.append("body")
            missing = 0
            continue
        if not any(d.w >= 0.04 for d in faces):
            # no face or body to follow: follow the movement (someone skating, running, bending over)
            if motion and i < len(motion) and motion[i][1] > 6.0:
                lo_i = max(0, i - 2)
                mv = [m for m in motion[lo_i:i + 3] if m[1] > 6.0]
                out[i] = float(np.median([m[0] for m in mv]))
                kinds.append("motion")
                missing = 0
                continue
            missing += 1
            if missing >= 3:  # nothing to follow for ~0.75 s (a static wide shot): frame the middle
                out[i] = 0.5
            if not faces:
                continue
        missing = 0
        # only main people can be the speaker: tiny background faces (a crowd) have noisy "mouth movement"
        biggest = max(d.w for d in faces)
        faces = [d for d in faces if d.w >= max(0.02, 0.4 * biggest)]
        if not faces:  # only a far-away crowd: frame the middle
            out[i] = 0.5
            kinds.append("wide")
            continue
        visible = {d.track: d for d in faces}
        # active speaker: clearly the most mouth movement right now, else keep whoever it was
        ranked = sorted(visible, key=lambda t: -smooth.get(t, np.zeros(n))[i])
        top = ranked[0]
        top_act = smooth.get(top, np.zeros(n))[i]
        second = smooth.get(ranked[1], np.zeros(n))[i] if len(ranked) > 1 else 0.0
        if speaker not in visible:
            speaker = top if top_act > 0 else max(visible, key=lambda t: visible[t].w)
        elif top != speaker and talking[i] and top_act > 1.25 * second + 0.5:
            speaker = top
        s = visible[speaker]
        # frame the group if the speaker's neighbours fit; otherwise the speaker alone
        group = [d for d in faces if d.w > 0.35 * s.w]  # ignore tiny faces far in the background
        lo = min(d.cx - d.w * 0.7 for d in group)
        hi = max(d.cx + d.w * 0.7 for d in group)
        if len(group) > 1 and hi - lo <= crop_frac * 0.95:
            out[i] = (lo + hi) / 2
            kinds.append("group")
        else:
            out[i] = s.cx
            kinds.append("speaker" if len(faces) > 1 else "face")
        # keep the speaker's whole face inside the crop
        half = crop_frac / 2
        out[i] = min(max(out[i], s.cx + s.w * 0.6 - half), s.cx - s.w * 0.6 + half)
    kind = max(set(kinds), key=kinds.count) if kinds else "none"
    return out, kind


def _segment_positions(times: np.ndarray, centers: np.ndarray, cuts: np.ndarray | None = None,
                       threshold: float = 0.10, min_hold: float = 1.2) -> list[tuple[float, float]]:
    """Piecewise-constant camera positions: list of (start_time, center_x).
    Inside a shot a move needs to last ~0.75 s (no jitter); at a scene cut the camera re-frames immediately."""
    n = len(centers)
    if n == 0:
        return [(0.0, 0.5)]
    cuts = cuts if cuts is not None and len(cuts) == n else np.zeros(n, dtype=bool)
    starts = [0] + [i for i in range(1, n) if cuts[i]] + [n]
    segs: list[tuple[float, float]] = []
    for s0, s1 in zip(starts, starts[1:]):
        shot = centers[s0:s1]
        valid = ~np.isnan(shot)
        if not valid.any():  # nobody seen in this shot: keep the last framing (or the middle)
            if not segs:
                segs.append((0.0, 0.5))
            continue
        idx = np.where(valid, np.arange(len(shot)), 0)
        np.maximum.accumulate(idx, out=idx)
        filled = shot[idx]
        first = int(np.argmax(valid))
        filled[:first] = shot[first]
        k = 2
        sm = np.array([np.median(filled[max(0, i - k): i + k + 1]) for i in range(len(filled))])
        t_shot = float(times[s0] - (STEP / 2 if s0 else 0.0))  # the cut happened between two samples
        first_pos = float(np.median(sm[: max(1, int(0.75 / STEP))]))
        if not segs or abs(first_pos - segs[-1][1]) > 0.02:
            segs.append((max(0.0, t_shot), first_pos))
        pending = None
        st = times[s0:s1]
        for t, c in zip(st, sm):
            cur = segs[-1][1]
            if abs(c - cur) > threshold:
                if pending is None:
                    pending = t
                elif t - pending >= 0.75 and t - segs[-1][0] >= min_hold:
                    segs.append((float(pending), float(np.median(sm[(st >= pending) & (st <= t)]))))
                    pending = None
            else:
                pending = None
    return segs or [(0.0, 0.5)]


# --------------------------------------------------------------------------- plan

def plan(src: str, start: float, end: float, width: int, height: int, mode: str = "auto",
         speech: list[tuple[float, float]] | None = None) -> Framing:
    """speech: (start, end) of spoken words, relative to the clip start (used to find the active speaker)."""
    aspect = width / max(height, 1)
    blur = (
        f"[0:v]split=2[bgs][fgs];"
        # blur a quarter-size copy and scale it back up: same look, ~16x less work than blurring 1080x1920
        f"[bgs]scale={OUT_W // 4}:{OUT_H // 4}:force_original_aspect_ratio=increase,crop={OUT_W // 4}:{OUT_H // 4},"
        f"boxblur=luma_radius=10:luma_power=2,eq=brightness=-0.08,scale={OUT_W}:{OUT_H}:flags=bilinear[bg];"
        f"[fgs]scale={OUT_W}:{OUT_H}:force_original_aspect_ratio=decrease[fg];"
        f"[bg][fg]overlay=(W-w)/2:(H-h)/2,setsar=1[vf]"
    )
    # zoom: center 3:4 crop shown big (1080x1440) over a blurred fill. Keeps an FPS crosshair and the
    # action large, which suits gameplay without a facecam far better than a thin letterboxed strip.
    zw = int(round(min(width, height * 3 / 4))) // 2 * 2
    zoom = (
        f"[0:v]split=2[bgs][fgs];"
        f"[bgs]scale={OUT_W // 4}:{OUT_H // 4}:force_original_aspect_ratio=increase,crop={OUT_W // 4}:{OUT_H // 4},"
        f"boxblur=luma_radius=10:luma_power=2,eq=brightness=-0.12,scale={OUT_W}:{OUT_H}:flags=bilinear[bg];"
        f"[fgs]crop={zw}:{height}:(iw-{zw})/2:0,scale={OUT_W}:-2:flags=lanczos[fg];"
        f"[bg][fg]overlay=(W-w)/2:(H-h)/2-60,setsar=1[vf]"
    )
    if aspect <= OUT_W / OUT_H + 0.02:
        return Framing("vertical", blur)
    crop_w = int(round(height * OUT_W / OUT_H)) // 2 * 2
    if mode == "blur":
        return Framing("blur", blur)
    if mode == "zoom":
        return Framing("zoom", zoom)
    if mode == "center":
        return Framing("center", f"[0:v]crop={crop_w}:{height}:(iw-{crop_w})/2:0,scale={OUT_W}:{OUT_H},setsar=1[vf]")

    times, frames, overlays, cuts, motion = _detect(src, start, end, width, height)
    centers, kind = _targets(times, frames, speech, crop_w / width, cuts, motion)
    ratio = float(np.mean(~np.isnan(centers))) if len(centers) else 0.0
    notes = [f"{overlays} overlay face(s) ignored"] if overlays else []
    if ratio < 0.35:
        if mode == "face":  # forced face mode but nobody found -> center crop
            return Framing("center", f"[0:v]crop={crop_w}:{height}:(iw-{crop_w})/2:0,scale={OUT_W}:{OUT_H},"
                                     f"setsar=1[vf]", ratio, notes=notes)
        return Framing("zoom", zoom, ratio, notes=notes)

    segs = _segment_positions(times, centers, cuts)
    max_x = width - crop_w

    def x_of(c: float) -> int:
        return int(min(max(c * width - crop_w / 2, 0), max_x))

    expr = str(x_of(segs[-1][1]))
    for k in range(len(segs) - 2, -1, -1):
        expr = f"if(lt(t,{segs[k + 1][0]:.2f}),{x_of(segs[k][1])},{expr})"
    vf = f"[0:v]crop={crop_w}:{height}:'{expr}':0,scale={OUT_W}:{OUT_H}:flags=lanczos,setsar=1[vf]"
    return Framing(kind if kind != "none" else "face", vf, ratio, len(segs), notes)
