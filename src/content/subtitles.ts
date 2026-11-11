import {activeCaption,captionWindow,loadYouTubeTimeline,type CaptionCue} from './caption-timeline';
import { OWN_ATTRIBUTE } from './dom';
/** Adapter for page-exposed TextTracks and YouTube's visible caption DOM. */
export class SubtitleTranslator {
    private timer: number | null = null;
    private last = '';
    private revision = 0;
    private session = 0;
    private overlay: HTMLDivElement | null = null;
    private cache = new Map<string, string>();
    private inFlight = new Map<string, number>();
    private retryAfter = 0;
    private timeline:CaptionCue[]=[];
    private track:TextTrack|null=null;
    private trackLength=0;
    private loading:AbortController|null=null;
    private timelineVideo:HTMLVideoElement|null=null;
    constructor(private readonly translate: (texts: string[]) => Promise<string[]>) { }
    start(): void {
        if (this.timer !== null)
            return;
        this.timer = window.setInterval(() => this.tick(), 200);
        const session=this.session;
        const loading=new AbortController();this.loading=loading;
        const timeout=setTimeout(()=>loading.abort(),15000);
        void loadYouTubeTimeline(loading.signal).then(cues=>{
            if(session===this.session&&!loading.signal.aborted&&cues.length){this.timeline=cues;this.timelineVideo=document.querySelector('video');}
        }).catch(()=>{ /* Unavailable tracks use visible captions, without bypassing access restrictions. */ })
        .finally(()=>{clearTimeout(timeout);if(this.loading===loading)this.loading=null;});
    }
    stop(): void {
        this.session++;
        this.loading?.abort();this.loading=null;
        this.timeline=[];this.timelineVideo=null;this.track=null;this.trackLength=0;
        this.cache.clear();
        this.inFlight.clear();
        this.retryAfter = 0;
        if (this.timer !== null)
            clearInterval(this.timer);
        this.timer = null;
        this.last = '';
        this.revision++;
        this.overlay?.remove();
        this.overlay = null;
    }
    private current(): {
        text: string;
        video: HTMLVideoElement;
    } | null {
        for (const video of document.querySelectorAll('video')) {
            if (video.ended || video.getBoundingClientRect().width < 20)
                continue;
            let texts: string[] = [];
            for (const track of video.textTracks) {
                if (track.mode !== 'showing' || !track.activeCues)
                    continue;
                if(track.cues&&(this.track!==track||this.trackLength!==track.cues.length)){
                    this.track=track;this.trackLength=track.cues.length;this.timelineVideo=video;
                    this.timeline=Array.from(track.cues).filter((cue):cue is VTTCue=>cue instanceof VTTCue).map(cue=>({start:cue.startTime,end:cue.endTime,text:cue.text.replace(/<[^>]*>/g,'')})).filter(cue=>cue.text.trim()&&cue.text.length<=12000).sort((a,b)=>a.start-b.start);
                }
                for (const cue of track.activeCues)
                    if (cue instanceof VTTCue)
                        texts.push(cue.text.replace(/<[^>]*>/g, ''));
            }
            if (!texts.length && /(^|\.)youtube\.com$/.test(location.hostname))
                texts = Array.from(document.querySelectorAll('.ytp-caption-segment')).map(e => e.textContent ?? '');
            const text = texts.join(' ').trim();
            if (text)
                return { text, video };
        }
        return null;
    }
    private render(text: string, video: HTMLVideoElement): void {
        if (!this.overlay) {
            this.overlay = document.createElement('div');
            this.overlay.setAttribute(OWN_ATTRIBUTE, 'subtitle');
            Object.assign(this.overlay.style, { position: 'fixed', zIndex: '2147483646', pointerEvents: 'none', padding: '5px 12px', borderRadius: '5px', background: 'rgba(0,0,0,.82)', color: 'white', font: '20px/1.5 system-ui', textAlign: 'center', whiteSpace: 'pre-wrap' });
            document.documentElement.append(this.overlay);
        }
        const full = document.fullscreenElement;
        if (full instanceof HTMLElement && !(full instanceof HTMLVideoElement) && this.overlay.parentElement !== full)
            full.append(this.overlay);
        else if (!full && this.overlay.parentElement !== document.documentElement)
            document.documentElement.append(this.overlay);
        const rect = video.getBoundingClientRect();
        this.overlay.style.left = Math.max(0, rect.left + rect.width * .1) + 'px';
        this.overlay.style.top = Math.max(0, Math.min(innerHeight - 60, rect.bottom - 100)) + 'px';
        this.overlay.style.width = Math.max(80, rect.width * .8 - 24) + 'px';
        this.overlay.dataset.subtitleMode=this.timeline.length?'prefetch':'live';
        this.overlay.textContent = text;
        this.overlay.hidden = false;
    }
    private prefetch(texts:string[]):void{
        const session=this.session;
        for(const text of texts)this.inFlight.set(text,session);
        void this.translate(texts).then(results=>{
            if(session!==this.session)return;
            if(results.length!==texts.length)throw new Error('字幕結果數量不符');
            texts.forEach((text,index)=>{const value=results[index];if(value!==undefined)this.cache.set(text,value);});
            // Keep a bounded local cache; the worker also persists translated chunks.
            while(this.cache.size>2000){const first=this.cache.keys().next().value;if(first===undefined)break;this.cache.delete(first);}
        }).catch(()=>{if(session===this.session)this.retryAfter=Date.now()+10000;})
        .finally(()=>{for(const text of texts)if(this.inFlight.get(text)===session)this.inFlight.delete(text);});
    }
    private tick(): void {
        const current = this.current();
        const timelineVideo=this.timelineVideo;
        if(timelineVideo&&this.timeline.length){
            const cc=document.querySelector('.ytp-subtitles-button');
            const enabled=this.track?this.track.mode==='showing':cc?.getAttribute('aria-pressed')!=='false';
            if(!enabled||timelineVideo.ended||!timelineVideo.isConnected){if(this.overlay)this.overlay.hidden=true;return;}
            const cue=activeCaption(this.timeline,timelineVideo.currentTime);
            const translated=cue?this.cache.get(cue.text):undefined;
            if(translated)this.render(translated,timelineVideo);
            else if(cue)this.render(Date.now()<this.retryAfter?'字幕翻譯失敗，稍後重試':'字幕預翻譯中…',timelineVideo);
            else if(this.overlay)this.overlay.hidden=true;
            if(!this.inFlight.size&&Date.now()>=this.retryAfter){
                const batch=captionWindow(this.timeline,timelineVideo.currentTime,this.cache);
                if(batch.length)this.prefetch(batch);
            }
            return;
        }
        if (!current) {
            if (this.last) {
                this.last = '';
                this.revision++;
            }
            if (this.overlay)
                this.overlay.hidden = true;
            return;
        }
        const { text, video } = current;
        if (text !== this.last) {
            this.last = text;
            this.revision++;
            if (this.overlay)
                this.overlay.hidden = true;
        }
        const existing = this.cache.get(text);
        if (existing) {
            this.render(existing, video);
            return;
        }
        if (this.inFlight.size > 0 || text.length > 12000 || Date.now() < this.retryAfter)
            return;
        const revision = this.revision;
        const session = this.session;
        this.inFlight.set(text, session);
        void this.translate([text]).then(results => {
            if (session !== this.session)
                return;
            const result = results[0];
            if (!result)
                return;
            this.cache.set(text, result);
            if (this.cache.size > 300) {
                const oldest = this.cache.keys().next().value;
                if (oldest !== undefined)
                    this.cache.delete(oldest);
            }
            if (this.revision === revision && this.last === text)
                this.render(result, video);
        }).catch(() => {
            if (session === this.session) this.retryAfter = Date.now() + 30000;
        }).finally(() => {
            if (this.inFlight.get(text) === session) this.inFlight.delete(text);
        });
    }
}
