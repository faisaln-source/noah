import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {promises as fs} from 'node:fs';
import {DATA,required} from './store.mjs';
import {run,update} from './jobs.mjs';
import {addMedia,probe} from './media.mjs';

// Keep the lossless master track and video packets, adding a widely supported
// default playback track. No video re-encoding and no lossless audio conversion.
export async function addCompatibleAudio(input,output,job){
  await run('ffmpeg',['-y','-v','warning','-i',input,
    '-map','0:v:0','-map','0:a:0','-map','0:a:0',
    '-c:v','copy','-c:a:0','aac','-b:a:0','320k','-ar:a:0','48000','-ac:a:0','2',
    '-c:a:1','copy','-strict','-2',
    '-disposition:a:0','default','-disposition:a:1','0',
    '-metadata:s:a:0','title=Compatible playback (AAC)',
    '-metadata:s:a:0','handler_name=Compatible playback (AAC)',
    '-metadata:s:a:1','title=Lossless master audio',
    '-metadata:s:a:1','handler_name=Lossless master audio',
    '-movflags','+faststart',output],job);
}
export async function repairExportAudio(payload,job){
  const source=required('media',payload.mediaId);
  if(!['export','preview'].includes(source.kind))throw new Error('Choose a completed edited export or rendered preview');
  const input=path.join(DATA,path.basename(source.file));
  const info=await probe(input);
  const audio=info.streams.filter(stream=>stream.codec_type==='audio');
  if(!audio.length)throw new Error('This file has no audio track. Re-export from the original recording with source volume above zero.');
  if(audio[0].codec_name==='aac')return source;
  if(audio[0].codec_name!=='flac')throw new Error('This repair is for older lossless FLAC exports. Re-export this file from the editor for compatible audio.');
  update(job,{stage:'Adding compatible sound; copying video and lossless audio unchanged'});
  const output=path.join(DATA,`${randomUUID()}.mp4`);
  try{
    await addCompatibleAudio(input,output,job);
    return await addMedia(output,`${source.title} (compatible audio)`,'export',{
      quality:source.quality,sourceIds:source.sourceIds || [],timeline:source.timeline,
      srt:source.srt,vtt:source.vtt,ratio:source.ratio,subtitleCount:source.subtitleCount,
      audioCompatibilityVersion:1,losslessAudioCodec:'flac',repairedFrom:source.id
    });
  }catch(error){await fs.unlink(output).catch(()=>{});throw error;}
}
