import { z } from 'zod';
import { DocumentLoadError } from './errors';
import { escapeMarkup, splitLongText, type Segment, type TranslationDocument } from './formats';
const textItemSchema = z.object({ str: z.string(), hasEOL: z.boolean().optional(), transform: z.array(z.number()).optional() });
const contentSchema = z.object({ items: z.array(z.union([textItemSchema, z.object({ type: z.string() })])) });
const pdfMetadataSchema = z.object({ numPages: z.number().int().min(1) });
const taskSchema = z.object({ promise: z.promise(z.unknown()) });
const moduleSchema = z.object({ version: z.literal('5.4.322') });
function callMethod(target: unknown, name: string, args: unknown[] = []): unknown {
    if ((typeof target !== 'object' && typeof target !== 'function') || target === null)
        throw new Error('PDF 模組物件不相容。');
    const method: unknown = Reflect.get(target, name);
    if (typeof method !== 'function')
        throw new Error('PDF 模組方法不相容。');
    return Reflect.apply(method, target, args);
}
/** Extracts text items in PDF stream order. It does not infer multi-column reading order. */
export function pdfTextLines(value: unknown): string {
    const { items } = contentSchema.parse(value);
    let text = '';
    let previousY: number | undefined;
    for (const item of items) {
        if (!('str' in item))
            continue;
        const y = item.transform?.[5];
        if (previousY !== undefined && y !== undefined && Math.abs(y - previousY) > 2 && !text.endsWith('\n'))
            text += '\n';
        if (text && !text.endsWith('\n') && !/\s$/.test(text) && !/^\s/.test(item.str))
            text += ' ';
        text += item.str;
        if (item.hasEOL)
            text += '\n';
        previousY = y;
    }
    return text.trim();
}
export interface PdfTextPage {
    number: number;
    text: string;
}
export function pdfTextDocument(pages: PdfTextPage[], title: string): TranslationDocument {
    const groups = pages.map(page => ({ number: page.number, segments: splitLongText(page.text).filter(source => source.trim()).map(source => ({ source, translation: null } satisfies Segment)) }));
    const segments = groups.flatMap(group => group.segments);
    if (!segments.length)
        throw new DocumentLoadError('pdf-empty');
    return { title, kind: 'pdf', extension: 'html', segments, export: mode => {
            const rows = groups.map(group => `<section><h2>第 ${group.number} 頁</h2>${group.segments.map(segment => {
                const original = `<div class="original">${escapeMarkup(segment.source)}</div>`;
                const translated = `<div class="translated">${escapeMarkup(segment.translation ?? segment.source)}</div>`;
                return `<article class="${mode}">${mode === 'bilingual' ? original : ''}${translated}</article>`;
            }).join('')}</section>`).join('');
            return new Blob([`<!doctype html><html lang="zh-Hant"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'"><title>${escapeMarkup(title)} · 翻譯</title><style>body{max-width:1100px;margin:32px auto;padding:0 24px;font-family:system-ui,sans-serif;line-height:1.8;color:#302d35}h1{font-size:24px}h2{font-size:16px;color:#89657f}article{display:grid;gap:24px;margin-bottom:24px}article.bilingual{grid-template-columns:1fr 1fr}article div{white-space:pre-wrap;overflow-wrap:anywhere}.translated{color:#754261}section{border-top:1px solid #ddd;margin-top:28px}small{color:#777}@media print{body{margin:0;max-width:none}section{break-before:page}section:first-of-type{break-before:auto}article{break-inside:avoid}}@media(max-width:650px){article.bilingual{grid-template-columns:1fr}}</style></head><body><h1>${escapeMarkup(title)}</h1><small>文字擷取與翻譯，不保留 PDF 原始圖像、欄位及排版。可使用瀏覽器列印另存 PDF。</small>${rows}</body></html>`], { type: 'text/html;charset=utf-8' });
        } };
}
async function extractPdfDocument(buffer: ArrayBuffer, title: string): Promise<TranslationDocument> {
    if (buffer.byteLength > 50 * 1024 * 1024)
        throw new DocumentLoadError('pdf-size');
    // PDF.js 5 uses Promise.withResolvers (Chrome 124+). Do not install global polyfills.
    if (!('withResolvers' in Promise))
        throw new DocumentLoadError('pdf-browser');
    const base = chrome.runtime.getURL('vendor/pdfjs/');
    const imported: unknown = await import(base + 'pdf.mjs');
    moduleSchema.parse(imported);
    // GlobalWorkerOptions is a static class, so validate its setter on the module boundary.
    if (typeof imported !== 'object' || imported === null || !('GlobalWorkerOptions' in imported))
        throw new Error('PDF 模組載入失敗。');
    const workerOptions: unknown = imported.GlobalWorkerOptions;
    if (typeof workerOptions !== 'function' || !('workerSrc' in workerOptions) || typeof workerOptions.workerSrc !== 'string')
        throw new Error('PDF Worker 模組不相容。');
    workerOptions.workerSrc = base + 'pdf.worker.mjs';
    const task = callMethod(imported, 'getDocument', [{ data: new Uint8Array(buffer), isEvalSupported: false, useWasm: false, disableFontFace: true, enableXfa: false, disableAutoFetch: true, cMapUrl: base + 'cmaps/', cMapPacked: true, standardFontDataUrl: base + 'standard_fonts/', verbosity: 0 }]);
    try {
        const pdf: unknown = await taskSchema.parse(task).promise;
        const { numPages } = pdfMetadataSchema.parse(pdf);
        if (numPages > 500)
            throw new DocumentLoadError('pdf-pages');
        const pages: PdfTextPage[] = [];
        for (let number = 1; number <= numPages; number++) {
            const page: unknown = await callMethod(pdf, 'getPage', [number]);
            try {
                pages.push({ number, text: pdfTextLines(await callMethod(page, 'getTextContent')) });
            }
            finally {
                callMethod(page, 'cleanup');
            }
        }
        return pdfTextDocument(pages, title);
    }
    finally {
        await callMethod(task, 'destroy');
    }
}
export async function pdfDocument(buffer: ArrayBuffer, title: string): Promise<TranslationDocument> {
    try {
        return await extractPdfDocument(buffer, title);
    }
    catch (error) {
        if (error instanceof DocumentLoadError)
            throw error;
        if (typeof error === 'object' && error !== null && 'name' in error && error.name === 'PasswordException')
            throw new DocumentLoadError('pdf-password');
        throw new DocumentLoadError('pdf-invalid');
    }
}
