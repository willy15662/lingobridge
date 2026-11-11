import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
const folder=await mkdtemp(join(tmpdir(),'document-test-'));
await build({entryPoints:['src/documents/formats.ts','src/documents/zip.ts'],outdir:folder,bundle:true,platform:'node',format:'esm',outExtension:{'.js':'.mjs'}});
const formats=await import(pathToFileURL(join(folder,'formats.mjs')));
const zip=await import(pathToFileURL(join(folder,'zip.mjs')));
test.after(()=>rm(folder,{recursive:true,force:true}));
const encoder=new TextEncoder();
test('ZIP roundtrip retains EPUB mimetype first and binary resources',async()=>{
 const entries=[{name:'OPS/images/icon.png',data:new Uint8Array([0,1,255,32])},{name:'mimetype',data:encoder.encode('application/epub+zip')},{name:'OPS/chapter.xhtml',data:encoder.encode('<p>Hello 世界</p>')}];
 const bytes=zip.writeZip(entries);const parsed=await zip.readZip(bytes.buffer);
 assert.equal(parsed[0].name,'mimetype'); assert.deepEqual(parsed.find(x=>x.name===entries[0].name).data,entries[0].data);
 assert.equal(new TextDecoder().decode(parsed[2].data),'<p>Hello 世界</p>');
 assert.equal(new DataView(bytes.buffer).getUint16(8,true),0);
});
test('ZIP rejects corrupt bytes, truncation, duplicate names, traversal, and encryption',async()=>{
 const original=zip.writeZip([{name:'mimetype',data:encoder.encode('application/epub+zip')}]);
 const corrupt=original.slice();corrupt[38]^=255;
 await assert.rejects(zip.readZip(corrupt.buffer),/校驗/);
 await assert.rejects(zip.readZip(original.slice(0,-1).buffer),/ZIP/);
 assert.throws(()=>zip.writeZip([{name:'../escape',data:new Uint8Array()}]),/路徑/);
 assert.throws(()=>zip.writeZip([{name:'x',data:new Uint8Array()},{name:'x',data:new Uint8Array()}]),/重複/);
 const encrypted=original.slice();const view=new DataView(encrypted.buffer);const central=view.getUint32(encrypted.length-6,true);view.setUint16(central+8,1,true);
 await assert.rejects(zip.readZip(encrypted.buffer),/加密/);
});
test('CRC32 agrees with standard check vector',()=>{assert.equal(zip.crc32(encoder.encode('123456789')),0xcbf43926);});
test('SRT keeps cue identifiers and timestamps in bilingual and translated downloads',async()=>{
 const source='7\r\n00:01:02,000 --> 00:01:05,100\r\nHello world\r\n\r\n8\r\n00:01:06,000 --> 00:01:08,000\r\nGoodbye\r\n';
 const doc=formats.subtitleDocument(source,'test.srt','srt'); assert.equal(doc.segments.length,2);
 doc.segments[0].translation='你好世界';doc.segments[1].translation='再見';
 const bilingual=await doc.export('bilingual').text();
 assert.match(bilingual,/00:01:02,000 --> 00:01:05,100\r\nHello world\r\n你好世界/);
 const translated=await doc.export('translated').text();assert.ok(!translated.includes('Hello world'));assert.match(translated,/7\r\n00:01:02,000 --> 00:01:05,100/);
});
test('VTT metadata survives, malicious translated cue markup cannot create new cue',async()=>{
 const source='WEBVTT\n\nNOTE keep this\n\nSTYLE\n::cue { color: lime }\n\nintro\n00:00.000 --> 00:02.000 align:start\nHello';
 const doc=formats.subtitleDocument(source,'test.vtt','vtt');assert.equal(doc.segments.length,1);
 doc.segments[0].translation='<script>alert(1)</script>\n\n00:01.000 --> 00:04.000';
 const result=await doc.export('bilingual').text();assert.ok(result.startsWith('WEBVTT\n\nNOTE keep this'));assert.match(result,/align:start\nHello/);assert.ok(!result.includes('<script>'));assert.equal((result.match(/-->/g)||[]).length,1);
});
test('text segments preserve whitespace and unfinished original paragraphs',async()=>{
 const doc=formats.textDocument('Hello\n\nUnfinished\n','a.txt');doc.segments[0].translation='你好';
 assert.equal(await doc.export('translated').text(),'你好\n\nUnfinished\n');
 assert.equal(await doc.export('bilingual').text(),'Hello\n\n你好\n\nUnfinished\n');
});
test('Markdown fenced code is excluded from provider inputs and unchanged in output',async()=>{
 const code='```js\nconst message = "hello";\n\nconsole.log(message);\n```';
 const doc=formats.textDocument('Hello\n\n'+code+'\n\nGoodbye','a.md',true);
 assert.deepEqual(doc.segments.map(x=>x.source),['Hello','Goodbye']);
 for(const segment of doc.segments)segment.translation='譯文';assert.ok((await doc.export('translated').text()).includes(code));
});
test('long text chunks reconstruct exactly without splitting surrogate pairs',()=>{
 const text='a'.repeat(5999)+'😀'+'z'.repeat(8000);const parts=formats.splitLongText(text);
 assert.equal(parts.join(''),text);assert.ok(parts.every(x=>x.length<=6000));
 for(const part of parts)assert.ok(!/[\uD800-\uDBFF]$/.test(part));
});
test('ZIP reader inflates DEFLATE entries and rejects oversized expansion declarations',async()=>{
 const {deflateRawSync}=await import('node:zlib');
 const source=encoder.encode('A compressed EPUB chapter '.repeat(200));const packed=deflateRawSync(source);const name=encoder.encode('chapter.xhtml');
 const local=new Uint8Array(30+name.length+packed.length);const l=new DataView(local.buffer);
 l.setUint32(0,0x04034b50,true);l.setUint16(8,8,true);l.setUint32(14,zip.crc32(source),true);l.setUint32(18,packed.length,true);l.setUint32(22,source.length,true);l.setUint16(26,name.length,true);local.set(name,30);local.set(packed,30+name.length);
 const central=new Uint8Array(46+name.length);const c=new DataView(central.buffer);c.setUint32(0,0x02014b50,true);c.setUint16(10,8,true);c.setUint32(16,zip.crc32(source),true);c.setUint32(20,packed.length,true);c.setUint32(24,source.length,true);c.setUint16(28,name.length,true);central.set(name,46);
 const end=new Uint8Array(22);const e=new DataView(end.buffer);e.setUint32(0,0x06054b50,true);e.setUint16(8,1,true);e.setUint16(10,1,true);e.setUint32(12,central.length,true);e.setUint32(16,local.length,true);
 const archive=new Uint8Array(local.length+central.length+end.length);archive.set(local);archive.set(central,local.length);archive.set(end,local.length+central.length);
 const parsed=await zip.readZip(archive.buffer);assert.deepEqual(parsed[0].data,source);
 new DataView(archive.buffer).setUint32(local.length+24,1,true);
 await assert.rejects(zip.readZip(archive.buffer),/超出/);
});
test('document URLs permit relative paths and anchors only, including control-character attacks',()=>{
 for(const value of ['javascript:alert(1)','java\nscript:alert(1)','java\tscript:alert(1)',' data:text/html,hi','https://example.com','//example.com','/absolute','\\\\example.com','%6a%61vascript%3aalert(1)','%2f%2fexample.com','blob:abc','file:///etc/passwd'])assert.equal(formats.safeDocumentUrl(value),null,value);
 assert.equal(formats.safeDocumentUrl('../Images/cover.png'),'../Images/cover.png');
 assert.equal(formats.safeDocumentUrl('#chapter-2'),'#chapter-2');
});
test('document batches obey both item and total character ceilings',()=>{
 const segments=Array.from({length:23},()=>({source:'a'.repeat(12000),translation:null}));
 const batches=formats.segmentBatches(segments,20);
 assert.deepEqual(batches.map(batch=>batch.length),[5,5,5,5,3]);
 assert.deepEqual(batches.flat(),segments);
 assert.ok(batches.every(batch=>batch.reduce((sum,segment)=>sum+segment.source.length,0)<=60000));
 assert.deepEqual(formats.segmentBatches(segments,2).map(batch=>batch.length),[2,2,2,2,2,2,2,2,2,2,2,1]);
});
