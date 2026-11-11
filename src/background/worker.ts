import { dictionaryPrompt, parseDictionary } from '../core/vocabulary';
import { VocabularyStore } from './vocabulary';
import {isPdfTab,workspaceForTab} from '../core/pdf-entry';
import { defaults, settingsSchema, publicSettings, sitePolicy, type Settings } from '../core/settings';
import { requestSchema, unwrapReply, type Request, type Reply } from '../core/messages';
import { TranslationEngine } from './engine';
import { TranslationError, endpointURL } from './providers';
// Immediately restrict storage; no content-script listener is allowed to return secrets.
const ready = chrome.storage.local.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' });
async function settings(): Promise<Settings> { await ready; const value = await chrome.storage.local.get('settings'); return settingsSchema.safeParse(value.settings).data ?? structuredClone(defaults); }
const engine = new TranslationEngine({ async load() { await ready; const data = await chrome.storage.local.get(['cache', 'stats']); return { cache: data.cache, stats: data.stats }; }, async save(cache, stats) { await chrome.storage.local.set({ cache, stats }); } });
const vocabulary = new VocabularyStore();
function trusted(sender: chrome.runtime.MessageSender): boolean { return sender.id === chrome.runtime.id && typeof sender.url === 'string' && sender.url.startsWith(chrome.runtime.getURL('')); }
async function activePage(message: unknown) {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if(tab&&await isPdfTab(tab)){await chrome.tabs.create({url:workspaceForTab(tab)});return {document:true};}
    if (!tab?.id || !tab.url || !/^https?:/.test(tab.url))
        throw new TranslationError('此頁不支援翻譯，請開啟一般 HTTP／HTTPS 網頁。');
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['content/content.js'] });
    return unwrapReply(await chrome.tabs.sendMessage(tab.id, message));
}
async function broadcastSettings(value:Settings,restore=false):Promise<void>{
 const tabs=await chrome.tabs.query({}).catch(()=>[]);
 const message={kind:'settings.updated',settings:publicSettings(value),restore};
 await Promise.allSettled(tabs.filter(tab=>tab.id!==undefined).map(tab=>chrome.tabs.sendMessage(tab.id??-1,message)));
}
let registration: Promise<unknown> = Promise.resolve();
function registerSites() {
    registration = registration.catch(() => { }).then(async () => {
        const granted = await chrome.permissions.getAll();
        const matches = (granted.origins ?? []).filter(origin => /^https?:\/\//.test(origin));
        const existing = await chrome.scripting.getRegisteredContentScripts();
        if (existing.some(e => e.id === 'local-translator'))
            await chrome.scripting.unregisterContentScripts({ ids: ['local-translator'] });
        if (matches.length)
            await chrome.scripting.registerContentScripts([{ id: 'local-translator', matches, js: ['content/content.js'], runAt: 'document_idle', persistAcrossSessions: true }]);
    });
    return registration;
}
async function dispatch(request: Request, sender: chrome.runtime.MessageSender): Promise<unknown> {
    const isTrusted = trusted(sender);
    if (!isTrusted && !['settings.public', 'translate', 'captions.info', 'dictionary.lookup', 'vocabulary.save', 'vocabulary.open'].includes(request.kind))
        throw new TranslationError('此操作僅允許擴充套件設定頁使用。');
    if (sender.id !== chrome.runtime.id)
        throw new TranslationError('無效來源。');
    if (['dictionary.lookup', 'vocabulary.save', 'vocabulary.open'].includes(request.kind) && !isTrusted) {
        const s = await settings();
        if (!sender.url || !/^https?:/.test(sender.url) || sitePolicy(new URL(sender.url).hostname, publicSettings(s)) === 'blocked')
            throw new TranslationError('此網站已停用查詞。');
    }
    switch (request.kind) {
        case 'dictionary.lookup': {
            const s = await settings();
            if (s.provider === 'deepl') throw new TranslationError('詞意與例句查詢需要 OpenAI 或 Gemini，請在設定切換服務。');
            const config = s.providers[s.provider];
            const url = endpointURL(config.endpoint);
            if (!await chrome.permissions.contains({ origins: [url.origin + '/*'] }))
                throw new TranslationError('請先到設定授權 API 網址。');
            const configured = { ...s, providers: { ...s.providers, [s.provider]: { ...config, prompt: dictionaryPrompt(s.target) } } };
            try {
                const results = await engine.translate([JSON.stringify({ term: request.term, context: request.context })], configured, s.source, s.target, true, text => { parseDictionary(text); });
                return parseDictionary(results[0] ?? '');
            } catch (error) {
                if (error instanceof TranslationError) throw error;
                throw new TranslationError('查詞服務回傳格式不完整，請重試或更換模型。');
            }
        }
        case 'vocabulary.save':
            await ready;
            return vocabulary.save(request.draft, (sender.url ?? '').slice(0, 2000));
        case 'vocabulary.list': await ready; return vocabulary.list();
        case 'vocabulary.review': await ready; return vocabulary.review(request.id, request.remembered);
        case 'vocabulary.remove': await ready; await vocabulary.remove(request.id); return null;
        case 'vocabulary.open': await chrome.tabs.create({ url: chrome.runtime.getURL('vocabulary.html') }); return null;
        case 'captions.info': {
            if(!sender.tab?.id||!sender.url||!/^https:\/\/(www\.|m\.)?youtube\.com\/watch(?:\?|$)/.test(sender.url))throw new TranslationError('不支援此字幕來源。');
            const results=await chrome.scripting.executeScript({target:{tabId:sender.tab.id},world:'MAIN',func:()=>{
                const player=document.getElementById('movie_player');
                if(!player||!('getPlayerResponse' in player)||typeof player.getPlayerResponse!=='function')return null;
                const data:unknown=player.getPlayerResponse();
                if(!data||typeof data!=='object')return null;
                let language:unknown;
                if('getOption' in player&&typeof player.getOption==='function'){
                    const track:unknown=player.getOption('captions','track');
                    if(track&&typeof track==='object'&&'languageCode' in track)language=track.languageCode;
                }
                if(!('videoDetails' in data)||!data.videoDetails||typeof data.videoDetails!=='object'||!('videoId' in data.videoDetails))return null;
                if(!('captions' in data)||!data.captions||typeof data.captions!=='object'||!('playerCaptionsTracklistRenderer' in data.captions))return null;
                const renderer=data.captions.playerCaptionsTracklistRenderer;
                if(!renderer||typeof renderer!=='object'||!('captionTracks' in renderer))return null;
                return {videoId:data.videoDetails.videoId,language,tracks:renderer.captionTracks};
            }});
            return results[0]?.result??null;
        }
        case 'settings.public': return publicSettings(await settings());
        case 'settings.get': return settings();
        case 'settings.save': {
            for (const config of Object.values(request.settings.providers))
                endpointURL(config.endpoint);
            await chrome.storage.local.set({ settings: request.settings });
            await broadcastSettings(request.settings);
            return publicSettings(request.settings);
        }
        case 'translate': {
            const s = await settings();
            if (request.texts.reduce((sum, t) => sum + t.length, 0) > 80000)
                throw new TranslationError('單次文字過長，請分段翻譯。');
            if (!isTrusted) {
                if (!sender.url || !/^https?:/.test(sender.url))
                    throw new TranslationError('不支援此頁面。');
                if (sitePolicy(new URL(sender.url).hostname, publicSettings(s)) === 'blocked')
                    throw new TranslationError('此網站已停用翻譯。');
            }
            const url = endpointURL(s.providers[s.provider].endpoint);
            if (!await chrome.permissions.contains({ origins: [url.origin + '/*'] }))
                throw new TranslationError('尚未授權 API 網址。請到設定儲存並授予連線權限。');
            let source = request.source ?? s.source;
            if (source === 'auto') {
                const detection = await chrome.i18n.detectLanguage(request.texts.join('\n').slice(0, 10000)).catch(() => null);
                if (detection?.isReliable)
                    source = detection.languages[0]?.language ?? 'auto';
            }
            return engine.translate(request.texts, s, source, request.target ?? s.target,request.priority==='subtitle');
        }
        case 'stats.get': return engine.getStats();
        case 'cache.clear':
            await engine.clear('cache');
            return null;
        case 'stats.clear':
            await engine.clear('stats');
            return null;
        case 'data.reset':
            await ready;
            await vocabulary.clear();
            await engine.clear('all');
            await chrome.storage.local.set({ settings: structuredClone(defaults) });
            await broadcastSettings(defaults,true);
            return null;
        case 'page.mode':
        case 'page.selection': return activePage(request);
        default: {
            const exhaustive: never = request;
            return exhaustive;
        }
    }
}
chrome.runtime.onMessage.addListener((value, sender, respond) => {
    const parsed = requestSchema.safeParse(value);
    if (!parsed.success) {
        respond({ ok: false, error: '無效的擴充套件訊息。' } satisfies Reply);
        return false;
    }
    void dispatch(parsed.data, sender).then(data => respond({ ok: true, data } satisfies Reply)).catch(error => respond({ ok: false, error: error instanceof TranslationError ? error.message : '操作失敗，請重新載入頁面或檢查設定。' } satisfies Reply));
    return true;
});
async function install() { await ready; await chrome.contextMenus.removeAll(); chrome.contextMenus.create({ id: 'translate-page', title: '翻譯此頁（雙語）', contexts: ['page'] }); chrome.contextMenus.create({ id: 'translate-selection', title: '翻譯選取文字', contexts: ['selection'] }); await registerSites(); }
chrome.runtime.onInstalled.addListener(() => { void install(); });
chrome.permissions.onAdded.addListener(() => { void registerSites(); });
chrome.permissions.onRemoved.addListener(() => { void registerSites(); });
chrome.contextMenus.onClicked.addListener((info, tab) => {
    if (!tab?.id)
        return;
    const tabId = tab.id;
    void (async()=>{
        if(await isPdfTab(tab)){await chrome.tabs.create({url:workspaceForTab(tab)});return;}
        await chrome.scripting.executeScript({target:{tabId},files:['content/content.js']});
        await chrome.tabs.sendMessage(tabId,info.menuItemId==='translate-selection'?{kind:'page.selection',text:info.selectionText}:{kind:'page.mode',mode:'bilingual'});
    })().catch(()=>{});
});
chrome.commands.onCommand.addListener((command,tab) => {
    if(command==='open-side-panel'){
        if(tab?.id!==undefined)void chrome.sidePanel.open({tabId:tab.id}).catch(()=>{});
        return;
    }
    if(command==='translate-selection'||command==='toggle-translation')void activePage(command === 'translate-selection' ? { kind: 'page.selection' } : { kind: 'page.toggle' }).catch(() => {});
});
