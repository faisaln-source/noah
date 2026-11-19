"""Read a live stream's chat as it happens (Twitch and YouTube), so chat reactions can be measured.

Each reader calls on_message(wall_time, user, text) for every chat message until stop is set or the chat
ends. No account is needed: Twitch is read anonymously over IRC, YouTube through yt-dlp's live chat reader.
Kick isn't supported: its chat is only open to registered developer apps."""
from __future__ import annotations

import json
import re
import socket
import threading
import time
from pathlib import Path
from typing import Callable
from urllib.parse import urlparse

MessageFn = Callable[[float, str, str], None]
LogFn = Callable[[str], None]


class ChatError(Exception):
    pass


class NoChat(ChatError):
    """The stream has no chat (switched off by the streamer): don't keep retrying."""


def chat_site(url: str, meta: dict | None = None) -> str:
    """'twitch', 'youtube', or '' when Clipper can't read this site's chat."""
    host = (urlparse(url).hostname or "").lower()
    site = ((meta or {}).get("site") or "").lower()
    if host in {"twitch.tv", "www.twitch.tv"}:
        return "twitch"
    if host in {"youtube.com", "www.youtube.com", "m.youtube.com", "youtu.be"}:
        return "youtube"
    return ""


def start_chat(url: str, meta: dict, on_message: MessageFn, log: LogFn, stop: threading.Event,
               work: Path) -> threading.Thread | None:
    """Start reading the stream's chat in a background thread. None if the site isn't supported."""
    site = chat_site(url, meta)
    target = {"twitch": _twitch, "youtube": _youtube}.get(site)
    if not target:
        return None
    # the site stamps messages with its own clock; this computer's clock can be off by minutes. Shift every
    # stamp onto this computer's clock, by the smallest gap seen between a stamp and the message arriving
    # (the recording uses this computer's clock too). Keeps the spacing of messages that arrive in batches.
    gaps: list[float] = []
    site_message = on_message

    def on_message(ts: float, user: str, text: str) -> None:  # noqa: F811 - wraps the caller's handler
        gaps.append(time.time() - ts)
        del gaps[:-300]
        site_message(ts + min(gaps), user, text)

    def run():
        tries = 0
        while not stop.is_set():
            started = time.time()
            try:
                target(url, meta, on_message, log, stop, work)
            except NoChat as exc:
                log(str(exc))
                break
            except Exception as exc:  # a dropped connection: try again, unless it keeps failing at once
                log(f"Chat connection dropped ({str(exc)[:120]}); reconnecting")
            if stop.is_set():
                break
            tries = tries + 1 if time.time() - started < 60 else 1
            if tries >= 6:
                log("Couldn't keep the chat connected, so chat reactions stopped. The recording goes on.")
                break
            stop.wait(min(30, 3 * tries))

    t = threading.Thread(target=run, daemon=True, name=f"chat-{site}")
    t.start()
    return t


# ------------------------------------------------------------------ Twitch: anonymous IRC
def _twitch_channel(url: str, meta: dict) -> str:
    path = [p for p in urlparse(url).path.split("/") if p]
    name = path[0] if path else (meta.get("channel") or meta.get("id") or "")
    if not re.fullmatch(r"\w{2,30}", name or ""):
        raise ChatError("Couldn't tell which Twitch channel this is.")
    return name.lower()


