/** Real Chromium DOM/observer tests. Translation transport is deliberately simulated.
 * Run: CHROME_PATH=/path/to/chrome node tests/content.e2e.mjs
 * This is not evidence that an external provider works.
 */
import {chromium} from 'playwright-core';
import {build} from 'esbuild';
import assert from 'node:assert/strict';
import {mkdtemp,rm,mkdir,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
const temporary=await mkdtemp(join(tmpdir(),'content-browser-'));
const bundle=join(temporary,'content.js');
await build({entryPoints:['src/content/controller.ts'],outfile:bundle,bundle:true,format:'iife',globalName:'ContentHarness',target:'chrome120'});
const settingsBundle=join(temporary,'settings.mjs');
await build({entryPoints:['src/core/settings.ts'],outfile:settingsBundle,bundle:true,format:'esm',platform:'node'});
const {defaults,publicSettings}=await import('file://'+settingsBundle);
let browser;
const checks=[];
try{
 browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_PATH||undefined});
 const page=await browser.newPage({viewport:{width:1000,height:800}});
 await page.setContent('<!doctype html><html><body><main><p id="first">Hello <a href="#anchor" id="link">world</a>!</p><p id="second">Read a second sentence.</p><p translate="no">Do not translate this.</p><div contenteditable="true">User secret draft.</div><pre>const code = 1;</pre><div hidden><p>Hidden private content.</p></div><div inert><p>Inert background content.</p></div><p id="ruby" translate="no"><ruby>漢字<rt>かんじ</rt></ruby></p></main></body></html>');
 await page.addScriptTag({path:bundle});
 await page.evaluate(settings=>{
  window.contentCalls=[];window.linkClicks=0;document.querySelector('#link').addEventListener('click',event=>{event.preventDefault();window.linkClicks++;});
  window.controller=new ContentHarness.PageTranslator(settings,async texts=>{window.contentCalls.push(texts);return texts.map(text=>'譯文：'+text);});window.controller.setMode('bilingual');
 },publicSettings(defaults));
 await page.waitForFunction(()=>document.querySelectorAll('[data-local-translate="result"]').length===2);
 assert.equal(await page.locator('#first > [data-local-translate="result"]').count(),1);
 assert.equal(await page.locator('#first > [data-local-translate="result"]').evaluate(element=>getComputedStyle(element).backgroundColor),'rgba(0, 0, 0, 0)');
 assert.equal(await page.locator('#first > [data-local-translate="result"]').evaluate(element=>getComputedStyle(element).marginTop),'8px');
 assert.equal(await page.locator('pre [data-local-translate], [contenteditable] [data-local-translate], [translate="no"] [data-local-translate], [hidden] [data-local-translate], [inert] [data-local-translate]').count(),0);
 await page.locator('#link').click();assert.equal(await page.evaluate(()=>window.linkClicks),1);checks.push('bilingual paragraph extraction excludes editable/code/translate=no and preserves link listener');
 await page.waitForTimeout(450);const before=await page.evaluate(()=>window.contentCalls.length);await page.waitForTimeout(450);assert.equal(await page.evaluate(()=>window.contentCalls.length),before);checks.push('own DOM writes cause no repeat API requests');
 await page.evaluate(()=>{const p=document.createElement('p');p.id='dynamic';p.textContent='A dynamically inserted paragraph.';document.querySelector('main').append(p);});
 await page.waitForFunction(()=>document.querySelector('#dynamic [data-local-translate]')?.textContent.includes('dynamically'));
 await page.evaluate(()=>document.querySelector('#dynamic').firstChild.data='Changed by the application.');
 await page.waitForFunction(()=>document.querySelector('#dynamic [data-local-translate]')?.textContent.includes('Changed by'));
 await page.evaluate(()=>document.querySelector('#dynamic').append(document.createTextNode(' Newly appended text.')));
 await page.waitForFunction(()=>document.querySelector('#dynamic [data-local-translate]')?.textContent.includes('Newly appended'));
 checks.push('MutationObserver handles inserted paragraphs, changed text nodes, and new direct text nodes');
 await page.evaluate(()=>window.controller.setMode('translated'));
 assert.match(await page.locator('#first').textContent(),/^譯文：/);
 await page.evaluate(()=>window.controller.setMode('original'));
 assert.equal(await page.locator('#first').textContent(),'Hello world!');await page.locator('#link').click();assert.equal(await page.evaluate(()=>window.linkClicks),2);
 assert.equal(await page.locator('[data-local-translate="result"]').count(),0);checks.push('translated/original round trip preserves exact source text and listeners');
 // Recreate with serializable settings, then hold an in-flight provider response.
 await page.evaluate(settings=>{window.controller.dispose();window.controller=new ContentHarness.PageTranslator(settings,texts=>new Promise(resolve=>{window.resolveTranslation=()=>resolve(texts.map(()=>'遲到的譯文'));}));window.controller.setMode('bilingual');},publicSettings(defaults));
 await page.waitForFunction(()=>typeof window.resolveTranslation==='function');
 await page.evaluate(()=>{window.controller.setMode('original');window.resolveTranslation();});
 await page.waitForTimeout(200);assert.equal(await page.locator('[data-local-translate="result"]').count(),0);checks.push('late result after original mode cannot insert translated DOM');
 await page.evaluate(settings=>{window.controller.dispose();window.controller=new ContentHarness.PageTranslator(settings,async texts=>texts.map(()=>'<img src=x onerror="window.XSS=1">'));window.controller.setMode('bilingual');},publicSettings(defaults));
 await page.waitForFunction(()=>document.querySelector('[data-local-translate="result"]'));
 assert.equal(await page.locator('[data-local-translate="result"] img').count(),0);assert.equal(await page.evaluate(()=>window.XSS),undefined);checks.push('HTML-like provider response is inserted as inert text');
 // Navigation and framework reconciliation regression fixture.
 await page.evaluate(()=>window.controller.dispose());
 await page.setContent('<header><h1 id="title">API Keys</h1><nav><div id="nav">Dashboard</div></nav></header><aside><div role="tree"><div>references</div><div>SKILL.md</div></div></aside><main><p id="prose">Read this complete sentence.</p><div id="identifier">gen-lang-client-0841033463</div><div id="file">SKILL.md</div><div id="number">62</div></main>');
 await page.evaluate(settings=>{
  window.contentCalls=[];
  window.controller=new ContentHarness.PageTranslator(settings,async texts=>{window.contentCalls.push(...texts);return texts.map(text=>'譯文：'+text);});
  window.controller.setMode('bilingual');
 },publicSettings(defaults));
 await page.waitForFunction(()=>document.querySelectorAll('[data-local-translate="result"]').length===3);
 assert.equal(await page.locator('#title [data-local-translate]').evaluate(el=>getComputedStyle(el).display),'inline');
 assert.equal(await page.locator('#nav [data-local-translate]').evaluate(el=>getComputedStyle(el).display),'inline');
 assert.equal(await page.locator('#prose [data-local-translate]').evaluate(el=>getComputedStyle(el).display),'block');
 assert.equal(await page.locator('[role="tree"] [data-local-translate],#identifier [data-local-translate],#file [data-local-translate],#number [data-local-translate]').count(),0);
 const callsBefore=await page.evaluate(()=>window.contentCalls.length);
 await page.evaluate(()=>{
  document.querySelector('#nav [data-local-translate]').remove();
  document.querySelector('#title').setAttribute('translate','yes');
 });
 await page.waitForTimeout(400);
 assert.equal(await page.locator('#nav [data-local-translate]').count(),0);
 assert.equal(await page.evaluate(()=>window.contentCalls.length),callsBefore);
 checks.push('compact navigation stays inline; file trees and identifiers remain original; framework-removed output is not repeatedly inserted');
 await mkdir('evidence',{recursive:true});await page.screenshot({path:'evidence/content-dom.png',fullPage:true});await writeFile('evidence/content-e2e.json',JSON.stringify({passed:true,transport:'simulated',checks},null,2));
 console.log(JSON.stringify({passed:true,checks},null,2));
}finally{await browser?.close();await rm(temporary,{recursive:true,force:true});}
