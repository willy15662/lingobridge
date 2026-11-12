import { rpc } from '../core/messages';
import { imageResultSchema, type ImageResult } from '../core/images';
import { OWN_ATTRIBUTE, isExcluded } from './dom';
import { sitePolicy, type PublicSettings } from '../core/settings';
import { translationDirection } from './interaction';

type Tile = { kind: 'ready'; height: number; result: ImageResult } | { kind: 'error'; message: string } | { kind: 'pending' };
interface ImageState {
    image: HTMLImageElement;
    source: string;
    tiles: Map<number, Tile>;
    decoded: Promise<HTMLImageElement> | null;
    host: HTMLDivElement | null;
    original: boolean;
    revision: number;
    renderedKey: string;
}
interface ImageServices {
    translate(data: string): Promise<ImageResult>;
    read(url: string): Promise<string>;
}
const services: ImageServices = {
    translate: async data => imageResultSchema.parse(await rpc({ kind: 'image.translate', data })),
    read: async url => { const data = await rpc({ kind: 'image.read', url }); if (typeof data !== 'string') throw new Error('圖片讀取失敗。'); return data; },
};
/** Only intersecting image tiles are encoded and submitted. Never scans page text. */
export class ImageTranslator {
    private states = new Map<HTMLImageElement, ImageState>();
    private visible = new Set<HTMLImageElement>();
    private observer: IntersectionObserver | null = null;
    private mutations: MutationObserver | null = null;
    private running = false;
    private epoch = 0;
    private timer: number | null = null;
    private frame: number | null = null;
    constructor(private readonly settings: () => PublicSettings, private readonly api: ImageServices = services) {}
    start(): void {
        if (this.observer) return;
        this.observer = new IntersectionObserver(entries => {
            for (const entry of entries) if (entry.target instanceof HTMLImageElement) {
                if (entry.isIntersecting) this.visible.add(entry.target);
                else {
                    this.visible.delete(entry.target);
                    const state = this.states.get(entry.target);
                    state?.host?.remove();
                    if (state) {
                        state.host = null;
                        state.renderedKey = '';
                        if (this.visibleTiles(state).length === 0) state.decoded = null;
                    }
                }
            }
            this.schedule();
        });
        this.mutations = new MutationObserver(records => {
            const changed = records.flatMap(record => Array.from(record.addedNodes).concat(Array.from(record.removedNodes))).filter((node): node is Element => node instanceof Element && !node.closest(`[${OWN_ATTRIBUTE}]`));
            if (records.some(record => record.type === 'attributes' && record.target instanceof HTMLImageElement) || changed.some(node => node.matches('img') || node.querySelector('img'))) this.scan();
            else if (changed.some(node => node.matches('video') || node.querySelector('video'))) this.schedule();
        });
        this.mutations.observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ['src', 'srcset'] });
        window.addEventListener('scroll', this.onViewportChange, true);
        window.addEventListener('resize', this.onViewportChange);
        document.addEventListener('load', this.loaded, true);
        this.scan();
    }
    private allowed(): boolean { return this.settings().images && sitePolicy(location.hostname, this.settings()) !== 'blocked'; }
    private readonly loaded = (event: Event): void => { if (event.target instanceof HTMLImageElement) this.scan(); };
    private scan(): void {
        for (const [image, state] of this.states) if (!image.isConnected || state.source !== image.currentSrc) {
            state.host?.remove(); this.observer?.unobserve(image); this.visible.delete(image); this.states.delete(image);
        }
        for (const image of document.images) {
            if (this.states.has(image) || isExcluded(image) || image.closest('nav,header,[role="navigation"],a[href*="/watch"],a[href*="youtu.be"]')) continue;
            this.states.set(image, { image, source: image.currentSrc, tiles: new Map(), decoded: null, host: null, original: false, revision: 0, renderedKey: '' });
            this.observer?.observe(image);
        }
        this.schedule();
    }
    private readonly onViewportChange = (): void => {
        if (!this.observer) return;
        if (this.frame === null) {
            this.frame = window.requestAnimationFrame(() => {
                this.frame = null;
                for (const image of this.visible) { const state = this.states.get(image); if (state) this.render(state); }
            });
        }
        this.schedule();
    };
    private readonly schedule = (): void => {
        if (!this.observer || this.timer !== null) return;
        this.timer = window.setTimeout(() => { this.timer = null; for (const image of this.visible) { const state = this.states.get(image); if (state) this.render(state); } void this.flush(); }, 120);
    };
    private eligible(state: ImageState): boolean {
        const image = state.image; const rect = image.getBoundingClientRect();
        return image.isConnected && image.complete && image.naturalWidth >= 160 && image.naturalHeight >= 80 && rect.width >= 140 && rect.height >= 80 && rect.bottom > 0 && rect.top < innerHeight && rect.right > 0 && rect.left < innerWidth && getComputedStyle(image).visibility !== 'hidden';
    }
    private visibleTiles(state: ImageState): number[] {
        const image = state.image; const rect = image.getBoundingClientRect();
        const height = Math.min(1800, Math.round(image.naturalWidth * 1.5));
        const start = Math.max(0, -rect.top / rect.height * image.naturalHeight);
        const end = Math.min(image.naturalHeight, (innerHeight - rect.top) / rect.height * image.naturalHeight);
        const tiles: number[] = [];
        for (let y = Math.floor(start / height) * height; y < end; y += height) if (!state.tiles.has(y)) tiles.push(y);
        return tiles;
    }
    private async pixels(state: ImageState, y: number, height: number): Promise<string> {
        const image = state.image;
        const canvas = document.createElement('canvas');
        const scale = Math.min(1, 1600 / image.naturalWidth, 1800 / height);
        canvas.width = Math.max(1, Math.round(image.naturalWidth * scale)); canvas.height = Math.max(1, Math.round(height * scale));
        const context = canvas.getContext('2d'); if (!context) throw new Error('無法讀取圖片像素。');
        const encode = (source: HTMLImageElement): string => {
            context.fillStyle = '#fff'; context.fillRect(0, 0, canvas.width, canvas.height);
            context.drawImage(source, 0, y, source.naturalWidth, height, 0, 0, canvas.width, canvas.height);
            const data = canvas.toDataURL('image/jpeg', 0.92);
            if (data.length > 4500000) throw new Error('圖片區塊過大。');
            return data;
        };
        try { return encode(image); }
        catch {
            state.decoded ??= this.api.read(state.source).then(async data => { const decoded = new Image(); decoded.src = data; await decoded.decode(); return decoded; });
            const decoded = await state.decoded;
            // A tainted canvas stays tainted after clearRect; reset its bitmap.
            canvas.width = canvas.width;
            return encode(decoded);
        }
    }
    private async flush(): Promise<void> {
        if (this.running || !this.allowed() || !this.observer) return;
        // Video pages reserve automatic work for subtitles, including thumbnails.
        if (document.querySelector('video')) return;
        this.running = true; const epoch = this.epoch;
        try {
            for (const image of this.visible) {
                const state = this.states.get(image);
                if (!state || !this.eligible(state)) continue;
                for (const y of this.visibleTiles(state)) {
                    if (epoch !== this.epoch || !this.observer || !this.allowed() || !this.visible.has(image) || !this.eligible(state) || state !== this.states.get(image) || document.querySelector('video')) return;
                    if (!this.visibleTiles(state).includes(y)) continue;
                    const height = Math.min(1800, Math.round(image.naturalWidth * 1.5), image.naturalHeight - y);
                    state.tiles.set(y, { kind: 'pending' }); state.revision++; this.render(state);
                    try {
                        const data = await this.pixels(state, y, height);
                        if (epoch !== this.epoch || state !== this.states.get(image) || !this.visible.has(image) || document.querySelector('video')) { state.tiles.delete(y); state.revision++; return; }
                        const result = await this.api.translate(data);
                        if (epoch !== this.epoch || state !== this.states.get(image)) return;
                        state.tiles.set(y, { kind: 'ready', height, result }); state.revision++;
                    } catch (error) {
                        if (epoch !== this.epoch || state !== this.states.get(image)) return;
                        state.tiles.set(y, { kind: 'error', message: error instanceof Error ? error.message : '圖片翻譯失敗。' }); state.revision++;
                    }
                    this.render(state);
                }
            }
        } finally {
            this.running = false;
            if (this.observer && !document.querySelector('video') && Array.from(this.visible).some(image => { const state = this.states.get(image); return state && this.eligible(state) && this.visibleTiles(state).length > 0; })) this.schedule();
        }
    }
    private render(state: ImageState): void {
        if (document.querySelector('video') || !state.tiles.size || !this.visible.has(state.image) || !this.eligible(state) || !this.allowed()) { state.host?.remove(); state.host = null; state.renderedKey = ''; return; }
        const rect = state.image.getBoundingClientRect();
        if (!state.host) { state.host = document.createElement('div'); state.host.setAttribute(OWN_ATTRIBUTE, 'image'); document.documentElement.append(state.host); state.renderedKey = ''; }
        Object.assign(state.host.style, { position: 'fixed', left: rect.left + 'px', top: rect.top + 'px', width: rect.width + 'px', height: rect.height + 'px', pointerEvents: 'none', zIndex: '2147483645', overflow: 'hidden' });
        const key = `${state.revision}:${state.original}:${Math.round(rect.width)}:${Math.round(rect.height)}:${this.settings().target}`;
        const shadow = state.host.shadowRoot ?? state.host.attachShadow({ mode: 'open' });
        if (state.renderedKey === key) {
            const controls = shadow.querySelector<HTMLElement>('.controls');
            if (controls) controls.style.top = Math.max(4, -rect.top + 4) + 'px';
            return;
        }
        state.renderedKey = key;
        const style = document.createElement('style');
        style.textContent = ':host{all:initial}.region{box-sizing:border-box;position:absolute;display:flex;align-items:center;justify-content:center;text-align:center;white-space:pre-wrap;overflow:hidden;overflow-wrap:anywhere;background:#fff;color:#191919;padding:2px;border-radius:3px;font-family:system-ui,sans-serif;line-height:1.2}.controls{position:absolute;left:4px;display:flex;gap:4px;max-width:calc(100% - 8px);pointer-events:auto}button{font:12px/1.5 system-ui,sans-serif;padding:4px 7px;background:#211e25eF;border:1px solid #98879f;color:white;border-radius:6px;cursor:pointer;max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}button:focus-visible{outline:2px solid #dba4c3}';
        const nodes: Node[] = [style];
        let regions = 0;
        for (const [y, tile] of state.tiles) if (tile.kind === 'ready') for (const region of tile.result.regions) {
            regions++;
            if (state.original) continue;
            const [top, left, bottom, right] = region.box;
            const span = document.createElement('span'); span.className = 'region'; span.textContent = region.translation; span.lang = this.settings().target; span.dir = translationDirection(this.settings().target);
            const width = (right - left) / 1000 * rect.width;
            const height = (bottom - top) / 1000 * tile.height / state.image.naturalHeight * rect.height;
            const lines = Math.max(1, Math.ceil(region.translation.length / Math.max(1, width / 14)));
            Object.assign(span.style, { left: left / 10 + '%', top: (y + top / 1000 * tile.height) / state.image.naturalHeight * 100 + '%', width: (right - left) / 10 + '%', height: height + 'px', fontSize: Math.max(9, Math.min(24, height / (lines * 1.2))) + 'px' });
            span.setAttribute('aria-label', region.source + '：' + region.translation); nodes.push(span);
        }
        const controls = document.createElement('div'); controls.className = 'controls'; controls.style.top = Math.max(4, -rect.top + 4) + 'px';
        const error = Array.from(state.tiles.values()).find(tile => tile.kind === 'error');
        const pending = Array.from(state.tiles.values()).some(tile => tile.kind === 'pending');
        if (!error && !pending && !regions) { state.host.remove(); state.host = null; state.renderedKey = ''; return; }
        const toggle = document.createElement('button'); toggle.type = 'button';
        toggle.textContent = error ? '圖片翻譯失敗，點此重試' : pending ? '圖片翻譯中…' : regions ? state.original ? '顯示譯文' : '顯示原圖' : '未辨識到文字';
        if (error?.kind === 'error') toggle.title = error.message;
        toggle.onclick = () => { if (error) { for (const [y, tile] of state.tiles) if (tile.kind === 'error') state.tiles.delete(y); state.decoded = null; state.revision++; this.schedule(); } else { state.original = !state.original; this.render(state); } };
        controls.append(toggle); nodes.push(controls); shadow.replaceChildren(...nodes);
    }
    stop(): void {
        this.epoch++; this.observer?.disconnect(); this.observer = null; this.mutations?.disconnect(); this.mutations = null;
        if (this.timer !== null) clearTimeout(this.timer); this.timer = null;
        if (this.frame !== null) cancelAnimationFrame(this.frame); this.frame = null;
        for (const state of this.states.values()) state.host?.remove(); this.states.clear(); this.visible.clear();
        window.removeEventListener('scroll', this.onViewportChange, true); window.removeEventListener('resize', this.onViewportChange); document.removeEventListener('load', this.loaded, true);
    }
}
