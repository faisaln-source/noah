"""Spot the moments a live chat explodes: a sudden jump in messages per 5 seconds compared with how busy the
chat normally is. Works on wall-clock time; the caller maps it onto the recording."""
from __future__ import annotations

import re
import statistics
import threading
from collections import Counter, defaultdict

WINDOW = 5            # seconds per rate sample (messages in the last 5 s)
BASELINE = 180        # how far back "normal" is measured
MIN_RATE = 8          # a tiny chat needs at least this many messages in 5 s to count as a spike
COOLDOWN = 25         # quiet seconds after a spike before the next one can start
MAX_SPIKE = 30        # a spike longer than this is closed anyway (a long hype is one clip)


class ChatMeter:
    """Count chat messages per second and report spikes. add() is called from the chat thread, check() from
    the job loop."""

    def __init__(self):
        self.lock = threading.Lock()
        self.per_sec: dict[int, int] = defaultdict(int)
        self.words: dict[int, Counter] = defaultdict(Counter)
        self.total = 0
        self.first: int | None = None  # first second with a message: "normal" is only measured after it
        self.active: dict | None = None
        self.cool_until = 0
        self.normal = 0.0

    def add(self, ts: float, text: str) -> None:
        sec = int(ts)
        tokens = {t for t in re.findall(r"[\w']{2,}|[!?]{2,}", text.lower()) if len(t) <= 20}
        with self.lock:
            self.per_sec[sec] += 1
            self.words[sec].update(tokens)
            self.total += 1
            if self.first is None or sec < self.first:
                self.first = sec

    def rate(self, end: int) -> int:
        """Messages in the WINDOW seconds ending at `end` (exclusive)."""
        return sum(self.per_sec.get(s, 0) for s in range(end - WINDOW, end))

    def check(self, now: float) -> dict | None:
        """Look at chat up to a few seconds ago (late messages still arriving). Returns a finished spike:
        {start, peak, end, peak_rate, normal, top} in wall-clock seconds, or None."""
        t = int(now) - 2
        with self.lock:
            if self.first is None:
                return None
            # needs a minute of chat to know what normal is
            past = [self.rate(s) for s in range(max(t - BASELINE, self.first + WINDOW), t - 10, WINDOW)]
            if len(past) < 12 or not any(past):
                return None
            normal = statistics.median(past)
            spread = statistics.median(abs(x - normal) for x in past) or 1.0
            self.normal = normal
            trigger = max(MIN_RATE, normal * 2.5, normal + 5 * spread)
            r = self.rate(t)
            if self.active is None:
                if r >= trigger and t >= self.cool_until:
                    # the change began where chat first rose above normal, a few seconds before the trigger
                    start = t - WINDOW
                    while start > t - 20 and self.rate(start) > normal + 2 * spread:
                        start -= 1
                    self.active = {"start": start, "peak": t, "peak_rate": r, "normal": normal, "trigger": trigger}
                return None
            a = self.active
            if r > a["peak_rate"]:
                a["peak"], a["peak_rate"] = t, r
            if r < a["trigger"] * 0.5 or t - a["start"] >= MAX_SPIKE:
                self.active = None
                self.cool_until = t + COOLDOWN
                top = Counter()
                for s in range(a["start"], t):
                    top.update(self.words.get(s, {}))
                skip = {"the", "a", "i", "is", "to", "it", "and", "you", "of", "this", "that", "he", "in", "on"}
                words = [w for w, n in top.most_common(12) if w not in skip and n >= 3][:4]
                return {"start": a["start"], "peak": a["peak"], "end": t, "peak_rate": a["peak_rate"],
                        "normal": round(a["normal"], 1), "top": words}
        return None

    def series(self, since: float, until: float, step: int = WINDOW) -> list[tuple[int, int]]:
        """(wall second, messages in the 5 s before it) every `step` seconds, for the graph."""
        with self.lock:
            return [(s, self.rate(s)) for s in range(int(since) + step, int(until) + 1, step)]
