// Vidéo assistée (V181) — 1) clips automatiques par joueur / par action : fonctions pures, sans DOM (aussi testées sous Node, lab/).
// Heures : ms epoch. Positions : ms depuis le début de l'enregistrement (comme r.cuts, vRanges).
// Décalage d'horloge off = horloge de la vidéo − horloge des stats (deux appareils différents).

// Actions notées d'un match : x = [type, note, joueur, relais, difficulté, heure, modifiée?]
// filtre f : {pid:'e3'|['e3','e7'], kinds:['att','srv'], signs:[1]} ; heure absente → heure du point (ev.at), sinon ignorée
function vcActions(m,f){f=f||{};const P=f.pid==null?null:[].concat(f.pid),K=f.kinds?[].concat(f.kinds):null,G=f.signs?[].concat(f.signs):null,out=[];
  let si=-1,ri=-1;(m&&m.ev||[]).forEach((e,i)=>{if(e.t==='set'){si++;ri=-1;return;}if(e.t!=='pt')return;ri++;
    (e.st||[]).forEach(x=>{const t=x[5]!=null?x[5]:e.at;if(t==null)return;if(P&&!P.includes(x[2]))return;if(K&&!K.includes(x[0]))return;if(G&&!G.includes(x[1]))return;
      out.push({t,kind:x[0],sign:x[1],pid:x[2],setIdx:Math.max(0,si),rallyIdx:ri,ev:i,est:x[5]==null});});});
  return out.sort((a,b)=>a.t-b.t);}

// Tranches d'un enregistrement {u,d,t} (comme vSegsOf, sans le dossier) et durée totale (comme vidPlay : r.dur pour un clip avec ia)
const vcSegs=r=>(r&&r.segs||[]).map(x=>({d:x.d,t:x.t}));
function vcTot(r){const a=vcSegs(r).reduce((s,x)=>s+x.d,0);return r&&r.ia!=null?Math.min(r.dur,a-r.ia):a;}
// Heure (horloge vidéo) → position. Hors tranches : avant la 1re = négatif, trou entre tranches = début de la suivante, après = au-delà de tot.
function vcPosOf(r,t){const S=vcSegs(r),ia=(r&&r.ia)||0;if(!S.length)return null;let o=0;
  for(let i=0;i<S.length;i++){const s=S[i];if(t<s.t)return (i?o:o+t-s.t)-ia;if(t<s.t+s.d)return o+t-s.t-ia;o+=s.d;}
  return o+t-(S[S.length-1].t+S[S.length-1].d)-ia;}
// Position → heure (horloge vidéo), inverse de vcPosOf
function vcTimeAt(r,pos){const S=vcSegs(r),ab=pos+((r&&r.ia)||0);if(!S.length)return null;let o=0;
  for(let i=0;i<S.length;i++){const s=S[i];if(ab<o+s.d||i===S.length-1)return s.t+ab-o;o+=s.d;}}

// Clips autour des actions : [heure − before, heure + after] (la saisie suit l'action de quelques secondes),
// fusionnés s'ils se chevauchent (ou sont à moins de gap ms), rognés à l'enregistrement. → [{a,b,acts:[…]}]
function vcClips(acts,r,o){o=o||{};const bf=o.before!=null?o.before:6000,af=o.after!=null?o.after:2000,off=o.offset||0,gap=o.gap||0,tot=vcTot(r),L=[];
  (acts||[]).forEach(x=>{const t=x.t+off,a=Math.max(0,vcPosOf(r,t-bf)),b=Math.min(tot,vcPosOf(r,t+af));if(b-a>=200)L.push({a:Math.round(a),b:Math.round(b),acts:[x]});});
  L.sort((p,q)=>p.a-q.a);const out=[];L.forEach(c=>{const z=out[out.length-1];if(z&&c.a<=z.b+gap){z.b=Math.max(z.b,c.b);z.acts.push(...c.acts);}else out.push(c);});return out;}
const vcClipRanges=(acts,r,o)=>vcClips(acts,r,o).map(c=>[c.a,c.b]);

