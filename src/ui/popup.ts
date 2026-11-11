import {isPdfTab,workspaceForTab} from '../core/pdf-entry';
import { rpc, unwrapReply } from '../core/messages';
import { defaults, modeSchema, providerIdSchema, settingsSchema, type Settings, type Mode, sitePolicy } from '../core/settings';
import { element, input, select, languageOptions, setSelect, status, report, endpointOrigin, updateSiteRule } from './shared';
let settings: Settings = structuredClone(defaults);
let selectedMode: Mode = 'bilingual';
let activeTab: chrome.tabs.Tab | undefined;
let ready = false;
let busy = false;
let pdfTab=false;
languageOptions('source', true);
languageOptions('target', false);
function setMode(mode: Mode): void {
    selectedMode = mode;
    for (const button of document.querySelectorAll<HTMLButtonElement>('[data-mode]')) {
        const chosen = button.dataset.mode === mode;
        button.classList.toggle('selected', chosen);
        button.setAttribute('aria-pressed', String(chosen));
    }
}
function currentUrl(): URL {
    if (!activeTab?.url)
        throw new Error('無法取得目前網站。');
    const url = new URL(activeTab.url);
    if (!['https:', 'http:'].includes(url.protocol))
        throw new Error('此頁面不允許擴充套件翻譯。請開啟一般網頁。');
    return url;
}
function readSettings(): Settings { return settingsSchema.parse({ ...settings, source: select('source').value, target: select('target').value, provider: providerIdSchema.parse(select('provider').value), hover: input('hover').checked, mode: selectedMode }); }
async function applyMode(): Promise<void> {
    if (!ready || busy)
        return;
    if (activeTab?.id === undefined)
        throw new Error('沒有可翻譯的分頁。');
    if(pdfTab){await chrome.tabs.create({url:workspaceForTab(activeTab)});status('已開啟 PDF 文件工作區。請讀取文件後開始翻譯。');return;}
    currentUrl();
    const next = readSettings();
    busy = true;
    const button = element('translate');
    button.setAttribute('aria-busy', 'true');
    if (button instanceof HTMLButtonElement)
        button.disabled = true;
    try {
        if (next.mode !== 'original') {
            const granted = await chrome.permissions.request({ origins: [endpointOrigin(next.providers[next.provider].endpoint)] });
            if (!granted)
                throw new Error('尚未授權翻譯服務的連線權限。');
        }
        await rpc({ kind: 'settings.save', settings: next });
        settings = next;
        await chrome.scripting.executeScript({ target: { tabId: activeTab.id }, files: ['content/content.js'] });
        const pageResult=unwrapReply(await chrome.tabs.sendMessage(activeTab.id, { kind: 'page.mode', mode: next.mode }));
        if(next.mode!=='original'&&typeof pageResult==='object'&&pageResult!==null&&'mode' in pageResult&&pageResult.mode==='original')throw new Error('此網站已停用翻譯。請先調整網站規則。');
        status(next.mode === 'original' ? '已還原原文。' : '已開始翻譯。請在網頁上查看進度。');
    }
    finally {
        busy = false;
        button.setAttribute('aria-busy', 'false');
        if (button instanceof HTMLButtonElement)
            button.disabled = false;
    }
}
for (const button of document.querySelectorAll<HTMLButtonElement>('[data-mode]')) {
    button.addEventListener('click', () => {
        const mode = modeSchema.parse(button.dataset.mode);
        setMode(mode);
        if (mode === 'original')
            void applyMode().catch(report);
    });
}
element('translate').addEventListener('click', () => void applyMode().catch(report));
function showSiteRule(): void {
    const policy = sitePolicy(currentUrl().hostname, settings);
    select('site-rule').value = policy === 'blocked' ? 'never' : 'always';
    input('always').checked = policy !== 'manual';
}
async function saveSiteRule(): Promise<void> {
    if (!ready)
        throw new Error('設定仍在載入。');
    const enabled = input('always').checked;
    const rule = select('site-rule').value === 'never' ? 'never' : 'always';
    const url = currentUrl();
    const next = updateSiteRule(readSettings(), url.hostname, rule, enabled);
    if (rule === 'always' && enabled && !await chrome.permissions.request({ origins: [`${url.origin}/*`] }))
        throw new Error('尚未授權此網站，無法啟用自動翻譯。');
    await rpc({ kind: 'settings.save', settings: next });
    settings = next;
    showSiteRule();
    status('此網站的翻譯規則已更新。');
}
function siteRuleChanged(): void {
    void saveSiteRule().catch(error => {
        try {
            showSiteRule();
        }
        catch {
            input('always').checked = false;
        }
        report(error);
    });
}
input('always').addEventListener('change', siteRuleChanged);
select('site-rule').addEventListener('change', () => {
    if (input('always').checked)
        siteRuleChanged();
});
element('settings').addEventListener('click', () => void chrome.runtime.openOptionsPage().catch(report));
element('documents').addEventListener('click', () => void chrome.tabs.create({ url: pdfTab&&activeTab?workspaceForTab(activeTab):chrome.runtime.getURL('documents.html') }).catch(report));
element('shortcuts').addEventListener('click', () => void chrome.tabs.create({ url: 'chrome://extensions/shortcuts' }).catch(report));
void (async () => {
    settings = settingsSchema.parse(await rpc({ kind: 'settings.get' }));
    [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
    pdfTab=activeTab?await isPdfTab(activeTab):false;
    setSelect('source', settings.source);
    setSelect('target', settings.target);
    setSelect('provider', settings.provider);
    setMode(settings.mode);
    input('hover').checked = settings.hover;
    if(pdfTab){
        element('site').textContent='PDF 文件';element('translate').textContent='開啟 PDF 翻譯';
        input('always').disabled=true;select('site-rule').disabled=true;
        for(const button of document.querySelectorAll<HTMLButtonElement>('[data-mode]'))button.disabled=true;
        status('PDF 請在文件工作區讀取並翻譯；內建閱讀器的選取翻譯不支援。');
    }else try {
        const url = currentUrl();
        element('site').textContent = url.hostname;
        showSiteRule();
    }
    catch (error) {
        report(error);
        element('site').textContent = '此頁面無法翻譯';
    }
    ready = true;
    if (!pdfTab&&!settings.providers[settings.provider].apiKey)
        status('請先在設定中填入自己的 API Key。');
})().catch(report);

element('sidepanel').addEventListener('click',()=>{
 if(activeTab?.id===undefined){status('請先開啟瀏覽器分頁。',true);return;}
 void chrome.sidePanel.open({tabId:activeTab.id}).catch(report);
});

element('vocabulary').addEventListener('click', () => void rpc({ kind: 'vocabulary.open' }).catch(report));
input('hover').addEventListener('change', () => {
    void (async () => {
        if (!ready || busy || activeTab?.id === undefined) throw new Error('請等設定載入後再試。');
        currentUrl();
        const next = readSettings();
        if (next.hover && !await chrome.permissions.request({ origins: [endpointOrigin(next.providers[next.provider].endpoint)] }))
            throw new Error('尚未授權查詞服務。');
        await rpc({ kind: 'settings.save', settings: next });
        settings = next;
        await chrome.scripting.executeScript({ target: { tabId: activeTab.id }, files: ['content/content.js'] });
        status(next.hover ? '已啟用，按住 Ctrl 停留後點小圖標查詞；反白翻譯按 Alt+Q。' : '已關閉懸停查詞。');
    })().catch(error => { input('hover').checked = settings.hover; report(error); });
});
