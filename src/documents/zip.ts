/** Bounded ZIP reader/writer for EPUB. No extraction to disk, ZIP64 or encryption. */
export interface ZipEntry {
    name: string;
    data: Uint8Array<ArrayBuffer>;
}
const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8', { fatal: true });
const MAX_FILE = 32 * 1024 * 1024;
const MAX_TOTAL = 100 * 1024 * 1024;
export function crc32(bytes: Uint8Array): number {
    let crc = 0xffffffff;
    for (const byte of bytes) {
        crc ^= byte;
        for (let bit = 0; bit < 8; bit++)
            crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
    }
    return (crc ^ 0xffffffff) >>> 0;
}
function range(bytes: Uint8Array, start: number, size: number): void {
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(size) || start < 0 || size < 0 || start + size > bytes.length)
        throw new Error('ZIP 檔案已截斷或結構不合法。');
}
function validateName(name: string): void {
    if (!name || name.includes('\\') || name.startsWith('/') || name.includes('\0') || name.split('/').includes('..'))
        throw new Error('EPUB 含不安全的檔案路徑。');
}
async function inflate(bytes: Uint8Array<ArrayBuffer>, expected: number): Promise<Uint8Array<ArrayBuffer>> {
    const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
    const reader = stream.getReader();
    const result = new Uint8Array(expected);
    let offset = 0;
    try {
        for (;;) {
            const item = await reader.read();
            if (item.done)
                break;
            if (offset + item.value.length > expected)
                throw new Error('EPUB 解壓縮大小超出宣告範圍。');
            result.set(item.value, offset);
            offset += item.value.length;
        }
    }
    catch (error) {
        await reader.cancel();
        throw error;
    }
    if (offset !== expected)
        throw new Error('EPUB 解壓縮資料長度不符。');
    return result;
}
export async function readZip(buffer: ArrayBuffer): Promise<ZipEntry[]> {
    const bytes = new Uint8Array(buffer);
    if (bytes.length > MAX_TOTAL)
        throw new Error('EPUB 壓縮檔不能超過 100 MB。');
    const view = new DataView(buffer);
    let end = -1;
    for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i--) {
        if (view.getUint32(i, true) === 0x06054b50 && i + 22 + view.getUint16(i + 20, true) === bytes.length) {
            end = i;
            break;
        }
    }
    if (end < 0)
        throw new Error('找不到有效的 ZIP 目錄。');
    if (view.getUint16(end + 4, true) || view.getUint16(end + 6, true))
        throw new Error('不支援多磁碟 ZIP。');
    const count = view.getUint16(end + 10, true);
    if (count > 5000 || count !== view.getUint16(end + 8, true))
        throw new Error('ZIP 項目過多或不支援 ZIP64。');
    const directorySize = view.getUint32(end + 12, true);
    let cursor = view.getUint32(end + 16, true);
    range(bytes, cursor, directorySize);
    const directoryEnd = cursor + directorySize;
    if (directoryEnd > end)
        throw new Error('ZIP 目錄重疊。');
    const entries: ZipEntry[] = [];
    const names = new Set<string>();
    let total = 0;
    for (let i = 0; i < count; i++) {
        range(bytes, cursor, 46);
        if (view.getUint32(cursor, true) !== 0x02014b50)
            throw new Error('ZIP 目錄標記錯誤。');
        const flags = view.getUint16(cursor + 8, true);
        const method = view.getUint16(cursor + 10, true);
        const crc = view.getUint32(cursor + 16, true);
        const compressed = view.getUint32(cursor + 20, true);
        const size = view.getUint32(cursor + 24, true);
        const nameSize = view.getUint16(cursor + 28, true);
        const extraSize = view.getUint16(cursor + 30, true);
        const commentSize = view.getUint16(cursor + 32, true);
        const local = view.getUint32(cursor + 42, true);
        range(bytes, cursor + 46, nameSize + extraSize + commentSize);
        const name = decoder.decode(bytes.slice(cursor + 46, cursor + 46 + nameSize));
        validateName(name);
        if (names.has(name))
            throw new Error('ZIP 含重複檔案名稱。');
        names.add(name);
        if (flags & 1)
            throw new Error('不支援加密 EPUB。');
        if (method !== 0 && method !== 8)
            throw new Error('不支援此 ZIP 壓縮格式。');
        total += size;
        if (size > MAX_FILE || total > MAX_TOTAL)
            throw new Error('EPUB 解壓縮資料過大。');
        range(bytes, local, 30);
        if (view.getUint32(local, true) !== 0x04034b50)
            throw new Error('ZIP 檔頭錯誤。');
        const offset = local + 30 + view.getUint16(local + 26, true) + view.getUint16(local + 28, true);
        range(bytes, offset, compressed);
        if (offset + compressed > view.getUint32(end + 16, true))
            throw new Error('ZIP 檔案資料與目錄重疊。');
        const packed = bytes.slice(offset, offset + compressed);
        const data = method === 0 ? packed : await inflate(packed, size);
        if (data.length !== size || crc32(data) !== crc)
            throw new Error('EPUB 檔案校驗失敗。');
        entries.push({ name, data });
        cursor += 46 + nameSize + extraSize + commentSize;
    }
    if (cursor !== directoryEnd)
        throw new Error('ZIP 目錄長度不符。');
    return entries;
}
export function writeZip(entries: ZipEntry[]): Uint8Array<ArrayBuffer> {
    if (entries.length > 5000)
        throw new Error('EPUB 項目過多。');
    const ordered = [...entries].sort((a, b) => a.name === 'mimetype' ? -1 : b.name === 'mimetype' ? 1 : 0);
    const parts: Uint8Array<ArrayBuffer>[] = [];
    const central: Uint8Array<ArrayBuffer>[] = [];
    let offset = 0;
    const names = new Set<string>();
    for (const entry of ordered) {
        validateName(entry.name);
        if (names.has(entry.name))
            throw new Error('重複 ZIP 檔名。');
        names.add(entry.name);
        const name = encoder.encode(entry.name);
        if (name.length > 65535 || entry.data.length > MAX_FILE)
            throw new Error('EPUB 項目過大。');
        const local = new Uint8Array(30 + name.length);
        const l = new DataView(local.buffer);
        l.setUint32(0, 0x04034b50, true);
        l.setUint16(4, 20, true);
        l.setUint16(6, 0x0800, true);
        l.setUint16(12, 33, true);
        l.setUint32(14, crc32(entry.data), true);
        l.setUint32(18, entry.data.length, true);
        l.setUint32(22, entry.data.length, true);
        l.setUint16(26, name.length, true);
        local.set(name, 30);
        const header = new Uint8Array(46 + name.length);
        const c = new DataView(header.buffer);
        c.setUint32(0, 0x02014b50, true);
        c.setUint16(4, 20, true);
        c.setUint16(6, 20, true);
        c.setUint16(8, 0x0800, true);
        c.setUint16(14, 33, true);
        c.setUint32(16, crc32(entry.data), true);
        c.setUint32(20, entry.data.length, true);
        c.setUint32(24, entry.data.length, true);
        c.setUint16(28, name.length, true);
        c.setUint32(42, offset, true);
        header.set(name, 46);
        central.push(header);
        parts.push(local, entry.data);
        offset += local.length + entry.data.length;
        if (offset > MAX_TOTAL)
            throw new Error('輸出 EPUB 超過 100 MB。');
    }
    const end = new Uint8Array(22);
    const e = new DataView(end.buffer);
    e.setUint32(0, 0x06054b50, true);
    e.setUint16(8, entries.length, true);
    e.setUint16(10, entries.length, true);
    e.setUint32(12, central.reduce((sum, part) => sum + part.length, 0), true);
    e.setUint32(16, offset, true);
    const all = [...parts, ...central, end];
    const result = new Uint8Array(all.reduce((sum, part) => sum + part.length, 0));
    let at = 0;
    for (const part of all) {
        result.set(part, at);
        at += part.length;
    }
    return result;
}
