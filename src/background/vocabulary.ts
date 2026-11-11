import { vocabularyItemSchema, reviewed, type VocabularyDraft, type VocabularyItem } from '../core/vocabulary';

const prefix = 'vocabulary:';
// Only the worker writes vocabulary. Each word has its own storage key; serial
// mutations preserve review progress when two tabs save the same word together.
export class VocabularyStore {
    private mutations: Promise<unknown> = Promise.resolve();
    private serial<T>(run: () => Promise<T>): Promise<T> {
        const task = this.mutations.then(run);
        this.mutations = task.catch(() => undefined);
        return task;
    }
    async list(): Promise<VocabularyItem[]> {
        await this.mutations;
        const data = await chrome.storage.local.get(null);
        return Object.entries(data).flatMap(([key, value]) => {
            if (!key.startsWith(prefix)) return [];
            const parsed = vocabularyItemSchema.safeParse(value);
            return parsed.success ? [parsed.data] : [];
        }).sort((a, b) => b.savedAt - a.savedAt);
    }
    save(draft: VocabularyDraft, url: string): Promise<VocabularyItem> {
        return this.serial(async () => {
            const id = prefix + encodeURIComponent(JSON.stringify([draft.target, draft.term.normalize('NFKC').toLocaleLowerCase().replace(/\s+/g, ' ').trim()]));
            const previous = vocabularyItemSchema.safeParse((await chrome.storage.local.get(id))[id]);
            if (previous.success) return previous.data;
            const now = Date.now();
            const item: VocabularyItem = { ...draft, id, url, savedAt: now, dueAt: now, interval: 0, reviews: 0 };
            await chrome.storage.local.set({ [id]: item });
            return item;
        });
    }
    review(id: string, remembered: boolean): Promise<VocabularyItem> {
        return this.serial(async () => {
            const item = vocabularyItemSchema.parse((await chrome.storage.local.get(id))[id]);
            const result = reviewed(item, remembered, Date.now());
            await chrome.storage.local.set({ [id]: result });
            return result;
        });
    }
    remove(id: string): Promise<void> { return this.serial(() => chrome.storage.local.remove(id)); }
    clear(): Promise<void> {
        return this.serial(async () => {
            const keys = Object.keys(await chrome.storage.local.get(null)).filter(key => key.startsWith(prefix));
            if (keys.length) await chrome.storage.local.remove(keys);
        });
    }
}
