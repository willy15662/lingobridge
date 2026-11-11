import {z} from 'zod';
import {rpc} from '../core/messages';
import {publicSettingsSchema,type PublicSettings} from '../core/settings';
import {element,textarea,select,languageOptions,setSelect,status,report} from './shared';
import {translateText} from './text-translation';
const sourceText=textarea('source-text');const result=textarea('result');
let settings:PublicSettings|undefined;let revision=0;let running=false;
languageOptions('source',true);languageOptions('target',false);
function button(id:string):HTMLButtonElement{const el=element(id);if(!(el instanceof HTMLButtonElement))throw new Error('介面初始化失敗');return el;}
function refresh():void{button('translate').disabled=!settings||running||!sourceText.value.trim();button('stop').disabled=!running;button('copy').disabled=!result.value;button('swap').disabled=running||select('source').value==='auto';element('count').textContent=sourceText.value.length.toLocaleString('zh-TW')+' / 60,000';}
function invalidate():void{revision++;running=false;result.value='';refresh();}
sourceText.addEventListener('input',invalidate);for(const id of ['source','target'])select(id).addEventListener('change',invalidate);
button('translate').addEventListener('click',()=>{
 if(!settings||running)return;
 const token=++revision;running=true;result.value='';refresh();status('翻譯中…');
 const input={text:sourceText.value,source:select('source').value,target:select('target').value,batchSize:settings.batchSize};
 void translateText(input,async(texts,source,target)=>z.array(z.string()).parse(await rpc({kind:'translate',texts,source,target})),()=>token===revision)
 .then(value=>{if(token===revision){result.value=value;status('翻譯完成。');}})
 .catch(error=>{if(token===revision)report(error);})
 .finally(()=>{if(token===revision){running=false;refresh();}});
});
button('stop').addEventListener('click',()=>{revision++;running=false;refresh();status('已停止後續批次；已送出的請求仍可能計費。');});
button('clear').addEventListener('click',()=>{sourceText.value='';invalidate();status('已清除。');sourceText.focus();});
button('swap').addEventListener('click',()=>{const old=select('source').value;if(old==='auto')return;setSelect('source',select('target').value);setSelect('target',old);if(result.value)sourceText.value=result.value;invalidate();});
button('copy').addEventListener('click',()=>{void navigator.clipboard.writeText(result.value).then(()=>status('已複製譯文。')).catch(()=>status('無法自動複製，請選取譯文後複製。',true));});
button('settings').addEventListener('click',()=>void chrome.runtime.openOptionsPage().catch(report));
button('documents').addEventListener('click',()=>void chrome.tabs.create({url:chrome.runtime.getURL('documents.html')}).catch(report));
void rpc({kind:'settings.public'}).then(value=>{settings=publicSettingsSchema.parse(value);setSelect('source',settings.source);setSelect('target',settings.target);element('provider').textContent=settings.provider;refresh();}).catch(report);
window.addEventListener('pagehide',()=>{revision++;});refresh();
