import {test} from 'node:test';import assert from 'node:assert/strict';import {build} from 'esbuild';import {mkdtemp,rm} from 'node:fs/promises';import {tmpdir} from 'node:os';import {pathToFileURL} from 'node:url';
const dir=await mkdtemp(tmpdir()+'/caption-timeline-');await build({entryPoints:['src/content/caption-timeline.ts'],outfile:dir+'/timeline.mjs',bundle:true,platform:'node',format:'esm'});
const {parseCaptionTimeline,activeCaption,captionWindow,captionURL,loadYouTubeTimeline}=await import(pathToFileURL(dir+'/timeline.mjs'));await rm(dir,{recursive:true,force:true});
test('json3 timestamps and segments become timed captions; empty events skipped',()=>{
 const cues=parseCaptionTimeline({events:[{tStartMs:5000,dDurationMs:2000,segs:[{utf8:'next'}]},{tStartMs:1000,dDurationMs:3000,segs:[{utf8:'Hello '},{utf8:'world'}]},{tStartMs:0}]});
 assert.deepEqual(cues,[{start:1,end:4,text:'Hello world'},{start:5,end:7,text:'next'}]);
 assert.equal(activeCaption(cues,1)?.text,'Hello world');assert.equal(activeCaption(cues,4),undefined);assert.equal(activeCaption(cues,5)?.text,'next');assert.equal(activeCaption(cues,0),undefined);
 assert.throws(()=>parseCaptionTimeline({events:[{tStartMs:-1}]}));
});
test('rolling caption latest start wins and seeking selects the new time window',()=>{
 const cues=[{start:0,end:10,text:'old'},{start:3,end:7,text:'new'},{start:150,end:160,text:'seek'}];
 assert.equal(activeCaption(cues,4)?.text,'new');assert.deepEqual(captionWindow(cues,150,new Map()),['seek']);assert.deepEqual(captionWindow(cues,0,new Map([['old','舊']])),['new']);
});
test('prefetch bounded to 90 seconds, 12 unique cues and 24000 characters',()=>{
 const cues=Array.from({length:200},(_,i)=>({start:i,end:i+1,text:'line '+i}));assert.equal(captionWindow(cues,0,new Map()).length,12);
 assert.deepEqual(captionWindow([{start:100,end:101,text:'later'}],0,new Map()),[]);
 assert.equal(captionWindow([{start:0,end:1,text:'a'.repeat(12000)},{start:1,end:2,text:'b'.repeat(12000)},{start:2,end:3,text:'c'}],0,new Map()).length,2);
});
test('caption URL matches current video, selected language and same-origin timedtext only',()=>{
 const page=new URL('https://www.youtube.com/watch?v=fixture');const info={videoId:'fixture',language:'en',tracks:[{languageCode:'ja',baseUrl:'https://www.youtube.com/api/timedtext?lang=ja'},{languageCode:'en',baseUrl:'https://www.youtube.com/api/timedtext?lang=en&sig=test'}]};
 const url=captionURL(info,page);assert.equal(url.searchParams.get('lang'),'en');assert.equal(url.searchParams.get('sig'),'test');assert.equal(url.searchParams.get('fmt'),'json3');
 assert.equal(captionURL({...info,videoId:'other'},page),null);
 for(const baseUrl of ['https://evil.test/api/timedtext','https://www.youtube.com/account','https://user:pass@www.youtube.com/api/timedtext'])assert.equal(captionURL({...info,tracks:[{languageCode:'en',baseUrl}]},page),null);
});

test('loads same-origin subtitle track through metadata RPC without any API key',async()=>{
 const original={chrome:globalThis.chrome,location:globalThis.location,fetch:globalThis.fetch};
 globalThis.location={href:'https://www.youtube.com/watch?v=fixture'};
 globalThis.chrome={runtime:{sendMessage:async request=>{assert.equal(request.kind,'captions.info');return {ok:true,data:{videoId:'fixture',tracks:[{languageCode:'en',baseUrl:'https://www.youtube.com/api/timedtext?sig=test'}]}};}}};
 globalThis.fetch=async(url,options)=>{assert.equal(url.pathname,'/api/timedtext');assert.equal(options.redirect,'error');assert.equal(options.headers,undefined);return Response.json({events:[{tStartMs:1000,dDurationMs:1000,segs:[{utf8:'hello'}]}]});};
 try{assert.deepEqual(await loadYouTubeTimeline(new AbortController().signal),[{start:1,end:2,text:'hello'}]);}
 finally{Object.assign(globalThis,original);}
});
test('subtitle download rejects oversized payloads and access errors',async()=>{
 const original={chrome:globalThis.chrome,location:globalThis.location,fetch:globalThis.fetch};
 globalThis.location={href:'https://www.youtube.com/watch?v=fixture'};
 globalThis.chrome={runtime:{sendMessage:async()=>({ok:true,data:{videoId:'fixture',tracks:[{languageCode:'en',baseUrl:'https://www.youtube.com/api/timedtext'}]}})}};
 try{for(const response of [new Response('',{status:403}),new Response('',{headers:{'content-length':'5000001'}})]){globalThis.fetch=async()=>response;await assert.rejects(loadYouTubeTimeline(new AbortController().signal),/字幕軌/);}}
 finally{Object.assign(globalThis,original);}
});