def _twitch(url, meta, on_message, log, stop, work):
    channel = _twitch_channel(url, meta)
    sock = socket.create_connection(("irc.chat.twitch.tv", 6667), timeout=30)
    sock.settimeout(2)
    send = lambda line: sock.sendall((line + "\r\n").encode("utf-8"))  # noqa: E731
    send("CAP REQ :twitch.tv/tags")
    send("PASS SCHMOOPIIE")
    send(f"NICK justinfan{int(time.time()) % 90000 + 10000}")  # Twitch's anonymous read-only login
    send(f"JOIN #{channel}")
    log(f"Reading Twitch chat for #{channel}")
    buf, last = b"", time.time()
    try:
        while not stop.is_set():
            try:
                data = sock.recv(65536)
            except socket.timeout:
                if time.time() - last > 360:
                    raise ChatError("no data from Twitch chat for 6 minutes")
                continue
            if not data:
                raise ChatError("Twitch closed the chat connection")
            last = time.time()
            buf += data
            *lines, buf = buf.split(b"\r\n")
            for raw in lines:
                line = raw.decode("utf-8", "replace")
                if line.startswith("PING"):
                    send("PONG" + line[4:])
                    continue
                m = re.match(r"(?:@(\S+) )?:(\w+)!\S+ PRIVMSG #\w+ :(.*)", line)
                if not m:
                    continue
                tags = dict(kv.split("=", 1) for kv in (m.group(1) or "").split(";") if "=" in kv)
                ts = int(tags.get("tmi-sent-ts") or 0) / 1000 or time.time()
                on_message(ts, tags.get("display-name") or m.group(2), m.group(3))
    finally:
        sock.close()


# ------------------------------------------------------------------ YouTube: yt-dlp's live chat reader
def _youtube(url, meta, on_message, log, stop, work):
    import subprocess
    import os

    vid = meta.get("id") or ""
    watch = f"https://www.youtube.com/watch?v={vid}" if vid else url
    # a fresh folder per connection: an earlier reader may still hold its file open
    out = work / "youtube_chat" / str(int(time.time() * 1000))
    out.mkdir(parents=True, exist_ok=True)

    done = threading.Event()
    def fetch():
        process = subprocess.Popen([os.environ.get("CLIPFORGE_YTDLP", "yt-dlp"), "--skip-download", "--write-subs", "--sub-langs", "live_chat", "--no-warnings", "--js-runtimes", "node", "-o", str(out / "chat.%(ext)s"), watch], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
        try:
            while process.poll() is None and not stop.wait(1):
                pass
        finally:
            if process.poll() is None:
                process.terminate()
            process.wait()
            done.set()
    threading.Thread(target=fetch, daemon=True, name="youtube-chat-fetch").start()
    log("Reading YouTube live chat")
    pos, seen = 0, set()
    while not stop.is_set():
        files = sorted(out.glob("*.live_chat.json*"))
        if files:
            try:
                with open(files[0], "rb") as f:
                    f.seek(pos)
                    chunk = f.read()
            except OSError:
                chunk = b""
            end = chunk.rfind(b"\n")
            if end >= 0:
                pos += end + 1
                for raw in chunk[: end + 1].splitlines():
                    for ts, user, text, mid in _youtube_messages(raw):
                        if mid not in seen:
                            seen.add(mid)
                            on_message(ts, user, text)
        if done.is_set() and not stop.is_set():
            if not files:  # yt-dlp found no live chat at all
                raise NoChat("This YouTube stream has its chat switched off, so there are no chat reactions "
                             "to clip. Recording and cutting by hand still work.")
            raise ChatError("YouTube chat ended")
        stop.wait(1.0)


def _youtube_messages(raw: bytes):
    try:
        item = json.loads(raw)
    except ValueError:
        return
    actions = (item.get("replayChatItemAction") or {}).get("actions") or [item]
    for a in actions:
        r = ((a.get("addChatItemAction") or {}).get("item") or {})
        r = r.get("liveChatTextMessageRenderer") or r.get("liveChatPaidMessageRenderer")
        if not r:
            continue
        text = "".join(run.get("text") or (run.get("emoji") or {}).get("shortcuts", [""])[0]
                       for run in (r.get("message") or {}).get("runs") or [])
        ts = int(r.get("timestampUsec") or 0) / 1e6 or time.time()
        user = (r.get("authorName") or {}).get("simpleText") or ""
        yield ts, user, text, r.get("id") or f"{ts}{user}{text}"
