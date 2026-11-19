import test from 'node:test';
import assert from 'node:assert/strict';
import {parseHistory,historyManifest,matchingReplay} from '../backend/hls-history.mjs';
test('provider history preserves broadcast timing, keys, byte ranges and exact clip selection',()=>{
  const text='#EXTM3U\n#EXT-X-MEDIA-SEQUENCE:200\n#EXT-X-PROGRAM-DATE-TIME:2026-11-18T01:00:00Z\n#EXT-X-KEY:METHOD=AES-128,URI="key.bin"\n#EXT-X-MAP:URI="init.mp4"\n#EXTINF:10,\n#EXT-X-BYTERANGE:100@50\nmedia.mp4\n#EXTINF:10,\n#EXT-X-BYTERANGE:100\nmedia.mp4\n#EXT-X-DISCONTINUITY\n#EXTINF:10,\nlast.ts\n';
  const parsed=parseHistory(text,'https://provider.example/live/index.m3u8');
  assert.equal(parsed.duration,30);
  assert.equal(parsed.firstDate,Date.parse('2026-11-18T01:00:00Z')/1000);
  const selected=parsed.segments.filter(item=>item.end>12 && item.start<18);
  const manifest=historyManifest(selected);
  assert.match(manifest,/#EXT-X-MEDIA-SEQUENCE:201/);
  assert.match(manifest,/#EXT-X-BYTERANGE:100@150/);
  assert.match(manifest,/URI="https:\/\/provider.example\/live\/key.bin"/);
  assert.match(manifest,/#EXT-X-ENDLIST/);
  assert.equal(selected[0].start,10);
  assert.throws(()=>parseHistory('#EXTM3U\n#EXTINF:10,\nfile:///secret','https://provider.example/live'),/Unsupported/);
});
test('ongoing replay discovery never substitutes a previous broadcast',()=>{
  const metadata={release_timestamp:180000};
  const yesterday={url:'old',is_live:false,timestamp:90000};
  const current={url:'matching',is_live:true,timestamp:180003};
  assert.equal(matchingReplay([yesterday,current],metadata),current);
  assert.equal(matchingReplay([yesterday],metadata),null);
  assert.equal(matchingReplay([current],{}),null);
});
