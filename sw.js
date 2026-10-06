const CACHE = "chrono-carnet-v59";

const APP = [
  "/",
  "/index.html",

  "/css/app.css?v=4.4.3",
  "/css/clarity.css?v=2",

  "/js/app.js?v=59",
  "/js/v44.js?v=2",
  "/js/ccf-input-guard.js?v=1",
  "/js/ccf-step.js?v=1",
  "/js/ccf-end-ui.js?v=1",
  "/js/qrcode.min.js?v=1",

  "/manifest.webmanifest"
];


/* =========================================================
   INSTALLATION
========================================================= */

self.addEventListener("install", event => {

  event.waitUntil(

    caches
      .open(CACHE)
      .then(cache =>
        cache.addAll(APP)
      )
      .then(() =>
        self.skipWaiting()
      )

  );

});


/* =========================================================
   ACTIVATION
   Supprime les anciens caches
========================================================= */

self.addEventListener("activate", event => {

  event.waitUntil(

    caches
      .keys()
      .then(keys =>
        Promise.all(

          keys
            .filter(key =>
              key.startsWith("chrono-carnet-") && key !== CACHE
            )
            .map(key =>
              caches.delete(key)
            )

        )
      )
      .then(() =>
        self.clients.claim()
      )

  );

});


/* =========================================================
   FETCH
   Réseau prioritaire
   Cache en secours
========================================================= */

self.addEventListener("fetch", event => {

  if (event.request.method !== "GET" ||
      new URL(event.request.url).origin !== self.location.origin) {
    return;
  }


  event.respondWith(

    fetch(event.request)

      .then(response => {

        if (!response.ok) throw new Error("Ressource indisponible");

        const copy =
          response.clone();


        event.waitUntil(caches
          .open(CACHE)
          .then(cache =>
            cache.put(
              event.request,
              copy
            )
          ).catch(() => {}));


        return response;

      })

      .catch(async () => {

        const cached =
          await caches.match(
            event.request
          );


        if (cached) {
          return cached;
        }


        if (
          event.request.mode ===
          "navigate"
        ) {

          return (await caches.match(
            "/index.html"
          )) || Response.error();

        }


        return Response.error();

      })

  );

});
