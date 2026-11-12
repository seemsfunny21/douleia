const CACHE="dromologia-github-v1";
self.addEventListener("install",event=>{
  event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(["./","./index.html","./manifest.webmanifest","./icon.svg"])).then(()=>self.skipWaiting()));
});
self.addEventListener("activate",event=>{
  event.waitUntil(Promise.all([self.clients.claim(),caches.keys().then(keys=>Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k))))]));
});
self.addEventListener("fetch",event=>{
  if(event.request.mode!=="navigate")return;
  event.respondWith(fetch(event.request).catch(()=>caches.match("./index.html")));
});
