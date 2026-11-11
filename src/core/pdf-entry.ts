/** Identify PDF tabs without requesting their document contents. */
export function pdfSource(raw:string):{kind:'local'}|{kind:'remote';url:string}|null{
 try{
  const url=new URL(raw);
  if(url.protocol==='chrome-extension:'&&url.hostname==='mhjfbmdgcfjbbpaeojofohoefgiehjai'){
   const nested=url.searchParams.get('src')??url.searchParams.get('file');
   if(nested)return pdfSource(nested);
   return {kind:'local'};
  }
  if(!/\.pdf$/i.test(decodeURIComponent(url.pathname)))return null;
  if(url.protocol==='file:')return {kind:'local'};
  if(['http:','https:'].includes(url.protocol)&&!url.username&&!url.password){url.hash='';return {kind:'remote',url:url.href};}
 }catch{/* Invalid URLs are handled by the ordinary page boundary. */}
 return null;
}
export function documentWorkspace(raw:string):string{
 const source=pdfSource(raw);
 return chrome.runtime.getURL('documents.html')+(source?.kind==='remote'?'#pdf='+encodeURIComponent(source.url):'#local-pdf');
}
export async function isPdfTab(tab:chrome.tabs.Tab):Promise<boolean>{
 if(pdfSource(tab.url??''))return true;
 if(tab.id===undefined||!/^https?:/.test(tab.url??''))return false;
 try{
  const result=await chrome.scripting.executeScript({target:{tabId:tab.id},world:'MAIN',func:()=>document.contentType==='application/pdf'||!!document.querySelector('embed[type="application/pdf"],object[type="application/pdf"]')});
  return result[0]?.result===true;
 }catch{return false;}
}
export function workspaceForTab(tab:chrome.tabs.Tab):string{
 if(pdfSource(tab.url??''))return documentWorkspace(tab.url??'');
 try{const url=new URL(tab.url??'');if(['https:','http:'].includes(url.protocol)&&!url.username&&!url.password){url.hash='';return chrome.runtime.getURL('documents.html')+'#pdf='+encodeURIComponent(url.href);}}catch{}
 return chrome.runtime.getURL('documents.html')+'#local-pdf';
}
