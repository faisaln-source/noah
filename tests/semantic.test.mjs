import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

test('optional semantic review uses saved feedback, validates model JSON and rejects weak candidates', async () => {
  const directory = path.resolve('data', `semantic-${randomUUID()}`);
  process.env.DATA_DIR = directory;
  let seen;
  let invalid = false;
  const server = createServer(async (req,res) => {
    res.setHeader('Content-Type','application/json');
    if (req.url === '/api/tags') return res.end(JSON.stringify({models:[{name:'fixture-text'}]}));
    let body = ''; for await (const chunk of req) body += chunk;
    seen = JSON.parse(body);
    res.end(JSON.stringify({message:{content:JSON.stringify(invalid ? {} : {keep:false,title:'No payoff',reason:'Speech has no completed event',score:10})}}));
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  process.env.CLIPFORGE_OLLAMA_URL = `http://127.0.0.1:${server.address().port}`;
  const {put,db} = await import('../backend/store.mjs');
  const {reviewWithOllama,ollamaModels} = await import('../backend/semantic.mjs');
  try {
    const analysis = {highlights:[{start:1,end:3,title:'Peak',reason:'Audio and motion',prominence:30}]};
    const source = {transcript:{segments:[{start:1,end:3,text:'Trying to find the next room'}]}};
    assert.equal(await reviewWithOllama(source,analysis,{},()=>{}),analysis);
    put('settings',{id:'ollama',enabled:true,model:'fixture-text'});
    put('ratings',{id:'test',rating:'good',title:'Complete story',note:'Keep the payoff'});
    assert.deepEqual((await ollamaModels()).models,['fixture-text']);
    const result = await reviewWithOllama(source,analysis,{},()=>{});
    assert.equal(result.highlights.length,0);
    assert.equal(JSON.parse(seen.messages[1].content).feedback[0].reason,'Keep the payoff');
    invalid = true;
    await assert.rejects(reviewWithOllama(source,analysis,{},()=>{}),/invalid review/);
  } finally {
    await new Promise(resolve=>server.close(resolve)); db.close();
    assert.equal(path.dirname(directory),path.resolve('data'));
    assert.match(path.basename(directory),/^semantic-[a-f0-9-]{36}$/);
    await fs.rm(directory,{recursive:true,force:true});
  }
});

test('optional cloud review sends only explicitly supplied context and normalizes JSON (mock Anthropic)',async()=>{
  const {semanticChat}=await import('../backend/semantic.mjs');
  const original=globalThis.fetch;
  let received;
  process.env.ANTHROPIC_API_KEY='fixture-only';
  process.env.ANTHROPIC_MODEL='fixture-model';
  globalThis.fetch=async(url,options)=>{
    assert.equal(String(url),'https://api.anthropic.com/v1/messages');
    received=JSON.parse(options.body);
    assert.equal(options.headers.Authorization,'Bearer fixture-only');
    return Response.json({content:[{type:'text',text:'{"keep":true,"title":"Moment","reason":"Payoff","score":80}'}]});
  };
  try{
    const response=await semanticChat({messages:[{role:'system',content:'Review fixture'},{role:'user',content:'Context only',images:['fixture-jpeg']} ]},{provider:'claude'},AbortSignal.timeout(1000));
    assert.equal(JSON.parse((await response.json()).message.content).keep,true);
    assert.equal(received.messages[0].content[1].source.media_type,'image/jpeg');
    assert.equal(received.model,'fixture-model');
  }finally{globalThis.fetch=original;delete process.env.ANTHROPIC_API_KEY;delete process.env.ANTHROPIC_MODEL;}
});
