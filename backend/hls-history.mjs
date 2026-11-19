// Stable, seekable snapshots of the history actually exposed by an HLS provider.
export function remoteUrl(value,base){
  const url=new URL(value,base);
  if(!['http:','https:'].includes(url.protocol) || url.username || url.password)throw new Error('Unsupported history media URL');
  return url.href;
}
export function absoluteTags(line,base){
  return line.replace(/URI="([^"]+)"/g,(_match,value)=>`URI="${remoteUrl(value,base)}"`);
}
export function parseHistory(text,base){
  if(!text.startsWith('#EXTM3U'))throw new Error('The provider did not return an HLS playlist');
  const lines=text.replace(/\r/g,'').split('\n');
  const variants=[];const segments=[];
  let variant=null,duration=null,position=0,sequence=0,key='',map='',extras=[],date=null,firstDate=null,rangeEnds=new Map();
  for(const raw of lines){
    const line=raw.trim();if(!line)continue;
    if(line.startsWith('#EXT-X-STREAM-INF:')){variant=Number(line.match(/(?:AVERAGE-)?BANDWIDTH=(\d+)/)?.[1])||0;continue;}
    if(!line.startsWith('#') && variant!==null){variants.push({url:remoteUrl(line,base),bandwidth:variant});variant=null;continue;}
    if(line.startsWith('#EXT-X-MEDIA-SEQUENCE:'))sequence=Number(line.split(':')[1]);
    else if(line.startsWith('#EXTINF:'))duration=Number(line.slice(8).split(',')[0]);
    else if(line.startsWith('#EXT-X-KEY:'))key=absoluteTags(line,base);
    else if(line.startsWith('#EXT-X-MAP:'))map=absoluteTags(line,base);
    else if(line.startsWith('#EXT-X-PROGRAM-DATE-TIME:')){date=Date.parse(line.slice(25))/1000;if(firstDate===null && Number.isFinite(date))firstDate=date-position;}
    else if(line.startsWith('#EXT-X-DISCONTINUITY') || line.startsWith('#EXT-X-BYTERANGE:'))extras.push(line);
    else if(!line.startsWith('#') && duration!==null){
      const url=remoteUrl(line,base);
      extras=extras.map(tag=>{if(!tag.startsWith('#EXT-X-BYTERANGE:'))return tag;const [length,explicit]=tag.slice(17).split('@').map(Number);const offset=explicit ?? rangeEnds.get(url) ?? 0;rangeEnds.set(url,offset+length);return `#EXT-X-BYTERANGE:${length}@${offset}`;});
      segments.push({url,start:position,end:position+duration,duration,sequence:sequence++,key,map,extras});position+=duration;duration=null;extras=[];
    }
  }
  return {variants:variants.sort((a,b)=>b.bandwidth-a.bandwidth),segments,duration:position,firstDate};
}
export function historyManifest(segments){
  if(!segments.length)throw new Error('No earlier video segments are available');
  const header=`#EXTM3U\n#EXT-X-VERSION:6\n#EXT-X-TARGETDURATION:${Math.ceil(Math.max(...segments.map(item=>item.duration)))}\n#EXT-X-MEDIA-SEQUENCE:${segments[0].sequence}\n#EXT-X-PLAYLIST-TYPE:VOD\n`;
  return header+segments.map(item=>[item.key,item.map,...item.extras,`#EXTINF:${item.duration},`,item.url].filter(Boolean).join('\n')).join('\n')+'\n#EXT-X-ENDLIST\n';
}
export async function fetchHistory(url,headers={},depth=0){
  if(depth>4)throw new Error('Provider playlist nesting is too deep');
  const response=await fetch(url,{headers,signal:AbortSignal.timeout(20000)});
  if(!response.ok)throw new Error(`Provider history is unavailable (${response.status})`);
  const text=await response.text();
  if(text.length>16*1024*1024)throw new Error('Provider playlist exceeds the supported size');
  const parsed=parseHistory(text,response.url || url);
  if(parsed.variants.length)return fetchHistory(parsed.variants[0].url,headers,depth+1);
  if(!parsed.segments.length)throw new Error('This provider has not exposed any rewindable video');
  return parsed;
}
export function matchingReplay(entries,metadata){
  const began=Number(metadata.release_timestamp || metadata.timestamp);
  if(!Number.isFinite(began) || !began)return null;
  // Never mistake yesterday's archive for this broadcast.
  return entries.find(item=>Number.isFinite(Number(item.timestamp)) && Math.abs(Number(item.timestamp)-began)<=120 && (item.is_live || item.live_status==='is_live')) || null;
}
