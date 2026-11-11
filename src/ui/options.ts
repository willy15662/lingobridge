import {applyTranslationStyle,maskStyles} from '../core/styles';
import { z } from 'zod';
import { rpc } from '../core/messages';
import { defaults, settingsSchema, providerIdSchema, type Settings, type ProviderId } from '../core/settings';
import { element, input, select, textarea, languageOptions, setSelect, status, report, endpointOrigin, exportedSettings, importedSettings, downloadJSON } from './shared';
let settings: Settings = structuredClone(defaults);
let ready = false;
const providerIds: ProviderId[] = ['openai', 'gemini', 'deepl'];
languageOptions('source', true);
languageOptions('target', false);
function field(title: string, node: HTMLElement): HTMLLabelElement { const label = document.createElement('label'); label.append(document.createTextNode(title), node); return label; }
for (const id of providerIds) {
    const panel = document.createElement('div');
    panel.id = `provider-${id}`;
    panel.className = 'provider-panel';
    panel.hidden = id !== 'openai';
    const key = document.createElement('input');
    key.id = `${id}-key`;
    key.type = 'password';
    key.autocomplete = 'off';
    key.spellcheck = false;
    key.placeholder = '輸入 API Key';
    key.maxLength = 4096;
    const keyRow = document.createElement('div');
    keyRow.className = 'key-row';
    keyRow.append(field('API Key', key));
    const reveal = document.createElement('button');
    reveal.type = 'button';
    reveal.className = 'secondary';
    reveal.textContent = '顯示';
    reveal.setAttribute('aria-label', `顯示 ${id} API Key`);
    reveal.addEventListener('click', () => { key.type = key.type === 'password' ? 'text' : 'password'; reveal.textContent = key.type === 'password' ? '顯示' : '隱藏'; });
    keyRow.append(reveal);
    panel.append(keyRow);
    const endpoint = document.createElement('input');
    endpoint.id = `${id}-endpoint`;
    endpoint.type = 'url';
    endpoint.required = true;
    panel.append(field(id === 'gemini' ? 'API 基底網址' : 'API 網址', endpoint));
    const model = document.createElement('input');
    model.id = `${id}-model`;
    model.maxLength = 200;
    const prompt = document.createElement('textarea');
    prompt.id = `${id}-prompt`;
    prompt.rows = 5;
    prompt.maxLength = 8000;
    if (id !== 'deepl') {
        panel.append(field('模型', model), field('翻譯 Prompt', prompt));
        const hint = document.createElement('p');
        hint.className = 'hint';
        hint.textContent = '可使用 {{source}}、{{target}}。請保留「依原順序回傳 JSON 字串陣列」的要求。';
        panel.append(hint);
    }
    else {
        model.hidden = true;
        prompt.hidden = true;
        panel.append(model, prompt);
    }
    element('provider-fields').append(panel);
}
for (const button of document.querySelectorAll<HTMLButtonElement>('[data-provider]')) {
    button.addEventListener('click', () => {
        const id = providerIdSchema.parse(button.dataset.provider);
        for (const provider of providerIds)
            element(`provider-${provider}`).hidden = provider !== id;
        for (const sibling of document.querySelectorAll<HTMLButtonElement>('[data-provider]')) {
            const active = sibling === button;
            sibling.classList.toggle('selected', active);
            sibling.setAttribute('aria-pressed', String(active));
        }
    });
}
function showSettings(value: Settings): void {
    for (const id of ['source', 'target', 'mode', 'provider'] satisfies Array<keyof Settings>)
        setSelect(id, value[id]);
    for (const id of ['autoTranslate', 'hover', 'selection', 'subtitles'] satisfies Array<keyof Settings>)
        input(id).checked = value[id];
    for (const id of providerIds) {
        const provider = value.providers[id];
        input(`${id}-key`).value = provider.apiKey;
        input(`${id}-endpoint`).value = provider.endpoint;
        input(`${id}-model`).value = provider.model;
        textarea(`${id}-prompt`).value = provider.prompt;
    }
    input('requestsPerMinute').value = String(value.requestsPerMinute);
    input('batchSize').value = String(value.batchSize);
    setSelect('theme', value.style.theme);
    input('color').value = value.style.color;
    input('background').value = value.style.background;
    input('fontSize').value = String(value.style.fontSize);
    input('border').checked = value.style.border;
    textarea('allowSites').value = value.allowSites.join('\n');
    textarea('blockSites').value = value.blockSites.join('\n');
    preview();
}
function rules(id: string): string[] { return [...new Set(textarea(id).value.split(/\r?\n/).map(s => s.trim().toLowerCase()).filter(Boolean))]; }
function readSettings(): Settings {
    const draft: unknown = { ...settings, source: select('source').value, target: select('target').value, mode: select('mode').value, provider: select('provider').value, autoTranslate: input('autoTranslate').checked, hover: input('hover').checked, selection: input('selection').checked, subtitles: input('subtitles').checked, style: { theme: select('theme').value, color: input('color').value, background: input('background').value, fontSize: Number(input('fontSize').value), border: input('border').checked }, allowSites: rules('allowSites'), blockSites: rules('blockSites'), requestsPerMinute: Number(input('requestsPerMinute').value), batchSize: Number(input('batchSize').value), providers: Object.fromEntries(providerIds.map(id => [id, { apiKey: input(`${id}-key`).value.trim(), endpoint: input(`${id}-endpoint`).value.trim(), model: input(`${id}-model`).value.trim(), prompt: textarea(`${id}-prompt`).value }])) };
    const parsed = settingsSchema.safeParse(draft);
    if (!parsed.success)
        throw new Error(`設定格式錯誤：${parsed.error.issues.map(i => i.path.join('.')).join('、')}。請檢查欄位範圍。`);
    for (const id of providerIds)
        endpointOrigin(parsed.data.providers[id].endpoint);
    return parsed.data;
}
function preview(): void {
    const parsed=settingsSchema.shape.style.safeParse({theme:select('theme').value,color:input('color').value,background:input('background').value,fontSize:Number(input('fontSize').value),border:input('border').checked});
    if(parsed.success)applyTranslationStyle(element('translation-preview'),parsed.data);
}
const maskSheet=document.createElement('style');maskSheet.textContent=maskStyles;document.head.append(maskSheet);
element('translation-preview').setAttribute('data-local-translate','result');
select('theme').addEventListener('change', preview);
for (const id of ['color', 'background', 'fontSize', 'border'])
    input(id).addEventListener('input', preview);
