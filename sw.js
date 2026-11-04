const C = 's24-v5';
const ARQ = ['./', 'index.html', 'style.css', 'app.js', 'S-24_T.pdf', 'vendor/pdf-lib.min.js', 'vendor/qrcode.js', 'vendor/jsQR.js', 'manifest.webmanifest', 'icon.svg', 'icon-180.png', 'icon-192.png', 'icon-512.png'];
self.addEventListener('install', e => e.waitUntil(caches.open(C).then(c => c.addAll(ARQ)).then(() => self.skipWaiting())));
self.addEventListener('activate', e => e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== C && k !== 's24-compartilhado').map(k => caches.delete(k)))).then(() => self.clients.claim())));
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  // Android: PDF compartilhado para o app (share target) -> guarda e abre a verificação
  if (e.request.method === 'POST' && url.pathname.endsWith('/verificar')) {
    e.respondWith((async () => {
      const f = (await e.request.formData()).get('pdf');
      if (f) await (await caches.open('s24-compartilhado')).put('compartilhado.pdf', new Response(f, { headers: { 'Content-Type': 'application/pdf' } }));
      return Response.redirect('./?verificar=1', 303);
    })());
    return;
  }
  if (e.request.method !== 'GET') return;
  e.respondWith(caches.match(e.request, { ignoreSearch: true }).then(r => r || fetch(e.request)));
});
