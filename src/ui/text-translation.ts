import {splitText} from '../content/dom';
export interface TextTranslationInput {text:string;source:string;target:string;batchSize:number}
export type TextBatch = (texts:string[],source:string,target:string)=>Promise<string[]>;
export async function translateText(input:TextTranslationInput,run:TextBatch,current:()=>boolean=()=>true):Promise<string>{
 if(!input.text.trim())throw new Error('請輸入要翻譯的文字。');
 if(input.text.length>60000)throw new Error('文字超過 60,000 字元，請改用文件翻譯。');
 const chunks=splitText(input.text,6000);const translated:string[]=[];
 const batchSize=Math.max(1,Math.min(10,Math.floor(input.batchSize)));
 for(let index=0;index<chunks.length;index+=batchSize){
  if(!current())throw new Error('翻譯已停止。');
  const batch=chunks.slice(index,index+batchSize);
  const result=await run(batch,input.source,input.target);
  if(!current())throw new Error('翻譯已停止。');
  if(result.length!==batch.length)throw new Error('翻譯結果數量不符。');
  translated.push(...result);
 }
 return translated.join('\n');
}
