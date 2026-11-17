/* Work Routes: isolated, offline-first app-shell cache. Never delete
   caches from voltes, reminder, Pegasus or the applications launcher:
   GitHub Pages apps share the same origin and Cache Storage. */
const PREFIX = "dromologia-github-neon-";
const CACHE = PREFIX + "v13";
const SHELL = ["./", "./index.html", "./manifest.webmanifest", "./icon.svg","./hero-banner.webp"];

self.addEventListener("install", event => {
  event.waitUntil(
    caches.open(CACHE)
      .then(cache => cache.addAll(SHELL))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", event => {
  event.waitUntil(Promise.all([
    self.clients.claim(),
    caches.keys().then(keys => Promise.all(
      keys.filter(name => name.startsWith(PREFIX) && name !== CACHE)
        .map(name => caches.delete(name))
    ))
  ]));
});

/* Serve the app shell immediately after the first download. Revalidate
   in the background, so code updates are picked up on the next visit.
   Supabase/API requests are not cached here and always use the network. */
self.addEventListener("fetch", event => {
  const request = event.request;
  if (request.method !== "GET" || request.mode !== "navigate") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin ||
      !url.pathname.startsWith(new URL(self.registration.scope).pathname)) return;

  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const cached = await cache.match(request, { ignoreSearch: true }) ||
      await cache.match("./index.html");

    const update = fetch(request).then(async response => {
      if (response.ok) {
        try { await cache.put(request, response.clone()); }
        catch (_) { /* Cache quota / private-mode restrictions. */ }
      }
      return response;
    });

    if (cached) {
      event.waitUntil(update.catch(() => {}));
      return cached;
    }
    try { return await update; }
    catch { return Response.error(); }
  })());
});
