/* Service worker : l'appli s'ouvre même sans réseau. */
const VERSION = 'tournee-1794517607';
const SHELL = ['./', './index.html', './manifest.webmanifest',
  './icon-192.png', './icon-512.png', './icon-maskable-512.png', './apple-touch-icon.png', './runtime.js', './pdf.js'];
const CDN = ['cdnjs.cloudflare.com', 'fonts.googleapis.com', 'fonts.gstatic.com'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(k => k !== VERSION && k !== 'cdn' && k !== 'partage').map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const req = e.request;
  /* « Partager → Tournée » : on garde le fichier reçu puis on ouvre l'appli qui l'importe */
  if (req.method === 'POST' && new URL(req.url).pathname.endsWith('/partage')) {
    e.respondWith((async () => {
      try {
        const form = await req.formData(), f = form.get('fichier');
        const c = await caches.open('partage');
        if (f && f.size) await c.put('fichier', new Response(await f.text()));
        else if (form.get('text')) await c.put('fichier', new Response(form.get('text')));
      } catch (_) {}
      return Response.redirect('./?partage=1', 303);
    })());
    return;
  }
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin === location.origin) {
    // pages et fichiers de l'appli : réseau d'abord (pour les mises à jour), sinon la copie gardée
    // GitHub garde les pages 10 min en cache : on redemande toujours la dernière version
    e.respondWith(fetch(url.href, {cache: 'no-cache', credentials: 'same-origin'}).then(res => {
      if (res.ok) { const copy = res.clone(); caches.open(VERSION).then(c => c.put(req, copy)); }
      return res;
    }).catch(() => caches.match(req, {ignoreSearch: true}).then(r => r || (req.mode === 'navigate' ? caches.match('./index.html') : undefined))));
    return;
  }
  if (CDN.includes(url.hostname)) {
    // bibliothèques et polices : la copie gardée tout de suite, rafraîchie en arrière-plan
    e.respondWith(caches.open('cdn').then(c => c.match(req).then(hit => {
      const net = fetch(req).then(res => { if (res.ok || res.type === 'opaque') c.put(req, res.clone()); return res; }).catch(() => hit);
      return hit || net;
    })));
  }
});
