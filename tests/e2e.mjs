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
let context;let server;let requests=0;let dictionaryRequests=0;let imageRequests=0;
const dictionaryEntry={pronunciation:'/ˈpærəɡræf/',sourceLanguage:'en',senses:[{partOfSpeech:'n.',meaning:'段落',example:'Read the first paragraph.',translation:'讀第一段。'},{partOfSpeech:'n.',meaning:'短篇文字',example:'Write a short paragraph.',translation:'寫一小段文字。'}],contextualMeaning:'這裡指網頁上的一個文字段落。'};
try{
 server=createServer(async(req,res)=>{
  try{
   if(req.url==='/v1/chat/completions'&&req.method==='POST'){
    let raw='';for await(const chunk of req)raw+=chunk;
    const body=JSON.parse(raw);const vision=Array.isArray(body.messages[1].content);const inputs=vision?[]:JSON.parse(body.messages[1].content);requests++;if(vision)imageRequests++;
    const dictionary=body.messages[0].content.includes('You are a language tutor.');
    if(dictionary)dictionaryRequests++;
    res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify({choices:[{message:{content:vision?JSON.stringify({regions:[{box:[100,100,400,900],source:'Hello reader',translation:'讀者你好'}]}):JSON.stringify(inputs.map(text=>dictionary?JSON.stringify(dictionaryEntry):'譯文 '+text))}}],usage:{prompt_tokens:4,completion_tokens:3}}));
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
 // Actual hover -> runtime RPC -> provider -> save -> notebook -> review flow.
 await options.locator('#hover').check();await options.locator('#status').evaluate(el=>el.textContent='');await options.locator('#save').click();
 await options.waitForFunction(()=>document.querySelector('#status')?.textContent.includes('已儲存'));
 await page.bringToFront();
 const point=await page.evaluate(()=>{
  const text=document.querySelector('#paragraph').firstChild;
  const start=text.data.indexOf('paragraph');const range=document.createRange();range.setStart(text,start);range.setEnd(text,start+9);
  const rect=range.getBoundingClientRect();return{x:rect.left+rect.width/2,y:rect.top+rect.height/2};
 });
 await page.mouse.move(point.x,point.y);
 await page.waitForTimeout(800);assert.equal(dictionaryRequests,0);
 await page.keyboard.down('Control');
 const icon=page.locator('[data-local-translate="lookup-action"]');
 await icon.getByRole('button',{name:'查詢單字／片語',exact:true}).waitFor();assert.equal(dictionaryRequests,0);
 await page.keyboard.up('Control');await icon.getByRole('button',{name:'查詢單字／片語',exact:true}).click();
 const lookup=page.locator('[data-local-translate="lookup"]');
 await lookup.getByRole('button',{name:'加入單字本',exact:true}).waitFor({timeout:6000}).catch(async error=>{
  console.log('hover diagnostics',await page.evaluate(point=>{const r=document.caretRangeFromPoint(point.x,point.y);return{point,selection:getSelection()?.toString(),node:r?.startContainer.textContent,offset:r?.startOffset,hit:document.elementFromPoint(point.x,point.y)?.outerHTML,lookup:document.querySelector('[data-local-translate="lookup"]')?.shadowRoot?.textContent};},point),await worker.evaluate(async()=>({settings:(await chrome.storage.local.get('settings')).settings.hover})),{dictionaryRequests});
  await page.screenshot({path:'evidence/lookup-failure.png'});throw error;
 });
 await page.waitForFunction(()=>document.querySelector('[data-local-translate="lookup"]')?.shadowRoot?.textContent.includes('在這裡的意思'));
 await page.keyboard.up('Control');
 assert.equal(await lookup.locator('h2').textContent(),'paragraph');
 assert.equal(await lookup.locator('.sense').count(),2);assert.equal(await lookup.locator('.example-translation').first().textContent(),'讀第一段。');
 const box=await lookup.boundingBox();assert.ok(box.x>=0&&box.y>=0);assert.equal(dictionaryRequests,1);
 await page.mouse.move(point.x+1,point.y);await page.waitForTimeout(850);assert.equal(dictionaryRequests,1);
 await lookup.getByRole('button',{name:'加入單字本',exact:true}).click();
 await lookup.getByRole('button',{name:'已加入單字本',exact:true}).waitFor();
 await page.screenshot({path:'evidence/lookup-card.png'});
 // Select a phrase while whole-page selection translation is disabled.
 await lookup.getByRole('button',{name:'關閉',exact:true}).click();
 await page.evaluate(()=>{
  const text=document.querySelector('#paragraph').firstChild;const start=text.data.indexOf('a paragraph');const range=document.createRange();range.setStart(text,start);range.setEnd(text,start+11);
  const selection=getSelection();selection.removeAllRanges();selection.addRange(range);
  document.querySelector('#paragraph').dispatchEvent(new MouseEvent('mouseup',{bubbles:true,button:0}));
 });
 await page.waitForTimeout(800);assert.equal(dictionaryRequests,1,'selection alone does not query a dictionary');
 assert.equal(await page.locator('[data-local-translate="selection-action"]').count(),0);
 assert.equal(await icon.count(),0);
 const phrasePoint=await page.evaluate(()=>{const r=getSelection().getRangeAt(0).getBoundingClientRect();return{x:r.left+r.width/2,y:r.top+r.height/2};});
 await page.mouse.move(phrasePoint.x,phrasePoint.y);await page.keyboard.down('Control');
 await icon.getByRole('button',{name:'查詢單字／片語',exact:true}).waitFor();await page.keyboard.up('Control');
 await icon.getByRole('button',{name:'查詢單字／片語',exact:true}).click();
 await page.waitForFunction(()=>document.querySelector('[data-local-translate="lookup"]')?.shadowRoot?.querySelector('h2')?.textContent==='a paragraph');
 await lookup.getByRole('button',{name:'加入單字本',exact:true}).waitFor({state:'visible'});
 await page.waitForFunction(()=>document.querySelector('[data-local-translate="lookup"]')?.shadowRoot?.querySelector('footer button')?.disabled===false);
 await lookup.getByRole('button',{name:'加入單字本',exact:true}).click();
 await lookup.getByRole('button',{name:'已加入單字本',exact:true}).waitFor();
 // Even a short selection follows normal translation when explicitly commanded.
 await worker.evaluate(async()=>{const tabs=await chrome.tabs.query({});const tab=tabs.find(tab=>tab.url?.endsWith('/article'));await chrome.tabs.sendMessage(tab.id,{kind:'page.selection',text:'a paragraph'});});
 assert.equal(dictionaryRequests,2);assert.equal(await lookup.count(),0);
 assert.equal(await page.locator('[data-local-translate="panel"]').count(),1);
 const notebook=await context.newPage();await notebook.goto(`chrome-extension://${id}/vocabulary.html`);
 await notebook.waitForFunction(()=>document.querySelector('#total')?.textContent==='2');
 assert.equal(await notebook.locator('.word-card').count(),2);
 await notebook.reload();await notebook.waitForFunction(()=>document.querySelector('#total')?.textContent==='2');
 await notebook.locator('#search').fill('paragraph');assert.equal(await notebook.locator('.word-card').count(),2);
 await notebook.locator('#search').fill('a paragraph');assert.equal(await notebook.locator('.word-card').count(),1);
 await notebook.locator('#search').fill('');
 await notebook.locator('#review').click();assert.equal(await notebook.locator('.word-card').count(),1);
 assert.equal(await notebook.locator('.word-details').isVisible(),false);
 await notebook.getByRole('button',{name:'顯示答案',exact:true}).click();
 assert.equal(await notebook.locator('.word-details').isVisible(),true);
 await notebook.screenshot({path:'evidence/vocabulary-review.png',fullPage:true});
 await notebook.getByRole('button',{name:'已記住',exact:true}).click();
 await notebook.waitForFunction(()=>document.querySelector('#due')?.textContent==='1');
 await notebook.getByRole('button',{name:'顯示答案',exact:true}).click();
 await notebook.getByRole('button',{name:'還不熟',exact:true}).click();
 await notebook.waitForFunction(()=>document.querySelector('#cards')?.textContent.includes('今天的複習完成了'));
 await notebook.reload();await notebook.waitForFunction(()=>document.querySelector('#due')?.textContent==='0');
 await notebook.locator('.word-card').first().getByRole('button',{name:'移除',exact:true}).click();
 await notebook.waitForFunction(()=>document.querySelector('#total')?.textContent==='1');
 // An authorized site loads image translation without a page-mode command.
 await options.locator('#images').check();await options.locator('#status').evaluate(el=>el.textContent='');await options.locator('#save').click();
 await options.waitForFunction(()=>document.querySelector('#status')?.textContent.includes('已儲存'));
 const imagePage=await context.newPage();await imagePage.goto(base+'/article');
 await imagePage.evaluate(()=>{
  const canvas=document.createElement('canvas');canvas.width=400;canvas.height=300;const ctx=canvas.getContext('2d');ctx.fillStyle='white';ctx.fillRect(0,0,400,300);ctx.fillStyle='black';ctx.font='30px sans-serif';ctx.fillText('Hello reader',40,80);
  const img=new Image();img.id='auto-image';img.src=canvas.toDataURL();document.body.append(img);
 });
 await imagePage.waitForFunction(()=>document.querySelector('[data-local-translate="image"]')?.shadowRoot?.textContent.includes('讀者你好'));
 assert.equal(imageRequests,1);
 assert.equal(await imagePage.locator('[data-local-translate="result"]').count(),0,'image auto-translation leaves page text alone');
 await imagePage.locator('[data-local-translate="image"]').getByRole('button',{name:'顯示原圖',exact:true}).click();
 assert.equal(await imagePage.locator('[data-local-translate="image"] .region').count(),0);
 await mkdir('evidence/screenshots',{recursive:true});await options.screenshot({path:'evidence/screenshots/options.png',fullPage:true});
 await writeFile('evidence/e2e-result.json',JSON.stringify({status:'passed',liveProvider:false,sidebarPage:true,nativeSidepanelGesture:false,pdfDownloadTranslateExport:true,hoverLookup:true,phraseLookup:true,vocabularyPersistenceAndReview:true,automaticImageTranslation:true},null,2));
 console.log('PASS actual MV3 worker + provider fixture + content bilingual/dynamic/restore + settings UI + PDF download/translation/export + hover/phrase dictionary + saved vocabulary/review + automatically injected image OCR');
}catch(error){await mkdir('evidence',{recursive:true});await writeFile('evidence/e2e-result.json',JSON.stringify({status:'failed-or-blocked',message:error instanceof Error?error.message:String(error),liveProvider:false},null,2));throw error;}
finally{await context?.close();if(server?.listening)await new Promise(resolve=>{server.close(resolve);server.closeAllConnections();});await rm(profile,{recursive:true,force:true});await rm(copy,{recursive:true,force:true});}
