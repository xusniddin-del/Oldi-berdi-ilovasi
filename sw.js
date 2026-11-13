// Oldi-Berdi service worker: opens instantly from the saved copy and refreshes it in the background.
const CACHE = 'oldiberdi-v13';
const SHELL = ['./', './index.html', './config.js', './manifest.webmanifest', './icon-192.png', './icon-512.png', './apple-touch-icon.png'];
self.addEventListener('install', e => { e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL.map(u => new Request(u, { cache: 'reload' })))).then(() => self.skipWaiting())); });
self.addEventListener('activate', e => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener('fetch', e => {
  const req = e.request, u = new URL(req.url);
  if (req.method !== 'GET' || u.origin !== location.origin || u.pathname.endsWith('version.json') || u.pathname.endsWith('.apk')) return;
  e.respondWith(caches.open(CACHE).then(c => c.match(req, { ignoreSearch: true }).then(hit => {
    const net = fetch(req).then(r => { if (r.ok) c.put(req, r.clone()); return r; }).catch(() => hit || c.match('./index.html'));
    if (hit) { e.waitUntil(net.catch(() => {})); return hit; }
    return net;
  })));
});
// "Yangilash" button: fetch the newest files first, then the page reloads
self.addEventListener('message', e => {
  if (e.data !== 'refresh') return;
  e.waitUntil(caches.open(CACHE).then(c => Promise.all(SHELL.map(u => fetch(u, { cache: 'reload' }).then(r => r.ok && c.put(u, r)).catch(() => {}))))
    .finally(() => { if (e.ports[0]) e.ports[0].postMessage('ok'); }));
});
