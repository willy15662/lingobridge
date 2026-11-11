export function remotePdfURL(raw:string):URL{
 const url=new URL(raw);
 if(!['https:','http:'].includes(url.protocol)||url.username||url.password)throw new Error('PDF 網址須為 HTTP 或 HTTPS，且不可含帳密。');
 url.hash='';return url;
}
export async function fetchPdfFile(raw:string):Promise<File>{
 const url=remotePdfURL(raw);
 const response=await fetch(url,{credentials:'omit',redirect:'error',signal:AbortSignal.timeout(30000)});
 if(!response.ok)throw new Error('無法下載 PDF。需要登入或重新導向的文件，請先下載到本機再選取。');
 const limit=50*1024*1024;
 if(Number(response.headers.get('content-length'))>limit)throw new Error('PDF 不能超過 50 MB。');
 const reader=response.body?.getReader();if(!reader)throw new Error('PDF 沒有內容。');
 const chunks:Uint8Array<ArrayBuffer>[]=[];let size=0;
 try{while(true){const item=await reader.read();if(item.done)break;size+=item.value.length;if(size>limit)throw new Error('PDF 不能超過 50 MB。');chunks.push(new Uint8Array(item.value));}}
 finally{await reader.cancel();}
 const blob=new Blob(chunks);const header=new TextDecoder().decode(await blob.slice(0,1024).arrayBuffer());
 if(!header.includes('%PDF-'))throw new Error('網址沒有回傳 PDF，可能是登入頁。請下載 PDF 後再選取檔案。');
 let name='document.pdf';try{name=decodeURIComponent(url.pathname.split('/').pop()??'')||name;}catch{}
 if(!/\.pdf$/i.test(name))name='document.pdf';
 return new File([blob],name,{type:'application/pdf'});
}
