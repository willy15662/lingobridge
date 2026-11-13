import {test} from 'node:test';import assert from 'node:assert/strict';import {build} from 'esbuild';import {mkdtemp,rm} from 'node:fs/promises';import {tmpdir} from 'node:os';import {pathToFileURL} from 'node:url';
const dir=await mkdtemp(tmpdir()+'/translate-subtitle-');
await build({entryPoints:['src/content/subtitles.ts'],outfile:dir+'/subtitles.mjs',bundle:true,platform:'node',format:'esm'});
const {SubtitleTranslator}=await import(pathToFileURL(dir+'/subtitles.mjs'));await rm(dir,{recursive:true,force:true});
const settled=()=>new Promise(resolve=>setImmediate(resolve));
function fixture(){const calls=[];const renders=[];const translator=new SubtitleTranslator(texts=>new Promise((resolve,reject)=>calls.push({texts,resolve,reject})));translator.controls.attach=()=>{};const video={};translator.activeVideo=video;translator.mediaKey='fixture';translator.playback=()=>({video,key:'fixture'});translator.current=()=>({text:'Caption',video});translator.render=text=>renders.push(text);return {translator,calls,renders};}
test('settings restart issues a fresh caption request and ignores old failures',async()=>{
 const {translator,calls,renders}=fixture();translator.tick();translator.stop();translator.tick();assert.equal(calls.length,2);
 calls[0].reject(Error('old request'));await settled();assert.equal(translator.retryAfter,0);assert.equal(translator.inFlight.size,1);
 calls[1].resolve(['新譯文']);await settled();assert.deepEqual(renders,['新譯文']);assert.equal(translator.inFlight.size,0);
});
test('late old success cannot delete new in-flight work or cache a stale caption',async()=>{
 const {translator,calls,renders}=fixture();translator.tick();translator.stop();translator.tick();
 calls[0].resolve(['舊譯文']);await settled();assert.equal(translator.cache.size,0);assert.equal(translator.inFlight.size,1);translator.tick();assert.equal(calls.length,2);
 calls[1].resolve(['新譯文']);await settled();assert.deepEqual(renders,['新譯文']);
});
test('fallback never accumulates requests as visible captions advance',async()=>{
 const {translator,calls}=fixture();translator.tick();translator.current=()=>({text:'second',video:{}});translator.tick();assert.equal(calls.length,1);calls[0].resolve(['first']);await settled();translator.tick();assert.equal(calls.length,2);assert.deepEqual(calls[1].texts,['second']);calls[1].resolve(['second']);await settled();
});
test('prefetched captions display by video time and seeking prioritizes a new window',async()=>{
 const previous=globalThis.document;globalThis.document={querySelector:()=>null};
 try{const {translator,calls,renders}=fixture();translator.current=()=>null;
 const video={currentTime:0,isConnected:true,ended:false};translator.activeVideo=video;translator.playback=()=>({video,key:'fixture'});translator.timelineVideo=video;translator.timeline=[{start:0,end:2,text:'first'},{start:2,end:4,text:'second'},{start:150,end:155,text:'seek'}];
 translator.tick();assert.deepEqual(calls[0].texts,['first','second']);calls[0].resolve(['第一','第二']);await settled();video.currentTime=2.5;translator.tick();assert.equal(renders.at(-1),'第二');assert.equal(calls.length,1);
 video.currentTime=151;translator.tick();assert.deepEqual(calls[1].texts,['seek']);calls[1].resolve(['快轉']);await settled();translator.tick();assert.equal(renders.at(-1),'快轉');
 }finally{globalThis.document=previous;}
});
test('stopped prefetch cannot populate a new session',async()=>{
 const {translator,calls}=fixture();translator.prefetch(['old']);translator.stop();calls[0].resolve(['舊']);await settled();assert.equal(translator.cache.size,0);
});

test('paused playback does not prefetch or request new captions',()=>{
 const {translator,calls}=fixture();translator.playback=()=>null;translator.tick();assert.equal(calls.length,0);
});

test('ad videos are ignored by subtitle playback detection and empty YouTube timeline retries',async()=>{
 const previousDoc=globalThis.document;const previousLoc=globalThis.location;
 const adVideo={paused:false,ended:false,currentSrc:'blob:ad',getBoundingClientRect:()=>({width:400}),closest:sel=>sel.includes('.ad-showing')?{}:null};
 const mainVideo={paused:false,ended:false,currentSrc:'blob:main',getBoundingClientRect:()=>({width:400}),closest:()=>null};
 globalThis.document={querySelectorAll:()=>[adVideo,mainVideo],querySelector:()=>null};
 globalThis.location={href:'https://music.youtube.com/watch?list=1&v=abc',hostname:'music.youtube.com',pathname:'/watch'};
 try{
  const translator=new SubtitleTranslator(async()=>[]);
  const detected=translator.playback();
  assert.equal(detected?.video,mainVideo);
  assert.equal(translator.isYouTubeWatch(),true);
 }finally{globalThis.document=previousDoc;globalThis.location=previousLoc;}
});
test('seek current cue can request translation while lookahead is pending, with bounded urgent work',async()=>{
 const {translator,calls}=fixture();translator.current=()=>null;const video={currentTime:0,isConnected:true,ended:false};translator.activeVideo=video;translator.playback=()=>({video,key:'fixture'});translator.timelineVideo=video;translator.timeline=[{start:0,end:4,text:'first'},{start:150,end:155,text:'seek'}];
 translator.tick();assert.deepEqual(calls[0].texts,['first']);video.currentTime=151;translator.tick();assert.deepEqual(calls[1].texts,['seek']);translator.tick();assert.equal(calls.length,2);calls[1].resolve(['快轉']);calls[0].resolve(['第一']);await settled();assert.equal(translator.urgent,false);
});

test('disabled or original mode blocks late rendering at the rendering boundary',()=>{
 const translator=new SubtitleTranslator(async()=>[]);translator.overlay={hidden:false};
 translator.controls.enabled=false;translator.render('late',{});assert.equal(translator.overlay.hidden,true);
 translator.controls.enabled=true;translator.controls.mode='original';translator.overlay.hidden=false;translator.render('late',{});assert.equal(translator.overlay.hidden,true);
});

test('slow startup response already contains upcoming cues instead of chasing expired lines',async()=>{
 const {translator,calls,renders}=fixture();translator.current=()=>null;
 const video={currentTime:0,isConnected:true,ended:false};translator.activeVideo=video;translator.playback=()=>({video,key:'fixture'});translator.timelineVideo=video;
 translator.timeline=[{start:0,end:2,text:'one'},{start:2,end:4,text:'two'},{start:4,end:6,text:'three'}];
 translator.tick();assert.deepEqual(calls[0].texts,['one','two','three']);
 video.currentTime=3;calls[0].resolve(['一','二','三']);await settled();translator.tick();assert.equal(renders.at(-1),'二');
 video.currentTime=5;translator.tick();assert.equal(renders.at(-1),'三');assert.equal(calls.length,1);
});

test('prefetch respects configured provider batch size and excludes in-flight cues',()=>{
 const {translator}=fixture();translator.batchSize=()=>2;translator.timeline=Array.from({length:10},(_,i)=>({start:i,end:i+2,text:'line'+i}));translator.inFlight.set('line0',0);assert.deepEqual(translator.window(0),['line1','line2']);
});
