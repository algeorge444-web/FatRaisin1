/* FatRaisin offline support.
   The app's own files are kept on the device so it opens without a connection.
   The app page is always fetched fresh when online (so updates show straight away),
   with the saved copy used only when offline. Maps, Google, Firebase and other
   outside services are never cached here. */
const CACHE = 'fatraisin-v4';
const FILES = ['./', './index.html', './manifest.json', './icon-192.png', './icon-512.png', './icon-maskable-512.png',
  './privacy.html', './terms.html', './support.html',
  './img/logo.png', './img/logo-dark.png', './img/vineyard.jpg', './img/distillery.jpg', './img/peller.jpg',
  './img/home-winery.jpg', './img/home-brewery.jpg', './img/home-distillery.jpg', './img/home-cidery.jpg',
  './img/apple-touch-icon.png', './img/favicon.png',
  './img/tour-places.jpg', './img/tour-trails.jpg', './img/tour-events.jpg', './img/tour-passport.jpg', './img/tour-cellar.jpg'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => Promise.all(FILES.map(f => c.add(f).catch(() => null)))).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;           /* outside services: straight to the network */
  if (/\/(pins\.json|data-version\.js)$/.test(url.pathname)) return;   /* shared data and the data version: always fresh */
  /* place and event data files (loaded with ?v=<data version>): network first, one saved copy each for offline use,
     so a new data version always reaches the phone and old versions don't pile up */
  if (/\.js$/.test(url.pathname) && url.search) {
    const key = url.origin + url.pathname;
    e.respondWith(fetch(req).then(res => {
      if (res.ok) { const copy = res.clone(); caches.open(CACHE).then(c => c.put(key, copy)).catch(() => {}); }
      return res;
    }).catch(() => caches.match(key)));
    return;
  }
  const isPage = req.mode === 'navigate' || /\/(index\.html)?$/.test(url.pathname);
  if (isPage) {
    /* the app page: network first, saved copy when offline */
    e.respondWith(fetch(req).then(res => {
      const copy = res.clone(); caches.open(CACHE).then(c => c.put('./index.html', copy)).catch(() => {});
      return res;
    }).catch(() => caches.match('./index.html').then(r => r || caches.match('./'))));
    return;
  }
  /* icons and policy pages: saved copy first, refreshed in the background */
  e.respondWith(caches.match(req).then(hit => {
    const net = fetch(req).then(res => { if (res.ok) { const copy = res.clone(); caches.open(CACHE).then(c => c.put(req, copy)); } return res; }).catch(() => hit);
    return hit || net;
  }));
});
