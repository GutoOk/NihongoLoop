const SW_VERSION = new URL(self.location.href).searchParams.get('v') || 'dev';
const STATIC_CACHE = `nihongo-loop-static-${SW_VERSION}`;
const RUNTIME_CACHE = `nihongo-loop-runtime-${SW_VERSION}`;
const RUNTIME_CACHE_LIMIT = 80;

const APP_SHELL = [
  '/manifest.json',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
];

async function trimCache(cacheName, maxEntries) {
  const cache = await caches.open(cacheName);
  const keys = await cache.keys();
  if (keys.length <= maxEntries) return;
  await cache.delete(keys[0]);
  await trimCache(cacheName, maxEntries);
}

function shouldHandle(request) {
  if (request.method !== 'GET') return false;
  if (!request.url.startsWith(self.location.origin)) return false;
  const url = new URL(request.url);
  if (url.pathname.startsWith('/api/')) return false;
  if (url.pathname.startsWith('/auth/')) return false;
  return true;
}

function isNavigation(request) {
  return request.mode === 'navigate' || request.headers.get('accept')?.includes('text/html');
}

function isVersionedAsset(url) {
  return url.pathname.startsWith('/assets/') || url.pathname.startsWith('/icons/');
}

async function networkFirstNavigation(request) {
  try {
    return await fetch(request, { cache: 'reload' });
  } catch {
    return new Response('Nihongo Loop esta offline. Verifique sua conexao e tente novamente.', {
      status: 503,
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
    });
  }
}

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(STATIC_CACHE)
      .then((cache) => Promise.allSettled(APP_SHELL.map((url) => cache.add(url))))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  const expectedCaches = new Set([STATIC_CACHE, RUNTIME_CACHE]);
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.map((key) => (
        expectedCaches.has(key) ? undefined : caches.delete(key)
      ))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  if (!shouldHandle(event.request)) return;

  const url = new URL(event.request.url);

  if (isNavigation(event.request)) {
    event.respondWith(networkFirstNavigation(event.request));
    return;
  }

  if (isVersionedAsset(url)) {
    event.respondWith(
      caches.match(event.request).then((cachedResponse) => {
        if (cachedResponse) return cachedResponse;
        return fetch(event.request).then((networkResponse) => {
          if (networkResponse && networkResponse.status === 200) {
            const responseToCache = networkResponse.clone();
            caches.open(RUNTIME_CACHE).then((cache) => {
              cache.put(event.request, responseToCache).then(() => trimCache(RUNTIME_CACHE, RUNTIME_CACHE_LIMIT));
            });
          }
          return networkResponse;
        });
      }),
    );
    return;
  }

  event.respondWith(
    fetch(event.request)
      .then((networkResponse) => {
        if (networkResponse && networkResponse.status === 200 && !isNavigation(event.request)) {
          const responseToCache = networkResponse.clone();
          caches.open(RUNTIME_CACHE).then((cache) => {
            cache.put(event.request, responseToCache).then(() => trimCache(RUNTIME_CACHE, RUNTIME_CACHE_LIMIT));
          });
        }
        return networkResponse;
      })
      .catch(() => caches.match(event.request).then((cachedResponse) => {
        if (cachedResponse) return cachedResponse;

        return new Response('Offline: recurso nao disponivel sem conexao.', {
          status: 503,
          headers: { 'Content-Type': 'text/plain; charset=utf-8' },
        });
      })),
  );
});
