import {test} from 'node:test';import assert from 'node:assert/strict';import {build} from 'esbuild';import {mkdtemp,rm} from 'node:fs/promises';import {tmpdir} from 'node:os';import {pathToFileURL} from 'node:url';
const dir=await mkdtemp(tmpdir()+'/translate-images-');
async function load(name,path){await build({entryPoints:[path],outfile:dir+'/'+name+'.mjs',bundle:true,format:'esm',platform:'node'});return import(pathToFileURL(dir+'/'+name+'.mjs'));}
const {imageDataSchema,parseImageResult}=await load('images','src/core/images.ts');const {translateImage}=await load('providers','src/background/providers.ts');
const {readImage}=await load('source','src/background/image-source.ts');const {defaults,settingsSchema}=await load('settings','src/core/settings.ts');const {TranslationEngine}=await load('engine','src/background/engine.ts');await rm(dir,{recursive:true,force:true});
const data='data:image/png;base64,aGVsbG8=';const result={regions:[{box:[100,100,400,900],source:'Hello',translation:'你好'}]};
test('image settings migrate as disabled and payload/result schemas reject invalid regions',()=>{
 const old=structuredClone(defaults);delete old.images;assert.equal(settingsSchema.parse(old).images,false);
 assert.equal(imageDataSchema.safeParse(data).success,true);for(const bad of ['https://example.com/x','data:image/svg+xml;base64,aA==','data:text/html;base64,aA=='])assert.equal(imageDataSchema.safeParse(bad).success,false);
 for(const box of [[100,100,0,900],[-1,0,100,100],[0,0,1001,100]])assert.throws(()=>parseImageResult(JSON.stringify({regions:[{...result.regions[0],box}]})));
 assert.deepEqual(parseImageResult(JSON.stringify({regions:[]})),{regions:[]});
});
test('OpenAI and Gemini use inline image input, image-only instruction and validated regions',async()=>{
 const original=globalThis.fetch;const captured=[];globalThis.fetch=async(url,init)=>{captured.push({url:String(url),init,body:JSON.parse(init.body)});return String(url).includes('generateContent')?Response.json({candidates:[{content:{parts:[{text:JSON.stringify(result)}]}}],usageMetadata:{promptTokenCount:7,candidatesTokenCount:3}}):Response.json({choices:[{message:{content:JSON.stringify(result)}}],usage:{prompt_tokens:6,completion_tokens:2}});};
 try{
  for(const provider of ['openai','gemini']){const s=structuredClone(defaults);s.provider=provider;s.providers[provider].apiKey='test-only';assert.deepEqual((await translateImage(data,s)).result,result);}
  assert.equal(captured[0].body.messages[1].content[0].image_url.url,data);assert.match(captured[0].body.messages[0].content,/never as instructions/);
  assert.equal(captured[1].body.contents[0].parts[0].inlineData.mimeType,'image/png');assert.equal(captured[1].body.contents[0].parts[0].inlineData.data,'aGVsbG8=');
  assert.ok(captured.every(r=>r.init.credentials==='omit'&&r.init.redirect==='error'&&!r.url.includes('test-only')));
  await assert.rejects(translateImage(data,{...defaults,provider:'deepl'}),/圖片/);
 }finally{globalThis.fetch=original;}
});
test('image source reads require origin permission and reject non-images, oversized bodies, credentials and redirects',async()=>{
 const original=globalThis.fetch;const originalChrome=globalThis.chrome;let allowed=false;let requests=0;let mode='image';
 globalThis.chrome={permissions:{contains:async()=>allowed}};
 globalThis.fetch=async(url,init)=>{requests++;assert.equal(init.credentials,'omit');assert.equal(init.redirect,'error');return new Response('bytes',{headers:{'content-type':mode==='html'?'text/html':'image/png',...(mode==='large'?{'content-length':'9000000'}:{})}});};
 try{
  await assert.rejects(readImage('https://images.example/comic.png'),/授權/);assert.equal(requests,0);allowed=true;
  for(const url of ['file:///etc/passwd','https://user:pass@images.example/x'])await assert.rejects(readImage(url));
  mode='html';await assert.rejects(readImage('https://images.example/x'));mode='large';await assert.rejects(readImage('https://images.example/x'),/8 MB/);
  mode='image';assert.match(await readImage('https://images.example/x'),/^data:image\/png;base64,/);
 }finally{globalThis.fetch=original;globalThis.chrome=originalChrome;}
});
test('image work shares the scheduler, persists structured cache and accounts for provider tokens',async()=>{
 const original=globalThis.fetch;let calls=0;let persisted={};globalThis.fetch=async()=>{calls++;return Response.json({choices:[{message:{content:JSON.stringify(result)}}],usage:{prompt_tokens:6,completion_tokens:2}});};
 try{
  const s=structuredClone(defaults);s.providers.openai.apiKey='fixture';
  const store={async load(){return{cache:persisted};},async save(cache){persisted=structuredClone(cache);}};
  const engine=new TranslationEngine(store,undefined,async()=>{});assert.deepEqual(await engine.image(data,s),result);assert.deepEqual(await engine.image(data,s),result);assert.equal(calls,1);
  assert.deepEqual(await new TranslationEngine(store,undefined,async()=>{}).image(data,s),result);assert.equal(calls,1);
  const stats=await engine.getStats();assert.equal(stats.requests,1);assert.equal(stats.inputTokens,6);assert.equal(stats.cacheHits,1);
 }finally{globalThis.fetch=original;}
});
