const CACHE_NAME = 'thiaguinho-console-v3'; // Mudou para v3 para forçar a atualização imediata!
const ASSETS_TO_CACHE = [
    './',
    './index.html',
    './manifest.json',
    './icon.svg',
    './js/core.js',
    './js/admin.js',
    './js/game_kart.js',
    './js/game_run.js',
    './js/game_box.js',
    './js/game_flight.js',
    './js/game_ar.js',
    './js/game_tennis.js'
];

self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(CACHE_NAME).then((cache) => {
            console.log('[Service Worker] Instalando nova versão V3...');
            return cache.addAll(ASSETS_TO_CACHE);
        })
    );
    self.skipWaiting();
});

self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys().then((cacheNames) => {
            return Promise.all(
                cacheNames.map((cache) => {
                    if (cache !== CACHE_NAME) {
                        console.log('[Service Worker] Apagando cache quebrado antigo:', cache);
                        return caches.delete(cache); // Destrói o cache antigo
                    }
                })
            );
        })
    );
    self.clients.claim();
});

self.addEventListener('fetch', (event) => {
    event.respondWith(
        caches.match(event.request).then((cachedResponse) => {
            return cachedResponse || fetch(event.request).catch(() => {
                return caches.match('./index.html');
            });
        })
    );
});
