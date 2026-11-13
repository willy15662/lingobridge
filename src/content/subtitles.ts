import {SubtitleControls} from './subtitle-controls';
import {activeCaption,captionWindow,loadYouTubeTimeline,type CaptionCue} from './caption-timeline';
import { OWN_ATTRIBUTE, isAd } from './dom';
/** Adapter for page-exposed TextTracks and YouTube's visible caption DOM. */
export class SubtitleTranslator {
    private readonly controls=new SubtitleControls();
    private timer: number | null = null;
    private last = '';
    private revision = 0;
    private session = 0;
    private overlay: HTMLDivElement | null = null;
    private cache = new Map<string, string>();
    private inFlight = new Map<string, number>();
    private retryAfter = 0;
    private lastStable = '';
    private stableSince = 0;
    private lastError = '';
    private timeline:CaptionCue[]=[];
    private track:TextTrack|null=null;
    private trackLength=0;
    private loading:AbortController|null=null;
    private timelineVideo:HTMLVideoElement|null=null;
    private activeVideo:HTMLVideoElement|null=null;
    private mediaKey = "";
    private timelineRetry = 0;
    private urgent=false;
    private enabledTracks = new Map<TextTrack, TextTrackMode>();
    constructor(private readonly translate: (texts: string[]) => Promise<string[]>, private readonly batchSize: () => number = () => 8) { }
    start(): void {
        if (this.timer !== null) return;
        this.timer = window.setInterval(() => this.tick(), 200);
        this.tick();
    }
    private playback(): { video: HTMLVideoElement; key: string } | null {
        const video = Array.from(document.querySelectorAll('video')).find(video => !video.paused && !video.ended && !isAd(video) && video.getBoundingClientRect().width >= 20);
        return video ? { video, key: location.href + '|' + video.currentSrc } : null;
    }
    private isYouTubeWatch(): boolean {
        return typeof location === 'object' && /(^|\.)youtube\.com$/.test(location.hostname) && location.pathname === '/watch';
    }
    private loadTimeline(video: HTMLVideoElement): void {
        if (!this.isYouTubeWatch() || this.loading || this.timeline.length) return;
        const session = this.session;
        const loading = new AbortController(); this.loading = loading;
        const timeout = setTimeout(() => loading.abort(), 15000);
        void loadYouTubeTimeline(loading.signal).then(cues => {
            if (session !== this.session || loading.signal.aborted) return;
            if (cues.length) { this.timeline = cues; this.timelineVideo = video; this.timelineRetry = 0; }
            else this.timelineRetry = Date.now() + 2000;
        }).catch(() => { if (session === this.session) this.timelineRetry = Date.now() + 5000; })
        .finally(() => { clearTimeout(timeout); if (this.loading === loading) this.loading = null; });
    }
    private prepare(media: { video: HTMLVideoElement; key: string }): void {
        this.clearSession();
        this.activeVideo = media.video;
        this.mediaKey = media.key;
        this.loadTimeline(media.video);
    }
    stop(): void {
        this.controls.dispose();
        if (this.timer !== null) clearInterval(this.timer);
        this.timer = null;
        this.clearSession();
    }
    private clearSession(): void {
        this.session++;
        this.urgent=false;
        for (const [track, original] of this.enabledTracks) if (track.mode === 'hidden') track.mode = original;
        this.enabledTracks.clear();
        this.activeVideo = null; this.mediaKey = ''; this.timelineRetry = 0;
        this.loading?.abort();this.loading=null;
        this.timeline=[];this.timelineVideo=null;this.track=null;this.trackLength=0;
        this.cache.clear();
        this.inFlight.clear();
        this.retryAfter = 0;
        this.lastError = '';
        this.lastStable = '';
        this.stableSince = 0;
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
            if (video !== this.activeVideo || video.paused || video.ended || isAd(video) || video.getBoundingClientRect().width < 20)
                continue;
            let texts: string[] = [];
            const tracks = Array.from(video.textTracks);
            const selected = tracks.find(track => track.mode === 'showing') ?? tracks.find(track => track.mode === 'hidden') ?? tracks.find(track => track.kind === 'subtitles' || track.kind === 'captions');
            if (selected?.mode === 'disabled') { this.enabledTracks.set(selected, 'disabled'); selected.mode = 'hidden'; }
            for (const track of selected ? [selected] : []) {
                if (!track.activeCues) continue;
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
        if (!this.controls.enabled || this.controls.mode === 'original') { if (this.overlay) this.overlay.hidden = true; return; }
        if (!this.overlay) {
            this.overlay = document.createElement('div');
            this.overlay.setAttribute(OWN_ATTRIBUTE, 'subtitle');
            Object.assign(this.overlay.style, { position: 'fixed', zIndex: '2147483646', pointerEvents: 'none', padding: '5px 12px', borderRadius: '5px', background: 'rgba(0,0,0,.82)', color: 'white', font: '20px/1.5 system-ui', textAlign: 'center', whiteSpace: 'pre-wrap' });
            document.documentElement.append(this.overlay);
        }
        const caption=document.querySelector('.ytp-caption-window-container .caption-window');
        if(caption instanceof HTMLElement){
            if(this.controls.position==='above'){if(caption.firstChild!==this.overlay)caption.prepend(this.overlay);}else if(caption.lastChild!==this.overlay)caption.append(this.overlay);
            Object.assign(this.overlay.style,{position:'static',width:'auto',padding:'3px 8px',fontSize:(parseFloat(getComputedStyle(caption.querySelector('.ytp-caption-segment')??caption).fontSize)*this.controls.size/100)+'px',fontFamily:this.controls.font,fontWeight:String(this.controls.weight),color:this.controls.color,background:'transparent',lineHeight:'1.4'});
            if(this.overlay.textContent!==text)this.overlay.textContent=text;this.overlay.hidden=false;return;
        }
        Object.assign(this.overlay.style,{position:'fixed',fontSize:(20*this.controls.size/100)+'px',fontFamily:this.controls.font,fontWeight:String(this.controls.weight),color:this.controls.color,background:this.controls.background+Math.round(this.controls.opacity*2.55).toString(16).padStart(2,'0')});
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
        const nativeVisible = this.track ? this.track.mode === 'showing' : document.querySelector('.ytp-subtitles-button')?.getAttribute('aria-pressed') !== 'false';
        const source = activeCaption(this.timeline, video.currentTime)?.text ?? this.last;
        this.overlay.textContent = !nativeVisible && source ? source + '\n' + text : text;
        this.overlay.hidden = false;
    }
    private window(time:number,current?:string):string[]{
        const pending=new Map(this.cache);
        for(const text of this.inFlight.keys())pending.set(text,'');
        const upcoming=captionWindow(this.timeline,time,pending);
        if(current&&!pending.has(current)){const index=upcoming.indexOf(current);if(index>=0)upcoming.splice(index,1);upcoming.unshift(current);}
        return upcoming.slice(0,Math.min(8,this.batchSize()));
    }
    private prefetch(texts:string[],urgent=false):void{
        const session=this.session;
        for(const text of texts)this.inFlight.set(text,session);
        void this.translate(texts).then(results=>{
            if(session!==this.session)return;
            if(results.length!==texts.length)throw new Error('字幕結果數量不符');
            this.lastError = '';
            texts.forEach((text,index)=>{const value=results[index];if(value!==undefined)this.cache.set(text,value);});
            // Keep a bounded local cache; the worker also persists translated chunks.
            while(this.cache.size>2000){const first=this.cache.keys().next().value;if(first===undefined)break;this.cache.delete(first);}
        }).catch(error=>{if(session===this.session){this.lastError=error instanceof Error&&error.message?error.message:'字幕翻譯失敗，稍後重試';this.retryAfter=Date.now()+10000;}})
        .finally(()=>{if(urgent&&session===this.session)this.urgent=false;for(const text of texts)if(this.inFlight.get(text)===session)this.inFlight.delete(text);});
    }
    private tick(): void {
        this.controls.attach();
        this.controls.setStatus(Date.now()<this.retryAfter&&this.lastError?this.lastError:this.inFlight.size?'字幕翻譯中，等待服務回覆…':'字幕翻譯已啟用');
        if(!this.controls.enabled||this.controls.mode==='original'){if(this.overlay)this.overlay.hidden=true;return;}
        const media = this.playback();
        if (!media) {
            const video = this.activeVideo;
            const cue = video ? activeCaption(this.timeline, video.currentTime) : undefined;
            const cached = this.cache.get(cue?.text ?? (this.timeline.length ? '' : this.last));
            if (video?.paused && !video.ended && video.isConnected && cached) this.render(cached, video);
            else if (this.overlay) this.overlay.hidden = true;
            return;
        }
        if (media.video !== this.activeVideo || media.key !== this.mediaKey) this.prepare(media);
        else if (this.timelineRetry && Date.now() >= this.timelineRetry) { this.timelineRetry = 0; this.loadTimeline(media.video); }
        const current = this.current();
        const timelineVideo=this.timelineVideo;
        if(timelineVideo&&this.timeline.length){
            const ccOff=this.isYouTubeWatch()&&document.querySelector('.ytp-subtitles-button')?.getAttribute('aria-pressed')==='false';
            const enabled=(this.track?this.track.mode!=='disabled':true)&&!ccOff;
            if(!enabled||timelineVideo.paused||timelineVideo.ended||!timelineVideo.isConnected){if(this.overlay)this.overlay.hidden=true;return;}
            const cue=activeCaption(this.timeline,timelineVideo.currentTime);
            const translated=cue?this.cache.get(cue.text):undefined;
            if(translated)this.render(translated,timelineVideo);
            else if(cue)this.render(Date.now()<this.retryAfter?(this.lastError||'字幕翻譯失敗，稍後重試'):'字幕預翻譯中…',timelineVideo);
            else if(this.overlay)this.overlay.hidden=true;
            if(cue&&!translated&&!this.inFlight.has(cue.text)&&this.inFlight.size>0&&!this.urgent&&Date.now()>=this.retryAfter){
                this.urgent=true;this.prefetch(this.window(timelineVideo.currentTime,cue.text),true);
            }
            if(!this.inFlight.size&&Date.now()>=this.retryAfter){
                // Include upcoming cues immediately so a slow reply does not chase expired lines.
                const batch=this.window(timelineVideo.currentTime, cue?.text);
                if(batch.length)this.prefetch(batch);
            }
            return;
        }
        if (!current) {
            const ccEnabled=document.querySelector('.ytp-subtitles-button')?.getAttribute('aria-pressed')==='true';
            this.controls.setStatus(this.loading?'正在讀取字幕軌…':ccEnabled?'字幕待命中（目前片段無對白）':'尚未讀取到字幕，請確認 CC 已開啟');
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
            const growing = this.last && text.startsWith(this.last);
            this.last = text;
            this.revision++;
            if (growing && !/[.!?。！？]["')\]]*$/.test(text)) {
                this.stableSince = Date.now() + 350;
            } else {
                this.stableSince = 0;
                if (this.overlay)
                    this.overlay.hidden = true;
            }
        }
        const existing = this.cache.get(text);
        if (existing) {
            this.render(existing, video);
            return;
        }
        this.controls.setStatus(Date.now()<this.retryAfter?(this.lastError||'字幕翻譯失敗，稍後重試；請檢查服務設定'):'即時字幕翻譯中；字幕軌尚未載入，無法預讀');
        if (this.inFlight.size > 0 || text.length > 12000 || Date.now() < this.retryAfter || Date.now() < this.stableSince)
            return;
        this.lastStable = text;
        const revision = this.revision;
        const session = this.session;
        this.inFlight.set(text, session);
        void this.translate([text]).then(results => {
            if (session !== this.session)
                return;
            const result = results[0];
            if (!result)
                return;
            this.lastError = '';
            this.cache.set(text, result);
            if (this.cache.size > 300) {
                const oldest = this.cache.keys().next().value;
                if (oldest !== undefined)
                    this.cache.delete(oldest);
            }
            if (this.revision === revision && this.last === text || this.last.startsWith(text))
                this.render(result, video);
        }).catch(error => {
            if (session === this.session) {
                this.lastError = error instanceof Error && error.message ? error.message : '字幕翻譯失敗，稍後重試；請檢查服務設定';
                this.retryAfter = Date.now() + 15000;
            }
        }).finally(() => {
            if (this.inFlight.get(text) === session) this.inFlight.delete(text);
        });
    }
}
