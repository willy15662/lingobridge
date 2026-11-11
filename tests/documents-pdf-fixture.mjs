export function pdfFixture(){
 const objects=['<< /Type /Catalog /Pages 2 0 R >>','<< /Type /Pages /Kids [3 0 R 6 0 R] /Count 2 >>','<< /Type /Page /Parent 2 0 R /MediaBox [0 0 600 800] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>','<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'];
 const stream=text=>{const data=`BT /F1 12 Tf 50 750 Td (${text}) Tj ET`;return `<< /Length ${data.length} >>\nstream\n${data}\nendstream`;};
 objects.push(stream('Hello local PDF'),'<< /Type /Page /Parent 2 0 R /MediaBox [0 0 600 800] /Resources << /Font << /F1 4 0 R >> >> /Contents 7 0 R >>',stream('A second page'));
 let text='%PDF-1.4\n';const offsets=[];
 for(const [index,body] of objects.entries()){offsets.push(text.length);text+=`${index+1} 0 obj\n${body}\nendobj\n`;}
 const xref=text.length;text+=`xref\n0 ${objects.length+1}\n0000000000 65535 f \n`+offsets.map(n=>String(n).padStart(10,'0')+' 00000 n \n').join('')+`trailer\n<< /Size ${objects.length+1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
 return new TextEncoder().encode(text).buffer;
}
