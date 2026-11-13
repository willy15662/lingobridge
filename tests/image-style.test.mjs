import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
const { outputFiles } = await build({entryPoints:['src/content/image-style.ts'], bundle:true, format:'esm', platform:'node', write:false});
const {imagePalette,imageFontSize,fallbackPalette} = await import('data:text/javascript;base64,' + Buffer.from(outputFiles[0].text).toString('base64'));
test('image palette follows the dominant background and keeps text readable',()=>{
 assert.deepEqual(imagePalette(new Uint8ClampedArray([20,20,20,255,21,21,21,255,255,255,255,255])),{background:'rgb(21,21,21)',foreground:'#fff'});
 assert.equal(imagePalette(new Uint8ClampedArray([240,230,220,255])).foreground,'#191919');
 assert.deepEqual(imagePalette(new Uint8ClampedArray([0,0,0,0])),fallbackPalette);
});
test('image fitting accounts for measured width, explicit newlines and long CJK text',()=>{
 const measure=(text,size)=>Array.from(text).length*size;
 assert.equal(imageFontSize('短句',200,100,measure),24);
 assert.ok(imageFontSize('很長的翻譯文字必須縮小才放得下',80,40,measure)<24);
 assert.ok(imageFontSize('a\nb\nc',200,50,measure)<imageFontSize('abc',200,50,measure));
 assert.equal(imageFontSize('too long',1,1,measure),7);
});
