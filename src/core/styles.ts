import type {Settings} from './settings';
export function translationStyle(style:Settings['style']):Partial<CSSStyleDeclaration> {
 const common:Partial<CSSStyleDeclaration>={display:'block',color:'inherit',background:'transparent',fontSize:style.fontSize+'%',borderInlineStart:'none',padding:'0',margin:'8px 0',lineHeight:'1.65',whiteSpace:'pre-wrap',overflowWrap:'anywhere',textAlign:'start',textDecoration:'none'};
 switch(style.theme){
  case 'plain':return common;
  case 'highlight':return {...common,color:style.color,background:style.background,borderInlineStart:style.border?'2px solid '+style.color:'none',padding:'0.25em 0.55em'};
  case 'gray':return {...common,color:style.color,opacity:'0.72'};
  case 'blockquote':return {...common,color:style.color,borderInlineStart:'3px solid '+style.color,paddingInlineStart:'0.8em'};
  case 'underline':case 'dotted':case 'dashed':case 'wavy':return {...common,textDecorationLine:'underline',textDecorationStyle:style.theme==='underline'?'solid':style.theme,textDecorationColor:style.color,textUnderlineOffset:'0.3em'};
  case 'mask':return {...common,background:style.background,cursor:'help'};
  default:{const exhaustive:never=style.theme;return exhaustive;}
 }
}
export const maskStyles='[data-local-translate="result"][data-theme="mask"]:not(:hover):not(:focus){color:transparent!important;user-select:none}[data-local-translate="result"][data-theme="mask"]:focus{outline:2px solid currentColor;outline-offset:2px}';
export function applyTranslationStyle(element:HTMLElement,style:Settings['style']):void {
 element.removeAttribute('style');Object.assign(element.style,translationStyle(style));element.dataset.theme=style.theme;
 if(style.theme==='mask'){element.tabIndex=0;element.title='滑鼠停留或按 Tab 聚焦顯示譯文';}
 else{element.removeAttribute('tabindex');element.removeAttribute('title');}
}
