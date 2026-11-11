/** Selection commands always use ordinary translation, including single words. */
import {chromium} from 'playwright-core';
import {build} from 'esbuild';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
const temp=await mkdtemp(tmpdir()+'/selection-e2e-');
await build({entryPoints:['src/content/controller.ts'],outfile:temp+'/controller.js',bundle:true,format:'iife',globalName:'Harness',target:'chrome120'});
await build({entryPoints:['src/core/settings.ts'],outfile:temp+'/settings.mjs',bundle:true,format:'esm',platform:'node'});
const {defaults,publicSettings}=await import('file://'+temp+'/settings.mjs');
let browser;
try{
 browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_PATH||undefined});
 const page=await browser.newPage({viewport:{width:720,height:650}});
 await page.setContent('<p id="phrase">managed applications</p><p id="word">managed</p><p id="long">'+'A complete sentence with several words. '.repeat(8)+'</p>');
 await page.addScriptTag({path:temp+'/controller.js'});
 await page.evaluate(settings=>{
  window.calls=[];window.controller=new Harness.PageTranslator({...settings,hover:true},async texts=>{window.calls.push(...texts);return texts.map(text=>'一般翻譯：'+text);});
 },publicSettings(defaults));
 for(const id of ['word','phrase','long']){
  const text=await page.locator('#'+id).textContent();
  await page.evaluate(id=>{const range=document.createRange();range.selectNodeContents(document.getElementById(id));getSelection().removeAllRanges();getSelection().addRange(range);},id);
  const before=await page.evaluate(()=>window.calls.length);
  await page.waitForTimeout(800);
  assert.equal(await page.locator('[data-local-translate="selection-action"],[data-local-translate="lookup-action"],[data-local-translate="lookup"]').count(),0);
  assert.equal(await page.evaluate(()=>window.calls.length),before,'highlighting alone never requests translation');
  await page.evaluate(()=>window.controller.selection());
  assert.equal(await page.evaluate(()=>window.calls.at(-1)),text.trim());
  assert.equal(await page.locator('[data-local-translate="panel"]').count(),1);
  assert.equal(await page.locator('[data-local-translate="lookup"]').count(),0,'short selection is ordinary translation too');
 }
 await page.evaluate(()=>window.controller.dispose());
 console.log('PASS selecting word/phrase/paragraph shows no icon or request; explicit selection command always uses normal translation');
}finally{await browser?.close();await rm(temp,{recursive:true,force:true});}
