import {test} from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
const temp=await mkdtemp(join(tmpdir(),'local-translate-content-'));
await build({entryPoints:['src/content/dom.ts'],outfile:join(temp,'dom.mjs'),bundle:true,format:'esm',platform:'node'});
const {splitText,restoreText,replaceText,changed,isExcluded,isAd}=await import(pathToFileURL(join(temp,'dom.mjs')).href);
await build({entryPoints:['src/content/controller.ts'],outfile:join(temp,'controller.mjs'),bundle:true,format:'esm',platform:'node'});
const {PageTranslator}=await import(pathToFileURL(join(temp,'controller.mjs')).href);
await build({entryPoints:['src/content/interaction.ts'],outfile:join(temp,'interaction.mjs'),bundle:true,format:'esm',platform:'node'});
const {translationDirection}=await import(pathToFileURL(join(temp,'interaction.mjs')).href);
await rm(temp,{recursive:true,force:true});
test('long non-space multilingual content respects provider request limit without breaking surrogate pairs',()=>{
 const input='閱讀😊'.repeat(3200);const chunks=splitText(input,6000);assert.equal(chunks.join(''),input);assert.ok(chunks.every(c=>c.length<=6000));assert.ok(chunks.every(c=>!/[\uD800-\uDBFF]$/.test(c)&&!(/^[\uDC00-\uDFFF]/.test(c))));
});
test('restoration preserves framework changes made while translated text was showing',()=>{
 const first={data:'original',isConnected:true};const second={data:' link',isConnected:true};const nodes=[{node:first,original:first.data,written:null},{node:second,original:second.data,written:null}];
 replaceText(nodes,'譯文');assert.equal(first.data,'譯文');assert.equal(second.data,'');assert.equal(changed(nodes),false);
 first.data='new route title';assert.equal(changed(nodes),true);restoreText(nodes);assert.equal(first.data,'new route title');assert.equal(second.data,' link');assert.ok(nodes.every(n=>n.written===null));
});
test('mode round trip restores exact whitespace and retains text-node identities',()=>{
 const first={data:' Hello ',isConnected:true};const second={data:'world!\n',isConnected:true};const nodes=[{node:first,original:first.data,written:null},{node:second,original:second.data,written:null}];
 replaceText(nodes,'你好世界');restoreText(nodes);assert.equal(first.data,' Hello ');assert.equal(second.data,'world!\n');assert.equal(nodes[0].node,first);assert.equal(changed(nodes),false);
});
test('detached source invalidates pending output',()=>{assert.equal(changed([{node:{data:'hello',isConnected:false},original:'hello',written:null}]),true);});

test('maximum configured batch size stays below worker aggregate character limit',async()=>{
 const calls=[];const texts=Array.from({length:20},(_,index)=>String(index).padStart(2,'0')+'文'.repeat(11998));
 const output=await PageTranslator.prototype.translateLong.call({settings:{batchSize:20},translate:async batch=>{calls.push(batch);return batch.map(text=>text);}},texts);
 assert.ok(calls.length>=4);assert.ok(calls.every(batch=>batch.length<=20&&batch.reduce((sum,text)=>sum+text.length,0)<=60000));
 assert.equal(output.length,texts.length);assert.deepEqual(output.map(text=>text.replaceAll(' ','')),texts);
});

test('translated wrappers choose RTL for Arabic/Hebrew and respect explicit Latin scripts',()=>{
 assert.equal(translationDirection('ar-SA'),'rtl');assert.equal(translationDirection('he'),'rtl');assert.equal(translationDirection('fa'),'rtl');assert.equal(translationDirection('az-Arab'),'rtl');assert.equal(translationDirection('az-Latn'),'ltr');assert.equal(translationDirection('zh-TW'),'ltr');
});

test('stopping page translation prevents billing subsequent chunks',async()=>{
 let current=true;let count=0;
 await assert.rejects(PageTranslator.prototype.translateLong.call({settings:{batchSize:1},translate:async batch=>{count++;current=false;return batch;}},['x'.repeat(18000)],()=>current),/已停止/);
 assert.equal(count,1);
});

test('ad containers and video ad players are excluded from text, image and subtitle translation',()=>{
 let matched='';
 const element={closest(selector){matched=selector;return selector.includes('.ad-showing')&&selector.includes('ins.adsbygoogle')?{}:null;}};
 assert.equal(isExcluded(element),true);
 assert.equal(isAd(element),true);
 assert.match(matched,/adsbygoogle/);
 assert.match(matched,/ad-showing/);
});
