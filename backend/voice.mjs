import {Router} from 'express';
import path from 'node:path';
import {promises as fs,createWriteStream} from 'node:fs';
import {Readable} from 'node:stream';
import {pipeline} from 'node:stream/promises';
import {createHash} from 'node:crypto';
import {DATA,required,numeric,get} from './store.mjs';
import {run,enqueue,register,update} from './jobs.mjs';
import {pythonProcess,addMedia,probe} from './media.mjs';

export const voice=Router();
const modelFolder=path.join(process.env.MODEL_CACHE || path.join(DATA,'models'),'voice');
const modelFile=path.join(modelFolder,'UVR_MDXNET_Main.onnx');
const checksum='8289784cda38543ff431add4070662813311a8cccfc0112ca82f76d9dba2b4ca';
voice.get('/voice/tracks/:id',async(req,res)=>{const source=required('media',req.params.id);const info=await probe(path.join(DATA,path.basename(source.file)));res.json(info.streams.filter(stream=>stream.codec_type==='audio').map((stream,index)=>({index,title:stream.tags?.title || stream.tags?.handler_name || `Audio track ${index+1}`,channels:stream.channels,codec:stream.codec_name})));});
voice.get('/voice/status',async(_req,res)=>res.json({ready:(await fs.stat(modelFile).catch(()=>null))?.size===66759214,downloadMB:67}));
register('voice-model',async(_payload,job)=>{
  await fs.mkdir(modelFolder,{recursive:true});
  const temporary=path.join(modelFolder,`${job.id}.download`);
  const controller=new AbortController();const cancel=setInterval(()=>{if(get('jobs',job.id)?.cancelled)controller.abort(new Error('Cancelled'));},500);
  try{
    update(job,{stage:'Downloading the local 67 MB UVR voice model'});
    const response=await fetch('https://github.com/TRvlvr/model_repo/releases/download/all_public_uvr_models/UVR_MDXNET_Main.onnx',{signal:AbortSignal.any([controller.signal,AbortSignal.timeout(300000)])});
    if(!response.ok)throw new Error(`Voice model download failed (${response.status})`);
    await pipeline(Readable.fromWeb(response.body),createWriteStream(temporary));
    if(createHash('sha256').update(await fs.readFile(temporary)).digest('hex')!==checksum)throw new Error('Voice model checksum did not match');
    await fs.rename(temporary,modelFile);return {ready:true};
  }finally{clearInterval(cancel);await fs.unlink(temporary).catch(()=>{});}
});
voice.post('/voice/install',(_req,res)=>res.status(202).json(enqueue('voice-model',{},'Install local voice reduction model')));

export async function removeVoice(input,output,work,strength,job){
  if(strength===0){await fs.copyFile(input,output);return;}
  const pcm=path.join(work,'voice-input.pcm');const separated=path.join(work,'game-audio.wav');
  update(job,{stage:'Preparing audio for streamer voice reduction'});
  await run('ffmpeg',['-y','-v','error','-i',input,'-vn','-ac','2','-ar','44100','-f','f32le',pcm],job);
  await pythonProcess({operation:'remove-voice',pcm,destination:separated,modelFile,strength},job);
  // Effects and source pixels are already rendered. Replace only the audio.
  await run('ffmpeg',['-y','-v','warning','-i',input,'-i',separated,'-map','0:v:0','-map','1:a:0','-c:v','copy','-c:a','flac','-strict','-2','-movflags','+faststart',output],job);
}
register('voice-preview',async(payload,job)=>{
  const source=required('media',payload.sourceId);
  const start=numeric(payload.start,0,source.duration-.01,'preview start');
  const end=numeric(payload.end,start+.01,Math.min(source.duration,start+15),'preview end');
  const strength=numeric(payload.strength ?? 1,0,1,'voice reduction strength');
  const work=path.join(DATA,'work',job.id);await fs.mkdir(work,{recursive:true});
  try{
    const input=path.join(work,'sample.mp4');const processed=path.join(work,'processed.mp4');
    await run('ffmpeg',['-y','-v','error','-ss',String(start),'-i',path.join(DATA,source.file),'-t',String(end-start),'-map','0:v:0','-map',`0:a:${Number(payload.track || 0)}`,'-c:v','copy','-c:a','flac','-strict','-2',input],job);
    await removeVoice(input,processed,work,strength,job);
    const output=path.join(DATA,`${job.id}-voice-sample.m4a`);
    await run('ffmpeg',['-y','-v','error','-i',processed,'-vn','-c:a','aac','-b:a','320k',output],job);
    return addMedia(output,'Voice reduction listening sample','audio',{voiceSample:true});
  }finally{await fs.rm(work,{recursive:true,force:true});}
});
voice.post('/voice/preview',(req,res)=>{
  const source=required('media',req.body.sourceId);
  numeric(req.body.start,0,source.duration-.01,'preview start');numeric(req.body.end,Number(req.body.start)+.01,Math.min(source.duration,Number(req.body.start)+15),'preview end');numeric(req.body.track || 0,0,31,'audio track');
  res.status(202).json(enqueue('voice-preview',req.body,'Preview streamer voice reduction'));
});
