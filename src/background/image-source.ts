import { TranslationError } from './providers';
/** Read only explicitly permitted image origins; never forward website cookies. */
export async function readImage(source: string): Promise<string> {
    const url = new URL(source);
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) throw new TranslationError('不支援此圖片網址。');
    if (!await chrome.permissions.contains({ origins: [url.origin + '/*'] })) throw new TranslationError('圖片來源尚未授權，請到設定按「授權媒體自動翻譯」。');
    const response = await fetch(url, { credentials: 'omit', redirect: 'error', signal: AbortSignal.timeout(20000) });
    const mime = response.headers.get('content-type')?.split(';')[0]?.trim();
    if (!response.ok || !mime || !['image/png', 'image/jpeg', 'image/webp', 'image/gif'].includes(mime)) throw new TranslationError('無法讀取圖片，僅支援 PNG、JPEG、WebP 或 GIF。');
    const limit = 8 * 1024 * 1024;
    if (Number(response.headers.get('content-length')) > limit) throw new TranslationError('圖片超過 8 MB，請使用較小圖片。');
    const reader = response.body?.getReader();
    if (!reader) throw new TranslationError('圖片內容為空。');
    const chunks: Uint8Array[] = []; let size = 0;
    try {
        while (true) { const { done, value } = await reader.read(); if (done) break; size += value.length; if (size > limit) throw new TranslationError('圖片超過 8 MB。'); chunks.push(value); }
    } finally { await reader.cancel(); }
    let binary = '';
    for (const chunk of chunks) for (let offset = 0; offset < chunk.length; offset += 8192) binary += String.fromCharCode(...chunk.subarray(offset, offset + 8192));
    return `data:${mime};base64,${btoa(binary)}`;
}
