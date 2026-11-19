export function historyTime(value){
  const milliseconds=Math.round(Math.max(0,value)*1000);
  const seconds=Math.floor(milliseconds/1000);
  return [Math.floor(seconds/3600),Math.floor(seconds/60)%60,seconds%60].map(part=>String(part).padStart(2,'0')).join(':')+'.'+String(milliseconds%1000).padStart(3,'0');
}
export function validateHistoryRange({start,end,availableStart,availableEnd,maxDuration=1800}){
  let a=Number(start),b=Number(end);
  if(!Number.isFinite(a)||!Number.isFinite(b))throw new Error('Enter valid clip start and end timestamps.');
  if(a<availableStart-.001 || a>availableEnd-.01)throw new Error(`Choose a start within available history: ${historyTime(availableStart)} to ${historyTime(availableEnd)}.`);
  a=Math.max(a,availableStart);
  if(b-a<.009)throw new Error(`Clip end must be at least 0.01 seconds after start (${historyTime(a)}). Move the end marker forward.`);
  if(b>a+maxDuration+.001)throw new Error(`This selection is too long. Choose an end at or before ${historyTime(a+maxDuration)} (maximum ${maxDuration/60} minutes per clip), or split it into smaller clips.`);
  if(b>availableEnd+.001)throw new Error(`The selected end (${historyTime(b)}) is beyond available history (${historyTime(availableEnd)}). Refresh full history or choose an earlier end.`);
  b=Math.min(b,availableEnd,a+maxDuration);
  return {start:a,end:b};
}
