// Vidéo, suite (V183 ; fonctions pures, aussi testées sous Node dans lab/) :
// 1) export avancé : morceaux, qualité (1080p / 720p / 480p / original), vitesse (×1, ×0,5, ×0,25), son, estimation de taille ;
// 2) score et rotation incrustés : états du score dans le temps de la vidéo, report sur la ligne de temps du fichier exporté,
//    dessin du bandeau (canvas) et images à remettre au module natif ;
// 3) saut des stats vers la vidéo : position d'un point ou d'une action dans un enregistrement ;
// 4) saisie des stats sur un film (V184) : plages gardées d'après les points, recalage, nom du fichier envoyé vers un autre appareil.
// Positions = ms depuis le début de l'enregistrement (comme r.cuts, vRanges, VID.pb.pos). Heures = ms epoch. Décalage off = horloge vidéo − horloge stats.
// Dépend de video-ai.js (vcPosOf, vcTot) : global dans l'appli, require en Node.
const _VC=typeof vcPosOf==='function'?{vcPosOf,vcTot}:(typeof require==='function'?require('./video-ai.js'):{});

// ===== 1. Export avancé ===================================================================================================
// Qualités : h = hauteur du petit côté de l'image, kbps = débit vidéo visé ; 'orig' = copie sans réencodage (taille et vitesse d'origine)
const VX_PRESETS={orig:{lab:'Original',h:null,kbps:null},'1080p':{lab:'1080p',h:1080,kbps:8000},'720p':{lab:'720p',h:720,kbps:4500},'480p':{lab:'480p',h:480,kbps:2000}};
const VX_SPEEDS=[2,1.5,1,0.75,0.5,0.25]; // V186 : de ×0,25 (ralenti) à ×2 (accéléré)
const VX_AUDIO_KBPS=128;
// Plages gardées → morceaux par tranche [{path, in, out}] (ms dans la tranche, out = 0 : jusqu'au bout). P = {segs:[{path,dur}], off:[], ia}
// (copie conforme de vidExport V180, pour que le module natif reçoive la même chose)
function vxPieces(R,P){const out=[];const ia=P.ia||0;R.forEach(([a,b])=>{const A=a+ia,Bb=b+ia;P.segs.forEach((x,i)=>{const o=P.off[i],e=o+x.dur;if(e<=A||o>=Bb)return;out.push({path:x.path,in:Math.round(Math.max(0,A-o)),out:Bb>=e?0:Math.round(Bb-o)});});});return out;}
// Qualité réellement appliquée : jamais plus grande que la source (src = {w, h} de la vidéo, côté court = min)
function vxSize(preset,src){const p=VX_PRESETS[preset]||VX_PRESETS.orig;if(!p.h||!src||!src.w||!src.h)return null;const s=Math.min(src.w,src.h);if(s<=p.h)return {w:src.w,h:src.h,scale:1};
  const k=p.h/s,ev=x=>Math.round(x*k/2)*2;return {w:ev(src.w),h:ev(src.h),scale:k};}
// Estimation : durée (ms) et taille (octets) du fichier exporté. o = {tot, size (octets de l'enregistrement), speed, preset, audio, fps}
// 'orig' : proportion des octets gardés (le ralenti n'ajoute pas d'images : même taille) ; sinon débit visé × durée (+ son)
function vxEstimate(R,o){o=o||{};const kept=R.reduce((a,[x,y])=>a+y-x,0),sp=VX_SPEEDS.includes(o.speed)?o.speed:1,dur=Math.round(kept/sp),p=VX_PRESETS[o.preset]||VX_PRESETS.orig;
  let size;if(!p.kbps)size=Math.round((o.size||0)*kept/Math.max(1,o.tot||kept||1));else{const k=o.fps>40?1.25:1;size=Math.round(p.kbps*k*1000/8*dur/1000);}
  if(o.audio&&sp===1)size+=Math.round(VX_AUDIO_KBPS*1000/8*dur/1000);return {dur,size,kept,speed:sp,preset:p.lab};}
