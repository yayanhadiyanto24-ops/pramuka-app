const CACHE_NAME='ruang-tegak-shell-v15';
const APP_SHELL=['./','./index.html','./belajar.html','./login-confirm.html','./dokumen.html','./uji.html','./admin-kwarran.html','./manifest.webmanifest','./assets/ruang-tegak-icon.svg'];
self.addEventListener('install',event=>{
 event.waitUntil((async()=>{
  const cache=await caches.open(CACHE_NAME);
  await Promise.allSettled(APP_SHELL.map(path=>cache.add(path)));
  await self.skipWaiting();
 })());
});
self.addEventListener('activate',event=>{
 event.waitUntil((async()=>{
  const keys=await caches.keys();
  await Promise.all(keys.filter(key=>key.startsWith('ruang-tegak-')&&key!==CACHE_NAME).map(key=>caches.delete(key)));
  await self.clients.claim();
 })());
});
self.addEventListener('fetch',event=>{
 const request=event.request;
 if(request.method!=='GET'||new URL(request.url).origin!==self.location.origin)return;
 if(request.mode==='navigate'){
  event.respondWith((async()=>{
   try{
    const response=await fetch(request);
    const cache=await caches.open(CACHE_NAME);
    cache.put(request,response.clone()).catch(()=>{});
    return response;
   }catch(error){
    const cache=await caches.open(CACHE_NAME);
    return await cache.match(request)||await cache.match('./belajar.html')||Response.error();
   }
  })());
 }
});