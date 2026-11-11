import { rpc, contentMessageSchema, translate } from '../core/messages';
import { settingsSchema } from '../core/settings';
import { PageTranslator } from './controller';
declare global {
    var __localTranslateContentInstalled: boolean | undefined;
}
if (!globalThis.__localTranslateContentInstalled) {
    globalThis.__localTranslateContentInstalled = true;
    const publicSchema = settingsSchema.omit({ providers: true });
    let ready: Promise<PageTranslator> | undefined;
    function getController(): Promise<PageTranslator> {
        if(document.contentType==='application/pdf'||document.querySelector('embed[type="application/pdf"],object[type="application/pdf"]'))return Promise.reject(new Error('PDF 請使用文件工作區。'));
        ready ??= rpc({ kind: 'settings.public' }).then(data => new PageTranslator(publicSchema.parse(data), translate)).catch(error => { ready = undefined; throw error; });
        return ready;
    }
    // Register one stable listener; a later command can retry initialization.
    void getController().catch(() => undefined);
    chrome.runtime.onMessage.addListener((message, sender, reply) => {
        if (sender.id !== chrome.runtime.id)
            return;
        const request = contentMessageSchema.safeParse(message);
        if (!request.success)
            return;
        const action = request.data;
        void getController().then(async (controller) => {
            if(action.kind==='settings.updated') {
                controller.reset(action.settings, action.restore || action.settings.mode==='original' ? 'original' : controller.getMode());
            } else if (action.kind === 'page.selection')
                await controller.selection(action.text);
            else {
                const settings = publicSchema.parse(await rpc({ kind: 'settings.public' }));
                controller.reset(settings, action.kind === 'page.mode' ? action.mode : controller.getMode() === 'original' ? 'bilingual' : 'original');
            }
            reply({ ok: true, data: controller.status() });
        }).catch(() => reply({ ok: false, error: '無法翻譯此頁面，請重新載入頁面並檢查設定。' }));
        return true;
    });
}
