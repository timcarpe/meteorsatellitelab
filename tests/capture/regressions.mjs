// Unit storage stand-in. Native IndexedDB is separately subject to browser acceptance.
class BrowserCaptureStore {
 static databases = new Map();
 constructor(name) { this.db = BrowserCaptureStore.databases.get(name); if(!this.db){ this.db={records:new Map(),chunks:new Map()}; BrowserCaptureStore.databases.set(name,this.db); } }
 async save(record,chunk) { this.db.records.set(record.id,structuredClone(record)); if(chunk)this.db.chunks.set(JSON.stringify([chunk.sessionId,chunk.kind,chunk.index]),structuredClone(chunk.data)); }
 async list() { return [...this.db.records.values()].map(x=>structuredClone(x)); }
 async get(id) { return structuredClone(this.db.records.get(id)); }
 async chunk(id,kind,index) { const data=this.db.chunks.get(JSON.stringify([id,kind,index]));if(!data)throw new Error('Missing chunk');return data.slice(0); }
}

import { CaptureJournal, readCaptureFrames } from './modules/journal.js';
import { captureOutcome, captureDescription, createCapture } from './modules/model.js';
import { writeCaptureArchive, captureMetadata } from './modules/export.js';
const results=[];
const assert=(condition,message)=>{if(!condition)throw new Error(message)};
const test=async(name,fn)=>{try{await fn();results.push({name,passed:true})}catch(error){results.push({name,passed:false,error:error.stack})}};
const info={mode:'meteor',frequency:137900000,sampleRate:288000,startedAt:new Date().toISOString()};
const dbname='meteor-tests-'+crypto.randomUUID();
const store=new BrowserCaptureStore(dbname);
let live, sample, empty, imageRecord;
function sink(){const parts=[];const state={closed:false,aborted:false};return{parts,state,
 async write(data){parts.push(data.slice());},async close(){state.closed=true;},async abort(){state.aborted=true;}}}
