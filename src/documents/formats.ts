import { readZip, writeZip, type ZipEntry } from './zip';
export type OutputMode = 'bilingual' | 'translated';
export interface Segment {
    source: string;
    translation: string | null;
}
export interface TranslationDocument {
    title: string;
    kind: 'text' | 'markdown' | 'html' | 'subtitle' | 'epub' | 'pdf';
    segments: Segment[];
    export: (mode: OutputMode) => Blob;
    extension: string;
}
const encoder = new TextEncoder();
const decoder = new TextDecoder();
export function escapeMarkup(value: string): string { return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
export function splitLongText(text: string, max = 6000): string[] {
    if (!Number.isInteger(max) || max < 2)
        throw new Error('段落長度不合法。');
    const result: string[] = [];
    while (text.length > max) {
        let index = text.lastIndexOf(' ', max);
        if (index < max / 2)
            index = max;
        // Do not cut a Unicode surrogate pair in two.
        const code = text.charCodeAt(index - 1);
        if (code >= 0xd800 && code <= 0xdbff)
            index--;
        result.push(text.slice(0, index));
        text = text.slice(index);
    }
    if (text)
        result.push(text);
    return result;
}
function rendered(segment: Segment, mode: OutputMode, separator = '\n'): string {
    if (segment.translation === null)
        return segment.source;
    return mode === 'bilingual' ? segment.source + separator + segment.translation : segment.translation;
}
export function textDocument(text: string, title: string, markdown = false): TranslationDocument {
    const segments: Segment[] = [];
    const sections: ({
        kind: 'raw';
        text: string;
    } | {
        kind: 'segment';
        segment: Segment;
    })[] = [];
    let fenced = false;
    let fence = '';
    for (const block of text.split(/(\r?\n\s*\r?\n)/)) {
        if (!block.trim()) {
            sections.push({ kind: 'raw', text: block });
            continue;
        }
        if (markdown) {
            const lines = block.split('\n');
            const hasFence = lines.some(line => /^\s*(```|~~~)/.test(line));
            if (fenced || hasFence) {
                for (const line of lines) {
                    const marker = /^\s*(```|~~~)/.exec(line)?.[1];
                    if (marker && (!fenced || marker === fence)) {
                        fenced = !fenced;
                        fence = marker;
                    }
                }
                sections.push({ kind: 'raw', text: block });
                continue;
            }
        }
        for (const source of splitLongText(block)) {
            const segment: Segment = { source, translation: null };
            segments.push(segment);
            sections.push({ kind: 'segment', segment });
        }
    }
    return { title, kind: markdown ? 'markdown' : 'text', segments, extension: markdown ? 'md' : 'txt', export: mode => new Blob([sections.map(section => section.kind === 'raw' ? section.text : rendered(section.segment, mode, '\n\n')).join('')], { type: 'text/plain;charset=utf-8' }) };
}
export function subtitleDocument(text: string, title: string, format: 'srt' | 'vtt'): TranslationDocument {
    const separator = text.includes('\r\n') ? '\r\n' : '\n';
    const blocks = text.replace(/^\uFEFF/, '').split(/\r?\n\r?\n/);
    const segments: Segment[] = [];
    const items = blocks.map(block => {
        const lines = block.split(/\r?\n/);
        const timestamp = lines.findIndex(line => /^(?:\d{2}:)?\d{2}:\d{2}[.,]\d{3}\s+-->\s+(?:\d{2}:)?\d{2}:\d{2}[.,]\d{3}/.test(line));
        if (timestamp < 0 || timestamp === lines.length - 1 || /^(NOTE|STYLE|REGION)(\s|$)/.test(lines[0] ?? ''))
            return { prefix: block, segment: null };
        const source = lines.slice(timestamp + 1).join('\n');
        if (source.length > 12000)
            throw new Error('字幕單一段落超過 12000 字元。');
        const segment: Segment = { source, translation: null };
        segments.push(segment);
        return { prefix: lines.slice(0, timestamp + 1).join(separator), segment };
    });
    if (!segments.length)
        throw new Error('找不到有效的字幕時間軸。');
    return { title, kind: 'subtitle', segments, extension: format, export: mode => new Blob([items.map(item => {
                if (!item.segment)
                    return item.prefix;
                // A provider must not inject a new cue/timestamp or markup through translated text.
                const safe = item.segment.translation === null ? null : item.segment.translation.replace(/\r?\n\s*\r?\n/g, '\n').replace(/-->/g, '→').replace(/</g, '&lt;').replace(/>/g, '&gt;');
                return item.prefix + separator + rendered({ source: item.segment.source, translation: safe }, mode).replace(/\n/g, separator);
            }).join(separator + separator)], { type: format === 'vtt' ? 'text/vtt;charset=utf-8' : 'text/plain;charset=utf-8' }) };
}
/** Only document-relative URLs or same-document anchors survive exports. */
export function safeDocumentUrl(value: string): string | null {
    const normalized = value.replace(/[\u0000-\u0020\u007f]/g, '').trim();
    if (!normalized || normalized.startsWith('/') || normalized.includes('\\') || /^[a-z][a-z\d+.-]*:/i.test(normalized))
        return null;
    // URL decoding must not turn an apparent relative path into a scheme or host.
    let decoded: string;
    try {
        decoded = decodeURIComponent(normalized).replace(/[\u0000-\u0020\u007f]/g, '');
    }
    catch {
        return null;
    }
    if (decoded.startsWith('/') || decoded.includes('\\') || /^[a-z][a-z\d+.-]*:/i.test(decoded))
        return null;
    return normalized;
}
export function segmentBatches(segments: Segment[], limit: number, maxCharacters = 60000): Segment[][] {
    if (!Number.isInteger(limit) || limit < 1 || limit > 40 || maxCharacters < 12000)
        throw new Error('翻譯批次限制不合法。');
    const result: Segment[][] = [];
    let batch: Segment[] = [];
    let characters = 0;
    for (const segment of segments) {
        if (segment.source.length > maxCharacters)
            throw new Error('段落超過翻譯字數上限。');
        if (batch.length && (batch.length >= limit || characters + segment.source.length > maxCharacters)) {
            result.push(batch);
            batch = [];
            characters = 0;
        }
        batch.push(segment);
        characters += segment.source.length;
    }
    if (batch.length)
        result.push(batch);
    return result;
}
function parseMarkup(text: string, xml: boolean): Document {
    // The parsed document is never attached to the page. A restrictive page CSP is
    // also used, but parser-time network behavior still requires browser testing.
    const doc = new DOMParser().parseFromString(text, xml ? 'application/xhtml+xml' : 'text/html');
    if (xml && doc.querySelector('parsererror'))
        throw new Error('EPUB 章節不是有效 XHTML。');
    doc.doctype?.remove();
    const instructions = doc.createTreeWalker(doc, NodeFilter.SHOW_PROCESSING_INSTRUCTION);
    const removable: Node[] = [];
    while (instructions.nextNode())
        removable.push(instructions.currentNode);
    for (const node of removable)
        node.parentNode?.removeChild(node);
    const forbidden = new Set(['script', 'iframe', 'object', 'embed', 'base', 'form', 'input', 'button', 'textarea', 'select', 'meta', 'link', 'style', 'svg', 'animate', 'animatemotion', 'animatetransform', 'set', 'foreignobject', 'audio', 'video', 'source', 'track', 'template']);
    const safeAttributes = new Set(['id', 'class', 'lang', 'dir', 'title', 'alt', 'width', 'height', 'colspan', 'rowspan', 'scope', 'role']);
    for (const el of [...doc.querySelectorAll('*')]) {
        const tag = el.localName.toLowerCase();
        if (forbidden.has(tag)) {
            el.remove();
            continue;
        }
        for (const attr of [...el.attributes]) {
            const name = attr.name.toLowerCase();
            if (name === 'xmlns' && attr.value === 'http://www.w3.org/1999/xhtml')
                continue;
            if (safeAttributes.has(name) || /^aria-[a-z-]+$/.test(name))
                continue;
            if ((name === 'href' && tag === 'a') || (name === 'src' && tag === 'img')) {
                const safe = safeDocumentUrl(attr.value);
                if (safe !== null) {
                    el.setAttribute(attr.name, safe);
                    continue;
                }
            }
            el.removeAttribute(attr.name);
        }
    }
    return doc;
}
interface MarkupPart {
    doc: Document;
    records: {
        element: Element;
        source: string;
        segments: Segment[];
    }[];
}
function markupPart(text: string, xml: boolean): MarkupPart {
    const doc = parseMarkup(text, xml);
    const records: MarkupPart['records'] = [];
    const candidates = [...doc.querySelectorAll('p,h1,h2,h3,h4,h5,h6,li,td,th,figcaption,blockquote,dt,dd')];
    for (const element of candidates) {
        if (element.closest('pre,code,svg,math,nav'))
            continue;
        if (element.querySelector('p,h1,h2,h3,h4,h5,h6,li,td,th,figcaption,blockquote,dt,dd'))
            continue;
        const source = element.textContent?.trim() ?? '';
        if (!source || !/\p{L}/u.test(source))
            continue;
        records.push({ element, source, segments: splitLongText(source).map(source => ({ source, translation: null })) });
    }
    if (!records.length) {
        for (const element of doc.querySelectorAll('body > div,body')) {
            if (element.children.length)
                continue;
            const source = element.textContent?.trim() ?? '';
            if (source)
                records.push({ element, source, segments: splitLongText(source).map(source => ({ source, translation: null })) });
        }
    }
    return { doc, records };
}
function serializePart(part: MarkupPart, mode: OutputMode): string {
    // Clone on export so repeatedly switching export mode never accumulates translation nodes.
    const copy = part.doc.cloneNode(true);
    if (!(copy instanceof Document))
        throw new Error('無法建立文件副本。');
    const originals = [...part.doc.querySelectorAll('*')];
    const copies = [...copy.querySelectorAll('*')];
    for (const record of part.records) {
        const element = copies[originals.indexOf(record.element)];
        if (!element || record.segments.every(segment => segment.translation === null))
            continue;
        const translation = record.segments.map(segment => segment.translation ?? segment.source).join('');
        if (mode === 'translated')
            element.textContent = translation;
        else {
            const paragraph = copy.createElementNS(element.namespaceURI, 'span');
            paragraph.setAttribute('class', 'local-translation');
            paragraph.setAttribute('style', 'display:block;margin-top:0.6em;color:#75516a;');
            paragraph.textContent = translation;
            element.appendChild(paragraph);
        }
    }
    return new XMLSerializer().serializeToString(copy);
}
export function htmlDocument(text: string, title: string): TranslationDocument {
    const part = markupPart(text, false);
    return { title, kind: 'html', segments: part.records.flatMap(record => record.segments), extension: 'html', export: mode => new Blob([serializePart(part, mode)], { type: 'text/html;charset=utf-8' }) };
}
export async function epubDocument(buffer: ArrayBuffer, title: string): Promise<TranslationDocument> {
    const entries = await readZip(buffer);
    const mime = entries.find(entry => entry.name === 'mimetype');
    if (!mime || decoder.decode(mime.data).trim() !== 'application/epub+zip')
        throw new Error('這不是有效的 EPUB 檔案。');
    if (entries.some(entry => entry.name === 'META-INF/encryption.xml'))
        throw new Error('目前不支援含加密資源的 EPUB，包括混淆字型。');
    const container = entries.find(entry => entry.name === 'META-INF/container.xml');
    if (!container)
        throw new Error('EPUB 缺少 container.xml。');
    const containerDoc = new DOMParser().parseFromString(decoder.decode(container.data), 'application/xml');
    const packagePath = containerDoc.getElementsByTagNameNS('*', 'rootfile')[0]?.getAttribute('full-path');
    const packageEntry = entries.find(entry => entry.name === packagePath);
    if (!packageEntry)
        throw new Error('EPUB 缺少套件目錄。');
    const packageDoc = new DOMParser().parseFromString(decoder.decode(packageEntry.data), 'application/xml');
    if (packageDoc.querySelector('parsererror'))
        throw new Error('EPUB 套件目錄格式錯誤。');
    const base = new URL(packageEntry.name, 'https://epub.invalid/');
    const manifest = new Map<string, string>();
    for (const item of packageDoc.getElementsByTagNameNS('*', 'item')) {
        const id = item.getAttribute('id');
        const href = item.getAttribute('href');
        if (!id || !href)
            continue;
        const url = new URL(href, base);
        if (url.origin !== base.origin)
            continue;
        const path = decodeURIComponent(url.pathname.slice(1));
        if (/\.(xhtml|html|htm)$/i.test(path))
            manifest.set(id, path);
    }
    const orderedPaths: string[] = [];
    for (const item of packageDoc.getElementsByTagNameNS('*', 'itemref')) {
        const path = manifest.get(item.getAttribute('idref') ?? '');
        if (path && !orderedPaths.includes(path))
            orderedPaths.push(path);
    }
    // Translate manifest navigation and auxiliary chapters after the reading order.
    for (const path of manifest.values())
        if (!orderedPaths.includes(path))
            orderedPaths.push(path);
    const parts = new Map<string, MarkupPart>();
    for (const path of orderedPaths) {
        const entry = entries.find(entry => entry.name === path);
        if (!entry)
            throw new Error('EPUB 套件宣告的章節遺失。');
        parts.set(entry.name, markupPart(decoder.decode(entry.data), /\.xhtml$/i.test(entry.name)));
    }
    if (!parts.size)
        throw new Error('EPUB 沒有可讀取的 HTML 章節。');
    return { title, kind: 'epub', segments: [...parts.values()].flatMap(part => part.records.flatMap(record => record.segments)), extension: 'epub', export: mode => {
            const output: ZipEntry[] = entries.map(entry => {
                const part = parts.get(entry.name);
                return part ? { name: entry.name, data: encoder.encode(serializePart(part, mode)) } : entry;
            });
            return new Blob([writeZip(output)], { type: 'application/epub+zip' });
        } };
}
export async function loadDocument(file: File): Promise<TranslationDocument> {
    if (file.size > 100 * 1024 * 1024)
        throw new Error('檔案不能超過 100 MB。');
    const ext = file.name.toLowerCase().split('.').pop();
    if (ext === 'epub')
        return epubDocument(await file.arrayBuffer(), file.name);
    if (ext === 'pdf') {
        const {pdfDocument} = await import('./pdf');
        return pdfDocument(await file.arrayBuffer(), file.name);
    }
    if (file.size > 10 * 1024 * 1024)
        throw new Error('文字文件不能超過 10 MB。');
    const text = await file.text();
    if (ext === 'srt' || ext === 'vtt')
        return subtitleDocument(text, file.name, ext);
    if (ext === 'html' || ext === 'htm')
        return htmlDocument(text, file.name);
    if (ext === 'md' || ext === 'markdown')
        return textDocument(text, file.name, true);
    if (ext === 'txt')
        return textDocument(text, file.name);
    throw new Error('支援文字型 PDF、TXT、Markdown、HTML、SRT、VTT 與未加密 EPUB。');
}
