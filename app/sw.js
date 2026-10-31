// Offline support. Network first, so a deploy is picked up on the next load and
// modules from two versions never mix; the cache is the fallback when offline.
const CACHE = 'lilt-v1';

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const files = await (await fetch('src/offline.json', { cache: 'no-cache' })).json();
    const cache = await caches.open(CACHE);
    await cache.addAll(files.map((f) => new Request(f, { cache: 'no-cache' })));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const stale = (await caches.keys()).filter((k) => k !== CACHE);
    await Promise.all(stale.map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});

async function networkFirst(request) {
  const cache = await caches.open(CACHE);
  try {
    const response = await fetch(request);
    if (response.ok) await cache.put(request, response.clone());
    return response;
  } catch (err) {
    const cached = await cache.match(request, { ignoreSearch: true })
      ?? (request.mode === 'navigate' ? await cache.match('./') : undefined);
    if (cached) return cached;
    throw err;
  }
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET' || new URL(request.url).origin !== self.location.origin) return;
  event.respondWith(networkFirst(request));
});
