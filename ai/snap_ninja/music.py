"""Background music: user tracks from music/ or a generated royalty-free lo-fi loop."""
from __future__ import annotations

import random
import wave
from pathlib import Path

import numpy as np

MUSIC_EXTS = {".mp3", ".wav", ".m4a", ".aac", ".ogg", ".flac", ".opus"}
GENERATED_NAME = "_generated_lofi.wav"


def list_tracks(music_dir: Path) -> list[Path]:
    if not music_dir.is_dir():
        return []
    return sorted(p for p in music_dir.iterdir() if p.suffix.lower() in MUSIC_EXTS and p.name != GENERATED_NAME)


def pick_track(music_dir: Path, explicit: str = "", seed: int | None = None) -> Path:
    if explicit and Path(explicit).is_file():
        return Path(explicit)
    tracks = list_tracks(music_dir)
    if tracks:
        return random.Random(seed).choice(tracks)
    return generate_lofi(music_dir / GENERATED_NAME)


def _note(n: int) -> float:  # MIDI note -> Hz
    return 440.0 * 2 ** ((n - 69) / 12)


def generate_lofi(path: Path, seconds: float = 96.0, sr: int = 44100, bpm: float = 82.0, seed: int = 7) -> Path:
    """Soft chord pads + bass + dusty drums. Deterministic, ~16 MB wav, generated once."""
    if path.exists():
        return path
    path.parent.mkdir(parents=True, exist_ok=True)
    rng = np.random.default_rng(seed)
    n = int(seconds * sr)
    t = np.arange(n) / sr
    beat = 60.0 / bpm
    bar = beat * 4
    out = np.zeros((n, 2), dtype=np.float64)

    # Am9 - Fmaj7 - Cmaj7 - G6, one chord per bar
    prog = [[57, 60, 64, 67, 71], [53, 57, 60, 64, 69], [48, 55, 59, 64, 67], [55, 59, 62, 64, 71]]
    bass = [45, 41, 48, 43]
    env_len = int(bar * sr)
    attack = np.minimum(1.0, np.arange(env_len) / (0.35 * sr))
    release = np.minimum(1.0, (env_len - np.arange(env_len)) / (0.5 * sr))
    pad_env = attack * release
    for b in range(int(seconds / bar) + 1):
        s = int(b * bar * sr)
        e = min(n, s + env_len)
        if s >= n:
            break
        tt = t[s:e] - t[s]
        chord = prog[b % 4]
        for i, note in enumerate(chord):
            f = _note(note)
            for det, pan in ((-0.12, 0.3), (0.12, 0.7)):
                wave_ = np.sin(2 * np.pi * (f + det) * tt) + 0.25 * np.sin(2 * np.pi * 2 * (f + det) * tt)
                amp = 0.045 * pad_env[: e - s] * (1 + 0.15 * np.sin(2 * np.pi * 0.3 * tt + i))
                out[s:e, 0] += wave_ * amp * (1 - pan)
                out[s:e, 1] += wave_ * amp * pan
        # bass: root on beats 1 and 3
        for k in (0, 2):
            bs = s + int(k * beat * sr)
            be = min(n, bs + int(beat * 1.6 * sr))
            if bs >= n:
                continue
            bt = t[bs:be] - t[bs]
            benv = np.exp(-bt * 2.2) * np.minimum(1, bt / 0.01)
            sig = np.sin(2 * np.pi * _note(bass[b % 4] - 12) * bt) * benv * 0.22
            out[bs:be] += sig[:, None]

    # drums
    step = beat / 2
    for i in range(int(seconds / step)):
        s = int(i * step * sr)
        swing = int((0.03 * sr) if i % 2 else 0)
        s += swing
        if s >= n:
            break
        pos = i % 8
        if pos in (0, 5):  # kick
            L = int(0.35 * sr)
            kt = np.arange(min(L, n - s)) / sr
            freq = 50 + 90 * np.exp(-kt * 30)
            kick = np.sin(2 * np.pi * np.cumsum(freq) / sr) * np.exp(-kt * 9) * 0.5
            out[s:s + len(kick)] += kick[:, None]
        if pos in (2, 6):  # snare (soft, noisy)
            L = int(0.22 * sr)
            m = min(L, n - s)
            st = np.arange(m) / sr
            noise = rng.standard_normal(m)
            noise = np.convolve(noise, np.ones(6) / 6, mode="same")
            sn = (noise * 0.18 + np.sin(2 * np.pi * 190 * st) * 0.1) * np.exp(-st * 18)
            out[s:s + m] += sn[:, None]
        # hat every step
        L = int(0.05 * sr)
        m = min(L, n - s)
        hn = rng.standard_normal(m)
        hn = hn - np.convolve(hn, np.ones(3) / 3, mode="same")  # crude high-pass
        out[s:s + m, 0] += hn * np.exp(-np.arange(m) / sr * 60) * (0.05 if pos % 2 else 0.07) * 0.8
        out[s:s + m, 1] += hn * np.exp(-np.arange(m) / sr * 60) * (0.05 if pos % 2 else 0.07)

    # vinyl crackle + gentle low-pass (one-pole) for warmth
    crackle = (rng.random(n) > 0.9993) * rng.standard_normal(n) * 0.08
    out += crackle[:, None]
    kernel = np.hanning(9)
    kernel /= kernel.sum()
    for ch in range(2):
        out[:, ch] = np.convolve(out[:, ch], kernel, mode="same")
    # loop-friendly fades
    fade = int(0.05 * sr)
    out[:fade] *= np.linspace(0, 1, fade)[:, None]
    out[-fade:] *= np.linspace(1, 0, fade)[:, None]
    out /= max(1e-6, np.max(np.abs(out))) / 0.85
    pcm = (out * 32767).astype(np.int16)
    with wave.open(str(path), "wb") as wf:
        wf.setnchannels(2)
        wf.setsampwidth(2)
        wf.setframerate(sr)
        wf.writeframes(pcm.tobytes())
    return path
