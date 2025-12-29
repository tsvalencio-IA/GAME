const CACHE_NAME = 'thiaguinho-v23-platinum';
const ASSETS = [
  './',
  './index.html',
  './game.html',
  './css/style.css',
  './js/game.js',
  './js/vision.js',
  './assets/mascote_perfil.jpg',
  './assets/estrada.jpg'
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS)));
});

self.addEventListener('fetch', (e) => {
  e.respondWith(
    caches.match(e.request).then((response) => response || fetch(e.request))
  );
});
