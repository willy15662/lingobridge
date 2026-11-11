import { settingsSchema, matchesSite, type Settings } from '../core/settings';
export const languages: ReadonlyArray<readonly [
    string,
    string
]> = [['auto', '自動偵測'], ['zh-TW', '繁體中文'], ['zh-CN', '簡體中文'], ['en', '英文'], ['ja', '日文'], ['ko', '韓文'], ['fr', '法文'], ['de', '德文'], ['es', '西班牙文'], ['pt', '葡萄牙文'], ['it', '義大利文'], ['ru', '俄文'], ['ar', '阿拉伯文'], ['hi', '印地文'], ['vi', '越南文'], ['th', '泰文'], ['id', '印尼文']];
export function element(id: string): HTMLElement {
    const item = document.getElementById(id);
    if (!item)
        throw new Error(`找不到介面元件：${id}`);
    return item;
}
export function input(id: string): HTMLInputElement {
    const item = element(id);
    if (!(item instanceof HTMLInputElement))
        throw new Error(`輸入欄位無效：${id}`);
    return item;
}
export function select(id: string): HTMLSelectElement {
    const item = element(id);
    if (!(item instanceof HTMLSelectElement))
        throw new Error(`選單無效：${id}`);
    return item;
}
export function textarea(id: string): HTMLTextAreaElement {
    const item = element(id);
    if (!(item instanceof HTMLTextAreaElement))
        throw new Error(`文字欄位無效：${id}`);
    return item;
}
export function languageOptions(id: string, auto: boolean): void {
    const target = select(id);
    for (const [value, label] of languages) {
        if (!auto && value === 'auto')
            continue;
        target.add(new Option(label, value));
    }
}
export function setSelect(id: string, value: string): void {
    const target = select(id);
    if (!Array.from(target.options).some(o => o.value === value))
        target.add(new Option(value, value));
    target.value = value;
}
export function status(message: string, error = false): void { const target = element('status'); target.textContent = message; target.classList.toggle('error', error); target.setAttribute('role', error ? 'alert' : 'status'); }
export function report(error: unknown): void { status(error instanceof Error ? error.message : '操作失敗，請重試。', true); }
export function endpointOrigin(endpoint: string): string {
    const url = new URL(endpoint);
    if (url.username || url.password || url.search || url.hash)
        throw new Error('API 網址不得含帳號密碼、查詢參數或片段。');
    if (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)))
        throw new Error('API 必須使用 HTTPS；本機服務可使用 HTTP。');
    return `${url.origin}/*`;
}
export function exportedSettings(settings: Settings): Settings {
    const copy = settingsSchema.parse(settings);
    for (const provider of Object.values(copy.providers))
        provider.apiKey = '';
    return copy;
}
export function importedSettings(value: unknown, current: Settings): Settings {
    const parsed = settingsSchema.parse(value);
    for (const id of ['openai', 'gemini', 'deepl'] satisfies Array<keyof Settings['providers']>) {
        const sameOrigin = endpointOrigin(parsed.providers[id].endpoint) === endpointOrigin(current.providers[id].endpoint);
        parsed.providers[id].apiKey = sameOrigin ? current.providers[id].apiKey : '';
    }
    return parsed;
}
export function downloadJSON(value: unknown, filename: string): void { const url = URL.createObjectURL(new Blob([JSON.stringify(value, null, 2)], { type: 'application/json' })); const anchor = document.createElement('a'); anchor.href = url; anchor.download = filename; anchor.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); }
export function updateSiteRule(settings: Settings, hostname: string, rule: 'always' | 'never', enabled: boolean): Settings {
    let allowSites = settings.allowSites.filter(item => item !== hostname);
    let blockSites = settings.blockSites.filter(item => item !== hostname);
    if (rule === 'always' && enabled) {
        if (blockSites.some(item => matchesSite(hostname, item)))
            throw new Error('此網站符合黑名單的萬用規則。請先在設定中調整該規則。');
        allowSites.push(hostname);
    }
    else if (rule === 'never' && enabled) {
        blockSites.push(hostname);
    }
    else if (rule === 'always' && (settings.autoTranslate || allowSites.some(item => matchesSite(hostname, item)))) {
        blockSites.push(hostname);
    }
    else if (rule === 'never' && blockSites.some(item => matchesSite(hostname, item))) {
        throw new Error('此網站符合黑名單的萬用規則。請先在設定中調整該規則。');
    }
    return { ...settings, allowSites, blockSites };
}
