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
    downloads: () => Promise.resolve({ save: ({filename, data}) => shareOrSave(new File([data], filename, {type: data.type || 'application/octet-stream'}), filename) }),
    mcp: () => Promise.resolve({
      callTool: async (server, tool, a) => {
        if(tool !== 'send_message') throw {code:'tool_error', message:'indisponible'};
        const at = (a.attachments || [])[0];
        const file = new File([b64ToBlob(at.content, at.mimeType)], at.filename, {type: at.mimeType});
        const how = await shareOrSave(file, a.subject, 'À envoyer à : ' + (a.to || []).join(', ') + '\n\n' + a.body);
        return {payload: {how}};
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
  document.addEventListener('change', async e => {
    if(e.target.id !== 'pwa_import' || !e.target.files[0]) return;
    try{
      const j = JSON.parse(await e.target.files[0].text()), data = j.data || j;
      let n = 0;
      for(const c of Object.keys(data)){ for(const [id, d] of Object.entries(data[c] || {})){ DATA[c + '/' + id] = clone(d); n++; } }
      persist(); notify();
      toastMsg(n + ' éléments importés.');
    } catch(err2){ toastMsg('Import impossible : fichier non reconnu.'); }
    e.target.value = '';
  });

  /* ---------- fonctionnement hors ligne ---------- */
  if('serviceWorker' in navigator) window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
})();
