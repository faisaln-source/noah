import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import {promises as fs} from 'node:fs';
import path from 'node:path';
import {randomUUID,randomBytes,createHash} from 'node:crypto';

test('YouTube OAuth and resumable upload use explicit approval, protected storage and unchanged bytes (mock Google)',{timeout:60000},async()=>{
  if(process.platform!=='win32')return;
  const directory=path.resolve('data',`youtube-test-${randomUUID()}`);
  process.env.DATA_DIR=directory;
  const {youtube,publishMetadata}=await import('../backend/youtube.mjs');
  const {put,get,db}=await import('../backend/store.mjs');
  const originalFetch=globalThis.fetch;
  const received=[];
  let metadata;
  let chunks=0;
  globalThis.fetch=async(input,options={})=>{
    const url=new URL(String(input));
    if(url.hostname==='127.0.0.1')return originalFetch(input,options);
    if(url.href==='https://oauth2.googleapis.com/token')return Response.json({access_token:'fixture-access',refresh_token:'fixture-refresh',expires_in:3600});
    if(url.pathname==='/youtube/v3/channels')return Response.json({items:[{id:'fixture-channel',snippet:{title:'Fixture channel'}}]});
    if(url.pathname==='/upload/youtube/v3/videos'){
      metadata=JSON.parse(options.body);
      return new Response('',{status:200,headers:{location:'https://www.googleapis.com/upload/fixture-session'}});
    }
    if(url.pathname==='/upload/fixture-session'){
      received.push(Buffer.from(options.body));chunks++;
      if(chunks===1)return new Response('',{status:308,headers:{range:`bytes=0-${options.body.length-1}`}});
      return Response.json({id:'fixture-video'});
    }
    throw new Error(`Unexpected network call blocked by test: ${url.origin}${url.pathname}`);
  };
  const app=express();app.use(express.json());app.use('/api',youtube);app.use((error,_req,res,_next)=>res.status(400).json({error:error.message}));
  const server=await new Promise(resolve=>{const listener=app.listen(0,'127.0.0.1',()=>resolve(listener));});
  const base=`http://127.0.0.1:${server.address().port}`;
  async function api(route,body){const response=await fetch(base+route,body===undefined?{}:{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});return {status:response.status,body:await response.json()};}
  try{
    assert.throws(()=>publishMetadata({title:'X',privacy:'bad'}),/privacy/);
    const auth=await api('/api/youtube/connect',{credentials:{installed:{client_id:'fixture.apps.googleusercontent.com',client_secret:'fixture-secret'}}});
    assert.equal(auth.status,200);
    const url=new URL(auth.body.url);
    assert.equal(url.searchParams.get('code_challenge_method'),'S256');
    const bad=await api('/api/youtube/callback?state=wrong&code=fixture');assert.equal(bad.status,400);
    const callback=await fetch(base+`/api/youtube/callback?state=${url.searchParams.get('state')}&code=fixture`);
    assert.equal(callback.status,200,await callback.text());
    assert.equal((await api('/api/youtube/status')).body.channel.id,'fixture-channel');
    assert.ok(!(await fs.readFile(path.join(directory,'youtube-account.dpapi'),'utf8')).includes('fixture-refresh'));
    const bytes=randomBytes(8*1024*1024+65536);
    await fs.writeFile(path.join(directory,'export.mp4'),bytes);
    const media=put('media',{id:randomUUID(),file:'export.mp4',kind:'export',title:'Fixture'});
    const payload={mediaId:media.id,title:'Reviewed fixture',description:'Fixture description',tags:'gaming,fixture',privacy:'private',channelId:'fixture-channel',publishConfirmed:false};
    assert.equal((await api('/api/youtube/upload',payload)).status,400);
    const queued=await api('/api/youtube/upload',{...payload,publishConfirmed:true});assert.equal(queued.status,202);
    for(let i=0;i<100 && ['queued','running'].includes(get('jobs',queued.body.id).status);i++)await new Promise(resolve=>setTimeout(resolve,50));
    const job=get('jobs',queued.body.id);assert.equal(job.status,'done',job.error);
    assert.equal(chunks,2);
    assert.equal(createHash('sha256').update(Buffer.concat(received)).digest('hex'),createHash('sha256').update(bytes).digest('hex'));
    assert.equal(metadata.status.privacyStatus,'private');
    assert.equal(job.result.videoId,'fixture-video');
  }finally{
    globalThis.fetch=originalFetch;
    await new Promise(resolve=>server.close(resolve));db.close();
    assert.equal(path.dirname(directory),path.resolve('data'));
    assert.match(path.basename(directory),/^youtube-test-[a-f0-9-]{36}$/);
    await fs.rm(directory,{recursive:true,force:true});
  }
});
