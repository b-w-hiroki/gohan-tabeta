// Offline cache for the app shell. Bump VERSION when shipping changes to static files.
const VERSION = 'v10';
const CACHE = `gohan-tabeta-${VERSION}`;
const ASSETS = [
  './',
  './index.html',
  './app.html',
  './privacy.html',
  './css/style.css',
  './js/app.js',
  './js/db.js',
  './js/foods.js',
  './js/util.js',
  './js/dashboard.js',
  './js/cloud.js',
  './js/firebase-config.js',
  './manifest.webmanifest',
  './icons/icon.svg',
  './icons/icon-192.png',
  './icons/icon-512.png',
];
// Firebase SDK modules are versioned URLs, so they can be served cache-first.
const SDK_PREFIX = 'https://www.gstatic.com/firebasejs/';

self.addEventListener('install', (e) => {
  // Cache each file on its own so one failure does not block the whole install.
  e.waitUntil(caches.open(CACHE)
    .then((c) => Promise.allSettled(ASSETS.map((a) => c.add(a))))
    .then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  const url = e.request.url;
  if (url.startsWith(SDK_PREFIX)) {
    e.respondWith(caches.match(e.request).then((hit) => hit || fetch(e.request).then((res) => {
      const copy = res.clone();
      caches.open(CACHE).then((c) => c.put(e.request, copy));
      return res;
    })));
    return;
  }
  if (new URL(url).origin !== location.origin) return;
  // Network first so updates show up immediately; fall back to cache when offline.
  e.respondWith(
    fetch(e.request)
      .then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(e.request, copy));
        return res;
      })
      .catch(() => caches.match(e.request, { ignoreSearch: true })),
  );
});
