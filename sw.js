const CACHE_NAME = 'thiaguinho-console-v4'; // FORÇANDO ATUALIZAÇÃO MÁXIMA
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
            console.log('[Service Worker] Instalando nova versão V4...');
            return cache.addAll(ASSETS_TO_CACHE);
        })
    );
    self.skipWaiting(); // Obriga a instalar imediatamente
});

self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys().then((cacheNames) => {
            return Promise.all(
                cacheNames.map((cache) => {
                    if (cache !== CACHE_NAME) {
                        console.log('[Service Worker] Destruindo cache antigo:', cache);
                        return caches.delete(cache); // Limpa as memórias antigas que estavam bloqueando o login
                    }
                })
            );
        })
    );
    self.clients.claim(); // Assume controle imediato
});

self.addEventListener('fetch', (event) => {
    event.respondWith(
        fetch(event.request) // Tenta a rede primeiro para garantir código fresco
            .then(response => {
                const responseClone = response.clone();
                caches.open(CACHE_NAME).then(cache => cache.put(event.request, responseClone));
                return response;
            })
            .catch(() => {
                // Se falhar a rede (offline), usa o cache
                return caches.match(event.request).then(cachedResponse => {
                    return cachedResponse || caches.match('./index.html');
                });
            })
    );
});
