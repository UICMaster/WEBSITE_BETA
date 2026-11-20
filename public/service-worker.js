(() => {
  const CACHE_NAME = 'UIC-System-v50';
  const BASE = new URL('./', self.location.href).pathname;
  const withBase = (rel) => `${BASE}${rel.replace(/^\/+/, '')}`;

  const PRECACHE_URLS = [
    BASE,
    withBase('manifest.json'),
    withBase('favicon.svg'),
    withBase('favicon.ico'),
    withBase('android-chrome-192x192.png'),
    withBase('assets/logo/logo.svg')
  ];

  // 1. INSTALL: Pre-cache core app shell relative to current scope
  self.addEventListener('install', (event) => {
    event.waitUntil(
      caches.open(CACHE_NAME).then((cache) => cache.addAll(PRECACHE_URLS))
    );
    self.skipWaiting();
  });

  // 2. ACTIVATE: Purge legacy caches immediately and take control
  self.addEventListener('activate', (event) => {
    event.waitUntil(
      caches
        .keys()
        .then((keys) =>
          Promise.all(
            keys.map((key) => (key !== CACHE_NAME ? caches.delete(key) : undefined))
          )
        )
        .then(() => self.clients.claim())
    );
  });

  // 3. FETCH: Scope-aware Network-First (HTML/JSON), Cache-First (_astro), Stale-While-Revalidate (images)
  self.addEventListener('fetch', (event) => {
    if (event.request.method !== 'GET') return;
    if (event.request.headers.has('range')) return;

    const reqUrl = new URL(event.request.url);
    if (reqUrl.origin !== self.location.origin) return;
    if (!reqUrl.pathname.startsWith(BASE)) return;

    const relPath = reqUrl.pathname.slice(BASE.length);

    // Do not cache heavy media/downloads (audio, video, zip archives)
    if (/^assets\/(audio|video|downloads)\//i.test(relPath)) return;

    const isNavigation =
      event.request.mode === 'navigate' ||
      (event.request.headers.get('accept') || '').includes('text/html');
    const isDataJson = relPath.startsWith('data/') || relPath.endsWith('.json');

    // Network-First for HTML pages and live JSON telemetry
    if (isNavigation || isDataJson) {
      event.respondWith(
        fetch(event.request)
          .then((networkResponse) => {
            if (networkResponse && networkResponse.ok && networkResponse.status === 200) {
              const clone = networkResponse.clone();
              caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
            }
            return networkResponse;
          })
          .catch(async () => {
            const cached = await caches.match(event.request);
            if (cached) return cached;
            if (isNavigation) {
              const shell = await caches.match(BASE);
              if (shell) return shell;
            }
            return Response.error();
          })
      );
      return;
    }

    // Cache-First for immutable hashed Astro bundles
    if (relPath.startsWith('_astro/')) {
      event.respondWith(
        caches.match(event.request).then((cachedResponse) => {
          if (cachedResponse) return cachedResponse;
          return fetch(event.request).then((networkResponse) => {
            if (networkResponse && networkResponse.ok && networkResponse.status === 200) {
              const clone = networkResponse.clone();
              caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
            }
            return networkResponse;
          });
        })
      );
      return;
    }

    // Stale-While-Revalidate for logos, team emblems, icons & portraits
    const isVisualAsset =
      /\.(svg|png|webp|jpg|jpeg|ico)$/i.test(relPath) ||
      relPath.startsWith('assets/');

    if (isVisualAsset) {
      event.respondWith(
        caches.match(event.request).then((cachedResponse) => {
          const networkPromise = fetch(event.request)
            .then((networkResponse) => {
              if (networkResponse && networkResponse.ok && networkResponse.status === 200) {
                const clone = networkResponse.clone();
                caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
              }
              return networkResponse;
            })
            .catch(() => cachedResponse);

          return cachedResponse || networkPromise;
        })
      );
    }
  });
})();
