/*! EditorPilot service worker — COOP/COEP + offline PWA cache */
let coepCredentialless = true;

const CACHE_VERSION = 'editorpilot-pwa-v10';

const PRECACHE_URLS = [
  './',
  './index.html',
  './style.css',
  './app.js',
  './ai.js',
  './db.js',
  './db-worker.js',
  './advanced.js',
  './processing-log.js',
  './scores.js',
  './logo.png',
  './manifest.webmanifest',
  './version.json',
  './coi-config.js',
  './vendor/sqlite-wasm/index.mjs',
  './vendor/sqlite-wasm/sqlite3.wasm',
  './vendor/sqlite-wasm/sqlite3-opfs-async-proxy.js',
];

if (typeof window === 'undefined') {
  self.addEventListener('install', (event) => {
    self.skipWaiting();
    event.waitUntil(precache());
  });

  self.addEventListener('activate', (event) => {
    event.waitUntil(
      (async () => {
        const keys = await caches.keys();
        await Promise.all(keys.filter((k) => k !== CACHE_VERSION).map((k) => caches.delete(k)));
        await self.clients.claim();
      })()
    );
  });

  self.addEventListener('message', (ev) => {
    if (ev.data?.type === 'coepCredentialless') {
      coepCredentialless = !!ev.data.value;
    }
    if (ev.data?.type === 'SKIP_WAITING') {
      self.skipWaiting();
    }
  });

  function wrapResponse(response) {
    if (response.status === 0) {
      return response;
    }

    const newHeaders = new Headers(response.headers);
    newHeaders.set(
      'Cross-Origin-Embedder-Policy',
      coepCredentialless ? 'credentialless' : 'require-corp'
    );
    if (!coepCredentialless) {
      newHeaders.set('Cross-Origin-Resource-Policy', 'cross-origin');
    }
    newHeaders.set('Cross-Origin-Opener-Policy', 'same-origin');

    if (response.status === 101 || response.status === 204 || response.status === 304) {
      return new Response(null, {
        status: response.status,
        statusText: response.statusText,
        headers: newHeaders,
      });
    }

    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers: newHeaders,
    });
  }

  function wrapCached(response) {
    const newHeaders = new Headers(response.headers);
    newHeaders.set(
      'Cross-Origin-Embedder-Policy',
      coepCredentialless ? 'credentialless' : 'require-corp'
    );
    if (!coepCredentialless) {
      newHeaders.set('Cross-Origin-Resource-Policy', 'cross-origin');
    }
    newHeaders.set('Cross-Origin-Opener-Policy', 'same-origin');
    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers: newHeaders,
    });
  }

  async function precache() {
    const cache = await caches.open(CACHE_VERSION);
    await Promise.all(
      PRECACHE_URLS.map(async (url) => {
        try {
          const response = await fetch(url, { cache: 'no-cache' });
          if (response.ok) {
            await cache.put(url, wrapResponse(response.clone()));
          }
        } catch (err) {
          console.warn('[SW] precache skipped:', url, err);
        }
      })
    );
  }

  self.addEventListener('fetch', (event) => {
    const request = event.request;
    if (request.cache === 'only-if-cached' && request.mode !== 'same-origin') {
      return;
    }

    const fetchRequest =
      coepCredentialless && request.mode === 'no-cors'
        ? new Request(request, { credentials: 'omit' })
        : request;

    const url = new URL(request.url);
    const isSameOrigin = url.origin === self.location.origin;
    const isGet = request.method === 'GET';

    if (!isGet || !isSameOrigin) {
      event.respondWith(
        fetch(fetchRequest)
          .then(wrapResponse)
          .catch((e) => {
            console.error('[COI]', e);
            return fetch(fetchRequest);
          })
      );
      return;
    }

    event.respondWith(
      (async () => {
        if (url.pathname.endsWith('version.json')) {
          try {
            const networkResponse = await fetch(new Request(fetchRequest, { cache: 'no-store' }));
            if (networkResponse.ok) {
              return wrapResponse(networkResponse);
            }
          } catch {
            /* fall through */
          }
        }

        const cache = await caches.open(CACHE_VERSION);

        try {
          const networkResponse = await fetch(fetchRequest);
          if (networkResponse.ok) {
            const wrapped = wrapResponse(networkResponse.clone());
            await cache.put(request, wrapped.clone());
            return wrapResponse(networkResponse);
          }
        } catch {
          /* offline — fall through to cache */
        }

        const cached =
          (await cache.match(request)) ||
          (request.mode === 'navigate'
            ? (await cache.match('./index.html')) || (await cache.match('./'))
            : null);

        if (cached) {
          return wrapCached(cached);
        }

        return fetch(fetchRequest).then(wrapResponse);
      })()
    );
  });
} else {
  (() => {
    const coi = {
      shouldRegister: () => true,
      coepCredentialless: () => true,
      doReload: () => window.location.reload(),
      quiet: false,
      ...window.coi,
    };

    if (window.crossOriginIsolated) {
      return;
    }

    if (!window.isSecureContext) {
      console.warn('[COI] COOP/COEP require a secure context (HTTPS or localhost).');
      return;
    }

    if (!navigator.serviceWorker) {
      console.warn('[COI] Service workers unavailable in this browser context.');
      return;
    }

    const scriptSrc = document.currentScript?.src;
    if (!scriptSrc) return;

    const reloadedBySelf = sessionStorage.getItem('coiReloadedBySelf');
    sessionStorage.removeItem('coiReloadedBySelf');

    if (navigator.serviceWorker.controller) {
      navigator.serviceWorker.controller.postMessage({
        type: 'coepCredentialless',
        value: coi.coepCredentialless(),
      });
    }

    if (reloadedBySelf || !coi.shouldRegister()) {
      return;
    }

    navigator.serviceWorker.register(scriptSrc).then(
      (registration) => {
        registration.addEventListener('updatefound', () => {
          const installing = registration.installing;
          if (!installing) return;
          installing.addEventListener('statechange', () => {
            if (installing.state === 'activated' && !window.crossOriginIsolated) {
              sessionStorage.setItem('coiReloadedBySelf', '1');
              coi.doReload();
            }
          });
        });

        if (registration.active && !navigator.serviceWorker.controller) {
          sessionStorage.setItem('coiReloadedBySelf', '1');
          coi.doReload();
          return;
        }

        if (registration.installing) {
          registration.installing.addEventListener('statechange', () => {
            if (registration.active && !window.crossOriginIsolated) {
              sessionStorage.setItem('coiReloadedBySelf', '1');
              coi.doReload();
            }
          });
        }
      },
      (err) => console.error('[COI] Service worker registration failed:', err)
    );

    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (!window.crossOriginIsolated && !sessionStorage.getItem('coiReloadedBySelf')) {
        sessionStorage.setItem('coiReloadedBySelf', '1');
        coi.doReload();
      }
    });
  })();
}
