/** Responsive navigation and component-library sidebar regression fixtures. */
import {chromium} from 'playwright-core';
import {build} from 'esbuild';
import assert from 'node:assert/strict';
import {mkdtemp,rm,mkdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
const temp=await mkdtemp(tmpdir()+'/translation-layout-');
await build({entryPoints:['src/content/controller.ts'],outfile:temp+'/controller.js',bundle:true,format:'iife',globalName:'Harness',target:'chrome120'});
await build({entryPoints:['src/core/settings.ts'],outfile:temp+'/settings.mjs',bundle:true,format:'esm',platform:'node'});
const {defaults,publicSettings}=await import('file://'+temp+'/settings.mjs');
let browser;
try{
 browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_PATH||undefined});
 const page=await browser.newPage({viewport:{width:1100,height:800}});
 await page.setContent(`<!doctype html><style>
 body{font:16px/1.5 system-ui;margin:20px}overflow-nav{display:block;width:460px}nav ul{display:flex;gap:20px;padding:0;list-style:none}nav li{white-space:nowrap}nav li[aria-hidden=true]{display:none}
 mat-nav-list{display:block;width:250px;background:#191919;color:white;padding:12px}.list-item{display:flex;gap:14px;padding:12px;color:inherit;text-decoration:none}.label{display:block;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.icon{width:20px;flex:none}h1{font-size:22px}p{max-width:550px}
 </style><overflow-nav><nav class="UnderlineNav" aria-label="Repository"><ul><li><a href="#code">Code</a></li><li><a href="#issues">Issues</a></li><li><a href="#pulls">Pull requests</a></li><li><a href="#actions">Actions</a></li></ul></nav></overflow-nav>
 <mat-nav-list><a id="api" class="list-item" href="#api"><div class="icon"><svg width="16" height="16"><circle cx="8" cy="8" r="5" fill="gray"/></svg></div><div class="label"><span id="api-label">API Keys</span></div></a><a id="projects" class="list-item" href="#projects"><span>Projects</span></a></mat-nav-list>
 <main><p id="prose">Read the <a id="prose-link" href="#article">complete article</a> before continuing.</p></main>`);
 await page.evaluate(()=>{
  window.navFlips=0;window.clicks=0;document.querySelector('#api').addEventListener('click',event=>{event.preventDefault();window.clicks++;});
  window.navTimer=setInterval(()=>{
   const items=[...document.querySelectorAll('nav li')];const overflow=items.reduce((sum,node)=>sum+node.getBoundingClientRect().width,0)>400;
   if(overflow!==items[0].hasAttribute('aria-hidden')){window.navFlips++;for(const item of items)overflow?item.setAttribute('aria-hidden','true'):item.removeAttribute('aria-hidden');}
  },30);
 });
 await page.addScriptTag({path:temp+'/controller.js'});
 await page.evaluate(settings=>{
  window.calls=[];window.controller=new Harness.PageTranslator(settings,async texts=>{window.calls.push(...texts);return texts.map(text=>({'API Keys':'API 金鑰',Projects:'專案'}[text]??'中文翻譯：'+text));});window.controller.setMode('bilingual');
 },publicSettings(defaults));
 await page.waitForFunction(()=>document.querySelector('#api [data-local-translate="result"]')&&document.querySelector('#prose [data-local-translate="result"]'));
 await page.waitForTimeout(1300);
 assert.equal(await page.locator('overflow-nav [data-local-translate="result"]').count(),0,'responsive tabs must retain native widths');
 assert.equal(await page.evaluate(()=>window.navFlips),0,'translation must not trigger alternating overflow states');
 const rows=await page.evaluate(()=>['api','projects'].map(id=>{
  const el=document.getElementById(id);const output=el.querySelector('[data-local-translate="result"]');
  const walker=document.createTreeWalker(el,NodeFilter.SHOW_TEXT);let text;while(text=walker.nextNode()){if(text.parentElement.closest('[data-local-translate]'))continue;if(text.textContent.trim())break;}
  const range=document.createRange();range.selectNodeContents(text);const source=range.getBoundingClientRect(),translation=output.getBoundingClientRect();
  return{source:source.top,translation:translation.top,right:translation.right,edge:el.getBoundingClientRect().right,display:getComputedStyle(output).display};
 }));
 for(const row of rows){assert.ok(Math.abs(row.source-row.translation)<3,JSON.stringify(row));assert.equal(row.display,'inline');assert.ok(row.right<=row.edge);}
 assert.equal(await page.locator('#api-label [data-local-translate="result"]').count(),1,'translation belongs inside the label, beside its text');
 assert.equal(await page.locator('#prose a [data-local-translate]').count(),0,'article links stay within their paragraph');
 assert.equal(await page.locator('#prose-link').textContent(),'complete article');
 const before=await page.evaluate(()=>window.calls.length);await page.locator('#api').click();assert.equal(await page.evaluate(()=>window.clicks),1);
 await page.waitForTimeout(300);assert.equal(await page.evaluate(()=>window.calls.length),before);
 await page.evaluate(()=>window.controller.setMode('original'));assert.equal(await page.locator('#api-label').textContent(),'API Keys');
 await page.evaluate(()=>window.controller.setMode('bilingual'));
 await page.waitForFunction(()=>document.querySelector('#api-label [data-local-translate="result"]'));
 await mkdir('evidence',{recursive:true});await page.screenshot({path:'evidence/navigation-sidebar.png',fullPage:true});
 await page.evaluate(()=>{clearInterval(window.navTimer);window.controller.dispose();});
 console.log('PASS responsive tabs do not oscillate; component sidebar labels stay beside source; links, paragraph ownership, mode restoration and request stability preserved');
}finally{await browser?.close();await rm(temp,{recursive:true,force:true});}