// Plages gardées → r.cuts (bascules alternées, comme vSetCut) : tout est jeté sauf les plages ; vRanges(r,tot) les redonne
// (plages qui se touchent ou se chevauchent réunies ; aucune plage → tout jeté)
function vcCuts(R,tot){const C=[];let k=1;const put=(t,v)=>{if(v!==k){C.push([Math.round(t),v]);k=v;}};
  const S=[];(R||[]).map(([a,b])=>[Math.max(0,a),Math.min(tot,b)]).filter(([a,b])=>b>a).sort((p,q)=>p[0]-q[0])
    .forEach(([a,b])=>{const z=S[S.length-1];if(z&&a<=z[1])z[1]=Math.max(z[1],b);else S.push([a,b]);});
  if(!S.length)return [[0,0]];if(S[0][0]>0)put(0,0);S.forEach(([a,b])=>{put(a,1);if(b<tot)put(b,0);});return C;}

// Décalage d'horloge vidéo − stats.
// a) réglage manuel : o.manual = décalage en ms, ou o.sync = {pos, t} (position dans la vidéo ↔ heure d'une action ou d'un point des stats)
// b) automatique : les points (ev.at, notés ~lag ms après la fin de l'échange) sont rapprochés des fins d'échanges détectées
//    (rallies = [[début, fin]…] en positions, sortie de dt-classify) ; balayage ±range ms par pas de 1 s puis 100 ms.
//    score = 2·appariés/(points dans la vidéo + échanges) ∈ [0,1] (F1 pondéré) ; second = meilleur score à plus de 20 s du premier.
// → {offset, score, second, n, src:'manual'|'auto'|'none'}
function vcEstimateOffset(m,r,rallies,o){o=o||{};
  if(o.manual!=null)return {offset:+o.manual,score:1,src:'manual'};
  if(o.sync&&o.sync.pos!=null&&o.sync.t!=null)return {offset:Math.round(vcTimeAt(r,o.sync.pos)-o.sync.t),score:1,src:'manual'};
  const P=(m&&m.ev||[]).filter(e=>e.t==='pt'&&e.at!=null).map(e=>e.at).sort((a,b)=>a-b),E=(rallies||[]).map(x=>vcTimeAt(r,x[1])).sort((a,b)=>a-b);
  if(P.length<3||E.length<3)return {offset:0,score:0,src:'none'};
  const lag=o.lag!=null?o.lag:2000,rng=o.range!=null?o.range:600e3,t0=vcTimeAt(r,0),t1=vcTimeAt(r,vcTot(r));
  // fin d'échange la plus proche de q (recherche dichotomique)
  const near=q=>{let lo=0,hi=E.length-1;while(lo<hi){const mi=(lo+hi)>>1;if(E[mi]<q)lo=mi+1;else hi=mi;}let d=Math.abs(E[lo]-q);if(lo)d=Math.min(d,Math.abs(E[lo-1]-q));return d;};
  const sc=(off,sg)=>{let s=0,n=0;for(const p of P){const q=p+off-lag;if(q<t0-sg||q>t1+sg)continue;n++;const d=near(q);if(d<3*sg)s+=Math.exp(-d*d/(2*sg*sg));}return 2*s/(n+E.length);};
  let best=-1,bo=0;const all=[];for(let off=-rng;off<=rng;off+=1000){const s=sc(off,2500);all.push([off,s]);if(s>best){best=s;bo=off;}}
  const second=all.filter(([f])=>Math.abs(f-bo)>20000).reduce((a,[,s])=>Math.max(a,s),0);
  let fb=-1,fo=bo;for(let off=bo-2000;off<=bo+2000;off+=100){const s=sc(off,1000);if(s>fb){fb=s;fo=off;}}
  return {offset:fo,score:+fb.toFixed(3),second:+second.toFixed(3),n:P.length,src:'auto'};}

// 2) Détection des temps morts (entre les échanges) pour proposer un montage garder / jeter.
// 1) dtAnalyze (navigateur) : lit la vidéo en accéléré, muette, ~8 images/s analysées en 64×36 gris → courbe d'activité
// 2) dtClassify (pur, testable sous Node) : courbe → échanges [[début, fin]…] ; dtCuts → r.cuts
// Positions en ms depuis le début de l'enregistrement (comme r.cuts, vRanges).

const DT={fps:8,rate:'auto',w:64,h:36,smooth:1500,base:90e3,minRally:2000,minDead:4000,padA:1500,padB:1000,contrast:1.8};

