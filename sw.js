/* =================================================================
   SERVICE WORKER - PWA INSTALLER
   Este script transforma o jogo num App instalável e gere o cache
   das tuas páginas e scripts (ignorando o Firebase para não quebrar o multiplayer).
   ================================================================= */

const CACHE_NAME = 'thiaguinho-wii-v1';

// Lista de ficheiros do teu projeto que devem ser guardados offline
// NOTA: Colocamos aqui os scripts que indicaste ter.
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
    './js/game_tennis.js',
    './js/game_ar.js'
];

// 1. Evento de Instalação: Guarda os ficheiros estáticos no cache
self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(CACHE_NAME).then((cache) => {
            console.log('[Service Worker] A fazer cache dos ficheiros da App');
            return cache.addAll(ASSETS_TO_CACHE);
        })
    );
    self.skipWaiting(); // Força a ativação imediata
});

// 2. Evento de Ativação: Limpa caches antigos se mudares a versão (CACHE_NAME)
self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys().then((keyList) => {
            return Promise.all(keyList.map((key) => {
                if (key !== CACHE_NAME) {
                    console.log('[Service Worker] A remover cache antigo:', key);
                    return caches.delete(key);
                }
            }));
        })
    );
    self.clients.claim();
});

// 3. Evento Fetch: Interceta pedidos da rede
self.addEventListener('fetch', (event) => {
    // Ignora pedidos que não sejam GET e ignora domínios externos 
    // (Isto é VITAL para não bloquear as chamadas do Firebase, TensorFlow e Auth)
    if (event.request.method !== 'GET' || !event.request.url.startsWith(self.location.origin)) {
        return;
    }

    event.respondWith(
        caches.match(event.request).then((cachedResponse) => {
            // Estratégia Stale-While-Revalidate: Devolve o cache imediatamente (rápido),
            // mas vai à internet buscar a versão mais recente para atualizar o cache em background.
            const fetchPromise = fetch(event.request).then((networkResponse) => {
                caches.open(CACHE_NAME).then((cache) => {
                    cache.put(event.request, networkResponse.clone());
                });
                return networkResponse;
            }).catch(() => {
                // Se estiver offline e a rede falhar, não faz nada (já devolvemos o cache)
                console.log('[Service Worker] Offline, a usar versão em cache.');
            });

            return cachedResponse || fetchPromise;
        })
    );
});