// Vitesse lisible : ×1, ×0,5, ×0,25
function vxSpeedLab(s){return '×'+String(s).replace('.',',');}
// Nom du fichier exporté : VolleyCoach_AAAAMMJJhhmm[_x05][_720p].mp4
function vxName(r,o){o=o||{};const d=new Date(r.t0||Date.now()).toISOString().slice(0,16).replace(/[-:T]/g,'');const sp=o.speed&&o.speed!==1?'_x'+String(o.speed).replace('.',''):'',q=o.preset&&o.preset!=='orig'?'_'+o.preset:'';return `VolleyCoach_${d}${sp}${q}.mp4`;}
// Demande complète pour le module natif (VideoDelay.transcode ou exportCut) : morceaux, taille cible, vitesse, son, incrustation
// R : plages gardées ; P : lecture (segs, off, ia, tot) ; o : {preset, speed, audio, exact, overlay, src:{w,h}, size, fps, r}
function vxPlan(R,P,o){o=o||{};const sp=VX_SPEEDS.includes(o.speed)?o.speed:1,p=VX_PRESETS[o.preset]?o.preset:'orig',size=vxSize(p,o.src),audio=!!o.audio&&sp===1;
  // sans réencodage (copie des échantillons, horodatages étirés pour le ralenti) tant qu'on garde la qualité d'origine, sans coupe à l'image ni bandeau
  const reenc=p!=='orig'||!!o.exact||!!o.overlay;
  return {pieces:vxPieces(R,P),speed:sp,preset:p,size,audio,exact:!!o.exact,reencode:reenc,kbps:VX_PRESETS[p].kbps?Math.round(VX_PRESETS[p].kbps*(o.fps>40?1.25:1)):null,
    overlay:o.overlay||null,name:vxName(o.r||{t0:Date.now()},{speed:sp,preset:p}),est:vxEstimate(R,{tot:P.tot,size:o.size,speed:sp,preset:p,audio,fps:o.fps})};}

// ===== 2. Score et rotation incrustés =====================================================================================
// États du score dans le temps de la vidéo. m : match (m.ev, m.roles, m.format, m.f4), r : enregistrement, o : {off, lag: 2000,
// rotAt, srvAt (S.rotAt / S.srvAt de replay(), sinon rotation calculée ici pour le 6x6), tm: 30000 (durée d'affichage « Temps mort »)}
// → [{from, to, set, sets:{G,A}, pts:{G,A}, rot, srv, tm, end}] : from/to = positions (ms) dans l'enregistrement ; un état peut
// commencer avant 0 ou finir après la fin : ovOnOutput les rogne aux plages gardées. srv = équipe au service pour l'échange à venir.
// Serveur : sp = joueur au service (notre équipe ; S.srvAt du prochain point si fourni, sinon zone 1 en 6x6), spn = son nom affiché
// (o.name(pid), sinon « numéro prénom » depuis m.roster). Changement : état temporaire sub = {o, on, i, in} (sortant, entrant) pendant o.sub ms (8 s ; 0 = pas affiché).
function ovStates(m,r,o){o=Object.assign({lag:2000,tm:30000,sub:8000},o||{});const off=o.off||0,F=(m&&m.format)||{},win=[1,2,3].includes(F.win)?F.win:3,pts=[25,21,15].includes(F.pts)?F.pts:25,tb=F.tb!==false,last=2*win-1;
  const posOf=t=>{const p=_VC.vcPosOf?_VC.vcPosOf(r,t):null;if(p!=null)return p;const S=(r&&r.segs)||[];if(!S.length)return t;const t0=S[0].t||r.t0||0;return t<t0?t-t0:Infinity;};
  const EV=(m&&m.ev)||[],out=[],sets={G:0,A:0};let cur=null,si=-1,zones=null,serving=null,roles=(m&&m.roles)||{};const sixes=!(m&&m.f4);
  const nameOf=pid=>{if(!pid)return null;if(o.name)return o.name(pid);const p=((m&&m.roster)||[]).find(x=>x.id===pid);return p?`${p.n!=null&&p.n!==''?p.n+' ':''}${p.pre||p.nom||''}`.trim():String(pid);};
  // rotation et serveur affichés = ceux de l'échange à venir : S.rotAt / S.srvAt du prochain point si fournis, sinon zone du passeur / joueur en zone 1 (6x6, zones tournées ici)
  const nextPt=idx=>{for(let i=idx+1;i<EV.length;i++){if(EV[i].t==='pt')return i;if(EV[i].t==='set')return -1;}return -1;};
  const rotNow=idx=>{if(o.rotAt){const i=nextPt(idx);return i<0?null:(o.rotAt[i]!=null?o.rotAt[i]:null);}if(!sixes||!zones)return null;for(let z=1;z<=6;z++)if(zones[z]&&roles[zones[z]]==='Pa')return z;return null;};
  const srvNow=idx=>{if(o.srvAt){const i=nextPt(idx);return i<0?null:(o.srvAt[i]||null);}if(serving!=='G'||!sixes||!zones)return null;return zones[1]||null;};
  const who=idx=>{const sp=srvNow(idx);return {sp,spn:nameOf(sp)};};
  // nouvel état à l'heure at : l'état en cours s'arrête là, un état programmé plus tard (fin de « Temps mort » ou de « Changement ») est annulé
  const push=(from,st)=>{while(out.length&&out[out.length-1].from>=from)out.pop();if(out.length){const L=out[out.length-1];L.to=Math.min(L.to,from);}cur=Object.assign({},st,{from,to:Infinity});out.push(cur);};
  EV.forEach((ev,idx)=>{if(ev.at==null)return;const at=posOf(ev.at+off-o.lag);
    if(ev.t==='set'){if(cur&&!cur.end&&cur.set!=null)return;si++;zones=[null].concat(ev.z||[]);serving=ev.s||'G';
      push(at,Object.assign({set:si+1,sets:{G:sets.G,A:sets.A},pts:{G:0,A:0},rot:rotNow(idx),srv:serving,tm:false,end:false,sub:null},who(idx)));}
    else if(ev.t==='role'){roles=Object.assign({},roles);roles[ev.p]=ev.r;}
    else if(ev.t==='pt'&&cur&&!cur.end){const P={G:cur.pts.G,A:cur.pts.A};P[ev.w==='G'?'G':'A']++;
      if(sixes&&zones&&ev.w==='G'&&serving==='A'){const f=zones[1];for(let i=1;i<6;i++)zones[i]=zones[i+1];zones[6]=f;}
      serving=ev.w==='G'?'G':'A';const target=(tb&&si===last-1)?15:pts,hi=Math.max(P.G,P.A),d=Math.abs(P.G-P.A),end=hi>=target&&d>=2;
      const S2={G:sets.G,A:sets.A};if(end){sets[P.G>P.A?'G':'A']++;S2.G=sets.G;S2.A=sets.A;}
      push(at,Object.assign({set:cur.set,sets:S2,pts:P,rot:end?null:rotNow(idx),srv:end?null:serving,tm:false,end,sub:null},end?{sp:null,spn:null}:who(idx)));}
    else if(ev.t==='sub'&&cur&&!cur.end){const k=zones?zones.indexOf(ev.o):-1;if(k>0)zones[k]=ev.i; // le remplaçant prend la place (et le service éventuel) du sortant
      const base=Object.assign({},cur,{rot:rotNow(idx)},who(idx),{sub:null});
      if(o.sub>0){push(at,Object.assign({},base,{sub:{o:ev.o,on:nameOf(ev.o),i:ev.i,in:nameOf(ev.i)}}));push(posOf(ev.at+off-o.lag+o.sub),base);}
      else if(base.sp!==cur.sp)push(at,base);}
    else if(ev.t==='to'&&cur&&!cur.end){const back=Object.assign({},cur,{sub:null});push(at,Object.assign({},cur,{tm:true,sub:null}));
      // le bandeau « Temps mort » disparaît après o.tm ms si rien ne se passe avant
      push(posOf(ev.at+off-o.lag+o.tm),back);}
  });
  return out.filter(s=>s.to>s.from);}
