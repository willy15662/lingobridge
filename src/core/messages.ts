import { imageDataSchema } from './images';
import { lookupInputSchema, vocabularyDraftSchema } from './vocabulary';
import { z } from 'zod';
import { modeSchema, settingsSchema, publicSettingsSchema } from './settings';
export const requestSchema = z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('image.read'), url: z.string().url().max(16000) }),
    z.object({ kind: z.literal('image.translate'), data: imageDataSchema }),
    lookupInputSchema.extend({ kind: z.literal('dictionary.lookup') }),
    z.object({ kind: z.literal('vocabulary.save'), draft: vocabularyDraftSchema }),
    z.object({ kind: z.literal('vocabulary.open') }),
    z.object({ kind: z.literal('vocabulary.list') }),
    z.object({ kind: z.literal('vocabulary.remove'), id: z.string().startsWith('vocabulary:').max(2000) }),
    z.object({ kind: z.literal('vocabulary.review'), id: z.string().startsWith('vocabulary:').max(2000), remembered: z.boolean() }),
    z.object({ kind: z.literal('settings.get') }), z.object({ kind: z.literal('settings.public') }), z.object({ kind: z.literal('settings.save'), settings: settingsSchema }),
    z.object({kind:z.literal('captions.info')}),
    z.object({ kind: z.literal('translate'), priority:z.enum(['normal','subtitle']).optional(), texts: z.array(z.string().max(12000)).min(1).max(40), source: z.string().min(2).max(30).optional(), target: z.string().min(2).max(30).optional() }),
    z.object({ kind: z.literal('page.mode'), mode: modeSchema }), z.object({ kind: z.literal('page.selection'), text: z.string().max(12000).optional() }),
    z.object({ kind: z.literal('stats.get') }), z.object({ kind: z.literal('cache.clear') }), z.object({ kind: z.literal('stats.clear') }), z.object({ kind: z.literal('data.reset') })
]);
export type Request = z.infer<typeof requestSchema>;
export type Reply = {
    ok: true;
    data: unknown;
} | {
    ok: false;
    error: string;
};
const replySchema = z.discriminatedUnion('ok', [z.object({ ok: z.literal(true), data: z.unknown() }), z.object({ ok: z.literal(false), error: z.string() })]);
export async function rpc(request: Request): Promise<unknown> {
    return unwrapReply(await chrome.runtime.sendMessage(request));
}
export async function translate(texts: string[]): Promise<string[]> { return z.array(z.string()).parse(await rpc({ kind: 'translate', texts })); }

export const contentMessageSchema=z.discriminatedUnion('kind',[
 z.object({kind:z.literal('page.mode'),mode:modeSchema}),
 z.object({kind:z.literal('page.selection'),text:z.string().max(12000).optional()}),
 z.object({kind:z.literal('page.toggle')}),
 z.object({kind:z.literal('settings.updated'),settings:publicSettingsSchema,restore:z.boolean().default(false)})
]);
export function unwrapReply(value:unknown):unknown{const parsed=replySchema.parse(value);if(!parsed.ok)throw new Error(parsed.error);return parsed.data;}

export async function translateSubtitles(texts:string[]):Promise<string[]>{return z.array(z.string()).parse(await rpc({kind:'translate',texts,priority:'subtitle'}));}
