import {z} from 'zod';
export interface CaptionCue {start:number;end:number;text:string}
const json3=z.object({events:z.array(z.object({tStartMs:z.number().finite().nonnegative(),dDurationMs:z.number().finite().positive().optional(),segs:z.array(z.object({utf8:z.string().max(12000)})).optional()})).max(50000)});
export function parseCaptionTimeline(value:unknown):CaptionCue[]{
 const events=json3.parse(value).events;
 const cues:CaptionCue[]=[];
 for(const event of events){
  const text=event.segs?.map(segment=>segment.utf8).join('').trim();
  if(!text||text.length>12000||!event.dDurationMs)continue;
  cues.push({start:event.tStartMs/1000,end:(event.tStartMs+event.dDurationMs)/1000,text});
 }
 return cues.sort((a,b)=>a.start-b.start);
}
export function activeCaption(cues:CaptionCue[],time:number):CaptionCue|undefined{
 // Latest start wins for rolling auto-caption windows.
 let lo=0,hi=cues.length;
 while(lo<hi){const mid=Math.floor((lo+hi)/2);if((cues[mid]?.start??Infinity)<=time)lo=mid+1;else hi=mid;}
 for(let index=lo-1;index>=0;index--){const cue=cues[index];if(cue&&cue.end>time)return cue;}
 return undefined;
}
export function captionWindow(cues:CaptionCue[],time:number,cached:ReadonlyMap<string,string>):string[]{
 const selected:string[]=[];let size=0;
 for(const cue of cues){
  if(cue.end<=time||cue.start>time+90||cached.has(cue.text)||selected.includes(cue.text))continue;
  if(selected.length>=12||size+cue.text.length>24000)break;
  selected.push(cue.text);size+=cue.text.length;
 }
 return selected;
}
const trackSchema=z.object({baseUrl:z.string().max(16000),languageCode:z.string().max(30),kind:z.string().optional()});
export const captionInfoSchema=z.object({videoId:z.string(),language:z.string().optional(),tracks:z.array(trackSchema).max(200)});
export function captionURL(info:unknown,page:URL):URL|null{
 const parsed=captionInfoSchema.parse(info);
 if(parsed.videoId!==page.searchParams.get('v'))return null;
 const track=parsed.tracks.find(t=>t.languageCode===parsed.language)??parsed.tracks.find(t=>t.kind!=='asr')??parsed.tracks[0];
 if(!track)return null;
 const url=new URL(track.baseUrl);
 if(url.origin!==page.origin||url.pathname!=='/api/timedtext'||url.username||url.password)return null;
 url.searchParams.set('fmt','json3');return url;
}
export async function loadYouTubeTimeline(signal:AbortSignal):Promise<CaptionCue[]>{
 const page=new URL(location.href);
 if(!/(^|\.)youtube\.com$/.test(page.hostname)||page.pathname!=='/watch')return [];
 const {rpc}=await import('../core/messages');
 const url=captionURL(await rpc({kind:'captions.info'}),page);
 if(!url||signal.aborted)return [];
 const response=await fetch(url,{signal,credentials:'same-origin',redirect:'error'});
 if(!response.ok||Number(response.headers.get('content-length'))>5000000)throw new Error('無法讀取字幕軌');
 const reader=response.body?.getReader();if(!reader)return [];
 const chunks:Uint8Array[]=[];let size=0;
 try{while(true){const chunk=await reader.read();if(chunk.done)break;size+=chunk.value.length;if(size>5000000)throw new Error('字幕軌過大');chunks.push(chunk.value);}}
 finally{await reader.cancel();}
 const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
 return parseCaptionTimeline(JSON.parse(new TextDecoder().decode(bytes)));
}
