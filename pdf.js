/* Petit générateur PDF (texte seul, tableau avec retour à la ligne), sans bibliothèque externe.
   window.makeTablePdf({title, subtitle, head:[...], rows:[[...]], widths:[...]}) -> Blob PDF (A4 paysage) */
(function(){
  // largeurs Helvetica (unités /1000) pour les caractères 32 à 126
  const W = [278,278,355,556,556,889,667,191,333,333,389,584,278,333,278,278,556,556,556,556,556,556,556,556,556,556,278,278,584,584,584,556,1015,667,667,722,722,667,611,778,722,278,500,667,556,833,722,778,667,778,722,667,611,722,667,944,667,667,611,278,278,278,469,556,333,556,556,500,556,556,278,556,556,222,222,500,222,833,556,556,556,556,333,500,278,556,500,722,500,500,500,334,260,334,584];
  const BASE = {'à':'a','â':'a','ä':'a','á':'a','ç':'c','é':'e','è':'e','ê':'e','ë':'e','î':'i','ï':'i','í':'i','ô':'o','ö':'o','ó':'o','ù':'u','û':'u','ü':'u','ú':'u','ÿ':'y','ñ':'n',
    'À':'A','Â':'A','Ä':'A','Ç':'C','É':'E','È':'E','Ê':'E','Ë':'E','Î':'I','Ï':'I','Ô':'O','Ö':'O','Ù':'U','Û':'U','Ü':'U','œ':'o','Œ':'O','’':"'",'‘':"'",'“':'"','”':'"','«':'"','»':'"','–':'-','—':'-','…':'.'};
  // caractères hors Latin-1 mais présents dans WinAnsi
  const WIN = {'€':0x80,'‚':0x82,'„':0x84,'…':0x85,'‘':0x91,'’':0x92,'“':0x93,'”':0x94,'•':0x95,'–':0x96,'—':0x97,'œ':0x9C,'Œ':0x8C};
  const cw = (ch, bold) => { let c = ch.charCodeAt(0); if(c < 32 || c > 126){ const b = BASE[ch]; c = b ? b.charCodeAt(0) : 110; if(ch === '…') return 1000*(bold?1.06:1); }
    return (W[c-32] || 556) * (bold ? 1.06 : 1); };
  const textW = (s, size, bold) => { let w = 0; for(const ch of s) w += cw(ch, bold); return w * size / 1000; };
  function wrap(s, maxW, size, bold){
    const out = []; String(s == null ? '' : s).split('\n').forEach(par => {
      let line = '';
      par.split(/\s+/).filter(Boolean).forEach(word => {
        const t = line ? line + ' ' + word : word;
        if(textW(t, size, bold) <= maxW){ line = t; return; }
        if(line) out.push(line);
        // mot trop long : on le coupe
        let w = word; while(textW(w, size, bold) > maxW){ let k = w.length; while(k > 1 && textW(w.slice(0,k), size, bold) > maxW) k--; out.push(w.slice(0,k)); w = w.slice(k); }
        line = w;
      });
      out.push(line);
    });
    return out.length ? out : [''];
  }
  const enc = s => { let o = ''; for(const ch of String(s)){ let c = ch.charCodeAt(0);
      if(WIN[ch]) c = WIN[ch]; else if(c > 255) c = 63;
      const x = String.fromCharCode(c); o += (x === '(' || x === ')' || x === '\\') ? '\\' + x : x; } return o; };

  window.makeTablePdf = function({title, subtitle, head, rows, widths}){
    const PW = 842, PH = 595, M = 28, FS = 10, LH = 12.5, PAD = 4;
    const total = widths.reduce((a,b) => a+b, 0), avail = PW - 2*M;
    const cols = widths.map(w => w * avail / total);
    const pages = []; let ops = [], y = PH - M;
    const txt = (x, yy, s, bold, size) => ops.push(`BT /${bold?'F2':'F1'} ${size||FS} Tf ${x.toFixed(1)} ${yy.toFixed(1)} Td (${enc(s)}) Tj ET`);
    const newPage = () => { if(ops.length) pages.push(ops.join('\n')); ops = []; y = PH - M; };
    const drawRow = (cells, bold, shade) => {
      const lines = cells.map((c, i) => wrap(c, cols[i] - 2*PAD, FS, bold));
      const h = Math.max(...lines.map(l => l.length)) * LH + 2*PAD - 2;
      if(y - h < M){ newPage(); drawRow(head, true, true); }
      if(shade) ops.push(`0.92 0.95 0.93 rg ${M} ${(y-h).toFixed(1)} ${avail.toFixed(1)} ${h.toFixed(1)} re f 0 0 0 rg`);
      let x = M;
      lines.forEach((ls, i) => { ls.forEach((l, k) => txt(x + PAD, y - PAD - FS + 1 - k*LH, l, bold)); x += cols[i]; });
      ops.push(`0.75 0.8 0.77 RG 0.5 w ${M} ${(y-h).toFixed(1)} m ${(M+avail).toFixed(1)} ${(y-h).toFixed(1)} l S 0 0 0 RG`);
      y -= h;
    };
    txt(M, y - 14, title, true, 15); y -= 24;
    if(subtitle){ txt(M, y - 11, subtitle, true, 11); y -= 20; }
    y -= 4; drawRow(head, true, true);
    if(!rows.length){ txt(M + PAD, y - 16, 'Aucun passage coché ce jour-là.', false); y -= 20; }
    rows.forEach(r => drawRow(r, false, false));
    newPage();
    // assemblage
    const objs = [];
    objs[1] = '<< /Type /Catalog /Pages 2 0 R >>';
    objs[3] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>';
    objs[4] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>';
    const kids = [];
    pages.forEach((content, i) => {
      const pn = 5 + i*2, cn = pn + 1; kids.push(pn + ' 0 R');
      objs[pn] = `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PW} ${PH}] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${cn} 0 R >>`;
      objs[cn] = `<< /Length ${content.length} >>\nstream\n${content}\nendstream`;
    });
    objs[2] = `<< /Type /Pages /Kids [${kids.join(' ')}] /Count ${kids.length} >>`;
    let out = '%PDF-1.4\n%\xE2\xE3\xCF\xD3\n'; const off = [];
    for(let i = 1; i < objs.length; i++){ off[i] = out.length; out += `${i} 0 obj\n${objs[i]}\nendobj\n`; }
    const xref = out.length;
    out += `xref\n0 ${objs.length}\n0000000000 65535 f \n` + off.slice(1).map(o => String(o).padStart(10,'0') + ' 00000 n \n').join('');
    out += `trailer\n<< /Size ${objs.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
    const bytes = new Uint8Array(out.length); for(let i = 0; i < out.length; i++) bytes[i] = out.charCodeAt(i) & 255;
    return new Blob([bytes], {type:'application/pdf'});
  };
})();
