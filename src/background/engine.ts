import { z } from 'zod';
import type { Settings } from '../core/settings';
import { createProvider, TranslationError, type TranslationProvider } from './providers';
export const statsSchema = z.object({ requests: z.number(), characters: z.number(), cacheHits: z.number(), errors: z.number(), inputTokens: z.number(), outputTokens: z.number() });
export type Stats = z.infer<typeof statsSchema>;
export const emptyStats = (): Stats => ({ requests: 0, characters: 0, cacheHits: 0, errors: 0, inputTokens: 0, outputTokens: 0 });
const entrySchema = z.object({ value: z.string(), time: z.number() });
const cacheSchema = z.record(entrySchema);
export interface EngineStore {
    load(): Promise<{
        cache: unknown;
        stats: unknown;
    }>;
    save(cache: Record<string, {
        value: string;
        time: number;
    }>, stats: Stats): Promise<void>;
}
export async function cacheKey(s: Settings, source: string, target: string, text: string): Promise<string> { const config = s.providers[s.provider]; const bytes = new TextEncoder().encode(JSON.stringify([s.provider, config.endpoint, config.model, config.prompt, source, target, text])); return [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(b => b.toString(16).padStart(2, '0')).join(''); }
export class TranslationEngine {
    private jobs:Array<{run:()=>Promise<void>;priority:boolean}>=[];
    private running=false;
    private priorityStreak=0;
    private cache: Record<string, {
        value: string;
        time: number;
    }> = {};
    private stats = emptyStats();
    private loaded = false;
    private lastRequest = 0;
    constructor(private store: EngineStore, private providerFactory: (id: Settings['provider']) => TranslationProvider = createProvider, private sleep: (ms: number) => Promise<void> = ms => new Promise(r => setTimeout(r, ms))) { }
    private serial<T>(fn:()=>Promise<T>,priority=false):Promise<T>{
        return new Promise<T>((resolve,reject)=>{
            this.jobs.push({priority,run:async()=>{try{resolve(await fn());}catch(error){reject(error);}}});
            void this.drain();
        });
    }
    private async drain():Promise<void>{
        if(this.running)return;
        this.running=true;
        try{while(this.jobs.length){
            const preferred=this.priorityStreak<3?this.jobs.findIndex(job=>job.priority):this.jobs.findIndex(job=>!job.priority);
            const [job]=this.jobs.splice(preferred<0?0:preferred,1);
            if(!job)continue;
            this.priorityStreak=job.priority?this.priorityStreak+1:0;
            await job.run();
        }}finally{this.running=false;}
    }
    private async load() {
        if (this.loaded)
            return;
        const data = await this.store.load();
        this.cache = cacheSchema.safeParse(data.cache).data ?? {};
        this.stats = statsSchema.safeParse(data.stats).data ?? emptyStats();
        this.loaded = true;
    }
    getStats() { return this.serial(async () => { await this.load(); return { ...this.stats }; }); }
    clear(kind: 'cache' | 'stats' | 'all') {
        return this.serial(async () => {
            await this.load();
            if (kind !== 'stats')
                this.cache = {};
            if (kind !== 'cache')
                this.stats = emptyStats();
            await this.persist();
        });
    }
    private async persist() {
        const entries = Object.entries(this.cache).filter(([, v]) => Date.now() - v.time < 30 * 86400000).sort((a, b) => b[1].time - a[1].time);
        let bytes = 0;
        this.cache = {};
        for (const [key, value] of entries) {
            bytes += 2 * (key.length + value.value.length) + 64;
            if (bytes > 3000000)
                break;
            this.cache[key] = value;
        }
        await this.store.save(this.cache, this.stats);
    }
    async translate(texts: string[], s: Settings, source = s.source, target = s.target, priority=false, validate?: (text: string) => void): Promise<string[]> {
        const result:string[]=[];
        for(let index=0;index<texts.length;index+=s.batchSize){
            result.push(...await this.translateBatch(texts.slice(index,index+s.batchSize),s,source,target,priority,validate));
        }
        return result;
    }
    private translateBatch(texts:string[],s:Settings,source:string,target:string,priority:boolean,validate?: (text: string) => void):Promise<string[]>{
        return this.serial(async () => {
            await this.load();
            const keys = await Promise.all(texts.map(t => cacheKey(s, source, target, t)));
            const output: string[] = [];
            const missing = new Map<string, {
                text: string;
                indexes: number[];
            }>();
            for (let n = 0; n < texts.length; n++) {
                const key = keys[n], text = texts[n];
                if (key === undefined || text === undefined)
                    continue;
                const cached = this.cache[key];
                if (cached && Date.now() - cached.time < 30 * 86400000) {
                    try { validate?.(cached.value); }
                    catch { delete this.cache[key]; missing.set(key, { text, indexes: [n] }); continue; }
                    output[n] = cached.value;
                    this.stats.cacheHits++;
                }
                else if (!text.trim()) {
                    output[n] = text;
                }
                else {
                    const item = missing.get(key);
                    if (item)
                        item.indexes.push(n);
                    else
                        missing.set(key, { text, indexes: [n] });
                }
            }
            try {
                const items = [...missing.entries()];
                for (let start = 0; start < items.length; start += s.batchSize) {
                    const batch = items.slice(start, start + s.batchSize);
                    let result;
                    for (let attempt = 0; attempt < 3; attempt++) {
                        await this.sleep(Math.max(0, this.lastRequest + 60000 / s.requestsPerMinute - Date.now()));
                        this.lastRequest = Date.now();
                        this.stats.requests++;
                        this.stats.characters += batch.reduce((sum, [, v]) => sum + v.text.length, 0);
                        try {
                            result = await this.providerFactory(s.provider).translate({ texts: batch.map(([, v]) => v.text), source, target, config: s.providers[s.provider] });
                            break;
                        }
                        catch (error) {
                            if (!(error instanceof TranslationError) || !error.retryable || attempt === 2)
                                throw error;
                            await this.sleep(Math.max(error.retryAfterMs, 500 * 2 ** attempt));
                        }
                    }
                    if (!result || result.texts.length !== batch.length)
                        throw new TranslationError('翻譯結果數量不正確。');
                    // Validate structured results before persisting them so retrying a
                    // malformed dictionary response can make a fresh provider request.
                    if (validate) result.texts.forEach(validate);
                    this.stats.inputTokens += result.inputTokens;
                    this.stats.outputTokens += result.outputTokens;
                    batch.forEach(([key, value], index) => {
                        const translated = result.texts[index];
                        if (translated === undefined)
                            return;
                        this.cache[key] = { value: translated, time: Date.now() };
                        for (const n of value.indexes)
                            output[n] = translated;
                    });
                }
            }
            catch (error) {
                this.stats.errors++;
                throw error;
            }
            finally {
                await this.persist();
            }
            return output;
        },priority);
    }
}
