import {test} from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {pathToFileURL} from 'node:url';
const dir=await mkdtemp(tmpdir()+'/vocabulary-tests-');
async function load(name,path){await build({entryPoints:[path],outfile:dir+'/'+name+'.mjs',bundle:true,format:'esm',platform:'node'});return import(pathToFileURL(dir+'/'+name+'.mjs'));}
const core=await load('core','src/core/vocabulary.ts');
const {VocabularyStore}=await load('store','src/background/vocabulary.ts');
const {TranslationEngine}=await load('engine','src/background/engine.ts');
const {defaults}=await load('settings','src/core/settings.ts');
await rm(dir,{recursive:true,force:true});
const entry={pronunciation:'/ˈmænɪdʒd/',sourceLanguage:'en',senses:[{partOfSpeech:'adj.',meaning:'受管理的',example:'The managed server is up to date.',translation:'受管理的伺服器保持最新。'}],contextualMeaning:'這裡指受執行階段管理的程式。'};
const draft={term:'managed',context:'Reverse engineer native, managed applications.',target:'zh-TW',entry};
function storage(){const data={settings:{secret:'private'}};globalThis.chrome={storage:{local:{async get(keys){return structuredClone(keys===null?data:Object.fromEntries((Array.isArray(keys)?keys:[keys]).map(key=>[key,data[key]])));},async set(value){Object.assign(data,structuredClone(value));},async remove(keys){for(const key of Array.isArray(keys)?keys:[keys])delete data[key];}}}};return data;}
test('dictionary validates bounded senses and examples instead of trusting model JSON',()=>{
 assert.deepEqual(core.parseDictionary('```json\n'+JSON.stringify(entry)+'\n```'),entry);
 assert.throws(()=>core.parseDictionary('{"senses":[]}'));
 assert.equal(core.dictionarySchema.safeParse({...entry,senses:[{...entry.senses[0],example:''}]}).success,false);
 assert.match(core.dictionaryPrompt('zh-TW'),/JSON DATA/);
});
test('concurrent saves are deduplicated and survive a fresh store instance with review progress intact',async()=>{
 const data=storage();const store=new VocabularyStore();
 const [a,b]=await Promise.all([store.save(draft,'https://example.com/article'),store.save({...draft,term:' Managed '},'https://example.com/second')]);
 assert.equal(a.id,b.id);assert.equal((await store.list()).length,1);
 const reviewed=await store.review(a.id,true);assert.equal(reviewed.interval,1);assert.equal(reviewed.reviews,1);
 const again=await store.save(draft,'https://example.com/new');assert.equal(again.reviews,1);
 assert.deepEqual(await new VocabularyStore().list(),[again]);
 await store.remove(a.id);assert.equal((await store.list()).length,0);assert.deepEqual(data.settings,{secret:'private'});
});
test('review schedules new, remembered, and forgotten words and clear only removes vocabulary',async()=>{
 const data=storage();const store=new VocabularyStore();const item=await store.save(draft,'');
 assert.ok(item.dueAt<=Date.now());const known=core.reviewed(item,true,1000);
 assert.equal(known.dueAt,1000+86400000);assert.equal(core.reviewed(known,true,1000).interval,2);
 const forgotten=core.reviewed(known,false,1000);assert.equal(forgotten.dueAt,601000);assert.equal(forgotten.interval,0);
 await store.save({...draft,term:'native'},'');await store.clear();assert.equal((await store.list()).length,0);assert.deepEqual(data.settings,{secret:'private'});
});
test('malformed dictionary output is not cached and a retry reaches the provider',async()=>{
 let calls=0;let persisted={};
 const engine=new TranslationEngine({async load(){return{};},async save(cache){persisted=structuredClone(cache);}},()=>({async translate(){calls++;return{texts:[calls===1?'{}':JSON.stringify(entry)],inputTokens:0,outputTokens:0};}}),async()=>{});
 const validate=text=>core.parseDictionary(text);
 await assert.rejects(engine.translate(['managed'],defaults,'en','zh-TW',true,validate));
 assert.equal(Object.keys(persisted).length,0);
 await engine.translate(['managed'],defaults,'en','zh-TW',true,validate);assert.equal(calls,2);
 await engine.translate(['managed'],defaults,'en','zh-TW',true,validate);assert.equal(calls,2);
});
