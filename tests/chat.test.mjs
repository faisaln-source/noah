import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import path from 'node:path';

test('chat meter ignores steady chat, detects real bursts, and rejects lookalike provider hosts',()=>{
  const result=spawnSync(path.resolve('tools/python/python.exe'),['-c',`
import sys
sys.path.insert(0,'ai')
from snap_ninja.chat_spikes import ChatMeter
from snap_ninja.chat import chat_site, _youtube_messages
meter=ChatMeter()
for t in range(200):
    meter.add(t,'steady')
    assert meter.check(t+2) is None
found=[]
for t in range(200,250):
    for n in range(20 if t < 207 else 1): meter.add(t,'wow payoff')
    spike=meter.check(t+2)
    if spike: found.append(spike)
assert len(found)==1,found
assert found[0]['peak_rate']>=80,found
assert 'payoff' in found[0]['top']
assert chat_site('https://youtube.com.attacker.example/watch?v=x')==''
assert chat_site('https://www.youtube.com/live/x')=='youtube'
assert chat_site('https://twitch.tv/streamer')=='twitch'
assert list(_youtube_messages(b'not json'))==[]
print('passed')
`],{encoding:'utf8',windowsHide:true});
  assert.equal(result.status,0,result.stderr);
});
