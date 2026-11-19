import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {promises as fs} from 'node:fs';
import {randomUUID} from 'node:crypto';
import path from 'node:path';
test('quiet-boundary audio chunks preserve every sample and absolute offset',async()=>{
  const file=path.resolve('data',`chunks-${randomUUID()}.wav`);
  try{
    const result=spawnSync(path.resolve('tools/python/python.exe'),['-c',`
import sys,wave
import numpy as np
sys.path.insert(0,'ai')
from snap_ninja.audio_chunks import _audio_chunks
samples=np.arange(16000*125,dtype=np.int16)
with wave.open(sys.argv[1],'wb') as stream:
    stream.setnchannels(1);stream.setsampwidth(2);stream.setframerate(16000);stream.writeframes(samples.tobytes())
chunks=list(_audio_chunks(sys.argv[1],chunk_s=60,search_s=3))
assert len(chunks)==3
position=0
for offset,chunk in chunks:
    assert abs(offset-position/16000)<1e-8
    assert len(chunk)<=63*16000
    np.testing.assert_array_equal(chunk*32768,samples[position:position+len(chunk)])
    position+=len(chunk)
assert position==len(samples)
`,file],{encoding:'utf8',windowsHide:true});
    assert.equal(result.status,0,result.stderr);
  }finally{assert.equal(path.dirname(file),path.resolve('data'));await fs.unlink(file).catch(()=>{});}
});
