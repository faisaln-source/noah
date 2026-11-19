"""Anonymous read-only live chat counters; usernames and chat text are not emitted."""
import json
import sys
import threading
import time
from pathlib import Path
from snap_ninja.chat import start_chat
from snap_ninja.chat_spikes import ChatMeter

request = json.loads(Path(sys.argv[1]).read_text(encoding='utf-8'))
meter = ChatMeter()
stop = threading.Event()
def emit(value):
    print(json.dumps(value), flush=True)
def message(ts, _user, text):
    meter.add(ts, text)
reader = start_chat(request['url'], {}, message, lambda text: emit({'status':text}), stop, Path(request['work']))
if reader is None:
    emit({'error':'Chat spike detection supports YouTube and Twitch live chat only'})
    sys.exit(1)
try:
    while not stop.wait(2):
        now = time.time()
        spike = meter.check(now)
        emit({'total':meter.total, 'normal':meter.normal, 'series':meter.series(now-180,now), 'spike':spike})
        with meter.lock:
            for second in list(meter.per_sec):
                if second < now - 360:
                    meter.per_sec.pop(second,None)
                    meter.words.pop(second,None)
        if not reader.is_alive():
            emit({'error':'Chat reader stopped. Recording and manual clipping remain available.'})
            break
finally:
    stop.set()