// --- Partie pure -------------------------------------------------------------------------------------------------------
const dtPct=(A,p)=>{if(!A.length)return 0;const S=Float64Array.from(A).sort();return S[Math.min(S.length-1,Math.max(0,Math.round(p*(S.length-1))))];};
// médiane glissante sur ±k échantillons (efface les secousses brèves), puis moyenne glissante sur ±k
function dtSmooth(V,k){const n=V.length,M=new Float64Array(n),S=new Float64Array(n);
  for(let i=0;i<n;i++){const w=Array.prototype.slice.call(V,Math.max(0,i-k),Math.min(n,i+k+1)).sort((a,b)=>a-b);M[i]=w[w.length>>1];}
  let s=0,a=0,b=-1;for(let i=0;i<n;i++){while(b<Math.min(n-1,i+k))s+=M[++b];while(a<i-k)s-=M[a++];S[i]=s/(b-a+1);}return S;}
// ligne de base lente (éclairage, public, caméra qui chauffe) : 20e centile sur ±base/2, calculé tous les ~2 s puis interpolé
function dtBase(T,S,win){const n=T.length,B=new Float64Array(n),G=[];if(!n)return B;let a=0,b=0;
  for(let i=0;i<n;i++){if(G.length&&T[i]-T[G[G.length-1][0]]<2000)continue;
    while(T[a]<T[i]-win/2)a++;while(b<n-1&&T[b+1]<=T[i]+win/2)b++;G.push([i,dtPct(Array.prototype.slice.call(S,a,b+1),.2)]);}
  let g=0;for(let i=0;i<n;i++){while(g<G.length-1&&G[g+1][0]<=i)g++;const [i0,v0]=G[g],nx=G[g+1];B[i]=nx?v0+(nx[1]-v0)*(i-i0)/(nx[0]-i0):v0;}return B;}
// seuil d'Otsu (64 classes) entre lo et hi
function dtOtsu(A,lo,hi){const N=64,H=new Array(N).fill(0),w=(hi-lo)/N||1;A.forEach(v=>H[Math.max(0,Math.min(N-1,Math.floor((v-lo)/w)))]++);
  const tot=A.length;let sum=0;H.forEach((h,i)=>sum+=i*h);let sb=0,wb=0,best=-1,th=N/2;
  for(let i=0;i<N;i++){wb+=H[i];if(!wb)continue;const wf=tot-wb;if(!wf)break;sb+=i*H[i];const mb=sb/wb,mf=(sum-sb)/wf,v=wb*wf*(mb-mf)*(mb-mf);if(v>best){best=v;th=i+1;}}
  return lo+th*w;}
// courbe [[ms, activité]…] → {rallies (avec marges), core (sans marges), thr, sm (courbe lissée − base)}
function dtClassify(curve,o){o=Object.assign({},DT,o||{});const C=(curve||[]).filter(x=>x&&isFinite(x[1])).sort((a,b)=>a[0]-b[0]),n=C.length;
  const tot=o.tot!=null?o.tot:(n?C[n-1][0]:0),none={rallies:[],core:[],thr:null,sm:[]};if(n<8)return none;
  const T=C.map(x=>x[0]),dts=[];for(let i=1;i<n;i++)dts.push(T[i]-T[i-1]);const dt=Math.max(1,dtPct(dts,.5)),k=Math.max(1,Math.round(o.smooth/2/dt));
  const S=dtSmooth(C.map(x=>x[1]),k),B=dtBase(T,S,o.base),D=Array.from(S,(v,i)=>v-B[i]);
  // contraste : sans écart net entre jeu et temps mort, on ne propose rien (tout reste gardé)
  const lo=dtPct(S,.1),hi=dtPct(S,.9),r=dtPct(D,.9)-dtPct(D,.1);if(!(hi>lo*o.contrast&&r>0))return Object.assign(none,{sm:D.map((v,i)=>[T[i],v])});
  const dl=dtPct(D,.05),dh=dtPct(D,.95),th=dtOtsu(D,dl,dh),up=th+.12*(dh-dl),dn=th-.12*(dh-dl);
  // hystérésis (entrée au-dessus de up, sortie sous dn) ; bornes placées au passage du seuil médian th, à mi-chemin
  // entre deux échantillons (le lissage étale les fronts : dn et up les décaleraient d'autant)
  let core=[],on=false,a=0,lo0=T[0],hi0=T[0];for(let i=0;i<n;i++){const v=D[i],mid=i+1<n?(T[i]+T[i+1])/2:T[i];
    if(!on){if(v<th)lo0=mid;if(v>=up){on=true;a=lo0;hi0=mid;}}else{if(v>=th)hi0=mid;if(v<dn){on=false;core.push([a,hi0]);lo0=mid;}}}
  if(on)core.push([a,T[n-1]]);
  // trous courts (ballon haut, temps faible) réunis, puis échanges trop courts (secousse, passage devant la caméra) retirés
  const J=[];core.forEach(c=>{const z=J[J.length-1];if(z&&c[0]-z[1]<o.minDead)z[1]=c[1];else J.push(c.slice());});
  core=J.filter(([x,y])=>y-x>=o.minRally);
  const R=[];core.forEach(([x,y])=>{const p=[Math.max(0,x-o.padA),Math.min(tot,y+o.padB)],z=R[R.length-1];if(z&&p[0]<=z[1])z[1]=p[1];else R.push(p);});
  return {rallies:R.map(x=>x.map(Math.round)),core:core.map(x=>x.map(Math.round)),thr:{th,up,dn},sm:D.map((v,i)=>[T[i],v])};}
