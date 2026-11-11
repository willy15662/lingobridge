import {test} from 'node:test';import assert from 'node:assert/strict';import {build} from 'esbuild';import vm from 'node:vm';
const {outputFiles}=await build({entryPoints:['src/background/worker.ts'],bundle:true,write:false,format:'iife',platform:'browser'});
let listener;let access;let commandListener;const broadcasts=[];const panels=[];const stored={};const events={addListener(){}};
const chrome={runtime:{id:'test-extension',getURL:p=>'chrome-extension://test-extension/'+p,onMessage:{addListener(fn){listener=fn;}},onInstalled:events},storage:{local:{async setAccessLevel(v){access=v.accessLevel;},async get(keys){const names=keys===null?Object.keys(stored):typeof keys==='string'?[keys]:keys;return Object.fromEntries(names.map(k=>[k,stored[k]]));},async set(v){Object.assign(stored,structuredClone(v));},async remove(keys){for(const key of Array.isArray(keys)?keys:[keys])delete stored[key];}}},permissions:{onAdded:events,onRemoved:events,async contains(){return false;}},commands:{onCommand:{addListener(fn){commandListener=fn;}}},sidePanel:{async open(options){panels.push(options);}},tabs:{async query(){return [{id:1},{id:2}]},async sendMessage(id,message){broadcasts.push({id,message});return {ok:true,data:null};}},contextMenus:{onClicked:events}};
vm.runInNewContext(outputFiles[0].text,{chrome,URL,TextEncoder,crypto,AbortSignal,structuredClone,setTimeout,clearTimeout,console});
async function send(message,trusted=true){return new Promise(resolve=>listener(message,{id:'test-extension',url:trusted?'chrome-extension://test-extension/options.html':'https://example.com',...(trusted?{}:{tab:{id:1}})},resolve));}
test('worker restricts local storage before accepting settings requests',async()=>{const r=await send({kind:'settings.get'});assert.equal(access,'TRUSTED_CONTEXTS');assert.equal(r.ok,true);assert.equal(r.data.provider,'openai');});
test('content sender cannot read keys, save settings, clear data or obtain stats',async()=>{for(const kind of ['settings.get','stats.get','data.reset','cache.clear']){const r=await send({kind},false);assert.equal(r.ok,false,kind);}const r=await send({kind:'settings.public'},false);assert.equal(r.ok,true);assert.equal('providers' in r.data,false);});
test('worker validates malformed requests before touching state',async()=>{const r=await send({kind:'translate',texts:[42]},false);assert.equal(r.ok,false);assert.equal(Object.keys(stored).length,0);});
test('API requests require explicit endpoint permission',async()=>{const r=await send({kind:'translate',texts:['hello']},false);assert.equal(r.ok,false);assert.match(r.error,/授權/);});
test('page cannot save forged provider credentials',async()=>{const settings=(await send({kind:'settings.get'})).data;settings.providers.openai.apiKey='private-key';const saved=await send({kind:'settings.save',settings},false);assert.equal(saved.ok,false);assert.equal(stored.settings,undefined);assert.equal((await send({kind:'settings.save',settings})).ok,true);const publicReply=await send({kind:'settings.public'},false);assert.equal(JSON.stringify(publicReply).includes('private-key'),false);});
test('external sender is rejected',async()=>{const r=await new Promise(resolve=>listener({kind:'settings.public'},{id:'unrelated',url:'https://example.com'},resolve));assert.equal(r.ok,false);});

