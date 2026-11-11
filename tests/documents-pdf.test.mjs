import test from 'node:test';
import {pdfFixture} from './documents-pdf-fixture.mjs';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {mkdtemp,rm,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {pathToFileURL,fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
const temp=await mkdtemp(join(tmpdir(),'pdf-document-test-'));
await build({entryPoints:['src/documents/pdf.ts'],outfile:join(temp,'pdf.mjs'),bundle:true,platform:'node',format:'esm'});
const {pdfDocument,pdfTextLines,pdfTextDocument}=await import(pathToFileURL(join(temp,'pdf.mjs')));
await build({entryPoints:['src/documents/formats.ts'],outfile:join(temp,'formats.mjs'),bundle:true,platform:'node',format:'esm'});
const {loadDocument}=await import(pathToFileURL(join(temp,'formats.mjs')));
test.after(()=>rm(temp,{recursive:true,force:true}));
test('PDF.js vendored modules retain matched hashes and license notices',async()=>{
 for(const [name,hash] of [['pdf.mjs','7c1a3c19fb241266bf3b9dd8b9315f8929c233315c3d30b55c7a02dc6adc5dae'],['pdf.worker.mjs','209a7ef55a4929b7b9be7aad8e1eb9723644bea93425adfd933f383cfdb06d86']]){
  const bytes=await readFile('public/vendor/pdfjs/'+name);assert.equal(createHash('sha256').update(bytes).digest('hex'),hash);assert.match(bytes.toString('utf8',0,1200),/Apache License, Version 2.0/);
 }
 for(const name of ['LICENSE','cmaps/LICENSE','standard_fonts/LICENSE_FOXIT','standard_fonts/LICENSE_LIBERATION'])assert.ok((await readFile('public/vendor/pdfjs/'+name)).length>1000);
});
test('PDF text item grouping respects line breaks and ignores marked content records',()=>{
 const text=pdfTextLines({items:[{type:'beginMarkedContent'},{str:'Hello',transform:[1,0,0,1,10,30]},{str:'world',transform:[1,0,0,1,50,30],hasEOL:true},{str:'Second line',transform:[1,0,0,1,10,10]}]});
 assert.equal(text,'Hello world\nSecond line');
});
test('PDF printable export escapes source, translation, and filename; page grouping survives',async()=>{
 const doc=pdfTextDocument([{number:1,text:'<script>source</script>'},{number:2,text:'Second'}],'<img onerror=alert(1)>.pdf');doc.segments[0].translation='<iframe src=x>translation';
 const html=await doc.export('bilingual').text();assert.ok(html.includes('第 1 頁'));assert.ok(html.includes('第 2 頁'));assert.ok(!html.includes('<script>'));assert.ok(!html.includes('<iframe'));assert.ok(!html.includes('<img'));assert.ok(html.includes('&lt;iframe'));
 const only=await doc.export('translated').text();assert.ok(!only.includes('&lt;script&gt;source'));assert.ok(only.includes('Second'));assert.throws(()=>pdfTextDocument([{number:1,text:''}],'scan.pdf'),/OCR/);
});
test('file loader routes PDF to actual PDF.js, extracts two pages and preserves typed errors',async()=>{
 // Only module initialization needs DOMMatrix. No drawing API is exercised here.
 const oldMatrix=globalThis.DOMMatrix;const oldChrome=globalThis.chrome;const oldFetch=globalThis.fetch;
 globalThis.DOMMatrix=class DOMMatrix{};
 globalThis.chrome={runtime:{getURL:path=>pathToFileURL(resolve('public',path)).href+(path.endsWith('/')?'/':'')}};
 globalThis.fetch=async input=>{
  const url=typeof input==='string'?input:input instanceof URL?input.href:input.url;
  if(!url.startsWith(pathToFileURL(resolve('public/vendor/pdfjs')).href+'/'))throw new Error('Unexpected network request');
  return new Response(await readFile(fileURLToPath(url)));
 };
 try{
  const doc=await loadDocument(new File([pdfFixture()],'fixture.pdf',{type:'application/pdf'}));assert.equal(doc.kind,'pdf');assert.deepEqual(doc.segments.map(segment=>segment.source),['Hello local PDF','A second page']);
  await assert.rejects(loadDocument(new File(['not a PDF'],'bad.pdf',{type:'application/pdf'})),error=>error.code==='pdf-invalid');
 }finally{globalThis.DOMMatrix=oldMatrix;globalThis.chrome=oldChrome;globalThis.fetch=oldFetch;}
});
