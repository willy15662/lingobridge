import {pdfFixture} from './documents-pdf-fixture.mjs';
import {chromium} from 'playwright-core';
import {createServer} from 'node:http';
import {once} from 'node:events';
import {mkdtemp,rm,mkdir,readFile,writeFile,cp} from 'node:fs/promises';
import {tmpdir} from 'node:os';import {resolve} from 'node:path';import assert from 'node:assert/strict';
// Actual MV3 worker/content/UI, local fixture API. No live provider account or key.
const profile=await mkdtemp(tmpdir()+'/translate-e2e-');const copy=await mkdtemp(tmpdir()+'/translate-extension-');
await cp('dist',copy,{recursive:true});
// Test-only required host permission avoids interactive Chrome permission prompts in automation.
const manifest=JSON.parse(await readFile(copy+'/manifest.json','utf8'));manifest.host_permissions=['http://127.0.0.1/*'];await writeFile(copy+'/manifest.json',JSON.stringify(manifest));
let context;let server;let requests=0;
try{
 server=createServer(async(req,res)=>{
  try{
   if(req.url==='/v1/chat/completions'&&req.method==='POST'){
    let raw='';for await(const chunk of req)raw+=chunk;
    const body=JSON.parse(raw);const inputs=JSON.parse(body.messages[1].content);requests++;
    res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify({choices:[{message:{content:JSON.stringify(inputs.map(text=>'譯文 '+text))}}],usage:{prompt_tokens:4,completion_tokens:3}}));
   }else if(req.url==='/fixture.pdf'){
    res.writeHead(200,{'Content-Type':'application/pdf'});res.end(Buffer.from(pdfFixture()));
   }else if(req.url==='/article'){
    res.writeHead(200,{'Content-Type':'text/html; charset=utf-8'});res.end('<!doctype html><html lang="en"><body><h1>A reading fixture</h1><p id="paragraph">This is a paragraph with <a href="#">a link</a>.</p><button id="add">Append paragraph</button><script>document.querySelector("#add").onclick=()=>{const p=document.createElement("p");p.id="dynamic";p.textContent="A dynamically added paragraph.";document.body.append(p)}</script></body></html>');
   }else{res.writeHead(404);res.end();}
  }catch{res.writeHead(500);res.end('Invalid fixture request');}
 });
 server.listen(0,'127.0.0.1');await once(server,'listening');
 const base='http://127.0.0.1:'+server.address().port;
 context=await chromium.launchPersistentContext(profile,{headless:true,channel:'chromium',...(process.env.CHROME_PATH?{executablePath:process.env.CHROME_PATH}:{}),args:[`--disable-extensions-except=${copy}`,`--load-extension=${copy}`]});
 let worker=context.serviceWorkers()[0];if(!worker)worker=await context.waitForEvent('serviceworker');const id=new URL(worker.url()).host;
 const options=await context.newPage();await options.goto(`chrome-extension://${id}/options.html`);await options.locator('#openai-key').fill('test-only-secret');await options.locator('#openai-endpoint').fill(base+'/v1/chat/completions');
 await options.locator('#save').click();await options.waitForFunction(()=>document.querySelector('#status')?.textContent?.includes('已儲存'));
 const page=await context.newPage();
 await page.goto(base+'/article');
 await worker.evaluate(async()=>{const [tab]=await chrome.tabs.query({active:true,currentWindow:true});await chrome.scripting.executeScript({target:{tabId:tab.id},files:['content/content.js']});await chrome.tabs.sendMessage(tab.id,{kind:'page.mode',mode:'bilingual'});});
 await page.waitForFunction(()=>document.querySelector('#paragraph')?.textContent?.includes('譯文'));
 assert.equal(await page.locator('#paragraph a').textContent(),'a link');assert.equal((await page.content()).includes('test-only-secret'),false);
 await page.locator('#add').click();await page.waitForFunction(()=>document.querySelector('#dynamic')?.textContent?.includes('譯文'));
 await worker.evaluate(async()=>{const [tab]=await chrome.tabs.query({active:true,currentWindow:true});await chrome.tabs.sendMessage(tab.id,{kind:'page.mode',mode:'original'});});
 await page.waitForFunction(()=>document.querySelector('#paragraph')?.textContent==='This is a paragraph with a link.');assert.ok(requests>0);
 const panel=await context.newPage();await panel.goto(`chrome-extension://${id}/sidepanel.html`);
 await panel.locator('#source-text').fill('A side panel translation.');await panel.locator('#translate').click();
 await panel.waitForFunction(()=>document.querySelector('#result')?.value==='譯文 A side panel translation.');
 await panel.locator('#clear').click();assert.equal(await panel.locator('#result').inputValue(),'');
 await options.locator('#theme').selectOption('mask');await options.locator('#save').click();
 await options.waitForFunction(()=>document.querySelector('#status')?.textContent?.includes('已儲存'));
 await worker.evaluate(async()=>{const tabs=await chrome.tabs.query({});const tab=tabs.find(t=>t.url?.endsWith('/article'));await chrome.tabs.sendMessage(tab.id,{kind:'page.mode',mode:'bilingual'});});
 await page.waitForFunction(()=>document.querySelector('[data-local-translate="result"][data-theme="mask"]')?.tabIndex===0);
 const documents=await context.newPage();await documents.goto(`chrome-extension://${id}/documents.html#pdf=${encodeURIComponent(base+'/fixture.pdf')}`);
 assert.equal(await documents.locator('#pdf-url').inputValue(),base+'/fixture.pdf');
 await documents.locator('#load-pdf').click();await documents.waitForFunction(()=>document.querySelector('#preview')?.textContent.includes('Hello local PDF'));
 await documents.locator('#start').click();await documents.waitForFunction(()=>document.querySelector('#status')?.textContent.includes('翻譯完成'));
 assert.match(await documents.locator('#preview').textContent(),/譯文 Hello local PDF/);
 const downloaded=documents.waitForEvent('download');await documents.locator('#save').click();const download=await downloaded;
 const exported=await readFile(await download.path(),'utf8');assert.match(exported,/譯文 Hello local PDF/);assert.match(exported,/A second page/);
 await mkdir('evidence/screenshots',{recursive:true});await options.screenshot({path:'evidence/screenshots/options.png',fullPage:true});
 await writeFile('evidence/e2e-result.json',JSON.stringify({status:'passed',liveProvider:false,sidebarPage:true,nativeSidepanelGesture:false,pdfDownloadTranslateExport:true},null,2));
 console.log('PASS actual MV3 worker + provider fixture + content bilingual/dynamic/restore + settings UI + PDF download/translation/export');
}catch(error){await mkdir('evidence',{recursive:true});await writeFile('evidence/e2e-result.json',JSON.stringify({status:'failed-or-blocked',message:error instanceof Error?error.message:String(error),liveProvider:false},null,2));throw error;}
finally{await context?.close();if(server?.listening)await new Promise(resolve=>{server.close(resolve);server.closeAllConnections();});await rm(profile,{recursive:true,force:true});await rm(copy,{recursive:true,force:true});}
