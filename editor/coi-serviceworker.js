/*! coi-serviceworker v0.1.7 — enables cross-origin isolation on static hosts */
if (typeof window === 'undefined') {
  self.addEventListener('install', () => self.skipWaiting());
  self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));

  self.addEventListener('fetch', function (event) {
    if (
      event.request.cache === 'only-if-cached' &&
      event.request.mode !== 'same-origin'
    ) {
      return;
    }

    event.respondWith(
      fetch(event.request)
        .then((response) => {
          if (response.status === 0) {
            return response;
          }

          const newHeaders = new Headers(response.headers);
          newHeaders.set('Cross-Origin-Embedder-Policy', 'credentialless');
          newHeaders.set('Cross-Origin-Opener-Policy', 'same-origin');

          return new Response(response.body, {
            status: response.status,
            statusText: response.statusText,
            headers: newHeaders,
          });
        })
        .catch((e) => console.error('[COI]', e))
    );
  });
} else {
  (() => {
    const reloadedBySelf = window.sessionStorage.getItem('coiReloadedBySelf');
    window.addEventListener('beforeunload', () => {
      window.sessionStorage.setItem('coiReloadedBySelf', 'false');
    });

    if (window.crossOriginIsolated) {
      return;
    }

    if (!window.isSecureContext) {
      console.warn('[COI] COOP/COEP require a secure context (HTTPS or localhost).');
      return;
    }

    const scriptSrc = document.currentScript?.src;
    if (!scriptSrc) return;

    const coepCredentialless =
      window.coi?.coepCredentialless === true ||
      (typeof window.coi?.coepCredentialless === 'function' && window.coi.coepCredentialless());

    if (!reloadedBySelf) {
      window.sessionStorage.setItem('coiReloadedBySelf', 'true');
      if ('serviceWorker' in navigator) {
        navigator.serviceWorker.register(scriptSrc).then(
          (registration) => {
            if (!registration.active) {
              console.log('[COI] Service worker installing…');
              return;
            }
            if (!window.crossOriginIsolated) {
              window.location.reload();
            }
          },
          (err) => console.error('[COI] Service worker registration failed:', err)
        );
      }
    }
  })();
}
