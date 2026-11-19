import test from 'node:test';
import assert from 'node:assert/strict';
import {validateHistoryRange,historyTime} from '../shared/history-range.mjs';
test('history errors use broadcast timestamps and explain length, ordering and stale history',()=>{
  const range={start:30827.195,end:30887.195,availableStart:0,availableEnd:40000};
  assert.equal(historyTime(range.start),'08:33:47.195');
  assert.deepEqual(validateHistoryRange(range),{start:range.start,end:range.end});
  assert.throws(()=>validateHistoryRange({...range,end:33000}),/09:03:47.195.*maximum 30 minutes/);
  assert.throws(()=>validateHistoryRange({...range,end:30827.2}),/0.01 seconds after start \(08:33:47.195\)/);
  assert.throws(()=>validateHistoryRange({...range,end:31000,availableEnd:30900}),/Refresh full history/);
  assert.equal(validateHistoryRange({...range,end:32627.1954}).end,32627.195);
});