element('settings-form').addEventListener('submit', event => {
    event.preventDefault();
    void (async () => {
        if (!ready)
            throw new Error('設定仍在載入，請稍候。');
        const next = readSettings();
        const origins = [...new Set(providerIds.filter(id => next.providers[id].apiKey).map(id => endpointOrigin(next.providers[id].endpoint)))];
        if (origins.length && !await chrome.permissions.request({ origins }))
            throw new Error('未取得 API 連線權限，設定尚未儲存。');
        await rpc({ kind: 'settings.save', settings: next });
        settings = next;
        status('設定已儲存。');
    })().catch(report);
});
element('grant-sites').addEventListener('click', () => void (async () => {
    const origins = rules('allowSites').flatMap(rule => {
        if (!/^(\*\.)?[a-z\d](?:[a-z\d.-]*[a-z\d])?$/i.test(rule))
            throw new Error(`網站規則無效：${rule}`);
        return [`https://${rule}/*`, `http://${rule}/*`];
    });
    if (!origins.length)
        throw new Error('請先新增白名單網站。');
    if (!await chrome.permissions.request({ origins }))
        throw new Error('未取得網站權限。');
    status('已取得網站權限。請儲存設定，套用白名單。');
})().catch(report));
const statsSchema = z.object({ requests: z.number(), characters: z.number(), cacheHits: z.number(), errors: z.number(), inputTokens: z.number(), outputTokens: z.number() });
async function refreshStats(): Promise<void> {
    const stats = statsSchema.parse(await rpc({ kind: 'stats.get' }));
    const container = element('stats');
    container.replaceChildren();
    const labels: Record<keyof typeof stats, string> = { requests: 'API 請求', characters: '原文字元', cacheHits: '快取命中', errors: '失敗請求', inputTokens: '輸入 Token', outputTokens: '輸出 Token' };
    for (const key of Object.keys(labels)) {
        if (!(key in stats))
            continue;
        const entry = z.enum(['requests', 'characters', 'cacheHits', 'errors', 'inputTokens', 'outputTokens']).parse(key);
        const card = document.createElement('div');
        const number = document.createElement('strong');
        number.textContent = stats[entry].toLocaleString('zh-TW');
        const label = document.createElement('span');
        label.textContent = labels[entry];
        card.append(number, label);
        container.append(card);
    }
}
element('refresh-stats').addEventListener('click', () => void refreshStats().catch(report));
element('clear-cache').addEventListener('click', () => void rpc({ kind: 'cache.clear' }).then(() => status('翻譯快取已清除。')).catch(report));
element('clear-stats').addEventListener('click', () => void rpc({ kind: 'stats.clear' }).then(refreshStats).then(() => status('用量統計已重設。')).catch(report));
element('export').addEventListener('click', () => {
    try {
        downloadJSON(exportedSettings(readSettings()), 'bilingual-reading-settings.json');
        status('已匯出設定，不含 API Key。');
    }
    catch (error) {
        report(error);
    }
});
input('import').addEventListener('change', () => void (async () => {
    const file = input('import').files?.[0];
    if (!file)
        return;
    if (file.size > 1024 * 1024)
        throw new Error('設定檔不可超過 1 MB。');
    const value: unknown = JSON.parse(await file.text());
    const next = importedSettings(value, settings);
    showSettings(next);
    status('已載入設定檔。API 網域變更的服務已清除金鑰，請確認後按儲存。');
    input('import').value = '';
})().catch(report));
element('reset').addEventListener('click', () => {
    if (!confirm('清除全部設定、API Key、快取和用量？此操作無法復原。'))
        return;
    void (async () => { await rpc({ kind: 'data.reset' }); settings = settingsSchema.parse(await rpc({ kind: 'settings.get' })); showSettings(settings); await refreshStats(); status('本機資料已清除。瀏覽器授予的網站權限可在擴充套件管理頁面移除。'); })().catch(report);
});
element('shortcuts').addEventListener('click', () => void chrome.tabs.create({ url: 'chrome://extensions/shortcuts' }).catch(report));
element('documents').addEventListener('click', () => void chrome.tabs.create({ url: chrome.runtime.getURL('documents.html') }).catch(report));
void (async () => { settings = settingsSchema.parse(await rpc({ kind: 'settings.get' })); showSettings(settings); ready = true; await refreshStats(); })().catch(report);
