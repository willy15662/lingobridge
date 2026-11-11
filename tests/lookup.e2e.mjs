/** Real browser interaction tests; lookup transport is simulated. */
import {chromium} from 'playwright-core';
import {build} from 'esbuild';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
const temp=await mkdtemp(tmpdir()+'/lookup-e2e-');
await build({entryPoints:['src/content/lookup.ts'],outfile:temp+'/lookup.js',bundle:true,format:'iife',globalName:'LookupHarness',target:'chrome120'});
await build({entryPoints:['src/core/settings.ts'],outfile:temp+'/settings.mjs',bundle:true,format:'esm',platform:'node'});
const {defaults,publicSettings}=await import('file://'+temp+'/settings.mjs');
let browser;
try{
 browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_PATH||undefined});
 const page=await browser.newPage({viewport:{width:720,height:650}});
 await page.setContent('<p id="word">managed applications</p><input value="secret"><pre>private code</pre>');
 await page.addScriptTag({path:temp+'/lookup.js'});
 await page.evaluate(settings=>{
  window.settings=settings;window.calls=0;window.saveCalls=0;window.behavior='hold';
  window.entry={pronunciation:'',sourceLanguage:'en',senses:[{partOfSpeech:'adj.',meaning:'受管理的',example:'<img src=x onerror="window.XSS=1">',translation:'受管理的應用程式。'}],contextualMeaning:'這裡指受執行階段管理。'};
  window.lookup=new LookupHarness.WordLookup(()=>window.settings,{
   lookup:async()=>{window.calls++;if(window.behavior==='hold')return new Promise(resolve=>{window.resolve=()=>resolve(window.entry);});if(window.behavior==='error'){window.behavior='success';throw Error('暫時無法查詢');}return window.entry;},
   save:async()=>{window.saveCalls++;if(window.saveCalls===1)throw Error('storage full');},open:async()=>{},
  });
 },publicSettings(defaults));
 const point=await page.evaluate(()=>{const text=document.querySelector('#word').firstChild;const range=document.createRange();range.setStart(text,0);range.setEnd(text,7);const rect=range.getBoundingClientRect();return{x:rect.left+rect.width/2,y:rect.top+rect.height/2};});
 await page.mouse.move(point.x,point.y);await page.waitForTimeout(800);assert.equal(await page.evaluate(()=>window.calls),0);
 await page.evaluate(()=>window.settings.hover=true);await page.mouse.move(point.x+1,point.y);
 await page.waitForTimeout(800);assert.equal(await page.evaluate(()=>window.calls),0,'hover without Ctrl does not send a lookup');
 await page.keyboard.down('Control');await page.waitForTimeout(250);await page.keyboard.up('Control');
 await page.waitForTimeout(650);assert.equal(await page.evaluate(()=>window.calls),0,'early Ctrl release cancels the dwell');
 // Pressing Ctrl after the pointer has stopped still starts the dwell.
 await page.keyboard.down('Control');
 const icon=page.locator('[data-local-translate="lookup-action"]');
 await icon.getByRole('button',{name:'查詢單字／片語',exact:true}).waitFor();
 assert.equal(await page.evaluate(()=>window.calls),0,'Ctrl dwell only previews the icon');
 const iconBounds=await icon.getByRole('button').boundingBox();assert.equal(iconBounds.width,28);assert.equal(iconBounds.height,28);
 await page.keyboard.up('Control');await icon.getByRole('button',{name:'查詢單字／片語',exact:true}).click();
 await page.waitForFunction(()=>window.calls===1);
 await page.keyboard.press('Escape');await page.evaluate(()=>window.resolve());await page.waitForTimeout(50);
 assert.equal(await page.locator('[data-local-translate="lookup"]').count(),0);
 await page.evaluate(()=>{window.behavior='error';void window.lookup.show({term:'managed',context:'managed applications'},{left:20,top:40,bottom:60});});
 const card=page.locator('[data-local-translate="lookup"]');
 await card.getByRole('button',{name:'重新查詢',exact:true}).click();
 await page.waitForFunction(()=>document.querySelector('[data-local-translate="lookup"]')?.shadowRoot?.querySelector('footer button')?.disabled===false);
 assert.equal(await card.locator('img').count(),0);assert.equal(await page.evaluate(()=>window.XSS),undefined);
 assert.match(await card.locator('.example').textContent(),/<img/);
 await card.getByRole('button',{name:'加入單字本',exact:true}).click();
 await page.waitForFunction(()=>document.querySelector('[data-local-translate="lookup"]')?.shadowRoot?.textContent.includes('儲存失敗'));
 await card.getByRole('button',{name:'加入單字本',exact:true}).click();
 await card.getByRole('button',{name:'已加入單字本',exact:true}).waitFor();
 await page.setViewportSize({width:320,height:500});
 await page.evaluate(()=>{window.lookup.close();void window.lookup.show({term:'managed',context:'managed applications'},{left:300,top:480,bottom:495});});
 await page.waitForFunction(()=>document.querySelector('[data-local-translate="lookup"]')?.shadowRoot?.querySelector('footer button')?.disabled===false);
 const bounds=await card.boundingBox();assert.ok(bounds.x>=0&&bounds.x+bounds.width<=320&&bounds.y>=0&&bounds.y+bounds.height<=500);
 await page.evaluate(()=>{window.lookup.close();window.settings.blockSites=[location.hostname];void window.lookup.show({term:'blocked',context:''});});
 assert.equal(await card.count(),0);
 await page.evaluate(()=>window.lookup.dispose());
 console.log('PASS Ctrl dwell, no ordinary-hover request, early-release cancellation, hover opt-in, late response cancellation, retry, inert HTML, save retry, small viewport, blocked site');
}finally{await browser?.close();await rm(temp,{recursive:true,force:true});}
