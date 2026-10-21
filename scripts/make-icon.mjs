// Prépare les sources d'icônes et d'écran de démarrage pour @capacitor/assets à partir de icon-512.png.
// (Idéalement, remplacer assets/icon-only.png par une icône 1024 × 1024 dessinée en grand.)
import sharp from 'sharp';
import { mkdirSync } from 'node:fs';
mkdirSync('assets', { recursive: true });
const icon = sharp('icon-512.png');
await icon.clone().resize(1024, 1024).png().toFile('assets/icon-only.png');
const logo = await sharp('icon-512.png').resize(700, 700).png().toBuffer();
for (const [file, bg] of [['splash.png', '#FFFFFF'], ['splash-dark.png', '#14243D']]) {
  await sharp({ create: { width: 2732, height: 2732, channels: 4, background: bg } })
    .composite([{ input: logo, gravity: 'center' }]).png().toFile(`assets/${file}`);
}
console.log('assets/ prêt : icon-only.png, splash.png, splash-dark.png');
