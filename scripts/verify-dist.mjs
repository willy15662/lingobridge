import {readFile,stat,readdir} from 'node:fs/promises';import assert from 'node:assert/strict';import {createHash} from 'node:crypto';
const manifest=JSON.parse(await readFile('dist/manifest.json','utf8'));
assert.equal(manifest.manifest_version,3);assert.equal(manifest.commands['translate-selection'].suggested_key.default,'Alt+Q');assert.equal(manifest.host_permissions,undefined);
assert.deepEqual([...manifest.permissions].sort(),['activeTab','contextMenus','scripting','sidePanel','storage']);
for(const file of [manifest.background.service_worker,manifest.action.default_popup,manifest.options_page,'documents.html','sidepanel.html','ui/sidepanel.js','ui/vocabulary.js','vocabulary.html','content/content.js'])assert.ok((await stat('dist/'+file)).size>0,file);
for(const file of ['popup.html','options.html','documents.html','sidepanel.html','vocabulary.html']){const html=await readFile('dist/'+file,'utf8');for(const match of html.matchAll(/(?:src|href)="([^"#]+)"/g)){if(/^(https?:|chrome:)/.test(match[1]))continue;await stat('dist/'+match[1]);}assert.equal(/<script(?![^>]*src=)[^>]*>\s*\S/.test(html),false);}
async function files(dir){const result=[];for(const entry of await readdir(dir,{withFileTypes:true})){const path=dir+'/'+entry.name;if(entry.isDirectory())result.push(...await files(path));else result.push(path);}return result;}
const hashes=[];for(const path of (await files('dist')).sort()){const data=await readFile(path);hashes.push({path,bytes:data.length,sha256:createHash('sha256').update(data).digest('hex')});}
console.log(`PASS Manifest V3, least-privilege manifest, local UI assets, ${hashes.length} hashed artifacts`);
