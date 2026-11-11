import ts from 'typescript';import {readdir,readFile,writeFile} from 'node:fs/promises';
const printer=ts.createPrinter({newLine:ts.NewLineKind.LineFeed});
async function format(directory){for(const item of await readdir(directory,{withFileTypes:true})){const path=directory+'/'+item.name;if(item.isDirectory())await format(path);else if(path.endsWith('.ts')){const source=ts.createSourceFile(path,await readFile(path,'utf8'),ts.ScriptTarget.Latest,true);await writeFile(path,printer.printFile(source));}}}
await format('src');
