import {chromium} from 'playwright-core';import {build} from 'esbuild';import {mkdtemp,rm} from 'node:fs/promises';import {tmpdir} from 'node:os';import assert from 'node:assert/strict';
const dir=await mkdtemp(tmpdir()+'/subtitle-ui-');let browser;
try{
 await build({entryPoints:['src/content/subtitles.ts'],outfile:dir+'/ui.js',bundle:true,format:'iife',globalName:'SubtitleUI'});
 browser=await chromium.launch({headless:true,...(process.env.CHROME_PATH?{executablePath:process.env.CHROME_PATH}:{})});const page=await browser.newPage();
 await page.setContent('<div class="html5-video-player"><video></video><div class="ytp-caption-window-container"><div class="caption-window"><span class="ytp-caption-segment" style="font-size:28px">Hello world</span></div></div><div class="ytp-right-controls"></div></div>');
 await page.addScriptTag({path:dir+'/ui.js'});await page.evaluate(()=>{window.translator=new SubtitleUI.SubtitleTranslator(async text=>text);translator.controls.attach();translator.render('你好世界',document.querySelector('video'));});
 assert.equal(await page.locator('.caption-window [data-local-translate="subtitle"]').textContent(),'你好世界');
 assert.equal(await page.locator('.ytp-caption-segment').evaluate(el=>getComputedStyle(el).fontSize),'28px');
 assert.equal(await page.locator('[data-local-translate="subtitle"]').evaluate(el=>getComputedStyle(el).fontSize),'28px');
 assert.equal(await page.evaluate(async()=>{const records=[];const observer=new MutationObserver(items=>records.push(...items));observer.observe(document.querySelector('.caption-window'),{childList:true,subtree:true});translator.render('你好世界',document.querySelector('video'));await Promise.resolve();observer.disconnect();return records.length;}),0);
 await page.getByRole('button',{name:'伴讀字幕設定'}).click();await page.getByLabel('字幕顯示',{exact:true}).selectOption('translated');
 await page.evaluate(()=>{translator.controls.attach();translator.render('你好世界',document.querySelector('video'));});assert.equal(await page.locator('.ytp-caption-segment').evaluate(el=>getComputedStyle(el).visibility),'hidden');
 await page.getByLabel('譯文字型大小',{exact:true}).evaluate(el=>{el.value='150';el.dispatchEvent(new Event('input',{bubbles:true}));});assert.equal(await page.locator('output').first().textContent(),'150%');
 await page.keyboard.press('Escape');assert.equal(await page.getByRole('button',{name:'伴讀字幕設定'}).getAttribute('aria-expanded'),'false');
 await page.getByRole('button',{name:'伴讀字幕設定'}).click();await page.locator('video').click({force:true});assert.equal(await page.getByRole('button',{name:'伴讀字幕設定'}).getAttribute('aria-expanded'),'false');
 await page.evaluate(()=>translator.stop());assert.equal(await page.locator('[data-local-translate]').count(),0);assert.equal(await page.locator('.ytp-caption-segment').textContent(),'Hello world');
 console.log('PASS subtitle toolbar, shared caption box, mode settings and cleanup');
}finally{await browser?.close();await rm(dir,{recursive:true,force:true});}
