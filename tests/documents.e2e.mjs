/** Real DOMParser/export checks in Chromium. No external translation service.
 * Run: CHROME_PATH=/path/to/chrome node tests/documents.e2e.mjs
 * Also import runDocumentBrowserChecks(browser) into another browser suite.
 */
import {chromium} from 'playwright-core';
import {build} from 'esbuild';
import assert from 'node:assert/strict';
import {mkdtemp,rm,mkdir,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
export async function runDocumentBrowserChecks(browser){
 const temp=await mkdtemp(join(tmpdir(),'documents-dom-'));
 const page=await browser.newPage();const requests=[];
 try{
  await build({stdin:{contents:"export * from './src/documents/formats';export * from './src/documents/zip';",resolveDir:process.cwd()},outfile:join(temp,'documents.js'),bundle:true,format:'iife',globalName:'DocumentHarness',target:'chrome120'});
  await page.route('**/*',route=>{requests.push(route.request().url());return route.abort();});
  await page.addScriptTag({path:join(temp,'documents.js')});
  await page.setContent('<!doctype html><html><head><meta http-equiv="Content-Security-Policy" content="default-src \'none\'; img-src \'none\'; frame-src \'none\'; object-src \'none\'; connect-src \'self\' https: http:"></head><body></body></html>');
  const html=await page.evaluate(async()=>{
   const input='<html><head><link rel="stylesheet" href="https://attacker.invalid/style.css"><style>@import "https://attacker.invalid/css"</style></head><body><p id="paragraph" onclick="alert(1)">Hello <a href="java&#10;script:alert(1)">world</a><a href="#local">local</a></p><img src="https://attacker.invalid/image.png" onerror="alert(1)"><img src="images/cover.png"><svg><a><animate attributeName="href" values="javascript:alert(1)"/></a></svg><iframe src="https://attacker.invalid/frame"></iframe><video src="https://attacker.invalid/video"></video><script>alert(1)</script></body></html>';
   const doc=DocumentHarness.htmlDocument(input,'source.html');for(const segment of doc.segments)segment.translation='<img src=x onerror=alert(1)> translated';
   const bilingual=await doc.export('bilingual').text();const repeated=await doc.export('bilingual').text();const translated=await doc.export('translated').text();
   const parsed=new DOMParser().parseFromString(bilingual,'text/html');
   return {bilingual,translated,repeated,unsafe:parsed.querySelectorAll('script,svg,animate,set,iframe,video,link,style,[onclick],[onerror],[srcdoc]').length,hrefs:[...parsed.querySelectorAll('a')].map(a=>a.getAttribute('href')),sources:[...parsed.querySelectorAll('img')].map(img=>img.getAttribute('src')),translationCount:parsed.querySelectorAll('.local-translation').length,translations:[...parsed.querySelectorAll('.local-translation')].map(el=>el.textContent)};
  });
  assert.equal(html.unsafe,0);assert.deepEqual(html.hrefs,[null,'#local']);assert.deepEqual(html.sources,[null,'images/cover.png']);assert.equal(html.translationCount,1);assert.equal(html.bilingual,html.repeated);assert.equal(html.translations[0],'<img src=x onerror=alert(1)> translated');assert.ok(html.translated.includes('&lt;img'));
  await page.waitForTimeout(100);assert.deepEqual(requests,[],'Detached document parsing must not initiate resource requests under document-page CSP');
  const epub=await page.evaluate(async()=>{
   const enc=new TextEncoder();const dec=new TextDecoder();const entry=(name,text)=>({name,data:enc.encode(text)});
   const entries=[entry('mimetype','application/epub+zip'),entry('META-INF/container.xml','<?xml version="1.0"?><container xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OPS/book.opf"/></rootfiles></container>'),entry('OPS/book.opf','<package xmlns="http://www.idpf.org/2007/opf"><manifest><item id="two" href="two.xhtml"/><item id="one" href="one.xhtml"/></manifest><spine><itemref idref="one"/><itemref idref="two"/></spine></package>'),entry('OPS/two.xhtml','<html xmlns="http://www.w3.org/1999/xhtml"><body><p>Second chapter</p></body></html>'),entry('OPS/one.xhtml','<html xmlns="http://www.w3.org/1999/xhtml"><body><p>First <em>chapter</em></p><img src="images/cover.png"/><script>alert(1)</script></body></html>'),{name:'OPS/images/cover.png',data:new Uint8Array([0,1,255,33])}];
   const doc=await DocumentHarness.epubDocument(DocumentHarness.writeZip(entries).buffer,'book.epub');const sources=doc.segments.map(segment=>segment.source);for(const segment of doc.segments)segment.translation='譯文 '+segment.source;
   const result=await DocumentHarness.readZip(await doc.export('bilingual').arrayBuffer());const one=dec.decode(result.find(entry=>entry.name==='OPS/one.xhtml').data);const parsed=new DOMParser().parseFromString(one,'application/xhtml+xml');
   const again=await DocumentHarness.readZip(await doc.export('translated').arrayBuffer());
   return {sources,names:result.map(entry=>entry.name),image:[...result.find(entry=>entry.name==='OPS/images/cover.png').data],valid:!parsed.querySelector('parsererror'),originalEm:parsed.querySelector('em')?.textContent,translation:parsed.querySelector('.local-translation')?.textContent,script:parsed.querySelectorAll('script').length,translated:dec.decode(again.find(entry=>entry.name==='OPS/one.xhtml').data)};
  });
  assert.deepEqual(epub.sources,['First chapter','Second chapter']);assert.equal(epub.names[0],'mimetype');assert.deepEqual(epub.image,[0,1,255,33]);assert.equal(epub.valid,true);assert.equal(epub.originalEm,'chapter');assert.equal(epub.translation,'譯文 First chapter');assert.equal(epub.script,0);assert.ok(epub.translated.includes('譯文 First chapter'));assert.ok(!epub.translated.includes('<em>'));
  return ['HTML removes active markup and unsafe URLs; translation stays text; repeated export is idempotent','Document-page CSP blocks parser-time remote resource requests','EPUB spine order, valid XHTML, image preservation and bilingual/translated export'];
 }finally{await page.close();await rm(temp,{recursive:true,force:true});}
}
if(process.argv[1]&&pathToFileURL(resolve(process.argv[1])).href===import.meta.url){
 let browser;
 try{browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_PATH||undefined});const checks=await runDocumentBrowserChecks(browser);console.log(JSON.stringify({status:'passed',checks},null,2));}
 catch(error){await mkdir('evidence',{recursive:true});await writeFile('evidence/documents-e2e-result.json',JSON.stringify({status:'failed-or-blocked',message:error instanceof Error?error.message:String(error)},null,2));throw error;}
 finally{await browser?.close();}
}
