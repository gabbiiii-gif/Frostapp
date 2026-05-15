// Gera ícones maskable PWA a partir do icon-192/512 existente.
// Spec maskable: arte fica dentro da safe zone (80% central). Fora dela
// pode ser cortado por launchers Android. Composita o ícone original (80%)
// sobre fundo theme_color para criar versões maskable corretas.
//
// Uso: node scripts/generate-maskable-icons.mjs

import sharp from 'sharp';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const BG = '#1e3a8a'; // theme_color do manifest

async function buildMaskable(srcPath, outPath, size) {
  // Safe zone maskable: arte central a 80% do canvas, padding 10% em volta.
  const innerSize = Math.round(size * 0.8);
  const padding = Math.round((size - innerSize) / 2);

  const innerBuf = await sharp(srcPath)
    .resize(innerSize, innerSize, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toBuffer();

  await sharp({
    create: {
      width: size,
      height: size,
      channels: 4,
      background: BG,
    },
  })
    .composite([{ input: innerBuf, top: padding, left: padding }])
    .png()
    .toFile(outPath);

  console.log(`✓ ${outPath} (${size}x${size}, art ${innerSize}px centrado, bg ${BG})`);
}

async function main() {
  const src192 = resolve(ROOT, 'public/icon-192.png');
  const src512 = resolve(ROOT, 'public/icon-512.png');
  const out192 = resolve(ROOT, 'public/icon-192-maskable.png');
  const out512 = resolve(ROOT, 'public/icon-512-maskable.png');

  // Sanity check: verifica que fontes existem
  readFileSync(src192);
  readFileSync(src512);

  await buildMaskable(src512, out192, 192);
  await buildMaskable(src512, out512, 512);
}

main().catch((e) => { console.error(e); process.exit(1); });
