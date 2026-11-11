/** Real playback, TextTracks, image pixels and visibility; provider replies are fixtures. */
import {chromium} from 'playwright-core';import {build} from 'esbuild';import assert from 'node:assert/strict';
import {mkdtemp,rm,mkdir} from 'node:fs/promises';import {tmpdir} from 'node:os';
const temp=await mkdtemp(tmpdir()+'/translate-media-');
await build({entryPoints:['src/content/controller.ts'],outfile:temp+'/controller.js',bundle:true,format:'iife',globalName:'Harness',target:'chrome120'});
await build({entryPoints:['src/core/settings.ts'],outfile:temp+'/settings.mjs',bundle:true,format:'esm',platform:'node'});
const {defaults,publicSettings}=await import('file://'+temp+'/settings.mjs');let browser;
try{
 browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_PATH||undefined});
 const page=await browser.newPage({viewport:{width:1000,height:700}});
 await page.setContent('<video muted width="420" height="230"></video><p id="page-text">The page must remain in its original language.</p><img id="thumbnail" width="300" height="200">');
 await page.addScriptTag({path:temp+'/controller.js'});
 await page.evaluate(settings=>{
  window.pageCalls=[];window.captionCalls=[];window.imageCalls=[];
  chrome.runtime={sendMessage:async message=>{window.imageCalls.push(message);return{ok:true,data:{regions:[]}};}};
  window.controller=new Harness.PageTranslator({...settings,autoTranslate:true,images:true},async texts=>{window.pageCalls.push(...texts);return texts.map(text=>'頁面：'+text);},async texts=>{window.captionCalls.push(...texts);return texts.map(text=>'字幕：'+text);});
  const canvas=document.createElement('canvas');canvas.width=420;canvas.height=230;const ctx=canvas.getContext('2d');ctx.fillRect(0,0,420,230);
  document.querySelector('#thumbnail').src=canvas.toDataURL();
  const video=document.querySelector('video');video.srcObject=canvas.captureStream(10);window.streamTimer=setInterval(()=>{ctx.fillStyle=Date.now()%2?'black':'#111';ctx.fillRect(0,0,420,230);},80);
  const track=video.addTextTrack('subtitles','English','en');track.mode='disabled';track.addCue(new VTTCue(0,120,'A playing caption.'));window.track=track;
 },publicSettings(defaults));
 await page.waitForTimeout(400);assert.equal(await page.evaluate(()=>window.captionCalls.length),0,'paused video starts no translation');
 await page.evaluate(()=>document.querySelector('video').play());
 await page.waitForFunction(()=>document.querySelector('[data-local-translate="subtitle"]')?.textContent.includes('A playing caption'));
 assert.equal(await page.evaluate(()=>window.track.mode),'hidden','available subtitles load automatically even with native CC off');
 assert.equal(await page.evaluate(()=>window.controller.getMode()),'original');assert.equal(await page.evaluate(()=>window.pageCalls.length),0);
 assert.equal(await page.evaluate(()=>window.imageCalls.length),0,'video page does not OCR thumbnails');
 await page.evaluate(()=>window.controller.setMode('original'));assert.equal(await page.locator('[data-local-translate="subtitle"]').count(),1,'page original mode does not stop subtitles');
 await page.evaluate(()=>document.querySelector('video').pause());const paused=await page.evaluate(()=>window.captionCalls.length);
 await page.evaluate(()=>window.track.addCue(new VTTCue(0,120,'Added while paused.')));await page.waitForTimeout(450);
 assert.equal(await page.evaluate(()=>window.captionCalls.length),paused);
 await page.evaluate(()=>document.querySelector('video').play());await page.waitForFunction(()=>window.captionCalls.includes('Added while paused.'));
 await page.evaluate(()=>{document.querySelector('video').pause();location.hash='next-video';});
 await page.waitForFunction(()=>!document.querySelector('[data-local-translate="subtitle"]'));
 assert.equal(await page.evaluate(()=>window.pageCalls.length),0,'SPA navigation does not activate page translation');
 await page.evaluate(()=>document.querySelector('video').play());
 await page.waitForFunction(()=>document.querySelector('[data-local-translate="subtitle"]'));
 await page.evaluate(settings=>window.controller.reset({...settings,subtitles:false,images:true},'original'),publicSettings(defaults));
 assert.equal(await page.locator('[data-local-translate="subtitle"]').count(),0);assert.equal(await page.evaluate(()=>window.track.mode),'disabled');
 await page.evaluate(()=>window.controller.setMode('bilingual'));await page.waitForFunction(()=>window.pageCalls.length>0);
 await page.evaluate(()=>{window.controller.dispose();clearInterval(window.streamTimer);document.querySelector('video').srcObject.getTracks().forEach(track=>track.stop());});
 // A long comic is translated tile by tile, only when the tile is on screen.
 await page.setContent('<p id="caption">Page text stays original while images translate.</p><img id="comic" style="display:block;width:300px;height:4000px"><img id="later" style="display:block;width:300px;height:300px">');
 await page.evaluate(settings=>{
  window.pageCalls=[];window.imageCalls=[];window.readCalls=[];
  chrome.runtime={sendMessage:async message=>{
   if(message.kind==='image.translate'){window.imageCalls.push(message.data);return{ok:true,data:{regions:[{box:[100,100,400,900],source:'Hello reader',translation:'讀者你好'}]}};}
   window.readCalls.push(message);return{ok:false,error:'unexpected read'};
  }};
  window.controller=new Harness.PageTranslator({...settings,autoTranslate:true,images:true,subtitles:false},async texts=>{window.pageCalls.push(...texts);return texts;});
  const canvas=document.createElement('canvas');canvas.width=300;canvas.height=4000;const ctx=canvas.getContext('2d');ctx.fillStyle='white';ctx.fillRect(0,0,300,4000);ctx.fillStyle='black';ctx.font='24px sans-serif';for(let y=80;y<4000;y+=450)ctx.fillText('Hello reader',40,y);
  document.querySelector('#comic').src=canvas.toDataURL();canvas.height=300;ctx.fillStyle='white';ctx.fillRect(0,0,300,300);ctx.fillStyle='black';ctx.fillText('Later image',40,60);document.querySelector('#later').src=canvas.toDataURL();
 },publicSettings(defaults));
 await page.waitForFunction(()=>window.imageCalls.length===2);await page.waitForTimeout(300);
 assert.equal(await page.evaluate(()=>window.pageCalls.length),0);assert.equal(await page.evaluate(()=>window.controller.getMode()),'original');
 assert.equal(await page.evaluate(()=>window.imageCalls.length),2,'below-fold image and lower comic tiles are not sent');
 const dimensions=await page.evaluate(async()=>Promise.all(window.imageCalls.map(async data=>{const image=new Image();image.src=data;await image.decode();return{w:image.naturalWidth,h:image.naturalHeight};})));
 assert.ok(dimensions.every(d=>d.w===300&&d.h===450));
 const overlay=page.locator('[data-local-translate="image"]');assert.match(await overlay.locator('.region').first().textContent(),/讀者你好/);
 await overlay.getByRole('button',{name:'顯示原圖',exact:true}).click();assert.equal(await overlay.locator('.region').count(),0);
 await overlay.getByRole('button',{name:'顯示譯文',exact:true}).click();assert.ok(await overlay.locator('.region').count()>0);
 await page.evaluate(()=>window.scrollTo(0,1000));await page.waitForFunction(()=>window.imageCalls.length>2);
 const before=await page.evaluate(()=>window.imageCalls.length);await page.evaluate(()=>window.scrollTo(0,0));await page.waitForTimeout(400);assert.equal(await page.evaluate(()=>window.imageCalls.length),before,'translated tiles are not requested twice');
 await mkdir('evidence',{recursive:true});await page.screenshot({path:'evidence/media-image-overlay.png',fullPage:false});
 await page.evaluate(settings=>window.controller.reset({...settings,images:false,subtitles:false},'original'),publicSettings(defaults));assert.equal(await overlay.count(),0);
 await page.evaluate(settings=>{
  chrome.runtime.sendMessage=message=>new Promise(resolve=>{window.resolveImage=()=>resolve({ok:true,data:{regions:[{box:[0,0,500,1000],source:'stale',translation:'遲到的舊譯文'}]}});});
  window.controller.reset({...settings,images:true,subtitles:false},'original');
 },publicSettings(defaults));
 await page.waitForFunction(()=>typeof window.resolveImage==='function');
 await page.evaluate(settings=>{window.controller.reset({...settings,images:false,subtitles:false},'original');window.resolveImage();},publicSettings(defaults));
 await page.waitForTimeout(200);assert.equal(await overlay.count(),0,'late OCR response cannot reinsert output after disabling images');
 await page.evaluate(()=>window.controller.dispose());
 console.log('PASS playback auto-subtitles, pause/resume, independent page modes, no thumbnail OCR, visible-only comic tiles, original toggle, tile reuse and setting-off cleanup');
}finally{await browser?.close();await rm(temp,{recursive:true,force:true});}