function concat(parts){const data=new Uint8Array(parts.reduce((n,x)=>n+x.length,0));let at=0;for(const part of parts){data.set(part,at);at+=part.length;}return data;}
function metrics(frames=0,segments=0){return{samples:32768,frames,segments,gaps:0,rms:0.1,clippedFraction:0};}
await test('outcomes distinguish samples, frames and images without claiming a satellite signal',async()=>{
 const rec=createCapture(info,'live',{});
 assert(captureOutcome(rec)==='no-data','zero state');
 rec.samplesReceived=32768;assert(captureOutcome(rec)==='samples-without-frames','raw state');
 assert(captureDescription(rec).title.includes('no Meteor frames'),'honest no decode title');
 rec.framesDecoded=1;assert(captureOutcome(rec)==='frames-without-image','frame state');
 rec.imageSegments=1;assert(captureOutcome(rec)==='image-packets-without-preview','segments not yet rendered');rec.image={width:1,height:1,channel:1,channels:[1]};assert(captureOutcome(rec)==='image-recovered','rendered image state');
});
await test('raw bytes are copied before worker transfer and committed with correct counters',async()=>{
 const errors=[]; const j=new CaptureJournal(store,info,'live',{},message=>errors.push(message));
 const original=new Uint8Array(65536);for(let i=0;i<original.length;i++)original[i]=i%251;
 j.raw(original.buffer,info);structuredClone(original.buffer,{transfer:[original.buffer]});
 assert(original.byteLength===0,'original transferred');j.metrics(metrics());
 j.raw(new Uint8Array(65536).fill(99).buffer,info);j.metrics(metrics());
 j.raw(new Uint8Array(65536).fill(42).buffer,{...info,frequency:137100000});j.metrics(metrics());
 live=await j.finish('Stopped by user');
 assert(errors.length===0,'no storage failure');assert(live.rawBytes===196608,'raw byte total');
 assert(live.samplesReceived===98304,'observed samples');assert(live.samplesProcessed===98304,'decoded input count');
 const saved=new Uint8Array(await store.chunk(live.id,'raw',0));
 assert(saved.length===65536&&saved[1000]===1000%251,'transferred content preserved');
 assert(live.rawRuns.length===2&&live.rawRuns[0].bytes===131072&&live.rawRuns[1].bytes===65536,'retune split');
 assert(live.frameBytes===0&&live.image===null,'no fabricated decode');
});
await test('sample replay cannot overwrite an earlier live attempt',async()=>{
 const j=new CaptureJournal(store,{...info,mode:'replay'},'sample',{},()=>{});
 j.frames(new Uint8Array(1024).fill(23).buffer);j.metrics(metrics(1,0));sample=await j.finish('Playback complete');
 const records=await store.list();assert(records.length===2,'two sessions');
 const saved=await store.get(live.id);assert(saved.rawBytes===196608&&saved.origin==='live','old live record intact');
 assert(captureMetadata(sample,true).source==='bundled-sample-replay','sample provenance');
 assert(captureMetadata(sample,true).receivedAt===null,'sample has no live acquisition time');
});
await test('zero-sample session is saved and exportable without a fake PNG or frame file',async()=>{
 const j=new CaptureJournal(store,info,'live',{},()=>{});empty=await j.finish('Stopped by user');
 assert((await store.get(empty.id)).state==='complete','zero byte retained');
 const target=sink();await writeCaptureArchive(store,empty,true,target);
 assert(target.state.closed&&!target.state.aborted,'archive finalized');globalThis.emptyZip=concat(target.parts);
});
await test('a no-image session exports all raw tuning runs and a measured report',async()=>{
 const target=sink();await writeCaptureArchive(store,live,true,target);
 assert(target.state.closed&&!target.state.aborted,'archive finalized');globalThis.liveZip=concat(target.parts);
 const meta=captureMetadata(live,true);assert(meta.outcome==='samples-without-frames','metadata outcome');
 assert(meta.rawRecording.files.length===2,'all tuning files listed');
 assert(meta.receiver.sampleRate===288000,'sample rate included');
});
await test('report-only export excludes raw bytes but records their saved size',async()=>{
 const target=sink();await writeCaptureArchive(store,live,false,target);globalThis.reportZip=concat(target.parts);
 const meta=captureMetadata(live,false);assert(meta.rawRecording.included===false&&meta.rawRecording.storedBytes===196608,'accurate omitted status');
});
await test('decoded frames and optional image survive finalization and export',async()=>{
 const png=Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII='),c=>c.charCodeAt(0));
 const j=new CaptureJournal(store,{...info,mode:'replay'},'imported',{},()=>{},'input.cadu');
 const frames=new Uint8Array(2048).fill(71);j.frames(frames.buffer);j.metrics(metrics(2,1));
 j.record.image={width:1,height:1,channel:1,channels:[1,2]};imageRecord=await j.finish('Playback complete',png.buffer);
 assert(imageRecord.imageStored,'image committed');
 assert(new Uint8Array(await readCaptureFrames(store,imageRecord))[100]===71,'frames preserved');
 const target=sink();await writeCaptureArchive(store,imageRecord,false,target);globalThis.imageZip=concat(target.parts);
});
await test('quota failure retains the committed prefix and clearly marks the session incomplete',async()=>{
 let writes=0;const errors=[];
 const failing={save:async(record,chunk)=>{if(chunk?.kind==='raw'&&++writes===2)throw new DOMException('Quota exceeded','QuotaExceededError');return store.save(record,chunk);},chunk:(...x)=>store.chunk(...x)};
 const j=new CaptureJournal(failing,info,'live',{},message=>errors.push(message));
 j.raw(new Uint8Array(65536).fill(1).buffer,info);j.raw(new Uint8Array(65536).fill(2).buffer,info);j.raw(new Uint8Array(65536).fill(3).buffer,info);
 const rec=await j.finish('Storage error');
 assert(errors.length===1,'single actionable failure');assert(rec.state==='error'&&!!rec.storageError,'error marked');
 assert(rec.rawBytes===65536&&rec.rawChunks===1&&rec.samplesReceived===98304,'only committed data claimed');
 assert((await store.get(rec.id)).rawBytes===65536,'persisted prefix metadata');
 const target=sink();await writeCaptureArchive(store,rec,true,target);assert(target.state.closed,'prefix export succeeds');
});
await test('slow storage queue is bounded and reports failure instead of dropping samples',async()=>{
 let release;const barrier=new Promise(resolve=>release=resolve);const errors=[];
 const slow={save:async(record,chunk)=>{await barrier;return store.save(record,chunk)}};
 const j=new CaptureJournal(slow,info,'live',{},message=>errors.push(message));let failed=false;
 try{for(let i=0;i<65;i++)j.raw(new Uint8Array(65536).buffer,info)}catch{failed=true}
 assert(failed&&errors.length===1,'queue overflow stopped recording');assert(j.queuedBytes<=4*1024*1024,'bounded pending memory');
 release();const rec=await j.finish('Storage too slow');assert(rec.state==='error','not called successful');
});
await test('export aborts rather than producing an apparently complete archive with a missing chunk',async()=>{
 const bad={chunk:async()=>{throw new Error('missing chunk')}};const target=sink();let failed=false;
 try{await writeCaptureArchive(bad,live,true,target)}catch{failed=true}
 assert(failed&&target.state.aborted&&!target.state.closed,'failed export aborted');
});
await test('repeated finalization joins the same promise',async()=>{
 const j=new CaptureJournal(store,info,'live',{},()=>{});
 const a=j.finish('First stop'),b=j.finish('Second stop');assert(a===b,'same completion promise');
 const rec=await a;assert(rec.stopReason==='First stop','first reason retained');
});
await test('imported radio files are not mislabelled as live or silently copied to raw storage',async()=>{
 const j=new CaptureJournal(store,{...info,mode:'iq-file'},'imported',{},()=>{},'input.cu8');
 j.raw(new Uint8Array(65536).buffer,info);j.metrics(metrics());const rec=await j.finish('Playback complete');
 assert(rec.rawBytes===0&&rec.samplesReceived===0&&rec.samplesProcessed===32768,'source samples not live');
 assert(captureMetadata(rec,true).source==='imported-iq-file','provenance');
});

console.log(JSON.stringify({environment:'Node; in-memory CaptureStore; no physical receiver',results},null,2));
if(results.some(result=>!result.passed)) throw new Error('Capture regressions failed');
