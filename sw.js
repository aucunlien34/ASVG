// Hors ligne : la page est d'abord demandée au réseau (mise à jour immédiate),
// puis servie depuis le cache si pas de connexion. Changer VERSION à chaque mise à jour.
const VERSION='gigean-v85';
const FILES=['./','./index.html','./manifest.webmanifest','./icon-192.png','./icon-512.png'];
self.addEventListener('install',e=>{e.waitUntil(caches.open(VERSION).then(c=>c.addAll(FILES)).then(()=>self.skipWaiting()));});
self.addEventListener('activate',e=>{e.waitUntil(caches.keys().then(k=>Promise.all(k.filter(x=>x!==VERSION).map(x=>caches.delete(x)))).then(()=>self.clients.claim()));});
self.addEventListener('fetch',e=>{
  if(e.request.method!=='GET')return;
  e.respondWith(fetch(e.request,{cache:'no-store'}).then(res=>{
    if(res.ok){const copy=res.clone();caches.open(VERSION).then(c=>c.put(e.request,copy));}
    return res;
  }).catch(()=>caches.match(e.request,{ignoreSearch:true}).then(r=>r||caches.match('./index.html'))));
});
