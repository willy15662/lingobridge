import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {pathToFileURL} from 'node:url';

const directory=await mkdtemp(path.join(tmpdir(),'translate-ui-test-'));
const sharedFile=path.join(directory,'shared.mjs');
const settingsFile=path.join(directory,'settings.mjs');
await build({entryPoints:['src/ui/shared.ts'],outfile:sharedFile,bundle:true,platform:'node',format:'esm'});
await build({entryPoints:['src/core/settings.ts'],outfile:settingsFile,bundle:true,platform:'node',format:'esm'});
const {exportedSettings,importedSettings,endpointOrigin,updateSiteRule}=await import(pathToFileURL(sharedFile).href);
const {defaults}=await import(pathToFileURL(settingsFile).href);

await test('settings export removes every provider key without mutating saved settings',()=>{
 const source=structuredClone(defaults);
 for(const [id,provider] of Object.entries(source.providers))provider.apiKey=`SECRET-${id}`;
 const exported=exportedSettings(source);
 for(const [id,provider] of Object.entries(exported.providers)){assert.equal(provider.apiKey,'');assert.equal(source.providers[id].apiKey,`SECRET-${id}`);}
 assert.ok(!JSON.stringify(exported).includes('SECRET'));
});
await test('settings import keeps local keys and accepts configured reading preferences',()=>{
 const current=structuredClone(defaults);current.providers.openai.apiKey='local-key';
 const incoming=exportedSettings(defaults);incoming.providers.openai.apiKey='untrusted-file-key';incoming.target='ja';incoming.mode='translated';
 const imported=importedSettings(incoming,current);
 assert.equal(imported.providers.openai.apiKey,'local-key');assert.equal(imported.target,'ja');assert.equal(imported.mode,'translated');
 assert.equal(current.target,'zh-TW');
});
await test('settings import rejects malformed language, style, and rate limits',()=>{
 for(const patch of [{target:''},{requestsPerMinute:0},{batchSize:1000},{style:{...defaults.style,color:'url(https://example.com)'}}])assert.throws(()=>importedSettings({...defaults,...patch},defaults));
});
await test('API origin permissions accept HTTPS and explicit loopback HTTP',()=>{
 assert.equal(endpointOrigin('https://api.example.com/v1/chat/completions'),'https://api.example.com/*');
 assert.equal(endpointOrigin('http://localhost:8080/v1/chat/completions'),'http://localhost:8080/*');
 assert.equal(endpointOrigin('http://127.0.0.1:1234/v1'),'http://127.0.0.1:1234/*');
});
await test('API settings reject embedded credentials, query secrets, and insecure remote connections',()=>{
 for(const endpoint of ['https://user:pass@example.com/v1','https://example.com/v1?key=secret','https://example.com/v1#secret','http://example.com/v1','file:///etc/passwd'])assert.throws(()=>endpointOrigin(endpoint));
 const incoming=structuredClone(defaults);incoming.providers.gemini.endpoint='https://user:pass@example.com/v1';assert.throws(()=>importedSettings(incoming,defaults));
});
await test('site switch never rule blocks an explicitly allowed site and keeps unrelated rules',()=>{
 const source={...structuredClone(defaults),allowSites:['example.com','other.com'],blockSites:['private.com']};
 const result=updateSiteRule(source,'example.com','never',true);
 assert.deepEqual(result.allowSites,['other.com']);assert.deepEqual(result.blockSites,['private.com','example.com']);
 assert.deepEqual(source.allowSites,['example.com','other.com']);
});
await test('site switch always rule removes only an exact blacklist entry',()=>{
 const source={...structuredClone(defaults),blockSites:['example.com','other.com']};
 const result=updateSiteRule(source,'example.com','always',true);
 assert.deepEqual(result.allowSites,['example.com']);assert.deepEqual(result.blockSites,['other.com']);
});
await test('site switch refuses to weaken a wildcard blacklist',()=>{
 const source={...structuredClone(defaults),blockSites:['*.example.com']};
 assert.throws(()=>updateSiteRule(source,'docs.example.com','always',true));
 assert.throws(()=>updateSiteRule(source,'docs.example.com','never',false));
 assert.deepEqual(source.blockSites,['*.example.com']);
});
await test('turning automatic translation off overrides a global or wildcard automatic rule',()=>{
 for(const patch of [{autoTranslate:true},{allowSites:['*.example.com']}]){
  const result=updateSiteRule({...structuredClone(defaults),...patch},'docs.example.com','always',false);
  assert.ok(result.blockSites.includes('docs.example.com'));
 }
});
await rm(directory,{recursive:true,force:true});

test('imported endpoint cannot inherit the previous origin API key',()=>{
 const settings=structuredClone(defaults);settings.providers.openai.apiKey='private-key';
 const imported=structuredClone(settings);imported.providers.openai.endpoint='https://different.example/v1/chat/completions';
 const result=importedSettings(imported,settings);assert.equal(result.providers.openai.apiKey,'');assert.equal(settings.providers.openai.apiKey,'private-key');
});