// échanges gardés → r.cuts (bascules alternées, comme vSetCut / vcCuts) : temps morts jetés
function dtCuts(R,tot){const C=[];let k=1;const put=(t,v)=>{if(v!==k){C.push([Math.round(t),v]);k=v;}};
  const S=[];(R||[]).map(([a,b])=>[Math.max(0,a),Math.min(tot,b)]).filter(([a,b])=>b>a).sort((p,q)=>p[0]-q[0])
    .forEach(([a,b])=>{const z=S[S.length-1];if(z&&a<=z[1])z[1]=Math.max(z[1],b);else S.push([a,b]);});
  if(!S.length)return [[0,0]];if(S[0][0]>0)put(0,0);S.forEach(([a,b])=>{put(a,1);if(b<tot)put(b,0);});return C;}
// comparaison détection / vérité (tests, réglages) : recouvrement des durées et écarts des bornes appariées
function dtScore(det,truth){const ov=(A,B)=>A.reduce((s,[a,b])=>s+B.reduce((t,[c,d])=>t+Math.max(0,Math.min(b,d)-Math.max(a,c)),0),0),len=A=>A.reduce((s,[a,b])=>s+b-a,0);
  const pairs=truth.map(t=>{const d=det.filter(x=>Math.min(x[1],t[1])>Math.max(x[0],t[0]));return d.length===1?[t,d[0]]:null;});
  const err=pairs.filter(Boolean).map(([t,d])=>Math.max(Math.abs(d[0]-t[0]),Math.abs(d[1]-t[1])));
  return {recall:ov(truth,det)/Math.max(1,len(truth)),precision:ov(det,truth)/Math.max(1,len(det)),matched:err.length,n:truth.length,found:det.length,maxErr:err.length?Math.max(...err):null};}

// --- Partie navigateur -------------------------------------------------------------------------------------------------
// gris w×h → activité : écart absolu moyen avec l'image précédente dans la zone roi, après retrait de la luminosité moyenne
// (exposition auto) et au mieux de 9 décalages ±1 px (bougé de la caméra, trépied qui vibre)
function dtDiff(c,p,w,h,roi){const [x0,y0,x1,y1]=roi?[Math.round(roi[0]*w),Math.round(roi[1]*h),Math.round((roi[0]+roi[2])*w),Math.round((roi[1]+roi[3])*h)]:[0,0,w,h];
  const X0=Math.max(1,x0),Y0=Math.max(1,y0),X1=Math.min(w-1,x1),Y1=Math.min(h-1,y1);if(X1<=X0||Y1<=Y0)return 0;
  let mc=0,mp=0,n=0;for(let y=Y0;y<Y1;y++)for(let x=X0;x<X1;x++){mc+=c[y*w+x];mp+=p[y*w+x];n++;}mc/=n;mp/=n;
  let best=Infinity;for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){let s=0;for(let y=Y0;y<Y1;y++){const r=y*w,q=(y+dy)*w+dx;for(let x=X0;x<X1;x++)s+=Math.abs(c[r+x]-mc-p[q+x]+mp);}if(s<best)best=s;}
  return best/n;}
