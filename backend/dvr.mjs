import {validateHistoryRange} from '../shared/history-range.mjs';
import {Router} from 'express';
import {Readable} from 'node:stream';
import {pipeline} from 'node:stream/promises';
import {promises as fs} from 'node:fs';
import path from 'node:path';
import {randomUUID,createHash} from 'node:crypto';
import {DATA,numeric} from './store.mjs';
import {run,enqueue,register,update,checkCancelled} from './jobs.mjs';
import {playbackMetadata,addMedia} from './media.mjs';
import {processLink} from './pipeline.mjs';
import {fetchHistory,historyManifest,matchingReplay,remoteUrl} from './hls-history.mjs';

export const dvr=Router();
const sessions=new Map();
const jobStreams=new Map();
export async function discoverHistory(url,metadata,resolve=playbackMetadata,list=async archive=>JSON.parse(await run('yt-dlp',['--flat-playlist','--playlist-end','10','--skip-download','--dump-single-json','--no-warnings','--socket-timeout','15','--',archive],undefined,{timeoutMs:45000})).entries || []){
  let historyMetadata=metadata;let replayUrl=url;let completeReplay=false;
  const provider=new URL(url);const host=provider.hostname.replace(/^www\./,'');
  if(host==='kick.com' && /^\/[\w-]+\/?$/.test(provider.pathname)){
    const entries=await list(`https://kick.com/${provider.pathname.split('/')[1]}/videos`).catch(()=>[]);
    const replay=matchingReplay(entries,metadata);
    if(replay?.url){replayUrl=new URL(replay.url).href.split('#')[0];historyMetadata=await resolve(replayUrl);completeReplay=true;}
  }
  const formats=historyMetadata.formats || historyMetadata.requested_formats || [historyMetadata];
  const candidates=formats.filter(format=>format.url && (String(format.protocol).includes('m3u8') || /\.m3u8(?:\?|$)/i.test(format.url)) && format.vcodec!=='none' && format.acodec!=='none');
  const selected=candidates.sort((a,b)=>(Number(b.height)||0)-(Number(a.height)||0) || (Number(b.tbr)||0)-(Number(a.tbr)||0))[0];
  if(!selected)throw new Error('This source does not expose a compatible HLS rewind stream. Use the platform player DVR or an available replay link.');
  const headers=selected.http_headers || historyMetadata.http_headers || {};
  const history=await fetchHistory(selected.url,headers);
  const began=Number(metadata.release_timestamp || metadata.timestamp);
  const offset=completeReplay || !metadata.is_live || !Number.isFinite(began) || !history.firstDate ? 0 : Math.max(0,history.firstDate-began);
  const timelineKnown=completeReplay || !metadata.is_live || Number.isFinite(began) && began>0 && !!history.firstDate;
  return {history,headers,replayUrl,completeReplay,offset,timelineKnown,title:metadata.title || 'Live history',width:selected.width,height:selected.height};
}
function publicSession(id,session){return {id,url:`/api/dvr/${id}/manifest.m3u8`,start:session.offset,end:session.offset+session.history.duration,live:false,sourceLive:session.sourceLive,title:session.title,width:session.width,height:session.height,fromBeginning:session.timelineKnown && session.offset<5,message:!session.timelineKnown?'Only the current provider history is available; its offset from broadcast start could not be verified.':session.offset<5?'Replay history starts at the beginning of this broadcast.':'The provider only exposes part of this broadcast. Older footage is outside its current DVR window.'};}
function requiredSession(id){const session=sessions.get(id);if(!session)throw new Error('Live history session expired. Reopen full live history.');session.accessedAt=Date.now();return session;}
dvr.post('/dvr',async(req,res)=>{
  if(sessions.size>=4)throw new Error('Close another history player before opening one more');
  const url=remoteUrl(req.body.url);
  const metadata=await playbackMetadata(url);
  const discovered=await discoverHistory(url,metadata);
  if(res.destroyed)return;
  const id=randomUUID();const session={...discovered,url,sourceLive:!!metadata.is_live,assets:new Map(),accessedAt:Date.now()};
  sessions.set(id,session);res.json(publicSession(id,session));
});
dvr.post('/dvr/:id/keepalive',(req,res)=>{requiredSession(req.params.id);res.json({ok:true});});
dvr.delete('/dvr/:id',(req,res)=>{sessions.delete(req.params.id);res.json({ok:true});});
dvr.get('/dvr/:id/manifest.m3u8',(req,res)=>{
  const session=requiredSession(req.params.id);
  const manifest=historyManifest(session.history.segments);
  const local=url=>{const token=createHash('sha256').update(url).digest('hex');session.assets.set(token,url);return `/api/dvr/${req.params.id}/asset/${token}`;};
  const rewritten=manifest.split('\n').map(line=>line.startsWith('#')?line.replace(/URI="([^"]+)"/g,(_match,url)=>`URI="${local(url)}"`):line?local(line):'').join('\n');
  res.setHeader('Cache-Control','no-store');res.type('application/vnd.apple.mpegurl').send(rewritten);
});
async function proxyAsset(req,res,session){
  const url=session.assets.get(req.params.token);if(!url)return res.sendStatus(404);
  const controller=new AbortController();res.on('close',()=>{if(!res.writableEnded)controller.abort();});
  const response=await fetch(url,{headers:{...session.headers,...(req.headers.range?{Range:req.headers.range}:{})},signal:AbortSignal.any([controller.signal,AbortSignal.timeout(30000)])});
  if(!response.ok)throw new Error(`History segment unavailable (${response.status}); refresh history to renew provider links`);
  res.status(response.status);for(const header of ['content-type','content-length','content-range','accept-ranges'])if(response.headers.has(header) && !(header==='content-length' && response.headers.has('content-encoding')))res.setHeader(header,response.headers.get(header));
  await pipeline(Readable.fromWeb(response.body),res);
}
function proxyManifest(manifest,base,session){
  const local=url=>{const token=createHash('sha256').update(url).digest('hex');session.assets.set(token,url);return `${base}/asset/${token}`;};
  return manifest.split('\n').map(line=>line.startsWith('#')?line.replace(/URI="([^"]+)"/g,(_match,url)=>`URI="${local(url)}"`):line?local(line):'').join('\n');
}
dvr.get('/dvr/:id/asset/:token',async(req,res)=>proxyAsset(req,res,requiredSession(req.params.id)));
dvr.get('/history-job/:token/manifest.m3u8',(req,res)=>{const session=jobStreams.get(req.params.token);if(!session)return res.sendStatus(404);res.type('application/vnd.apple.mpegurl').send(session.manifest);});
dvr.get('/history-job/:jobToken/asset/:token',async(req,res)=>{const session=jobStreams.get(req.params.jobToken);if(!session)return res.sendStatus(404);await proxyAsset(req,res,session);});
dvr.post('/dvr/:id/clip',async(req,res)=>{
  const session=requiredSession(req.params.id);
  if(req.body.rightsConfirmed!==true)throw new Error('Confirm media rights before clipping');
  const {start,end}=validateHistoryRange({start:req.body.start,end:req.body.end,availableStart:session.offset,availableEnd:session.offset+session.history.duration,maxDuration:['9:16','3:4'].includes(req.body.ratio)?120:1800});
  const segments=session.history.segments.filter(item=>item.end>start-session.offset && item.start<end-session.offset);
  const id=randomUUID();const name=`${id}-history.m3u8`;
  await fs.writeFile(path.join(DATA,'work',name),historyManifest(segments));
  res.status(202).json(enqueue('history-clip',{...req.body,manualClip:true,url:session.url,replayUrl:session.replayUrl,manifest:name,headers:session.headers,sourceStart:session.offset+segments[0].start,offset:start-session.offset-segments[0].start,duration:end-start},'Prepare earlier live moment for review'));
});
register('history-clip',async(payload,job)=>{
  const manifest=path.join(DATA,'work',path.basename(payload.manifest));
  const file=path.join(DATA,`${job.id}-history.mp4`);
  let complete=false;const token=randomUUID();
  try{
    update(job,{stage:'Downloading selected original replay segments'});
    const stream={headers:payload.headers || {},assets:new Map()};
    const port=Number(process.env.PORT || 3000);
    const base=`http://127.0.0.1:${port}/api/history-job/${token}`;
    stream.manifest=proxyManifest(await fs.readFile(manifest,'utf8'),base,stream);
    jobStreams.set(token,stream);
    await run('ffmpeg',['-y','-v','warning','-protocol_whitelist','file,http,https,tcp,tls,crypto','-allowed_extensions','ALL','-allowed_segment_extensions','ALL','-extension_picky','0','-i',base+'/manifest.m3u8','-map','0:v:0','-map','0:a:0?','-c','copy','-movflags','+faststart',file],job,{timeoutMs:300000});
    checkCancelled(job);
    const source=await addMedia(file,'Earlier live moment','clip',{sourceUrl:payload.url,replayUrl:payload.replayUrl,sourceStart:payload.sourceStart,captureQuality:'source-copy',rightsConfirmedAt:Date.now()});
    const result=await processLink({...payload,resumeSourceId:source.id,manualClip:true,detectionMode:'manual',reviewFirst:true},job);
    result.manualRanges=[{id:randomUUID(),start:payload.offset,end:Math.min(source.duration,payload.offset+payload.duration),title:'Selected earlier live moment'}];
    complete=true;return result;
  }finally{jobStreams.delete(token);if(complete)await fs.unlink(manifest).catch(()=>{});}
});
const cleanup=setInterval(()=>{for(const[id,session]of sessions)if(Date.now()-session.accessedAt>90000)sessions.delete(id);},15000);cleanup.unref();
