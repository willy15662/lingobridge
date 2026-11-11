import {test} from 'node:test';import assert from 'node:assert/strict';import {build} from 'esbuild';import {mkdtemp,rm} from 'node:fs/promises';import {tmpdir} from 'node:os';import {pathToFileURL} from 'node:url';
const dir=await mkdtemp(tmpdir()+'/reading-tools-');
async function load(name,path){await build({entryPoints:[path],outfile:dir+'/'+name+'.mjs',bundle:true,format:'esm',platform:'node'});return import(pathToFileURL(dir+'/'+name+'.mjs'));}
const {translateText}=await load('text','src/ui/text-translation.ts');const {translationStyle,applyTranslationStyle,maskStyles}=await load('style','src/core/styles.ts');const {defaults,settingsSchema}=await load('settings','src/core/settings.ts');const {unwrapReply}=await load('messages','src/core/messages.ts');await rm(dir,{recursive:true,force:true});
test('text workspace splits long input, preserves order and carries explicit languages',async()=>{
 const calls=[];const result=await translateText({text:'字'.repeat(60000),source:'en',target:'ja',batchSize:20},async(texts,source,target)=>{calls.push({texts,source,target});return texts.map((_,i)=>'譯'+i);});
 assert.equal(calls.length,1);assert.equal(calls[0].source,'en');assert.equal(calls[0].target,'ja');assert.equal(calls[0].texts.length,10);assert.equal(result.split('\n').length,10);
});
test('workspace edits cancel a pending response before rendering or sending another batch',async()=>{
 let current=true,calls=0;await assert.rejects(translateText({text:'字'.repeat(18000),source:'auto',target:'zh-TW',batchSize:1},async batch=>{calls++;current=false;return batch;},()=>current),/停止/);assert.equal(calls,1);
});
test('workspace rejects blank, oversized and misaligned results',async()=>{
 const input={text:'',source:'auto',target:'en',batchSize:8};await assert.rejects(translateText(input,async()=>[]),/輸入/);await assert.rejects(translateText({...input,text:'x'.repeat(60001)},async()=>[]),/60,000/);await assert.rejects(translateText({...input,text:'hello'},async()=>[]),/數量/);
});
test('themes use logical borders and configured decoration without injecting markup',()=>{
 for(const theme of settingsSchema.shape.style.shape.theme.removeDefault().options){const value=translationStyle({...defaults.style,theme});assert.equal(value.margin,'8px 0');assert.equal(value.fontSize,'100%');}
 assert.match(translationStyle({...defaults.style,theme:'blockquote'}).borderInlineStart,/3px solid/);assert.equal(translationStyle({...defaults.style,theme:'wavy'}).textDecorationStyle,'wavy');assert.equal(translationStyle({...defaults.style,theme:'plain'}).background,'transparent');
});
test('mask has keyboard access and theme switches remove old styles',()=>{
 const attrs={};const el={style:{},dataset:{},removeAttribute(name){delete attrs[name];if(name==='style')this.style={};},set tabIndex(value){attrs.tabindex=value},set title(value){attrs.title=value}};
 applyTranslationStyle(el,{...defaults.style,theme:'mask'});assert.equal(attrs.tabindex,0);assert.match(maskStyles,/:focus/);
 applyTranslationStyle(el,{...defaults.style,theme:'plain'});assert.equal(attrs.tabindex,undefined);assert.equal(el.style.cursor,undefined);
});
test('page command failures are surfaced rather than reported as a successful translation',()=>{
 assert.throws(()=>unwrapReply({ok:false,error:'page blocked'}),/page blocked/);assert.throws(()=>unwrapReply({random:true}));assert.deepEqual(unwrapReply({ok:true,data:{mode:'original'}}),{mode:'original'});
});
