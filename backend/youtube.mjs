import {Router} from 'express';
import {promises as fs} from 'node:fs';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {randomBytes,createHash} from 'node:crypto';
import {DATA,required,put,get} from './store.mjs';
import {enqueue,register,update,checkCancelled} from './jobs.mjs';

export const youtube = Router();
const vault=path.join(DATA,'youtube-account.dpapi');
let account;
let pending;
const tokenEndpoint='https://oauth2.googleapis.com/token';
function secureString(value,decrypt=false) {
  if(process.platform!=='win32') throw new Error('YouTube account storage currently requires Windows DPAPI');
  const script=decrypt ? '$value=[Console]::In.ReadToEnd() | ConvertTo-SecureString; $pointer=[Runtime.InteropServices.Marshal]::SecureStringToBSTR($value); try {[Console]::Out.Write([Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer))} finally {[Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer)}' : '$value=ConvertTo-SecureString -String ([Console]::In.ReadToEnd()) -AsPlainText -Force; [Console]::Out.Write(($value | ConvertFrom-SecureString))';
  return new Promise((resolve,reject)=>{
    const child=spawn('powershell.exe',['-NoProfile','-NonInteractive','-EncodedCommand',Buffer.from(script,'utf16le').toString('base64')],{windowsHide:true,stdio:['pipe','pipe','pipe']});
    let output='';child.stdout.on('data',chunk=>output+=chunk);child.stderr.resume();
    child.on('error',()=>reject(new Error('Windows account protection is unavailable')));
    child.on('close',code=>code===0?resolve(output):reject(new Error('Could not protect or read the YouTube account')));
    child.stdin.end(value);
  });
}
async function saveAccount(value){await fs.writeFile(vault,await secureString(JSON.stringify(value)),{mode:0o600});account=value;}
async function loadAccount(){if(account)return account;try{account=JSON.parse(await secureString(await fs.readFile(vault,'utf8'),true));return account;}catch{return null;}}
async function tokenRequest(body){const response=await fetch(tokenEndpoint,{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams(body),signal:AbortSignal.timeout(30000)});const value=await response.json();if(!response.ok)throw new Error('YouTube authorization failed. Reconnect your account.');return value;}
async function accessToken(){let value=await loadAccount();if(!value)throw new Error('Connect a YouTube account in Settings first');if(value.expiresAt<Date.now()+60000){const fresh=await tokenRequest({client_id:value.client_id,client_secret:value.client_secret,refresh_token:value.refresh_token,grant_type:'refresh_token'});value={...value,...fresh,expiresAt:Date.now()+fresh.expires_in*1000};await saveAccount(value);}return value.access_token;}
async function channelInfo(token){const response=await fetch('https://www.googleapis.com/youtube/v3/channels?part=snippet&mine=true',{headers:{Authorization:`Bearer ${token}`},signal:AbortSignal.timeout(20000)});const body=await response.json();if(!response.ok || !body.items?.length)throw new Error('Cannot identify the authorized YouTube channel');return {id:body.items[0].id,title:body.items[0].snippet.title};}
youtube.get('/youtube/status',async(_req,res)=>{const value=await loadAccount();res.json({connected:!!value,channel:value?.channel,pending:!!pending});});
youtube.post('/youtube/connect',async(req,res)=>{
  const config=req.body.credentials?.installed;
  if(!config || !/\.apps\.googleusercontent\.com$/.test(config.client_id || '') || typeof config.client_secret!=='string')throw new Error('Choose an OAuth Desktop app client JSON downloaded from Google Cloud');
  const verifier=randomBytes(32).toString('base64url');
  const state=randomBytes(32).toString('hex');
  const port=Number(process.env.PORT || 3000);
  const redirect=`http://127.0.0.1:${port}/api/youtube/callback`;
  pending={client_id:config.client_id,client_secret:config.client_secret,verifier,state,redirect,expiresAt:Date.now()+600000};
  const url=new URL('https://accounts.google.com/o/oauth2/v2/auth');
  url.search=new URLSearchParams({client_id:config.client_id,redirect_uri:redirect,response_type:'code',scope:'https://www.googleapis.com/auth/youtube.upload https://www.googleapis.com/auth/youtube.readonly',access_type:'offline',prompt:'consent',state,code_challenge:createHash('sha256').update(verifier).digest('base64url'),code_challenge_method:'S256'}).toString();
  res.json({url:url.href});
});
youtube.get('/youtube/callback',async(req,res)=>{
  if(!pending || Date.now()>pending.expiresAt || req.query.state!==pending.state)throw new Error('Authorization expired or state did not match. Start again in Settings.');
  const current=pending;pending=null;
  if(req.query.error || typeof req.query.code!=='string')throw new Error('YouTube authorization was declined');
  const tokens=await tokenRequest({client_id:current.client_id,client_secret:current.client_secret,code:req.query.code,code_verifier:current.verifier,redirect_uri:current.redirect,grant_type:'authorization_code'});
  const channel=await channelInfo(tokens.access_token);
  if(!tokens.refresh_token)throw new Error('Google did not return offline access. Reconnect and grant consent.');
  await saveAccount({client_id:current.client_id,client_secret:current.client_secret,...tokens,channel,expiresAt:Date.now()+tokens.expires_in*1000});
  res.type('html').send('<!doctype html><title>YouTube connected</title><h1>YouTube connected</h1><p>Return to ClipForge. No video was uploaded.</p>');
});
youtube.delete('/youtube/account',async(_req,res)=>{account=null;pending=null;await fs.unlink(vault).catch(()=>{});res.json({ok:true});});
export function publishMetadata(body){
  const title=String(body.title || '').trim();
  if(!title || title.length>100 || /[<>]/.test(title))throw new Error('Use a title of 1 to 100 characters without angle brackets');
  const description=String(body.description || '');if(Buffer.byteLength(description)>5000)throw new Error('Description must be at most 5000 UTF-8 bytes');
  if(!['private','unlisted','public'].includes(body.privacy))throw new Error('Choose a privacy setting');
  return {snippet:{title,description,categoryId:'20',tags:String(body.tags || '').split(',').map(tag=>tag.trim()).filter(Boolean).slice(0,20)},status:{privacyStatus:body.privacy,selfDeclaredMadeForKids:body.madeForKids===true}};
}
youtube.post('/youtube/upload',async(req,res)=>{
  const media=required('media',req.body.mediaId);
  if(media.kind!=='export')throw new Error('Choose a finished export');
  const metadata=publishMetadata(req.body);
  const value=await loadAccount();
  if(!value || req.body.channelId!==value.channel.id || req.body.publishConfirmed!==true)throw new Error('Review the channel, metadata and privacy, then explicitly confirm uploading');
  res.status(202).json(enqueue('youtube-upload',{mediaId:media.id,metadata,channelId:value.channel.id},'Upload reviewed video to YouTube'));
});
register('youtube-upload',async(payload,job)=>{
  const media=required('media',payload.mediaId);
  const token=await accessToken();
  const channel=await channelInfo(token);
  if(channel.id!==payload.channelId)throw new Error('Connected channel changed. Review and confirm uploading again.');
  const file=path.join(DATA,path.basename(media.file));
  const size=(await fs.stat(file)).size;
  const initiation=await fetch('https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status&notifySubscribers=false',{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json; charset=UTF-8','X-Upload-Content-Type':'video/mp4','X-Upload-Content-Length':String(size)},body:JSON.stringify(payload.metadata),signal:AbortSignal.timeout(30000)});
  if(!initiation.ok)throw new Error(`YouTube could not initiate upload (${initiation.status}). Check account/API quota.`);
  const location=initiation.headers.get('location');
  const parsed=new URL(location);
  if(parsed.protocol!=='https:' || !['www.googleapis.com','youtube.googleapis.com'].includes(parsed.hostname))throw new Error('Unexpected YouTube upload endpoint');
  const handle=await fs.open(file,'r');
  let completed;
  try{
    for(let offset=0;offset<size;){
      checkCancelled(job);
      const buffer=Buffer.alloc(Math.min(8*1024*1024,size-offset));
      const {bytesRead}=await handle.read(buffer,0,buffer.length,offset);
      if(bytesRead!==buffer.length)throw new Error('Export file changed while uploading');
      const response=await fetch(location,{method:'PUT',headers:{'Content-Type':'video/mp4','Content-Length':String(bytesRead),'Content-Range':`bytes ${offset}-${offset+bytesRead-1}/${size}`},body:buffer,signal:AbortSignal.timeout(120000)});
      if(response.status===308){const received=response.headers.get('range')?.match(/bytes=0-(\d+)/);offset=received?Number(received[1])+1:offset+bytesRead;}
      else if(response.ok){completed=await response.json();offset=size;}
      else throw new Error(`YouTube upload failed (${response.status}); check your connection before starting another upload`);
      update(job,{progress:offset/size*100,stage:'Uploading original export bytes to reviewed channel'});
    }
  }finally{await handle.close();}
  if(!completed?.id)throw new Error('YouTube did not confirm a completed upload');
  put('media',{...required('media',media.id),youtube:{id:completed.id,channelId:channel.id,privacy:payload.metadata.status.privacyStatus,uploadedAt:Date.now()}});
  return {videoId:completed.id,url:`https://www.youtube.com/watch?v=${completed.id}`,channel,privacy:payload.metadata.status.privacyStatus};
});