test('settings broadcast contains only public fields, never API keys',async()=>{
 broadcasts.length=0;const value=(await send({kind:'settings.get'})).data;value.providers.gemini.apiKey='secret-gemini';value.blockSites=['example.com'];
 assert.equal((await send({kind:'settings.save',settings:value})).ok,true);assert.equal(broadcasts.length,2);assert.equal(broadcasts[0].message.kind,'settings.updated');assert.equal(JSON.stringify(broadcasts).includes('secret-gemini'),false);assert.equal('providers' in broadcasts[0].message.settings,false);
});
test('Alt+S opens sidepanel directly from command gesture without webpage injection',()=>{
 commandListener('open-side-panel',{id:9});assert.deepEqual(panels.map(p=>p.tabId),[9]);
});
test('caption metadata requests cannot execute script on non-YouTube tabs',async()=>{
 const result=await send({kind:'captions.info'},false);assert.equal(result.ok,false);assert.match(result.error,/字幕來源/);
});
test('caption metadata bridge targets sender tab and returns only caption metadata',async()=>{
 let captured;chrome.scripting={async executeScript(options){captured=options;return [{result:{videoId:'fixture',tracks:[]}}];}};
 const result=await new Promise(resolve=>listener({kind:'captions.info'},{id:'test-extension',url:'https://www.youtube.com/watch?v=fixture',tab:{id:42}},resolve));
 assert.equal(result.ok,true);assert.equal(captured.target.tabId,42);assert.equal(captured.world,'MAIN');
 const previous=globalThis.document;globalThis.document={getElementById:()=>({getPlayerResponse:()=>({videoDetails:{videoId:'fixture'},captions:{playerCaptionsTracklistRenderer:{captionTracks:[]}},privateField:'not exported'})})};
 // Execute the actual serialized browser function in its own page-world fixture.
 const value=vm.runInNewContext('('+captured.func.toString()+')()',{document:globalThis.document});globalThis.document=previous;
 assert.equal(value.videoId,'fixture');assert.equal('privateField' in value,false);
});
test('PDF page commands open document workspace instead of injecting webpage translator',async()=>{
 const oldQuery=chrome.tabs.query,oldCreate=chrome.tabs.create,oldScript=chrome.scripting;const opened=[];
 chrome.tabs.create=async options=>{opened.push(options.url);};chrome.scripting={executeScript:async()=>{throw Error('must not inject');}};
 try{for(const url of ['file:///private/book.pdf','https://example.com/book.pdf']){chrome.tabs.query=async()=>[{id:1,url}];const reply=await send({kind:'page.mode',mode:'bilingual'});assert.equal(reply.ok,true);assert.equal(reply.data.document,true);}
 assert.equal(opened[0],'chrome-extension://test-extension/documents.html#local-pdf');assert.match(opened[1],/#pdf=https%3A/);
 }finally{chrome.tabs.query=oldQuery;chrome.tabs.create=oldCreate;chrome.scripting=oldScript;}
});

test('content can save its own lookup but cannot list, review or delete the vocabulary notebook',async()=>{
 const entry={pronunciation:'',sourceLanguage:'en',senses:[{partOfSpeech:'adj.',meaning:'受管理的',example:'A managed server.',translation:'受管理的伺服器。'}],contextualMeaning:'這裡指受管理的程式。'};
 const draft={term:'managed',context:'managed applications',target:'zh-TW',entry};
 const content=message=>new Promise(resolve=>listener(message,{id:'test-extension',url:'https://allowed.example/article',tab:{id:1}},resolve));
 const saved=await content({kind:'vocabulary.save',draft});assert.equal(saved.ok,true);assert.equal(saved.data.url,'https://allowed.example/article');
 assert.equal((await content({kind:'vocabulary.list'})).ok,false);
 assert.equal((await content({kind:'vocabulary.review',id:saved.data.id,remembered:true})).ok,false);
 assert.equal((await content({kind:'vocabulary.remove',id:saved.data.id})).ok,false);
 const list=await send({kind:'vocabulary.list'});assert.equal(list.ok,true);assert.equal(list.data.length,1);
 assert.equal((await content({kind:'vocabulary.save',draft:{...draft,entry:{...entry,senses:[]}}})).ok,false);
 assert.equal((await send({kind:'vocabulary.save',draft},false)).ok,false); // example.com is blocked above
 assert.equal((await send({kind:'vocabulary.remove',id:'settings'})).ok,false);
 assert.equal((await send({kind:'vocabulary.remove',id:saved.data.id})).ok,true);
 assert.equal((await send({kind:'vocabulary.list'})).data.length,0);
});