// lecture d'une tranche en accéléré : f(mediaTime s) à chaque image affichée (requestVideoFrameCallback, sinon requestAnimationFrame)
// → écart médian (s de vidéo) entre deux images affichées, qui règle la vitesse de la tranche suivante
function dtPlay(v,o,f){const G=[];let lm=null;const f2=mt=>{if(lm!=null&&mt>lm)G.push(mt-lm);lm=mt;f(mt);};
  return new Promise(ok=>{let done=false;const end=()=>{if(done)return;done=true;clearTimeout(to);v.onended=v.onerror=null;v.pause();G.sort((a,b)=>a-b);ok(G.length>2?G[G.length>>1]:null);};
  const to=setTimeout(end,o.max);v.onended=end;v.onerror=end;
  if(v.requestVideoFrameCallback){const cb=(now,md)=>{if(done)return;f2(md.mediaTime);v.requestVideoFrameCallback(cb);};v.requestVideoFrameCallback(cb);}
  else{const cb=()=>{if(done)return;f2(v.currentTime);requestAnimationFrame(cb);};requestAnimationFrame(cb);}
  v.playbackRate=o.rate;v.play().catch(end);});}
const dtReady=v=>v.readyState>=2?Promise.resolve():new Promise(ok=>{const d=()=>{v.removeEventListener('loadeddata',d);v.removeEventListener('error',d);ok();};v.addEventListener('loadeddata',d);v.addEventListener('error',d);setTimeout(d,5000);});
// segs = [{url, dur}] (tranches de l'enregistrement, dans l'ordre) ; o : fps, rate, w, h, roi [x,y,l,h] en fractions, ia (clip), onProgress(f)
// rate 'auto' : la plus grande vitesse qui garde ~fps images analysées par seconde de vidéo (bornée par l'affichage : 60 Hz → ~7×)
// → {curve, rallies, core, thr, dur, wall, speed (s de vidéo par s), n images, rate moyen}
async function dtAnalyze(segs,o){o=Object.assign({},DT,o||{});const w=o.w,h=o.h,cv=document.createElement('canvas');cv.width=w;cv.height=h;
  const ctx=cv.getContext('2d',{willReadFrequently:true}),mk=()=>{const v=document.createElement('video');v.muted=true;v.playsInline=true;v.preload='auto';return v;};
  const V=[mk(),mk()],t0=performance.now(),curve=[],ia=o.ia||0;let prev=null,last=-1e9,off=0,nf=0,cur=null,rate=o.rate==='auto'?4:+o.rate;const rs=[];
  const grab=pos=>{ctx.drawImage(cur,0,0,w,h);const d=ctx.getImageData(0,0,w,h).data,g=new Float32Array(w*h);for(let i=0;i<w*h;i++)g[i]=(d[i*4]*77+d[i*4+1]*150+d[i*4+2]*29)>>8;
    if(prev)curve.push([Math.round(pos),+dtDiff(g,prev,w,h,o.roi).toFixed(3)]);prev=g;nf++;};
  if(segs[0])V[0].src=segs[0].url;
  // deux lecteurs : la tranche suivante se charge pendant l'analyse de la tranche en cours
  for(let i=0;i<segs.length;i++){const v=V[i%2],nx=V[(i+1)%2],s=segs[i];if(segs[i+1]){nx.src=segs[i+1].url;nx.load();}
    await dtReady(v);cur=v;
    // image retenue dès 3/4 de l'intervalle visé (sinon, images tous les 100 ms pour 125 visés → une sur deux)
    const dm=await dtPlay(v,{rate,max:s.dur/rate*4+3000},mt=>{const pos=off+mt*1000-ia;if(pos-last<750/o.fps||pos<0)return;last=pos;grab(pos);});rs.push(rate);
    if(o.rate==='auto'&&dm)rate=Math.max(1,Math.min(16,rate*1.5,Math.max(rate*.6,rate/(dm*o.fps))));
    off+=s.dur;if(o.onProgress)o.onProgress((i+1)/segs.length);}
  V.forEach(v=>{v.removeAttribute('src');try{v.load();}catch(e){}});
  const tot=o.tot!=null?o.tot:off-ia,wall=(performance.now()-t0)/1000,res=dtClassify(curve,Object.assign({},o,{tot}));
  return Object.assign(res,{curve,dur:tot,wall,speed:tot/1000/wall,n:nf,rate:rs.length?rs.reduce((a,x)=>a+x,0)/rs.length:rate});}

if(typeof module!=='undefined')module.exports={vcActions,vcSegs,vcTot,vcPosOf,vcTimeAt,vcClips,vcClipRanges,vcCuts,vcEstimateOffset,DT,dtPct,dtSmooth,dtBase,dtOtsu,dtClassify,dtCuts,dtScore,dtDiff};
