/** Actual extension page + PDF.js module worker. No provider/API request is made.
 * Run after build: CHROME_PATH=/path/to/chrome node tests/documents-pdf.e2e.mjs
 */
import {chromium} from 'playwright-core';
import {mkdtemp,rm,mkdir,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import assert from 'node:assert/strict';
import {pdfFixture} from './documents-pdf-fixture.mjs';
export async function runPdfBrowserChecks(context,extensionId){
 const page=await context.newPage();
 const diagnostics={console:[],errors:[],requests:[],workers:[]};
 page.on('console',message=>{if(['error','warning'].includes(message.type()))diagnostics.console.push(message.text());});
 page.on('pageerror',error=>diagnostics.errors.push(error.message));
 page.on('requestfailed',request=>diagnostics.requests.push({url:request.url(),error:request.failure()?.errorText}));
 page.on('worker',worker=>diagnostics.workers.push(worker.url()));
 try{
  await page.goto(`chrome-extension://${extensionId}/documents.html`);
  await page.locator('#file').setInputFiles({name:'fixture.pdf',mimeType:'application/pdf',buffer:Buffer.from(pdfFixture())});
  await page.waitForFunction(()=>document.querySelector('#preview')?.textContent.includes('Hello local PDF')||/PDF|無法讀取文件/.test(document.querySelector('#status')?.textContent??''));
  assert.match(await page.locator('#preview').textContent(),/Hello local PDF/,await page.locator('#status').textContent());
  assert.match(await page.locator('#preview').textContent(),/A second page/);
  assert.equal(await page.locator('#start').isEnabled(),true);
  assert.equal(await page.locator('#document-name').textContent(),'fixture.pdf');
  await page.locator('#file').setInputFiles({name:'broken.pdf',mimeType:'application/pdf',buffer:Buffer.from('invalid PDF')});
  await page.waitForFunction(()=>document.querySelector('#status')?.textContent.includes('PDF 讀取失敗'));
  assert.equal(await page.locator('#start').isEnabled(),false);
  return ['Actual MV3 document page opens two-page PDF via local PDF.js module worker','Invalid PDF shows sanitized error and disables translation'];
 }catch(error){
  const ui=await page.evaluate(()=>({status:document.querySelector('#status')?.textContent,preview:document.querySelector('#preview')?.textContent,readyState:document.readyState})).catch(()=>null);
  // Only the generated fixture is parsed here. Expose raw library errors in the test
  // evidence, while the product UI continues to show sanitized messages.
  const parser=await page.evaluate(async bytes=>{
   let task;
   try{
    const pdfjs=await import(chrome.runtime.getURL('vendor/pdfjs/pdf.mjs'));
    pdfjs.GlobalWorkerOptions.workerSrc=chrome.runtime.getURL('vendor/pdfjs/pdf.worker.mjs');
    task=pdfjs.getDocument({data:new Uint8Array(bytes),isEvalSupported:false,useWasm:false,disableFontFace:true,enableXfa:false,cMapUrl:chrome.runtime.getURL('vendor/pdfjs/cmaps/'),cMapPacked:true,standardFontDataUrl:chrome.runtime.getURL('vendor/pdfjs/standard_fonts/'),verbosity:1});
    const doc=await Promise.race([task.promise,new Promise((_,reject)=>setTimeout(()=>reject(Error('PDF worker/parser did not finish in 8 seconds')),8000))]);
    const page=await doc.getPage(1);const content=await page.getTextContent();
    return {version:pdfjs.version,pages:doc.numPages,firstPage:content.items.filter(item=>'str' in item).map(item=>item.str)};
   }catch(error){return {name:error?.name,message:String(error?.message??error),stack:error?.stack};}
   finally{if(task)void task.destroy().catch(()=>{});}
  },Array.from(new Uint8Array(pdfFixture()))).catch(error=>({message:error.message}));
  await mkdir('evidence',{recursive:true});
  await writeFile('evidence/documents-pdf-diagnostics.json',JSON.stringify({ui,parser,...diagnostics},null,2));
  throw new Error(`${error instanceof Error?error.message:String(error)}\nPDF status: ${ui?.status??'unavailable'}\nParser: ${JSON.stringify(parser)}\nDetails: evidence/documents-pdf-diagnostics.json`,{cause:error});
 }finally{await page.close();}
}
if(process.argv[1]&&pathToFileURL(resolve(process.argv[1])).href===import.meta.url){
 const profile=await mkdtemp(join(tmpdir(),'pdf-extension-e2e-'));let context;
 try{
  const extension=resolve('dist');
  context=await chromium.launchPersistentContext(profile,{headless:true,channel:'chromium',executablePath:process.env.CHROME_PATH||undefined,args:[`--disable-extensions-except=${extension}`,`--load-extension=${extension}`]});
  let worker=context.serviceWorkers()[0];if(!worker)worker=await context.waitForEvent('serviceworker');
  const checks=await runPdfBrowserChecks(context,new URL(worker.url()).host);console.log(JSON.stringify({status:'passed',checks},null,2));
 }catch(error){await mkdir('evidence',{recursive:true});await writeFile('evidence/documents-pdf-e2e-result.json',JSON.stringify({status:'failed-or-blocked',message:error instanceof Error?error.message:String(error)},null,2));throw error;}
 finally{await context?.close();await rm(profile,{recursive:true,force:true});}
}
