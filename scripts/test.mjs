import {readdir} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
// Run files directly so every named assertion is visible in this Node host.
for(const file of (await readdir('tests')).filter(f=>f.endsWith('.test.mjs')).sort()){
 console.log(`\nRunning ${file}`);
 const result=spawnSync(process.execPath,[`tests/${file}`],{stdio:'inherit'});
 if(result.status!==0)process.exit(result.status??1);
}
