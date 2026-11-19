"""Adapted from Snap-Ninja (MIT), see LICENSE. Bounded-memory quiet-boundary audio chunks."""
import wave
import numpy as np
from pathlib import Path
CHUNK_SECONDS = 600

def _audio_chunks(wav_path: str | Path, chunk_s: float = CHUNK_SECONDS, search_s: float = 8.0):
    """Yield (offset_seconds, float32 mono 16 kHz array) pieces of ~chunk_s, cut at the quietest
    point near each boundary so words are not split. Avoids loading hours of audio at once and
    avoids faster-whisper's PyAV decoder (incompatible with recent PyAV releases)."""
    with wave.open(str(wav_path), "rb") as wf:
        sr = wf.getframerate()
        if sr != 16000 or wf.getnchannels() != 1 or wf.getsampwidth() != 2:
            raise ValueError("Expected 16 kHz mono 16-bit wav")
        total = wf.getnframes()
        pos = 0
        carry = np.zeros(0, dtype=np.int16)
        while pos < total or len(carry):
            want = int(chunk_s * sr) + int(search_s * sr) - len(carry)
            raw = wf.readframes(max(0, want)) if pos < total else b""
            data = np.concatenate([carry, np.frombuffer(raw, dtype=np.int16)])
            read_to = pos + len(data) - len(carry)
            if read_to >= total or len(data) <= int(chunk_s * sr):
                cut = len(data)
            else:
                lo, hi = int((chunk_s - search_s) * sr), len(data)
                win = int(0.1 * sr)
                region = data[lo:hi].astype(np.float32)
                n = len(region) // win
                energy = (region[: n * win].reshape(n, win) ** 2).mean(axis=1)
                cut = lo + int(np.argmin(energy)) * win + win // 2
            offset = (read_to - len(data)) / sr
            yield offset, data[:cut].astype(np.float32) / 32768.0
            carry = data[cut:]
            pos = read_to
            if pos >= total and not len(carry):
                break

