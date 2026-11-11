import { WordLookup } from './lookup';
import {translateSubtitles} from '../core/messages';
import {applyTranslationStyle, maskStyles} from '../core/styles';
import { translationDirection } from './interaction';
import { type Mode, type PublicSettings, sitePolicy } from '../core/settings';
import { candidate, compactTranslation, changed, collectBlocks, normalizedText, OWN_ATTRIBUTE, replaceText, restoreText, sourceNodes, splitText, type SourceText } from './dom';
import { TranslationPanel } from './panel';
import { SubtitleTranslator } from './subtitles';
type ResultState = {
    kind: 'idle';
} | {
    kind: 'pending';
} | {
    kind: 'ready';
    text: string;
} | {
    kind: 'error';
};
interface Block {
    element: HTMLElement;
    nodes: SourceText[];
    source: string;
    result: ResultState;
    output: HTMLElement | null;
    revision: number;
}
export class PageTranslator {
    private mode: Mode = 'original';
    private epoch = 0;
    private blocks = new Map<HTMLElement, Block>();
    private visible = new Set<HTMLElement>();
    private pending = new Set<Block>();
    private flushing = false;
    private scanTimer: number | null = null;
    private stopped = false;
    private lastUrl = location.href;
    private readonly panel = new TranslationPanel();
    private readonly themeStyles = document.createElement('style');
    private readonly lookup: WordLookup;
    private readonly subtitles: SubtitleTranslator;
    private readonly intersections: IntersectionObserver;
    private readonly mutations: MutationObserver;
    private readonly navigationTimer: number;
    constructor(private settings: PublicSettings, private readonly translate: (texts: string[]) => Promise<string[]>) {
        this.lookup = new WordLookup(() => this.settings);
        this.themeStyles.setAttribute(OWN_ATTRIBUTE, 'styles');
        this.themeStyles.textContent = maskStyles;
        document.documentElement.append(this.themeStyles);
        this.subtitles = new SubtitleTranslator(translateSubtitles);
        this.intersections = new IntersectionObserver(entries => {
            for (const entry of entries) {
                if (!(entry.target instanceof HTMLElement))
                    continue;
                if (entry.isIntersecting) {
                    this.visible.add(entry.target);
                    const block = this.blocks.get(entry.target);
                    if (block)
                        this.enqueue(block);
                }
                else
                    this.visible.delete(entry.target);
            }
        }, { rootMargin: '200px' });
        this.mutations = new MutationObserver(records => {
            if (records.some(record => !this.ownedMutation(record)))
                this.scheduleScan();
        });
        this.mutations.observe(document.documentElement, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ['hidden', 'inert', 'aria-hidden', 'contenteditable', 'translate'] });
        document.addEventListener('keydown', this.keyDown, true);
        this.navigationTimer = window.setInterval(() => {
            if (location.href !== this.lastUrl) {
                this.lastUrl = location.href;
                this.reset(this.settings);
            }
        }, 750);
        if (sitePolicy(location.hostname, settings) === 'auto')
            this.setMode(settings.mode);
    }
    private ownedMutation(record: MutationRecord): boolean {
        const element = record.target instanceof Element ? record.target : record.target.parentElement;
        if (element?.closest(`[${OWN_ATTRIBUTE}]`))
            return true;
        if (record.type === 'childList')
            return Array.from(record.addedNodes).concat(Array.from(record.removedNodes)).every(node => node instanceof Element && node.hasAttribute(OWN_ATTRIBUTE));
        // Translation-only mode changes existing text nodes. These writes are expected.
        if (record.type === 'characterData' && record.target instanceof Text) {
            for (const block of this.blocks.values())
                if (block.nodes.some(n => n.node === record.target && n.node.data === (n.written ?? n.original)))
                    return true;
        }
        return false;
    }
    private scheduleScan(): void {
        if (this.scanTimer !== null || this.stopped)
            return;
        this.scanTimer = window.setTimeout(() => { this.scanTimer = null; this.scan(); }, 100);
    }
    private discard(block: Block): void { block.revision++; restoreText(block.nodes); block.output?.remove(); this.intersections.unobserve(block.element); this.visible.delete(block.element); this.pending.delete(block); this.blocks.delete(block.element); }
    private scan(): void {
        if (this.stopped)
            return;
        for (const block of this.blocks.values()) {
            if (!block.element.isConnected) {
                this.discard(block);
                continue;
            }
            if (changed(block.nodes) || block.nodes.some(n => !block.element.contains(n.node)) || sourceNodes(block.element).some(n => !block.nodes.some(known => known.node === n.node))) {
                restoreText(block.nodes);
                block.output?.remove();
                block.output = null;
                block.nodes = sourceNodes(block.element);
                block.source = normalizedText(block.nodes);
                block.revision++;
                block.result = { kind: 'idle' };
            }
            if (!candidate(block.element)) {
                this.discard(block);
                continue;
            }
            // A framework owns its children. Do not fight it by repeatedly reinserting
            // output it removed. A source change or explicit mode switch renders again.
        }
        if (this.mode !== 'original')
            for (const element of collectBlocks(document.body))
                this.track(element);
        for (const block of this.blocks.values())
            if (this.visible.has(block.element))
                this.enqueue(block);
    }
    private track(element: HTMLElement): Block {
        const prior = this.blocks.get(element);
        if (prior)
            return prior;
        const nodes = sourceNodes(element);
        const block: Block = { element, nodes, source: normalizedText(nodes), result: { kind: 'idle' }, output: null, revision: 0 };
        this.blocks.set(element, block);
        this.intersections.observe(element);
        return block;
    }
    private enqueue(block: Block): void {
        if (sitePolicy(location.hostname, this.settings) === 'blocked' || !block.source || block.result.kind !== 'idle' || this.mode === 'original')
            return;
        this.pending.add(block);
        void this.flush();
    }
    private async translateLong(texts: string[], current: () => boolean = () => true): Promise<string[]> {
        const maxChunkCharacters = 6000;
        const maxRequestCharacters = 60000;
        const parts = texts.map(text => splitText(text, maxChunkCharacters));
        const all = parts.flat();
        const translated: string[] = [];
        const batchSize = Math.min(this.settings.batchSize, Math.floor(maxRequestCharacters / maxChunkCharacters));
        for (let start = 0; start < all.length; start += batchSize) {
            if (!current()) throw new Error('翻譯已停止。');
            const batch = all.slice(start, start + batchSize);
            const results = await this.translate(batch);
            if (results.length !== batch.length)
                throw new Error('翻譯結果數量不符，請重試。');
            translated.push(...results);
        }
        let offset = 0;
        return parts.map(part => { const value = translated.slice(offset, offset + part.length).join(' '); offset += part.length; return value; });
    }
    private async flush(): Promise<void> {
        if (this.flushing)
            return;
        this.flushing = true;
        try {
            while (this.pending.size) {
                const batch = Array.from(this.pending).slice(0, this.settings.batchSize);
                const epoch = this.epoch;
                const requests = batch.map(block => ({ block, revision: block.revision }));
                for (const block of batch) {
                    this.pending.delete(block);
                    block.result = { kind: 'pending' };
                }
                try {
                    const texts = await this.translateLong(batch.map(block => block.source), () => epoch === this.epoch && !this.stopped);
                    requests.forEach(({ block, revision }, index) => {
                        const text = texts[index];
                        if (text === undefined || epoch !== this.epoch || revision !== block.revision || !block.element.isConnected || changed(block.nodes))
                            return;
                        block.result = { kind: 'ready', text: text.trim() === block.source.trim() ? '' : text };
                        this.render(block);
                    });
                }
                catch (error) {
                    for (const { block, revision } of requests)
                        if (epoch === this.epoch && revision === block.revision) {
                            block.result = { kind: 'error' };
                            this.renderError(block);
                        }
                    if (epoch === this.epoch)
                        this.panel.show(error instanceof Error ? error.message : '翻譯失敗，請檢查服務設定。');
                }
            }
        }
        finally {
            this.flushing = false;
        }
    }
    private makeOutput(block: Block): HTMLElement {
        const output = document.createElement('span');
        output.setAttribute(OWN_ATTRIBUTE, 'result');
        output.lang = this.settings.target;
        output.dir = translationDirection(this.settings.target);
        applyTranslationStyle(output, this.settings.style);
        if (compactTranslation(block.element, block.source)) {
            Object.assign(output.style, { display: 'inline', margin: '0', marginInlineStart: '0.5em', lineHeight: 'inherit', whiteSpace: 'inherit', overflowWrap: 'normal' });
            // Keep the translation with the source label, inside any block/flex
            // wrappers the site uses, rather than introducing a new layout item.
            const label = [...block.nodes].reverse().find(node => /\p{L}/u.test(node.original))?.node.parentElement;
            (label && block.element.contains(label) ? label : block.element).append(output);
        } else {
            block.element.append(output);
        }
        block.output = output;
        return output;
    }
    private render(block: Block): void {
        block.output?.remove();
        block.output = null;
        restoreText(block.nodes);
        if (block.result.kind !== 'ready' || !block.result.text)
            return;
        if (this.mode === 'translated')
            replaceText(block.nodes, block.result.text);
        else if (this.mode !== 'original')
            this.makeOutput(block).textContent = block.result.text;
    }
    private renderError(block: Block): void {
        if (this.mode === 'original')
            return;
        block.output?.remove();
        const output = this.makeOutput(block);
        const retry = document.createElement('button');
        retry.type = 'button';
        retry.textContent = '翻譯失敗，點此重試';
        retry.style.cssText = 'font:inherit;color:inherit;background:transparent;border:0;cursor:pointer;text-decoration:underline';
        retry.onclick = event => { event.preventDefault(); event.stopPropagation(); output.remove(); block.output = null; block.result = { kind: 'idle' }; this.enqueue(block); };
        output.append(retry);
    }
    setMode(mode: Mode): void {
        this.epoch++;
        this.panel.close();
        this.lookup.close();
        this.pending.clear();
        this.mode = sitePolicy(location.hostname, this.settings) === 'blocked' ? 'original' : mode;
        for (const block of this.blocks.values()) {
            if (block.result.kind === 'pending' || block.result.kind === 'error')
                block.result = { kind: 'idle' };
            this.render(block);
        }
        if (this.mode !== 'original') {
            this.scan();
            if (this.settings.subtitles)
                this.subtitles.start();
        }
        else
            this.subtitles.stop();
    }
    getMode(): Mode { return this.mode; }
    status(): {
        mode: Mode;
        paragraphs: number;
        translated: number;
    } { return { mode: this.mode, paragraphs: this.blocks.size, translated: Array.from(this.blocks.values()).filter(block => block.result.kind === 'ready').length }; }
    reset(settings: PublicSettings, mode: Mode = this.mode): void {
        this.epoch++;
        this.pending.clear();
        for (const block of this.blocks.values())
            this.discard(block);
        this.settings = settings;
        this.subtitles.stop();
        this.setMode(mode);
    }
    async selection(text?: string): Promise<void> {
        if (this.stopped || sitePolicy(location.hostname, this.settings) === 'blocked')
            return;
        const selected = (text ?? window.getSelection()?.toString() ?? '').trim();
        if (!selected)
            return;
        if (selected.length > 12000) {
            this.panel.show('選取內容超過 12,000 字元，請分段翻譯。');
            return;
        }
        this.lookup.close();
        const epoch = this.epoch;
        await this.panel.translate(selected, texts => this.translateLong(texts, () => epoch === this.epoch && !this.stopped));
    }
    private readonly keyDown = (event: KeyboardEvent): void => {
        if (event.key === 'Escape') this.panel.close();
    };
    dispose(): void {
        this.lookup.dispose();
        this.stopped = true;
        this.epoch++;
        this.pending.clear();
        this.mutations.disconnect();
        this.intersections.disconnect();
        if (this.scanTimer !== null)
            clearTimeout(this.scanTimer);
        clearInterval(this.navigationTimer);
        for (const block of this.blocks.values())
            this.discard(block);
        this.subtitles.stop();
        this.panel.close();
        this.themeStyles.remove();
        document.removeEventListener('keydown', this.keyDown, true);
    }
}
