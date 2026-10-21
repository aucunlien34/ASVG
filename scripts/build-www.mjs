// Copie la webapp (fichiers servis par GitHub Pages) dans www/, dossier embarqué par Capacitor dans les applis natives.
// sw.js et version.json restent hors de l'appli : en natif, les mises à jour passent par les stores.
import { rmSync, mkdirSync, copyFileSync, existsSync } from 'node:fs';
const FILES = ['index.html', 'manifest.webmanifest', 'icon-192.png', 'icon-512.png'];
rmSync('www', { recursive: true, force: true });
mkdirSync('www');
for (const f of FILES) {
  if (!existsSync(f)) throw new Error(`Fichier manquant : ${f}`);
  copyFileSync(f, `www/${f}`);
}
console.log(`www/ prêt (${FILES.length} fichiers)`);
