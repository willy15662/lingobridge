import { rpc } from '../core/messages';
import { dictionarySchema, type LookupInput, type DictionaryEntry, type VocabularyDraft } from '../core/vocabulary';
import { sitePolicy, type PublicSettings } from '../core/settings';
import { isExcluded, normalizedText, OWN_ATTRIBUTE, sourceNodes } from './dom';
import { wordDetails, wordCardStyles } from '../ui/word-card';

type Anchor = Pick<DOMRect, 'left' | 'top' | 'bottom'>;
interface LookupServices {
    lookup(input: LookupInput): Promise<DictionaryEntry>;
    save(draft: VocabularyDraft): Promise<unknown>;
    open(): Promise<unknown>;
}
const services: LookupServices = {
    lookup: async input => dictionarySchema.parse(await rpc({ kind: 'dictionary.lookup', ...input })),
    save: draft => rpc({ kind: 'vocabulary.save', draft }),
    open: () => rpc({ kind: 'vocabulary.open' }),
};
export function isPhrase(text: string): boolean {
    return text.length > 0 && text.length <= 160 && text.trim().split(/\s+/).length <= 12;
}
export function lookupContext(element: Element, term: string): string {
    const block = element.closest('p,li,td,th,blockquote,article') ?? element;
    const text = block instanceof HTMLElement ? normalizedText(sourceNodes(block)) : block.textContent ?? '';
    const index = text.toLocaleLowerCase().indexOf(term.toLocaleLowerCase());
    return text.slice(Math.max(0, index - 500), Math.max(0, index - 500) + 1600);
}
export function wordAtPoint(x: number, y: number): { input: LookupInput; anchor: Anchor; key: Text; offset: number } | null {
    const range = document.caretRangeFromPoint(x, y);
    if (!range || !(range.startContainer instanceof Text)) return null;
    const node = range.startContainer;
    const parent = node.parentElement;
    if (!parent || isExcluded(parent)) return null;
    const offset = range.startOffset;
    for (const match of node.data.matchAll(/[\p{L}\p{M}]+(?:['’\-][\p{L}\p{M}]+)*/gu)) {
        const start = match.index;
        if (offset < start || offset > start + match[0].length) continue;
        range.setStart(node, start);
        range.setEnd(node, start + match[0].length);
        const rect = Array.from(range.getClientRects()).find(r => x >= r.left && x <= r.right && y >= r.top && y <= r.bottom);
        if (!rect || !isPhrase(match[0])) return null;
        return { input: { term: match[0], context: lookupContext(parent, match[0]) }, anchor: rect, key: node, offset: start };
    }
    return null;
}
export class WordLookup {
    private host: HTMLDivElement | null = null;
    private timer: number | null = null;
    private preview: HTMLDivElement | null = null;
    private sequence = 0;
    private hovered: { node: Node; offset: number } | null = null;
    private lastShown = '';
    private pointer: { x: number; y: number } | null = null;
    private controlHeld = false;
    private controlChord = false;
    constructor(private readonly settings: () => PublicSettings, private readonly api: LookupServices = services) {
        document.addEventListener('pointermove', this.move, true);
        document.addEventListener('pointerdown', this.outside, true);
        document.addEventListener('keydown', this.key, true);
        document.addEventListener('keyup', this.keyUp, true);
        document.addEventListener('pointerout', this.leave, true);
        document.addEventListener('selectionchange', this.selectionChanged);
        window.addEventListener('scroll', this.resetPointer, true);
        window.addEventListener('blur', this.resetPointer);
    }
    private allowed(): boolean { return sitePolicy(location.hostname, this.settings()) !== 'blocked'; }
    private readonly cancel = (): void => {
        if (this.timer !== null) clearTimeout(this.timer);
        this.timer = null;
        this.hovered = null;
    };
    private readonly resetPointer = (): void => { this.cancel(); this.clearPreview(); this.pointer = null; this.controlHeld = false; this.controlChord = false; };
    private readonly selectionChanged = (): void => { this.cancel(); this.clearPreview(); };
    private clearPreview(): void { this.preview?.remove(); this.preview = null; }
    private readonly leave = (event: PointerEvent): void => { if (!event.relatedTarget) this.resetPointer(); };
    private readonly key = (event: KeyboardEvent): void => {
        if (event.key === 'Control' && !event.repeat && !event.altKey && !event.metaKey && !event.shiftKey) {
            this.controlHeld = true;
            this.controlChord = false;
            this.scheduleHover();
        } else if (event.key !== 'Control') {
            if (event.ctrlKey) this.controlChord = true;
            this.controlHeld = false;
            this.cancel();
            if (event.key === 'Escape') this.close();
        }
    };
    private readonly keyUp = (event: KeyboardEvent): void => {
        if (event.key === 'Control') { this.controlHeld = false; this.controlChord = false; this.cancel(); }
    };
    private readonly outside = (event: PointerEvent): void => {
        if (this.host && event.composedPath().includes(this.host) || this.preview && event.composedPath().includes(this.preview)) return;
        this.close();
    };
    private readonly move = (event: PointerEvent): void => {
        if (this.host && event.composedPath().includes(this.host) || this.preview && event.composedPath().includes(this.preview)) { this.cancel(); this.pointer = null; return; }
        if (event.pointerType === 'touch') { this.resetPointer(); return; }
        this.pointer = { x: event.clientX, y: event.clientY };
        if (!event.ctrlKey || this.controlChord || event.buttons || event.altKey || event.metaKey || event.shiftKey) { this.controlHeld = false; this.cancel(); return; }
        this.controlHeld = true;
        this.scheduleHover();
    };
    private scheduleHover(): void {
        if (!this.pointer || !this.controlHeld || !this.settings().hover || !this.allowed()) { this.cancel(); return; }
        const hit = this.hoverTarget();
        if (!hit) { this.cancel(); return; }
        if (this.hovered?.node === hit.key && this.hovered.offset === hit.offset) return;
        this.cancel();
        this.hovered = { node: hit.key, offset: hit.offset };
        this.timer = window.setTimeout(() => {
            this.timer = null;
            const current = this.pointer && this.controlHeld ? this.hoverTarget() : null;
            if (current?.key === hit.key && current.offset === hit.offset && current.input.term === hit.input.term)
                this.showPreview(current.input, current.anchor);
        }, 700);
    }
    private hoverTarget(): { input: LookupInput; anchor: Anchor; key: Node; offset: number } | null {
        if (!this.pointer) return null;
        const selection = window.getSelection();
        const term = selection?.toString().trim() ?? '';
        if (!term) return wordAtPoint(this.pointer.x, this.pointer.y);
        if (!selection?.rangeCount || !isPhrase(term)) return null;
        const range = selection.getRangeAt(0);
        const parent = range.startContainer instanceof Element ? range.startContainer : range.startContainer.parentElement;
        if (!parent || isExcluded(parent)) return null;
        const point = this.pointer;
        const rect = Array.from(range.getClientRects()).find(r => point.x >= r.left && point.x <= r.right && point.y >= r.top && point.y <= r.bottom);
        return rect ? { input: { term, context: lookupContext(parent, term) }, anchor: rect, key: range.startContainer, offset: range.startOffset } : null;
    }
    private showPreview(input: LookupInput, anchor: Anchor): void {
        this.clearPreview();
        const host = document.createElement('div');
        host.setAttribute(OWN_ATTRIBUTE, 'lookup-action');
        Object.assign(host.style, { position: 'fixed', zIndex: '2147483647', left: Math.max(6, Math.min(anchor.left, innerWidth - 34)) + 'px', top: Math.max(6, Math.min(anchor.bottom + 5, innerHeight - 34)) + 'px' });
        const shadow = host.attachShadow({ mode: 'open' });
        const style = document.createElement('style');
        style.textContent = ':host{all:initial}button{box-sizing:border-box;width:28px;height:28px;padding:0;border:1px solid #d5d9e2;border-radius:5px;background:#fff;color:#4285f4;box-shadow:0 2px 8px #0002;cursor:pointer;font:bold 17px/1 system-ui;position:relative}small{font-size:10px;position:absolute;right:2px;bottom:2px;color:#687388;background:#fff}button:focus-visible{outline:2px solid #4285f4;outline-offset:2px}@media(prefers-color-scheme:dark){button{background:#282b32;border-color:#565a65;color:#a7c5ff}small{background:#282b32;color:#c1c8d5}}';
        const button = document.createElement('button');
        button.type = 'button'; button.title = '查詢單字／片語'; button.setAttribute('aria-label', '查詢單字／片語');
        button.textContent = '文'; const latin = document.createElement('small'); latin.textContent = 'A'; button.append(latin);
        button.onpointerdown = event => event.preventDefault();
        button.onclick = event => { event.preventDefault(); event.stopPropagation(); void this.show(input, anchor); };
        shadow.append(style, button); document.documentElement.append(host); this.preview = host;
    }
    async show(input: LookupInput, anchor?: Anchor): Promise<void> {
        if (!this.allowed()) return;
        const identity = JSON.stringify([input, this.settings().target]);
        if (this.host?.isConnected && this.lastShown === identity) return;
        this.close();
        this.lastShown = identity;
        const sequence = this.sequence;
        const target = this.settings().target;
        const host = document.createElement('div');
        host.setAttribute(OWN_ATTRIBUTE, 'lookup');
        const width = Math.min(460, window.innerWidth - 24);
        const left = Math.max(12, Math.min(anchor?.left ?? window.innerWidth - width - 20, window.innerWidth - width - 12));
        Object.assign(host.style, { position: 'fixed', zIndex: '2147483647', left: left + 'px', top: '12px', width: width + 'px' });
        const shadow = host.attachShadow({ mode: 'open' });
        const style = document.createElement('style');
        style.textContent = `:host{all:initial;color-scheme:light dark;--muted:#81798a;--border:#e8e0eb;--soft:#f8f4f8}*{box-sizing:border-box}.box{font:15px/1.65 system-ui,sans-serif;color:#302a39;background:#fff;border:1px solid var(--border);border-radius:16px;box-shadow:0 14px 60px #0003;padding:20px;max-height:min(620px,calc(100vh - 24px));overflow:auto}header,footer{display:flex;align-items:center;justify-content:space-between;gap:10px}header{margin-bottom:18px;font-size:12px;color:var(--muted)}h2{font-size:25px;line-height:1.3;margin:10px 0;overflow-wrap:anywhere}button{font:inherit;color:#a83f6d;background:var(--soft);border:1px solid var(--border);border-radius:8px;padding:6px 10px;cursor:pointer}button:disabled{opacity:.6;cursor:default}button:focus-visible{outline:2px solid #bb527c;outline-offset:3px}footer{margin-top:20px;flex-wrap:wrap}footer button:first-child{background:#b94d7b;color:white;border-color:transparent}.status{color:var(--muted);font-size:13px}p{white-space:pre-wrap}${wordCardStyles}@media(prefers-color-scheme:dark){:host{--muted:#b3abbc;--border:#433b49;--soft:#28232d}.box{background:#211e25;color:#eee8f1}button{color:#efa6c7}}`;
        const box = document.createElement('section');
        box.className = 'box';
        box.setAttribute('role', 'dialog');
        box.setAttribute('aria-label', `查詞：${input.term}`);
        const header = document.createElement('header');
        header.textContent = '雙語閱讀 · 查詞';
        const close = document.createElement('button');
        close.type = 'button'; close.textContent = '關閉'; close.onclick = () => this.close();
        header.append(close);
        const title = document.createElement('h2'); title.textContent = input.term;
        const body = document.createElement('div');
        const status = document.createElement('p'); status.className = 'status'; status.setAttribute('role', 'status');
        status.textContent = '正在查詢詞意與例句…';
        const footer = document.createElement('footer');
        const save = document.createElement('button'); save.type = 'button'; save.textContent = '加入單字本'; save.disabled = true;
        const open = document.createElement('button'); open.type = 'button'; open.textContent = '開啟單字本';
        open.onclick = () => { void this.api.open().catch(() => { status.textContent = '無法開啟單字本，請重新載入頁面。'; }); };
        footer.append(save, open);
        box.append(header, title, body, status, footer);
        shadow.append(style, box); document.documentElement.append(host); this.host = host;
        const position = (): void => {
            const height = box.getBoundingClientRect().height;
            const below = (anchor?.bottom ?? 12) + 10;
            const top = below + height <= innerHeight - 12 ? below : Math.max(12, (anchor?.top ?? innerHeight) - height - 10);
            host.style.top = top + 'px';
        };
        position();
        const load = async (): Promise<void> => {
            status.textContent = '正在查詢詞意與例句…';
            try {
                const entry = await this.api.lookup(input);
                if (sequence !== this.sequence) return;
                body.replaceChildren(wordDetails(input.term, entry, target));
                status.textContent = 'AI 詞意與例句，依目前上下文解釋。';
                save.disabled = false;
                save.onclick = () => {
                    save.disabled = true;
                    void this.api.save({ ...input, target, entry }).then(() => {
                        if (sequence !== this.sequence) return;
                        save.textContent = '已加入單字本'; status.textContent = '已儲存在這台裝置，可到單字本複習。';
                    }).catch(() => { if (sequence === this.sequence) { save.disabled = false; status.textContent = '儲存失敗，請再試一次。'; } });
                };
                position();
            } catch (error) {
                if (sequence !== this.sequence) return;
                status.textContent = error instanceof Error ? error.message : '查詞失敗，請重試。';
                const retry = document.createElement('button'); retry.type = 'button'; retry.textContent = '重新查詢';
                retry.onclick = () => { body.replaceChildren(); void load(); };
                body.replaceChildren(retry); position();
            }
        };
        await load();
    }
    close(): void { this.cancel(); this.clearPreview(); this.sequence++; this.host?.remove(); this.host = null; this.lastShown = ''; }
    dispose(): void {
        this.close();
        document.removeEventListener('pointermove', this.move, true);
        document.removeEventListener('pointerdown', this.outside, true);
        document.removeEventListener('keydown', this.key, true);
        document.removeEventListener('keyup', this.keyUp, true);
        document.removeEventListener('pointerout', this.leave, true);
        document.removeEventListener('selectionchange', this.selectionChanged);
        window.removeEventListener('scroll', this.resetPointer, true);
        window.removeEventListener('blur', this.resetPointer);
    }
}
