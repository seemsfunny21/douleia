/* Work Routes: isolated, offline-first app-shell cache. Never delete
   caches from voltes, reminder, Pegasus or the applications launcher:
   GitHub Pages apps share the same origin and Cache Storage. */
const PREFIX = "dromologia-github-neon-";
const CACHE = PREFIX + "v20-stress-fixes";
const SHELL = ["./", "./index.html", "./manifest.webmanifest", "./push.js", "./icon.svg","./hero-banner.webp"];

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
    const cache=await caches.open(CACHE);
    try{
      const fresh=await fetch(request,{cache:"no-store"});
      if(fresh.ok){
        try{await cache.put(request,fresh.clone());}catch(_){}
        return fresh;
      }
      throw new Error("HTTP "+fresh.status);
    }catch(_){
      return await cache.match(request,{ignoreSearch:true}) ||
        await cache.match("./index.html") || Response.error();
    }
  })());
});

/* Cache the optional push client for offline launches without changing API caching. */
self.addEventListener("fetch", event => {
 const req=event.request, url=new URL(req.url);
 if(req.method!=="GET" || url.origin!==self.location.origin ||
    url.pathname!==new URL("./push.js",self.registration.scope).pathname)return;
 event.respondWith(fetch(req,{cache:"no-store"}).then(async response=>{
  if(response.ok){try{const cache=await caches.open(CACHE);await cache.put(req,response.clone());}catch(_){}}
  return response;
 }).catch(()=>caches.match(req).then(hit=>hit||Response.error())));
});

self.addEventListener("push",event=>{
 let data={};
 try{data=event.data?.json()||{};}catch{data={body:event.data?.text()||""};}
 event.waitUntil(self.registration.showNotification(
  typeof data.title==="string"?data.title:"Δρομολόγια",
  {body:typeof data.body==="string"?data.body:"Ενημέρωση αναχώρησης ή άφιξης δρομολογίου.",
   icon:new URL("./icon.svg",self.registration.scope).href,
   badge:new URL("./icon.svg",self.registration.scope).href,
   tag:typeof data.tag==="string"?data.tag:"douleia-alert",
   requireInteraction:true,
   timestamp:Date.now(),
   data:{url:new URL("./",self.registration.scope).href}}
 ));
});
self.addEventListener("notificationclick",event=>{
 event.notification.close();
 event.waitUntil((async()=>{
  const target=new URL("./",self.registration.scope).href;
  const clients=await self.clients.matchAll({type:"window",includeUncontrolled:true});
  for(const client of clients){if(client.url.startsWith(target)&&"focus" in client)return client.focus();}
  if(self.clients.openWindow)return self.clients.openWindow(target);
 })());
});
