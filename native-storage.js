// Copie native des données de l'appli (iOS / Android).
// Le stockage du navigateur (localStorage) peut être vidé par le système, en particulier sur iPhone
// quand l'espace manque. Chaque écriture est donc recopiée dans un fichier de l'appli, et au démarrage
// le fichier restaure localStorage s'il est plus récent. Deux fichiers sont écrits en alternance :
// si une écriture est interrompue, l'autre reste lisible.
// Ce script s'exécute avant l'appli, qui est lancée une fois la restauration terminée.
(function () {
  'use strict';
  var C = window.Capacitor;
  var NATIVE = !!(C && typeof C.isNativePlatform === 'function' && C.isNativePlatform());
  var STAMP = 'vc-native-stamp';
  var DIR = 'DATA';
  var SLOTS = ['volleycoach/store-a.json', 'volleycoach/store-b.json'];
  var FORMAT = 'volleycoach-native-store';

  // Le script de l'appli suit celui-ci dans la page : on attend qu'il soit lu avant de le lancer
  function startApp() {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', startApp, { once: true });
      return;
    }
    var tpl = document.getElementById('vc-app');
    var s = document.createElement('script');
    s.textContent = tpl.textContent;
    try { tpl.replaceWith(s); } finally { hideSplash(); }
  }

  // L'écran de démarrage natif reste affiché jusqu'au premier affichage de l'appli
  function hideSplash() {
    var SS = C && C.Plugins && C.Plugins.SplashScreen;
    if (SS) requestAnimationFrame(function () { SS.hide().catch(function () {}); });
  }

  var FS = NATIVE && C.Plugins && C.Plugins.Filesystem;
  if (!FS) { startApp(); return; }

  var ls = window.localStorage;
  var proto = Object.getPrototypeOf(ls);
  var rawSet = proto.setItem, rawRemove = proto.removeItem, rawClear = proto.clear;
  var stamp = 0;        // numéro de la dernière version connue, toujours croissant
  var nextSlot = 0;     // fichier à écrire au prochain enregistrement
  var timer = null, writing = null, dirty = false, warned = false;

  function lsStamp() { var n = Number(rawGet(STAMP)); return isFinite(n) ? n : 0; }
  function rawGet(k) { try { return ls.getItem(k); } catch (e) { return null; } }

  function snapshot() {
    var items = {};
    for (var i = 0; i < ls.length; i++) {
      var k = ls.key(i);
      if (k !== STAMP) items[k] = ls.getItem(k);
    }
    return items;
  }

  async function readSlot(i) {
    try {
      var r = await FS.readFile({ path: SLOTS[i], directory: DIR, encoding: 'utf8' });
      var j = JSON.parse(r.data);
      if (j && j.format === FORMAT && typeof j.stamp === 'number' && j.items && typeof j.items === 'object') return j;
    } catch (e) { /* fichier absent ou illisible */ }
    return null;
  }

  async function writeNow() {
    dirty = false;
    var body = JSON.stringify({ format: FORMAT, stamp: stamp, savedAt: new Date().toISOString(), items: snapshot() });
    var slot = nextSlot;
    await FS.writeFile({ path: SLOTS[slot], directory: DIR, encoding: 'utf8', data: body, recursive: true });
    // Relecture : on ne bascule de fichier qu'après une écriture vérifiée
    var check = await readSlot(slot);
    if (!check || check.stamp !== stamp) throw new Error('relecture incorrecte');
    nextSlot = 1 - slot;
  }

  function flush() {
    if (timer) { clearTimeout(timer); timer = null; }
    if (writing) { dirty = true; return writing; }
    writing = writeNow().catch(function (e) {
      dirty = true;
      if (!warned && typeof window.toast === 'function') {
        warned = true;
        window.toast('Copie de sécurité impossible sur cet appareil : exportez vos données', 'warn');
      }
      console.error('native-storage', e);
    }).then(function () {
      writing = null;
      if (dirty) schedule();
    });
    return writing;
  }

  function schedule() { if (!timer) timer = setTimeout(flush, 250); }

  // Chaque modification de localStorage reçoit un numéro de version, écrit tout de suite (synchrone),
  // puis la copie fichier suit. Après un rechargement, le plus grand numéro l'emporte.
  function touched() {
    stamp = Math.max(Date.now(), stamp + 1);
    try { rawSet.call(ls, STAMP, String(stamp)); } catch (e) { /* stockage plein */ }
    schedule();
  }
  proto.setItem = function (k, v) { rawSet.call(this, k, v); if (this === ls && k !== STAMP) touched(); };
  proto.removeItem = function (k) { rawRemove.call(this, k); if (this === ls && k !== STAMP) touched(); };
  proto.clear = function () { rawClear.call(this); if (this === ls) touched(); };

  async function boot() {
    var a = await readSlot(0), b = await readSlot(1);
    var best = a && (!b || a.stamp >= b.stamp) ? a : b;
    if (best) nextSlot = best === a ? 1 : 0;
    var local = lsStamp();
    if (best && best.stamp > local) {
      // localStorage vidé ou plus ancien : on restaure depuis le fichier
      rawClear.call(ls);
      Object.keys(best.items).forEach(function (k) { rawSet.call(ls, k, best.items[k]); });
      rawSet.call(ls, STAMP, String(best.stamp));
      stamp = best.stamp;
      console.info('native-storage : données restaurées depuis la copie du ' + best.savedAt);
    } else {
      stamp = Math.max(local, best ? best.stamp : 0);
      // Données locales plus récentes que le fichier, ou jamais copiées : on met le fichier à jour
      if (best ? local > best.stamp : ls.length > 0) touched();
    }
  }

  var App = C.Plugins.App;
  if (App && App.addListener) App.addListener('pause', flush);
  document.addEventListener('visibilitychange', function () { if (document.hidden) flush(); });

  boot().catch(function (e) { console.error('native-storage', e); }).then(startApp);

  window.VCNativeStore = { flush: flush, slots: SLOTS, read: function () { return Promise.all([readSlot(0), readSlot(1)]); } };
})();
