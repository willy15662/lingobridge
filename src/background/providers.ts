import { z } from 'zod';
import type { ProviderConfig, ProviderId } from '../core/settings';
export class TranslationError extends Error {
    constructor(message: string, readonly retryable = false, readonly retryAfterMs = 0) { super(message); }
}
export interface TranslationInput {
    texts: string[];
    source: string;
    target: string;
    config: ProviderConfig;
}
export interface TranslationResult {
    texts: string[];
    inputTokens: number;
    outputTokens: number;
}
export interface TranslationProvider {
    translate(input: TranslationInput): Promise<TranslationResult>;
}
export function endpointURL(endpoint: string): URL {
    const url = new URL(endpoint);
    if (url.username || url.password || url.search || url.hash)
        throw new TranslationError('API 網址不可包含帳密、查詢參數或片段。');
    if (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)))
        throw new TranslationError('API 必須使用 HTTPS；本機服務可使用 HTTP。');
    return url;
}
const token = z.number().nonnegative().optional().default(0);
const openaiResponse = z.object({ choices: z.array(z.object({ message: z.object({ content: z.string() }) })).min(1), usage: z.object({ prompt_tokens: token, completion_tokens: token }).optional() });
const geminiResponse = z.object({ candidates: z.array(z.object({ content: z.object({ parts: z.array(z.object({ text: z.string().optional() })) }) })).min(1), usageMetadata: z.object({ promptTokenCount: token, candidatesTokenCount: token }).optional() });
const deeplResponse = z.object({ translations: z.array(z.object({ text: z.string() })) });
export function parseTranslations(value: string, count: number): string[] {
    let data: unknown;
    try {
        data = JSON.parse(value.trim().replace(/^```(?:json)?\s*/, '').replace(/\s*```$/, ''));
    }
    catch {
        throw new TranslationError('翻譯服務未回傳有效的 JSON 陣列，請檢查模型與 Prompt。');
    }
    const parsed = z.array(z.string().max(60000)).safeParse(data);
    if (!parsed.success || parsed.data.length !== count)
        throw new TranslationError('翻譯結果數量或格式不正確。');
    return parsed.data;
}
export function language(code: string): string {
    if (code === 'zh-TW')
        return 'ZH-HANT';
    if (code === 'zh-CN')
        return 'ZH-HANS';
    return code.toUpperCase();
}
async function post(url: URL, headers: Record<string, string>, body: unknown): Promise<unknown> {
    let response: Response;
    try {
        response = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body), signal: AbortSignal.timeout(25000), credentials: 'omit', redirect: 'error' });
    }
    catch {
        throw new TranslationError('無法連線翻譯服務，請檢查網址、權限與網路。', true);
    }
    if (!response.ok) {
        const retry = Number(response.headers.get('retry-after'));
        throw new TranslationError(`翻譯服務回傳 HTTP ${response.status}。${response.status === 401 || response.status === 403 ? '請檢查 API Key 與權限。' : ''}`, response.status === 429 || response.status >= 500, Number.isFinite(retry) ? Math.min(10000, Math.max(0, retry * 1000)) : 0);
    }
    try {
        return await response.json();
    }
    catch {
        throw new TranslationError('翻譯服務回傳無效 JSON。');
    }
}
function prompt(i: TranslationInput): string { return i.config.prompt.replaceAll('{{source}}', i.source === 'auto' ? 'the automatically detected source language' : i.source).replaceAll('{{target}}', i.target); }
export function createProvider(id: ProviderId): TranslationProvider {
    return { async translate(i) {
            if (!i.config.apiKey.trim())
                throw new TranslationError('請先在設定中填入 API Key。');
            const url = endpointURL(i.config.endpoint);
            switch (id) {
                case 'openai': {
                    const raw = await post(url, { Authorization: `Bearer ${i.config.apiKey}` }, { model: i.config.model, messages: [{ role: 'system', content: prompt(i) }, { role: 'user', content: JSON.stringify(i.texts) }], temperature: 0.2 });
                    const result = openaiResponse.safeParse(raw);
                    if (!result.success)
                        throw new TranslationError('OpenAI 回應結構不正確。');
                    const text = result.data.choices[0]?.message.content;
                    if (text === undefined)
                        throw new TranslationError('OpenAI 未回傳翻譯。');
                    return { texts: parseTranslations(text, i.texts.length), inputTokens: result.data.usage?.prompt_tokens ?? 0, outputTokens: result.data.usage?.completion_tokens ?? 0 };
                }
                case 'gemini': {
                    url.pathname = url.pathname.replace(/\/$/, '') + `/models/${encodeURIComponent(i.config.model)}:generateContent`;
                    const raw = await post(url, { 'x-goog-api-key': i.config.apiKey }, { systemInstruction: { parts: [{ text: prompt(i) }] }, contents: [{ role: 'user', parts: [{ text: JSON.stringify(i.texts) }] }], generationConfig: { responseMimeType: 'application/json', temperature: 0.2 } });
                    const result = geminiResponse.safeParse(raw);
                    if (!result.success)
                        throw new TranslationError('Gemini 回應結構不正確。');
                    const text = result.data.candidates[0]?.content.parts.map(p => p.text ?? '').join('');
                    if (text === undefined)
                        throw new TranslationError('Gemini 未回傳翻譯。');
                    return { texts: parseTranslations(text, i.texts.length), inputTokens: result.data.usageMetadata?.promptTokenCount ?? 0, outputTokens: result.data.usageMetadata?.candidatesTokenCount ?? 0 };
                }
                case 'deepl': {
                    const raw = await post(url, { Authorization: `DeepL-Auth-Key ${i.config.apiKey}` }, { text: i.texts, target_lang: language(i.target), ...(i.source === 'auto' ? {} : { source_lang: i.source.split('-')[0]?.toUpperCase() }), preserve_formatting: true });
                    const result = deeplResponse.safeParse(raw);
                    if (!result.success || result.data.translations.length !== i.texts.length)
                        throw new TranslationError('DeepL 翻譯結果數量或格式不正確。');
                    return { texts: result.data.translations.map(t => t.text), inputTokens: 0, outputTokens: 0 };
                }
                default: {
                    const exhaustive: never = id;
                    throw new Error(exhaustive);
                }
            }
        } };
}
