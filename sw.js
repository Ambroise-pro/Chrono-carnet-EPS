const CACHE = "chrono-carnet-v57";

const APP = [
  "/",
  "/index.html",

  "/css/app.css?v=4.4.1",
  "/css/clarity.css?v=2",

  "/js/app.js?v=56",
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
              key !== CACHE
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

  if (
    event.request.method !== "GET"
  ) {
    return;
  }


  event.respondWith(

    fetch(event.request)

      .then(response => {

        const copy =
          response.clone();


        caches
          .open(CACHE)
          .then(cache =>
            cache.put(
              event.request,
              copy
            )
          );


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

          return caches.match(
            "/index.html"
          );

        }


        return Response.error();

      })

  );

});
