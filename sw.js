// Hors ligne : la page est toujours demandée au serveur en contournant tous les caches
// (navigateur et réseau de diffusion), puis servie depuis le cache si pas de connexion.
const VERSION='volleycoach-v147';
const FILES=['./','./index.html','./manifest.webmanifest','./icon-192.png','./icon-512.png'];
self.addEventListener('install',e=>{e.waitUntil(caches.open(VERSION).then(c=>c.addAll(FILES)).then(()=>self.skipWaiting()));});
self.addEventListener('activate',e=>{e.waitUntil(caches.keys().then(k=>Promise.all(k.filter(x=>x!==VERSION&&x!=='volleycoach-share').map(x=>caches.delete(x)))).then(()=>self.clients.claim()));});
// Réception d'un fichier via « Partager › VolleyCoach » (Android, appli installée) : le fichier est mis de côté
// dans un cache dédié, puis l'appli s'ouvre et l'importe (import ou fusion d'un match).
const SHARE='volleycoach-share';
self.addEventListener('fetch',e=>{
  const u0=new URL(e.request.url);
  if(e.request.method==='POST'&&/\/share-target\/?$/.test(u0.pathname)){
    e.respondWith((async()=>{try{const fd=await e.request.formData(),f=fd.get('file');let txt='';
        if(f&&typeof f.text==='function')txt=await f.text();if(!txt)txt=fd.get('text')||fd.get('title')||'';
        const c=await caches.open(SHARE);await c.put('./shared-file',new Response(txt,{headers:{'Content-Type':'text/plain;charset=utf-8'}}));}catch(err){}
      return Response.redirect('./?share=1',303);})());return;}
  if(e.request.method!=='GET')return;
  const u=new URL(e.request.url),page=e.request.mode==='navigate'||/\/(index\.html)?$/.test(u.pathname)||/version\.json$/.test(u.pathname);
  // page et numéro de version : adresse unique à chaque demande pour obtenir la dernière version publiée
  const req=page&&u.origin===location.origin?new Request(u.origin+u.pathname+'?_='+Date.now(),{cache:'no-store'}):e.request;
  e.respondWith(fetch(req,{cache:'no-store'}).then(res=>{
    if(res.ok&&!/version\.json$/.test(u.pathname)){const copy=res.clone();caches.open(VERSION).then(c=>c.put(e.request.mode==='navigate'?'./index.html':e.request,copy));}
    return res;
  }).catch(()=>caches.match(e.request,{ignoreSearch:true}).then(r=>r||caches.match('./index.html'))));
});
