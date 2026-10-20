// Hors ligne : la page est toujours demandée au serveur en contournant tous les caches
// (navigateur et réseau de diffusion), puis servie depuis le cache si pas de connexion.
const VERSION='volleycoach-v139';
const FILES=['./','./index.html','./manifest.webmanifest','./icon-192.png','./icon-512.png'];
self.addEventListener('install',e=>{e.waitUntil(caches.open(VERSION).then(c=>c.addAll(FILES)).then(()=>self.skipWaiting()));});
self.addEventListener('activate',e=>{e.waitUntil(caches.keys().then(k=>Promise.all(k.filter(x=>x!==VERSION).map(x=>caches.delete(x)))).then(()=>self.clients.claim()));});
self.addEventListener('fetch',e=>{
  if(e.request.method!=='GET')return;
  const u=new URL(e.request.url),page=e.request.mode==='navigate'||/\/(index\.html)?$/.test(u.pathname)||/version\.json$/.test(u.pathname);
  // page et numéro de version : adresse unique à chaque demande pour obtenir la dernière version publiée
  const req=page&&u.origin===location.origin?new Request(u.origin+u.pathname+'?_='+Date.now(),{cache:'no-store'}):e.request;
  e.respondWith(fetch(req,{cache:'no-store'}).then(res=>{
    if(res.ok&&!/version\.json$/.test(u.pathname)){const copy=res.clone();caches.open(VERSION).then(c=>c.put(e.request.mode==='navigate'?'./index.html':e.request,copy));}
    return res;
  }).catch(()=>caches.match(e.request,{ignoreSearch:true}).then(r=>r||caches.match('./index.html'))));
});
