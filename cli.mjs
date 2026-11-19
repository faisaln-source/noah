// Thin client for the running local Noah server. No additional dependencies.
import path from 'node:path';
const [mode, value, ...flags] = process.argv.slice(2);
if (!['import','clip'].includes(mode) || !value) {
  console.log('Start Noah first.\nnode cli.mjs import <absolute file or folder> --rights\nnode cli.mjs clip <URL> --rights [--start 0] [--duration 60]\nEvery clip opens for review before export.');
  process.exitCode = 1;
} else {
  try {
    if (!flags.includes('--rights')) throw new Error('Add --rights to confirm ownership or permission to reuse this media');
    const argument = (name,fallback) => flags.includes(name) ? Number(flags[flags.indexOf(name)+1]) : fallback;
    const base = 'http://127.0.0.1:3000';
    const version = await (await fetch(base+'/api/version')).json();
    if (version.name !== 'Noah') throw new Error('Noah server not found');
    const body = mode === 'import' ? {path:path.resolve(value),rightsConfirmed:true} : {url:value,rightsConfirmed:true,inputMode:'range',start:argument('--start',0),duration:argument('--duration',60),manualClip:true,detectionMode:'manual',reviewFirst:true,ratio:'16:9',preset:'clean'};
    const response = await fetch(base+(mode === 'import' ? '/api/import-path' : '/api/process-link'),{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
    const job = await response.json();
    if (!response.ok) throw new Error(job.error);
    console.log(`Queued ${job.id}. Review progress in Noah at ${base}`);
  } catch(error) {console.error(error.message);process.exitCode=1;}
}
