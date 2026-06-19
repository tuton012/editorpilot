/*! coi-serviceworker v0.1.7 — enables cross-origin isolation on static hosts */
let coepCredentialless = true;

if (typeof window === 'undefined') {
  self.addEventListener('install', () => self.skipWaiting());
  self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

  self.addEventListener('message', (ev) => {
    if (ev.data?.type === 'coepCredentialless') {
      coepCredentialless = !!ev.data.value;
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

    // 204/304/101 must not include a body (Cloudflare often serves 304).
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

  self.addEventListener('fetch', (event) => {
    const request = event.request;
    if (request.cache === 'only-if-cached' && request.mode !== 'same-origin') {
      return;
    }

    const fetchRequest =
      coepCredentialless && request.mode === 'no-cors'
        ? new Request(request, { credentials: 'omit' })
        : request;

    event.respondWith(
      fetch(fetchRequest)
        .then(wrapResponse)
        .catch((e) => {
          console.error('[COI]', e);
          return fetch(fetchRequest);
        })
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
