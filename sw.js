/* Giro Postino – service worker.
   Tiene in memoria i file dell'app (così funziona senza internet)
   e riceve il file del giro quando arriva da "Condividi". */
const VERSIONE = 'gp-v4';
const CONDIVISO = 'gp-condiviso';
const FILE = ['./', 'index.html', 'style.css', 'app.js', 'manifest.webmanifest', 'icon-192.png', 'icon-512.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(VERSIONE).then(c => c.addAll(FILE)));
});

self.addEventListener('activate', e => {
  e.waitUntil((async () => {
    const nomi = await caches.keys();
    await Promise.all(nomi.filter(n => n !== VERSIONE && n !== CONDIVISO).map(n => caches.delete(n)));
    await self.clients.claim();
  })());
});

self.addEventListener('message', e => {
  if (e.data === 'AGGIORNA') self.skipWaiting();
});

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (url.origin !== location.origin) return;

  // File arrivato da "Condividi → Giro Postino"
  if (e.request.method === 'POST' && url.pathname.endsWith('/share')) {
    e.respondWith((async () => {
      try {
        const dati = await e.request.formData();
        let f = dati.get('giro') || dati.get('testo');
        if (f) {
          const testo = typeof f === 'string' ? f : await f.text();
          const c = await caches.open(CONDIVISO);
          await c.put('./giro-condiviso', new Response(testo));
        }
      } catch (err) { /* l'app mostrerà che non è arrivato niente */ }
      return Response.redirect('./?condiviso=1', 303);
    })());
    return;
  }

  if (e.request.method !== 'GET') return;
  e.respondWith((async () => {
    const c = await caches.open(VERSIONE);
    const inMemoria = await c.match(e.request, {ignoreSearch: true});
    return inMemoria || fetch(e.request);
  })());
});
