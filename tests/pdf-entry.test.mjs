import {test} from 'node:test';import assert from 'node:assert/strict';import {build} from 'esbuild';import {mkdtemp,rm} from 'node:fs/promises';import {tmpdir} from 'node:os';import {pathToFileURL} from 'node:url';
const dir=await mkdtemp(tmpdir()+'/pdf-entry-');
async function load(file){const out=dir+'/'+file.split('/').at(-1)+'.mjs';await build({entryPoints:[file],outfile:out,bundle:true,platform:'node',format:'esm'});return import(pathToFileURL(out));}
const {pdfSource,workspaceForTab,isPdfTab}=await load('src/core/pdf-entry.ts');const {remotePdfURL,fetchPdfFile}=await load('src/documents/remote-pdf.ts');await rm(dir,{recursive:true,force:true});
test('PDF URLs separate local file from remote and preserve signed query',()=>{
 assert.deepEqual(pdfSource('file:///home/private/document.PDF'),{kind:'local'});
 assert.deepEqual(pdfSource('https://example.com/a.pdf?signature=abc#page=2'),{kind:'remote',url:'https://example.com/a.pdf?signature=abc'});
 assert.equal(pdfSource('https://example.com/article?name=a.pdf'),null);assert.equal(pdfSource('https://name:pass@example.com/a.pdf'),null);
});
test('local PDF workspace does not expose file path; MIME probe handles extensionless PDF',async()=>{
 const old=globalThis.chrome;globalThis.chrome={runtime:{getURL:path=>'chrome-extension://test/'+path},scripting:{executeScript:async()=>[{result:true}]}};
 try{assert.equal(workspaceForTab({url:'file:///private/secret.pdf'}),'chrome-extension://test/documents.html#local-pdf');assert.equal(await isPdfTab({id:1,url:'https://example.com/download?id=2'}),true);assert.match(workspaceForTab({url:'https://example.com/download?id=2'}),/#pdf=/);}finally{globalThis.chrome=old;}
});
test('PDF downloads omit cookies, reject redirects and become file-loader compatible Files',async()=>{
 const previous=globalThis.fetch;globalThis.fetch=async(url,options)=>{assert.equal(options.credentials,'omit');assert.equal(options.redirect,'error');return new Response('%PDF-1.4\nfixture');};
 try{const file=await fetchPdfFile('https://example.com/download?id=1');assert.equal(file.name,'document.pdf');assert.equal(file.type,'application/pdf');assert.match(await file.text(),/^%PDF/);}finally{globalThis.fetch=previous;}
});
test('remote PDF rejects unsafe URLs, login HTML and oversized bodies',async()=>{
 for(const url of ['file:///private/a.pdf','data:application/pdf,x','https://user:pass@example.com/a.pdf'])assert.throws(()=>remotePdfURL(url));
 const previous=globalThis.fetch;
 try{globalThis.fetch=async()=>new Response('<html>login</html>');await assert.rejects(fetchPdfFile('https://example.com/a.pdf'),/沒有回傳 PDF/);
 globalThis.fetch=async()=>new Response('',{headers:{'content-length':String(51*1024*1024)}});await assert.rejects(fetchPdfFile('https://example.com/a.pdf'),/50 MB/);}finally{globalThis.fetch=previous;}
});
