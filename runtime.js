/* Version « sur le téléphone » : toutes les données restent dans ce téléphone, rien n'est envoyé sur Internet.
   L'appli appelle window.claude.use('db' | 'user' | 'downloads' | 'mcp') comme dans claude.ai. */
(function(){
  window.__PWA = true; window.__LOCAL = true;
  const KEY = 'tournee.db';

  /* ---------- stockage ---------- */
  let DATA = {};
  try { DATA = JSON.parse(localStorage.getItem(KEY) || '{}') || {}; } catch(e){ DATA = {}; }
  let saveT = null;
  function persist(){
    clearTimeout(saveT);
    saveT = setTimeout(() => { try { localStorage.setItem(KEY, JSON.stringify(DATA)); } catch(e){ alertFull(); } }, 50);
  }
  window.addEventListener('pagehide', () => { clearTimeout(saveT); try { localStorage.setItem(KEY, JSON.stringify(DATA)); } catch(e){} });
  function alertFull(){ const t = document.getElementById('toast'); if(t){ t.textContent = 'Mémoire du téléphone pleine : exportez une sauvegarde.'; t.hidden = false; } }
  /* demande au téléphone de ne jamais effacer ces données tout seul */
  try { navigator.storage && navigator.storage.persist && navigator.storage.persist(); } catch(e){}

  const clone = o => o === undefined ? undefined : JSON.parse(JSON.stringify(o));
  const err = (code, message) => ({code, message});
  const parent = p => p.split('/').slice(0, -1).join('/');
  function merge(a, b){
    for(const k in b){
      const v = b[k];
      if(v && typeof v === 'object' && !Array.isArray(v) && a[k] && typeof a[k] === 'object' && !Array.isArray(a[k])) merge(a[k], v);
      else a[k] = clone(v);
    }
    return a;
  }

  /* ---------- abonnements (mise à jour de l'écran) ---------- */
  const subs = new Set();
  let notifyQ = false;
  function notify(){ if(notifyQ) return; notifyQ = true; Promise.resolve().then(() => { notifyQ = false; subs.forEach(s => s()); }); }
  const META = {fromCache:false, hasPendingWrites:false};
  function dsnap(path){ const d = DATA[path]; return {id: path.split('/').pop(), exists: d !== undefined, data: () => clone(d), metadata: META}; }
  function qsnap(col, filters){
    const docs = Object.keys(DATA).filter(p => parent(p) === col).sort().map(dsnap)
      .filter(s => filters.every(([f, op, v]) => { const x = s.data()[f];
        return op === '==' ? x === v : op === '!=' ? x !== v : op === '<' ? x < v : op === '<=' ? x <= v : op === '>' ? x > v : op === '>=' ? x >= v : op === 'in' ? v.includes(x) : true; }));
    return {docs, size: docs.length, empty: !docs.length, metadata: META, docChanges: () => []};
  }
  function watch(make, next){
    let last = null;
    const run = () => { const s = make(), sig = JSON.stringify(s.docs ? s.docs.map(d => [d.id, d.data()]) : [s.exists, s.data()]); if(sig !== last){ last = sig; next(s); } };
    subs.add(run); Promise.resolve().then(run);
    return () => subs.delete(run);
  }

  function docW(path){
    return {
      id: path.split('/').pop(), path,
      get: async () => dsnap(path),
      set: async d => { DATA[path] = clone(d); persist(); notify(); },
      update: async d => { if(DATA[path] === undefined) throw err('invalid_argument', 'document absent'); merge(DATA[path], d); persist(); notify(); },
      delete: async () => { delete DATA[path]; persist(); notify(); },
      onSnapshot: next => watch(() => dsnap(path), next),
      collection: c => colW(path + '/' + c)
    };
  }
  function qW(col, filters){
    return {
      where: (f, op, v) => qW(col, filters.concat([[f, op, v]])),
      orderBy: () => qW(col, filters), limit: () => qW(col, filters),
      get: async () => qsnap(col, filters),
      onSnapshot: next => watch(() => qsnap(col, filters), next)
    };
  }
  const newId = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
  function colW(col){ const w = qW(col, []); w.path = col; w.doc = id => docW(col + '/' + (id || newId())); w.add = async d => { const r = w.doc(); await r.set(d); return r; }; return w; }
  const DB = { doc: docW, collection: colW };

  /* ---------- fichiers : partage Android (Gmail, Drive…) ou téléchargement ---------- */
  function saveFile(file){
    const a = document.createElement('a'); a.href = URL.createObjectURL(file); a.download = file.name;
    document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 2000);
  }
  async function shareOrSave(file, title, text){
    if(navigator.canShare && navigator.canShare({files:[file]})){
      try { await navigator.share({files:[file], title, text}); return 'shared'; }
      catch(e){ if(e && e.name === 'AbortError') throw {code:'declined'}; }
    }
    const a = document.createElement('a'); a.href = URL.createObjectURL(file); a.download = file.name;
    document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 2000);
    return 'saved';
  }
  const b64ToBlob = (b64, type) => { const bin = atob(b64), u = new Uint8Array(bin.length); for(let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); return new Blob([u], {type}); };

  const caps = {
    db: () => Promise.resolve(DB),
    user: () => Promise.resolve({ can: () => true, canEdit: () => true, isOwner: () => true, id: async () => 'local', me: async () => ({name:''}) }),
    downloads: () => Promise.resolve({ save: async ({filename, data}) => { saveFile(new File([data], filename, {type: data.type || 'application/octet-stream'})); return 'saved'; } }),
    mcp: () => Promise.resolve({
      callTool: async (server, tool, a) => {
        if(tool !== 'send_message') throw {code:'tool_error', message:'indisponible'};
        const at = (a.attachments || [])[0], to = (a.to || []).join(',');
        /* Android ne laisse pas partager un fichier Excel : on joint un PDF par jour */
        let files = [];
        try {
          const wb = XLSX.read(at.content, {type:'base64'});
          /* un PDF par jour : tout le texte s'affiche, les cellules longues passent à la ligne */
          files = wb.SheetNames.map(n => {
            const t = XLSX.utils.sheet_to_json(wb.Sheets[n], {header:1, defval:'', blankrows:true});
            const pdf = window.makeTablePdf({title: String((t[0]||[])[0]||n), subtitle: String((t[1]||[])[0]||''),
              head: (t[2]||[]).map(String), rows: t.slice(3).filter(r => r.some(c => String(c).trim())).map(r => r.map(String)),
              widths: [8,24,10,44,12]});
            return new File([pdf], n.replace(/[^\w\-é ]+/g, '').trim().replace(/\s+/g, '_') + '.pdf', {type:'application/pdf'});
          });
        } catch(_){}
        if(files.length && navigator.canShare && navigator.canShare({files})){
          try { await navigator.share({files, title: a.subject, text: a.body}); return {payload:{how:'shared'}}; }
          catch(e){ if(e && e.name === 'AbortError') throw {code:'declined'}; }
        }
        /* sinon : le mail s'ouvre avec destinataire, objet et résumé ; le fichier Excel est téléchargé pour le joindre */
        saveFile(new File([b64ToBlob(at.content, at.mimeType)], at.filename, {type: at.mimeType}));
        setTimeout(() => { location.href = 'mailto:' + (to ? encodeURIComponent(to) : '') + '?subject=' + encodeURIComponent(a.subject) +
          '&body=' + encodeURIComponent(a.body + '\n\n(Fichier Excel joint : ' + at.filename + ', dans Téléchargements.)'); }, 400);
        return {payload:{how:'mailto'}};
      }
    })
  };
  window.claude = { use: name => (caps[name] ? caps[name]() : Promise.resolve(null)) };

  /* ---------- sauvegarde / restauration (onglet Patients) ---------- */
  const LAST = 'tournee.lastbackup';
  const daysSince = () => { const t = +localStorage.getItem(LAST) || 0; return t ? Math.floor((Date.now() - t) / 864e5) : null; };
  window.pwaTools = () => {
    const n = daysSince(), late = n === null || n >= 7;
    return `<section class="card pwatools"><h2>Sauvegarde</h2>
    <span style="font-size:.8rem;color:var(--muted)">Version de l'appli : ${window.__BUILD||'?'}</span>
    <span style="font-size:.9rem;${late ? 'color:var(--warn);font-weight:700' : 'color:var(--muted)'}">${n === null ? 'Aucune sauvegarde faite pour l\'instant.' : n === 0 ? 'Dernière sauvegarde : aujourd\'hui.' : 'Dernière sauvegarde : il y a ' + n + ' jour' + (n > 1 ? 's' : '') + '.'}
    Les données ne sont que dans ce téléphone : pensez à exporter une sauvegarde chaque semaine (Drive, Gmail…).</span>
    <div class="formbtns" style="justify-content:flex-start">
      <button class="btn ${late ? '' : 'ghost'}" data-act="pwa-export">Exporter une sauvegarde</button>
      <label class="btn ghost" style="cursor:pointer">Importer une sauvegarde<input type="file" id="pwa_import" hidden></label>
    </div></section>`;
  };
  const toastMsg = m => { const t = document.getElementById('toast'); if(!t) return; t.textContent = m; t.hidden = false; clearTimeout(toastMsg.t); toastMsg.t = setTimeout(() => t.hidden = true, 3500); };
  document.addEventListener('click', async e => {
    const el = e.target.closest && e.target.closest('[data-act="pwa-export"]'); if(!el) return;
    const out = {app:'tournee', exported: new Date().toISOString(), data:{}};
    Object.keys(DATA).forEach(p => { const [c, id] = p.split('/'); if(id && p.split('/').length === 2){ (out.data[c] = out.data[c] || {})[id] = DATA[p]; } });
    const name = 'tournee-sauvegarde-' + new Date().toISOString().slice(0, 10) + '.json';
    try { await shareOrSave(new File([JSON.stringify(out, null, 1)], name, {type:'application/json'}), name, 'Sauvegarde de la tournée');
      localStorage.setItem(LAST, String(Date.now())); toastMsg('Sauvegarde prête.'); notify(); } catch(_){}
  });
  function importText(txt){
    try{
      const j = JSON.parse(txt), data = j.data || j;
      if(!data || typeof data !== 'object' || !(data.patients || data.soins)) throw 0;
      let n = 0;
      for(const c of Object.keys(data)){ for(const [id, d] of Object.entries(data[c] || {})){ DATA[c + '/' + id] = clone(d); n++; } }
      persist(); notify();
      toastMsg(n + ' éléments importés.');
    } catch(err2){ toastMsg('Import impossible : fichier non reconnu.'); }
  }
  document.addEventListener('change', async e => {
    if(e.target.id !== 'pwa_import' || !e.target.files[0]) return;
    importText(await e.target.files[0].text());
    e.target.value = '';
  });
  /* fichier reçu par « Partager → Tournée » (WhatsApp, Gmail…) */
  if(/[?&]partage=1/.test(location.search)){
    history.replaceState(null, '', location.pathname);
    window.addEventListener('load', async () => {
      try{
        const c = await caches.open('partage'), r = await c.match('fichier');
        if(r){ const txt = await r.text(); await c.delete('fichier'); setTimeout(() => importText(txt), 400); }
        else toastMsg('Aucun fichier reçu.');
      } catch(_){ toastMsg('Import impossible.'); }
    });
  }

  /* ---------- fonctionnement hors ligne ---------- */
  /* mises à jour : vérifiées à chaque retour dans l'appli, appliquées toutes seules */
  if('serviceWorker' in navigator){
    const hadCtrl = !!navigator.serviceWorker.controller; let reloading = false, pendingReload = false;
    const busy = () => { const a = document.activeElement; return (a && /INPUT|TEXTAREA|SELECT/.test(a.tagName)) || !!(document.getElementById('modal')||{}).innerHTML; };
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if(!hadCtrl || reloading) return;
      if(busy()){ pendingReload = true; toastMsg('Nouvelle version prête : elle s\'applique à la prochaine ouverture.'); return; }
      reloading = true; location.reload();
    });
    window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').then(reg => {
      document.addEventListener('visibilitychange', () => {
        if(document.visibilityState !== 'visible') return;
        if(pendingReload){ reloading = true; location.reload(); return; }
        reg.update().catch(() => {});
      });
    }).catch(() => {}));
  }
})();