// Clé d'un état : même clé = même image du bandeau
function ovKey(s){return `${s.set}|${s.sets.G}-${s.sets.A}|${s.pts.G}-${s.pts.A}|${s.rot||''}|${s.srv||''}|${s.tm?1:0}|${s.end?1:0}|${s.sp||''}|${s.sub?s.sub.i+'>'+s.sub.o:''}`;}
// États → intervalles sur la ligne de temps du fichier exporté (plages gardées R mises bout à bout, vitesse appliquée) :
// [{from, to, key, st}] en ms du fichier, états voisins identiques fusionnés. Les instants sans état (avant le premier set) n'ont pas de bandeau.
function ovOnOutput(states,R,speed){const sp=speed||1,out=[];let o=0;R.forEach(([a,b])=>{states.forEach(s=>{const f=Math.max(s.from,a),t=Math.min(s.to,b);if(t<=f)return;
    const F=Math.round(o+(f-a)/sp),T=Math.round(o+(t-a)/sp),k=ovKey(s),L=out[out.length-1];if(L&&L.key===k&&L.to>=F)L.to=Math.max(L.to,T);else out.push({from:F,to:T,key:k,st:s});});o+=(b-a)/sp;});
  return out;}
// Abréviation d'un nom d'équipe (bandeau « court ») : initiales des mots (VBC Montpellier → VBM), sinon 3 premières lettres
function ovAbbr(n){const w=String(n||'').trim().split(/[\s'’-]+/).filter(Boolean);if(!w.length)return '';const a=w.length>=2?w.map(x=>x[0]).join('').slice(0,3):w[0].slice(0,3);return a.toUpperCase();}
// Dessin du bandeau sur un contexte canvas. o = {x, y, h (hauteur du bandeau, px), team, opp, font, names: 'full'|'short'|'none',
// rot: true, srv: true, server: true (nom du serveur), subs: true (changements), opacity: .78}. Renvoie {w, h}.
// Ligne 1 : équipe · points · points · adversaire (petit : sets) ; ligne 2 : rotation (P1…P6) et « Au service : 7 Juliette » (ou l'équipe
// adverse au service), remplacée pendant quelques secondes par « Changement : entre 12 Tomasz · sort 7 Juliette », ou par « Temps mort ».
function ovDraw(ctx,s,o){o=o||{};const H=o.h||56,x=o.x||0,y=o.y||0,f=o.font||'Barlow Condensed, Arial Narrow, sans-serif',big=Math.round(H*.5),small=Math.round(H*.27),pad=Math.round(H*.22),nm=o.names||'full';
  const T0=o.team||'Nous',O0=o.opp||'Adversaire',team=nm==='none'?'':nm==='short'?ovAbbr(T0):String(T0).slice(0,14).toUpperCase(),opp=nm==='none'?'':nm==='short'?ovAbbr(O0):String(O0).slice(0,14).toUpperCase();
  const tS=team||'NOUS',oS=opp||'EUX';
  ctx.save();ctx.textBaseline='middle';
  ctx.font=`700 ${big}px ${f}`;const wT=team?ctx.measureText(team).width:0,wO=opp?ctx.measureText(opp).width:0,wP=ctx.measureText('88').width;
  ctx.font=`700 ${small}px ${f}`;const wS=ctx.measureText('8').width;
  const up=v=>String(v||'').toUpperCase(),srvTxt=s.srv==='G'?(o.server!==false&&s.spn?'AU SERVICE : '+up(s.spn):tS+' AU SERVICE'):oS+' AU SERVICE';
  ctx.font=`600 ${small}px ${f}`;const L2=s.tm?['TEMPS MORT']:s.sub&&o.subs!==false?['CHANGEMENT : ENTRE '+up(s.sub.in)+'  ·  SORT '+up(s.sub.on)]:[o.rot!==false&&s.rot?'P'+s.rot:null,o.srv!==false&&s.srv?srvTxt:null,s.end?'FIN DU SET '+s.set:null].filter(Boolean);
  const line2=L2.join('  ·  '),w2=line2?ctx.measureText(line2).width:0,one=!line2,HH=one?Math.round(H*.7):H;
  const gap=Math.round(H*.25),gT=team?gap:gap/2,gO=opp?gap:gap/2,w1=pad+wS+gap/2+wT+gT+wP+gap/2+Math.round(H*.12)+gap/2+wP+gO+wO+gap/2+wS+pad,W=Math.round(Math.max(w1,w2+2*pad)),R=Math.round(H*.18);
  ctx.globalAlpha=o.opacity!=null?o.opacity:.78;ctx.fillStyle=s.tm?'#7a1f1f':'#101828';ctx.beginPath();ctx.moveTo(x+R,y);ctx.arcTo(x+W,y,x+W,y+HH,R);ctx.arcTo(x+W,y+HH,x,y+HH,R);ctx.arcTo(x,y+HH,x,y,R);ctx.arcTo(x,y,x+W,y,R);ctx.closePath();ctx.fill();ctx.globalAlpha=1;
  const y1=y+Math.round(one?HH/2:H*.36),y2=y+Math.round(H*.76);let cx=x+pad;
  ctx.font=`700 ${small}px ${f}`;ctx.fillStyle='#F2BE22';ctx.fillText(String(s.sets.G),cx,y1);cx+=wS+gap/2;
  ctx.font=`700 ${big}px ${f}`;ctx.fillStyle='#fff';if(team)ctx.fillText(team,cx,y1);cx+=wT+gT;
  ctx.fillStyle=s.srv==='G'&&!s.end?'#F2BE22':'#fff';ctx.fillText(String(s.pts.G),cx,y1);cx+=wP+gap/2;
  ctx.fillStyle='#9aa4b2';ctx.fillRect(cx,y1-1,Math.round(H*.12),2);cx+=Math.round(H*.12)+gap/2;
  ctx.fillStyle=s.srv==='A'&&!s.end?'#F2BE22':'#fff';ctx.fillText(String(s.pts.A),cx,y1);cx+=wP+gO;
  ctx.fillStyle='#fff';if(opp)ctx.fillText(opp,cx,y1);cx+=wO+gap/2;
  ctx.font=`700 ${small}px ${f}`;ctx.fillStyle='#F2BE22';ctx.fillText(String(s.sets.A),cx,y1);
  if(line2){ctx.font=`600 ${small}px ${f}`;ctx.fillStyle=s.tm?'#ffd9d9':s.sub?'#F2BE22':'#cfd6e0';ctx.fillText(line2,x+pad,y2);}
  ctx.restore();return {w:W,h:HH};}
// Taille du bandeau (fraction de la hauteur affichée) et marge selon le réglage ; position d'une image selon le coin choisi
const OV_SIZE={s:.06,m:.075,l:.09},OV_MARGIN=.025;
function ovPlace(dim,size,corner){const m=Math.round(size.h*OV_MARGIN),c=corner||'tl';return {x:c==='tr'||c==='br'?size.w-m-dim.w:m,y:c==='bl'||c==='br'?size.h-m-dim.h:m};}
// Images du bandeau pour le module natif : une par clé d'état, PNG (data URL), à la taille de la vidéo exportée (size = {w, h} affichés),
// o : {size, team, opp, corner, scale: 's'|'m'|'l', names, rot, srv, opacity}. → {images: {key: dataUrl}, dims, pos: {key: {x, y}}, h, spans}
// (position par image : les coins droits et bas dépendent de la largeur du bandeau). Navigateur seulement (canvas).
// Un bandeau plus large que l'image (vidéo portrait, noms longs) est redessiné plus petit pour tenir entre les marges.
function ovImages(spans,o){o=o||{};const size=o.size||{w:1280,h:720},H=Math.round(size.h*(OV_SIZE[o.scale]||OV_SIZE.m)),images={},dims={},pos={},maxW=size.w-2*Math.round(size.h*OV_MARGIN);
  spans.forEach(sp=>{if(images[sp.key])return;const cv=document.createElement('canvas');cv.width=Math.max(size.w,Math.round(size.h*2));cv.height=H;const ctx=cv.getContext('2d');
    const op={x:0,y:0,h:H,team:o.team,opp:o.opp,names:o.names,rot:o.rot,srv:o.srv,server:o.server,subs:o.subs,opacity:o.opacity};let d=ovDraw(ctx,sp.st,op);
    if(d.w>maxW){ctx.clearRect(0,0,cv.width,cv.height);op.h=Math.max(12,Math.floor(H*maxW/d.w));d=ovDraw(ctx,sp.st,op);}
    const c2=document.createElement('canvas');c2.width=d.w;c2.height=d.h;c2.getContext('2d').drawImage(cv,0,0,d.w,d.h,0,0,d.w,d.h);images[sp.key]=c2.toDataURL('image/png');dims[sp.key]=d;pos[sp.key]=ovPlace(d,size,o.corner);});
  return {images,dims,pos,h:H,spans:spans.map(s=>({from:s.from,to:s.to,key:s.key}))};}
// Bandeau possible pour cet enregistrement ? → {ok, why: 'noMatch' | 'noTimes' | 'noOffset' | null}
function ovAvailable(m,r,o){o=o||{};if(!m||!r)return {ok:false,why:'noMatch'};if(!_mgSpan(m))return {ok:false,why:'noTimes'};
  const off=o.off!=null?o.off:(r.off!=null?r.off:null);if(off==null)return {ok:false,why:'noOffset'};return {ok:true,why:null};}

// ===== Réglages vidéo (Réglages › Vidéo) : valeurs par défaut, bornes, normalisation =====================================
// Montage auto : marges gardées avant / après chaque échange et temps mort minimal (s) ; clips : avance / suite (s) ; bandeau : coin,
// taille, noms, rotation, service, opacité ; export : qualité, vitesse, son, coupe exacte. Tout vit dans store.prefs.vid (VP()) :
// prefs.vid.auto, prefs.vid.clip, prefs.vid.ov, prefs.vid.exp. vxSettings() complète et borne (réglage absent ou hors bornes → défaut / borne).
const VX_SETTINGS={
  auto:{before:{def:1.5,min:0,max:10,step:.5},after:{def:1,min:0,max:10,step:.5},minDead:{def:4,min:2,max:15,step:1},minRally:{def:2,min:1,max:6,step:.5}},
  clip:{before:{def:1.5,min:0,max:15,step:.5},after:{def:1.5,min:0,max:10,step:.5}}, // V186 : 1,5 s avant / après
  ov:{on:{def:true},corner:{def:'tl',opts:['tl','tr','bl','br']},scale:{def:'m',opts:['s','m','l']},names:{def:'full',opts:['full','short','none']},rot:{def:true},srv:{def:true},server:{def:true},subs:{def:true},subDur:{def:8,min:3,max:20,step:1},opacity:{def:.78,min:.4,max:1,step:.02}},
  exp:{preset:{def:'orig',opts:Object.keys(VX_PRESETS)},speed:{def:1,opts:VX_SPEEDS},audio:{def:false},exact:{def:false}},
  // saisie sur un film (V184) : gardé avant la première action (service / réception) et après le point (s) ; vitesses pendant l'échange et après le point
  pt:{srv:{def:1.5,min:0,max:10,step:.5},rec:{def:2.5,min:0,max:10,step:.5},after:{def:1.5,min:0,max:10,step:.5}}, // V186 : 1,5 s après le point
  // V185 : react = temps de réaction (s de temps réel entre l'action vue et le tap, retiré de l'heure de la stat selon la vitesse de lecture)
  vst:{slow:{def:.5,opts:[1,.5,.25]},after:{def:1,opts:[1,2]},react:{def:.6,min:0,max:1.5,step:.1}},
  // V185 : clips par type d'action (section Vidéo des stats, Clips) : gardé avant / après l'action (s) ; V186 : 1,5 s partout par défaut (clip de 3 s centré)
  act:Object.fromEntries(['rec','pas','att','blk','def','srv'].flatMap(k=>[[k+'B',{def:1.5,min:0,max:10,step:.5}],[k+'A',{def:1.5,min:0,max:10,step:.5}]]))};
function vxSettings(P){P=P||{};const out={};Object.keys(VX_SETTINGS).forEach(g=>{const G=VX_SETTINGS[g],src=P[g]||{},o=out[g]={};Object.keys(G).forEach(k=>{const d=G[k],v=src[k];
    if(d.opts)o[k]=d.opts.includes(v)?v:d.def;else if(typeof d.def==='boolean')o[k]=v==null?d.def:!!v;else{const n=+v;o[k]=Number.isFinite(n)?Math.min(d.max,Math.max(d.min,Math.round(n/d.step)*d.step)):d.def;}});});return out;}
// Réglages du bandeau → options de ovStates (durée du changement) et de ovImages / ovDraw
function vxOvOpts(S){const v=(S&&S.ov)||vxSettings().ov;return {sub:v.subs?Math.round(v.subDur*1000):0,corner:v.corner,scale:v.scale,names:v.names,rot:v.rot,srv:v.srv,server:v.server,subs:v.subs,opacity:v.opacity};}
// Réglages du montage auto → options de dtClassify / dtAdjust (ms)
function vxAutoOpts(S){const a=(S&&S.auto)||vxSettings().auto;return {padA:Math.round(a.before*1000),padB:Math.round(a.after*1000),minDead:Math.round(a.minDead*1000),minRally:Math.round(a.minRally*1000)};}
// Marges changées après coup : à partir des échanges bruts gardés dans r.ral (core de dtClassify), sans réanalyser la vidéo
// (trous courts réunis selon minDead, échanges trop courts retirés, puis marges) → {core, rallies} ; dtCuts(rallies, tot) donne les r.cuts
function dtAdjust(core,tot,o){o=o||{};const J=[];(core||[]).slice().sort((a,b)=>a[0]-b[0]).forEach(c=>{const z=J[J.length-1];if(z&&c[0]-z[1]<(o.minDead||0))z[1]=Math.max(z[1],c[1]);else J.push(c.slice());});
  const C=J.filter(([x,y])=>y-x>=(o.minRally||0)),R=[];C.forEach(([x,y])=>{const p=[Math.max(0,x-(o.padA||0)),Math.min(tot,y+(o.padB||0))],z=R[R.length-1];if(z&&p[0]<=z[1])z[1]=Math.max(z[1],p[1]);else R.push(p);});
  return {core:C.map(x=>x.map(Math.round)),rallies:R.map(x=>x.map(Math.round))};}

// ===== Enregistrements ↔ matchs : recouvrement des heures, décalage connu, lien manuel ===================================
// Heures d'un match (horloge stats) : première et dernière heure notée (même calcul que mgSpan de l'appli, nom distinct : les deux scripts partagent la page)
const _mgSpan=m=>{const t=((m&&m.ev)||[]).map(e=>e.at).filter(Number.isFinite);return t.length?[Math.min(...t),Math.max(...t)]:null;};
// Candidats pour un enregistrement, du meilleur au moins bon : {m, overlap (ms), ratio (part du plus court recouverte), gap (ms sans recouvrement), score}.
// Heures de la vidéo ramenées sur l'horloge des stats par le décalage connu (o.off, sinon r.off) ; sans recouvrement, un match
// à moins de o.tol (30 min) reste proposé avec un score faible (appareils mal réglés, vidéo lancée tôt). Entraînements et clips exclus.
function vcLinkCandidates(r,matches,o){o=Object.assign({tol:30*60e3},o||{});if(!r||r.mode==='train'||r.clip||!Number.isFinite(r.t0))return [];
  const off=o.off!=null?o.off:(r.off||0),S=r.segs||[],end=S.length?S[S.length-1].t+S[S.length-1].d:r.t0+(r.dur||0),a=r.t0-off,b=end-off; // fin réelle (trous entre tranches compris)
  return (matches||[]).map(m=>{if(!m||m.season)return null;const sp=_mgSpan(m);if(!sp)return null;const ov=Math.min(b,sp[1])-Math.max(a,sp[0]),len=Math.max(1,Math.min(b-a,sp[1]-sp[0]));
      if(ov>0)return {m,overlap:ov,ratio:ov/len,gap:0,score:.3+.7*Math.min(1,ov/len)};const gap=-ov;return gap<=o.tol?{m,overlap:0,ratio:0,gap,score:.25*(1-gap/o.tol)}:null;})
    .filter(c=>c&&c.score>0).sort((p,q)=>q.score-p.score||(p.gap-q.gap));}
// Match retenu pour un enregistrement : lien manuel (r.mid) ou refus (r.noLink) d'abord, sinon meilleur candidat ;
// → {m, auto, sure, candidates} ; sure = recouvrement franc et sans concurrent proche (sinon proposer le choix à l'utilisateur)
function vcLinkPick(r,matches,o){const C=vcLinkCandidates(r,matches,o);if(!r)return {m:null,auto:false,sure:false,candidates:C};
  if(r.noLink)return {m:null,auto:false,sure:true,candidates:C};
  if(r.mid){const m=(matches||[]).find(x=>x&&x.id===r.mid);if(m)return {m,auto:false,sure:true,candidates:C};}
  if(!C.length)return {m:null,auto:true,sure:false,candidates:C};const b=C[0],s=C[1];
  return {m:b.m,auto:true,sure:b.ratio>=.5&&(!s||s.score<b.score*.6),candidates:C};}
// Inverse : enregistrements candidats pour un match (même score), du meilleur au moins bon
function vcRecsFor(m,vids,o){return (vids||[]).map(r=>{const c=vcLinkCandidates(r,[m],o)[0];return c?Object.assign({r},c):null;}).filter(Boolean).sort((p,q)=>q.score-p.score);}

// ===== 3. Stats → vidéo ===================================================================================================
// Position dans l'enregistrement pour revoir un instant des stats : heure t (horloge stats) + décalage, moins une avance (la saisie
// suit l'action : 6 s comme les clips). null si l'instant est hors de l'enregistrement.
function vsJump(r,t,o){o=Object.assign({before:6000,off:0},o||{});if(t==null||!_VC.vcPosOf)return null;const p=_VC.vcPosOf(r,t+o.off);if(p==null)return null;const tot=_VC.vcTot?_VC.vcTot(r):Infinity;return Math.max(0,Math.min(tot,p-o.before));}
// Instant d'un point : la dernière action horodatée de l'échange, sinon l'heure du point moins le retard de saisie (lag)
function vsPointTime(ev,o){o=Object.assign({lag:2000},o||{});if(!ev)return null;const st=(ev.st||[]).map(x=>x[5]).filter(x=>x!=null);if(st.length)return Math.max(...st);return ev.at!=null?ev.at-o.lag:null;}

// ===== 4. Saisie des stats sur un film de match (V184) ====================================================================
// Les stats sont saisies en relisant l'enregistrement : chaque action porte l'heure vidéo (horloge de l'enregistrement moins r.off),
// le point aussi. Le montage garde, pour chaque point, de la première action (moins la marge service ou réception) à la fin du point (plus la marge).
// Instant d'ancrage d'un point pour le recalage : sa dernière action horodatée, sinon l'heure du point (noté à la fin de l'échange, sans retard)
function vstAnchor(ev){if(!ev)return null;const st=(ev.st||[]).map(x=>x[5]).filter(Number.isFinite);return st.length?Math.max(...st):(Number.isFinite(ev.at)?ev.at:null);}
// Première action du point (heure et type), sinon l'heure du point
// V189 : « Début du point » (entraînement) : ev.t0 = heure du début, prise comme première action (marge du service)
function vstFirst(ev){if(!ev)return null;let b=Number.isFinite(ev.t0)?{t:ev.t0,kind:'start'}:null;(ev.st||[]).forEach(x=>{if(Number.isFinite(x[5])&&(!b||x[5]<b.t))b={t:x[5],kind:x[0]};});return b||(Number.isFinite(ev.at)?{t:ev.at,kind:null}:null);}
// Plages gardées (positions ms) d'après les points : o = {off, srv, rec, after, noStat} (ms ; noStat = avance quand le point n'a aucune action)
function vstRanges(m,r,o){o=Object.assign({off:(r&&r.off)||0,srv:1500,rec:2500,after:1500,noStat:6000},o||{});if(!r||!_VC.vcPosOf)return [];const tot=_VC.vcTot?_VC.vcTot(r):Infinity,out=[];
  ((m&&m.ev)||[]).forEach(ev=>{if(ev.t!=='pt'||!Number.isFinite(ev.at))return;const f=vstFirst(ev),before=f.kind==null?o.noStat:f.kind==='srv'||f.kind==='start'?o.srv:o.rec;
    const a=Math.max(0,_VC.vcPosOf(r,f.t+o.off)-before),b=Math.min(tot,_VC.vcPosOf(r,ev.at+o.off)+o.after);if(Number.isFinite(a)&&Number.isFinite(b)&&b-a>=200)out.push([Math.round(a),Math.round(b)]);});
  return out.sort((p,q)=>p[0]-q[0]);}
// Recalage : décale de delta ms l'heure des évènements à partir de l'index i (points, actions, changements, temps morts…) → nombre d'évènements touchés
function vstShift(m,i,delta){let n=0;((m&&m.ev)||[]).forEach((e,k)=>{if(k<i||!delta)return;if(Number.isFinite(e.at)){e.at+=delta;n++;}if(Number.isFinite(e.t0))e.t0+=delta;(e.st||[]).forEach(x=>{if(Number.isFinite(x[5]))x[5]+=delta;});});return n;}
// Index du prochain point (évènement pt) à partir de i, sinon −1 ; précédent : avant i
function vstNextPt(m,i){const E=(m&&m.ev)||[];for(let k=Math.max(0,i|0);k<E.length;k++)if(E[k].t==='pt')return k;return -1;}
function vstPrevPt(m,i){const E=(m&&m.ev)||[];for(let k=Math.min(E.length,i|0)-1;k>=0;k--)if(E[k].t==='pt')return k;return -1;}
// Vidéo envoyée vers un autre appareil : nom VolleyCoach_AAAAMMJJhhmmss_match.mp4 (heure UTC du début), relu à l'import pour dater l'enregistrement
function vxSendName(r){const d=new Date((r&&r.t0)||Date.now()).toISOString().slice(0,19).replace(/[-:T]/g,'');return `VolleyCoach_${d}_match.mp4`;}
function vxImportT0(name){const k=/VolleyCoach_(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})/.exec(String(name||''));if(!k)return null;const t=Date.UTC(+k[1],+k[2]-1,+k[3],+k[4],+k[5],+k[6]);return Number.isFinite(t)?t:null;}

// ===== 5. Section « Vidéo » des stats (V185) : montage par critères ========================================================
// Actions retenues (vcActions, avec j et prev) → plages gardées (positions ms) : action isolée = [t − avant(type), t + après(type)] ;
// point entier = de la première action du point (marge service / réception) à l'heure du point (+ après), comme vstRanges.
// o = {off, act: VS().act (s), pt: VS().pt (s), whole: true|false} ; m : match (ev), r : enregistrement. Plages fusionnées, triées.
function vmRanges(m,r,acts,o){o=o||{};if(!r||!_VC.vcPosOf)return [];const tot=_VC.vcTot?_VC.vcTot(r):Infinity,off=o.off||0,A=o.act||{},out=[];
  if(o.whole){const E=(m&&m.ev)||[],seen=new Set();(acts||[]).forEach(a=>{if(seen.has(a.ev))return;seen.add(a.ev);const ev=E[a.ev];if(ev)out.push(ev);});
    const P=o.pt||{};return vstRanges({ev:out},r,{off,srv:(P.srv!=null?P.srv:1.5)*1000,rec:(P.rec!=null?P.rec:2.5)*1000,after:(P.after!=null?P.after:1.5)*1000});}
  (acts||[]).forEach(a=>{const k=a.kind==='rly'||a.kind==='rel'?'pas':a.kind,bf=(A[k+'B']!=null?A[k+'B']:1.5)*1000,af=(A[k+'A']!=null?A[k+'A']:1.5)*1000;
    const p=_VC.vcPosOf(r,a.t+off);if(p==null)return;const x=Math.max(0,p-bf),y=Math.min(tot,p+af);if(y-x>=200)out.push([Math.round(x),Math.round(y)]);});
  out.sort((p,q)=>p[0]-q[0]);const M=[];out.forEach(c=>{const z=M[M.length-1];if(z&&c[0]<=z[1])z[1]=Math.max(z[1],c[1]);else M.push(c.slice());});return M;}

if(typeof module!=='undefined')module.exports={VX_PRESETS,VX_SPEEDS,VX_AUDIO_KBPS,VX_SETTINGS,OV_SIZE,OV_MARGIN,vxPieces,vxSize,vxEstimate,vxSpeedLab,vxName,vxPlan,vxSettings,vxAutoOpts,vxOvOpts,dtAdjust,
  ovStates,ovKey,ovOnOutput,ovAbbr,ovDraw,ovPlace,ovImages,ovAvailable,mgSpan:_mgSpan,vcLinkCandidates,vcLinkPick,vcRecsFor,vsJump,vsPointTime,
  vstAnchor,vstFirst,vstRanges,vstShift,vstNextPt,vstPrevPt,vxSendName,vxImportT0,vmRanges};
