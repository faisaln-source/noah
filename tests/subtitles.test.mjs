import test from 'node:test';
import assert from 'node:assert/strict';
import { parseSrt, retimeCaptions, serializeCaptions, assCaptions, suppliedCaptions } from '../backend/subtitles.mjs';

test('subtitles retain timing across trims and speed changes', () => {
  const segments = [{ start: 9, end: 13, text: 'real', words: [{ start: 10, end: 11, text: 'real' }] }];
  const result = retimeCaptions(segments, 10, 12, 5, .5);
  assert.equal(result[0].start, 5);
  assert.equal(result[0].end, 9);
  assert.equal(result[0].words[0].end, 7);
  assert.deepEqual(parseSrt(serializeCaptions(result)).map(({ words, ...item }) => item), result.map(({ words, ...item }) => item));
  assert.match(serializeCaptions(result, true), /^WEBVTT\n/);
  assert.match(assCaptions(result, { captionStyle: 'karaoke' }, 1080, 1920), /\\kf/);
});
test('neon subtitles use real word intervals, leave speech gaps clear, and preserve timed captions through SRT', () => {
  const segments = [{ start: 2, end: 4, text: 'Drive now', words: [{ start: 2.1, end: 2.4, text: 'Drive' }, { start: 3, end: 3.7, text: 'now' }] }];
  const options = { captionStyle: 'gta6', captionFont: 'Anton', captionSize: 72, captionColor: '#ff70bd', captionHighlightColor: '#ffd08a', captionAnimation: 'word-pop', subtitles: serializeCaptions(segments), captionSegments: segments };
  assert.equal(suppliedCaptions(options), segments);
  const ass = assCaptions(segments, options, 1080, 1920);
  assert.match(ass, /Style: Neon,Anton,72/);
  assert.match(ass, /0:00:02\.10,0:00:02\.40/);
  assert.match(ass, /0:00:03\.00,0:00:03\.70/);
  assert.match(ass, /\\t\(0,70,\\fscx108/);
  assert.match(ass, /BD70FF/);
  assert.equal((ass.match(/Dialogue:/g) || []).length, 4);
  const shifted = retimeCaptions(segments, 2, 4, 5, 2);
  assert.equal(shifted[0].words[1].start, 5.5);
  const edited = suppliedCaptions({ ...options, subtitles: options.subtitles.replace('Drive now', 'Edited words') });
  assert.equal(edited[0].words, undefined);
  assert.match(assCaptions(edited, options, 1080, 1920), /EDITED/);
  assert.match(assCaptions(segments, { ...options, captionAnimation: 'highlight' }, 1080, 1920), /8AD0FF/);
});
