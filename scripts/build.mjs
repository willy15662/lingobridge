import {build} from 'esbuild';
import {mkdir,cp,rm,mkdtemp,rename} from 'node:fs/promises';
import {resolve,dirname} from 'node:path';
// Parallel investigations must select distinct outputs: node scripts/build.mjs /tmp/own-build.
const out=resolve(process.argv[2]??'dist');
await mkdir(dirname(out),{recursive:true});
const staging=await mkdtemp(out+'-staging-');
try {
 await cp('public',staging,{recursive:true});
 await build({entryPoints:['src/background/worker.ts','src/content/content.ts','src/ui/popup.ts','src/ui/options.ts','src/ui/sidepanel.ts','src/ui/vocabulary.ts','src/documents/documents.ts'],outdir:staging,outbase:'src',bundle:true,format:'iife',target:'chrome120',sourcemap:true,logLevel:'info'});
 await rm(out,{recursive:true,force:true});
 await rename(staging,out);
} finally {await rm(staging,{recursive:true,force:true});}
