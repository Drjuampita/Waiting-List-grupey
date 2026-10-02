// Genera íconos y og.png PROVISIONALES desde la propia landing (JP aprueba los definitivos).
// Uso: con el servidor de pruebas en :3000 → npx tsx scripts/make-icons.ts
import { writeFile } from 'node:fs/promises';
import { chromium } from '@playwright/test';

const BASE = process.env.BASE_URL ?? 'http://localhost:3000';
const browser = await chromium.launch();

async function logoPng(size: number): Promise<Buffer> {
  const probe = await browser.newPage();
  await probe.goto(BASE);
  const box = (await probe.locator('.nav .logo-mark').boundingBox())!;
  await probe.close();
  // Recorte cuadrado centrado en la marca, escalado al tamaño pedido.
  const side = Math.max(box.width, box.height);
  const page = await browser.newPage({ deviceScaleFactor: size / side });
  await page.goto(BASE);
  const clip = { x: box.x + box.width / 2 - side / 2, y: box.y + box.height / 2 - side / 2, width: side, height: side };
  const png = await page.screenshot({ clip });
  await page.close();
  return png;
}

/** ICO con una sola imagen PNG embebida (válido desde Windows Vista y en todos los navegadores). */
function icoFromPng(png: Buffer, size: number): Buffer {
  const header = Buffer.alloc(22);
  header.writeUInt16LE(0, 0); // reservado
  header.writeUInt16LE(1, 2); // tipo: ícono
  header.writeUInt16LE(1, 4); // una imagen
  header.writeUInt8(size, 6); // ancho
  header.writeUInt8(size, 7); // alto
  header.writeUInt16LE(1, 10); // planos
  header.writeUInt16LE(32, 12); // bits por pixel
  header.writeUInt32LE(png.length, 14); // tamaño de la imagen
  header.writeUInt32LE(22, 18); // offset de la imagen
  return Buffer.concat([header, png]);
}

await writeFile('public/icon.png', await logoPng(512));
await writeFile('public/apple-touch-icon.png', await logoPng(180));
await writeFile('public/favicon.ico', icoFromPng(await logoPng(32), 32));

const og = await browser.newPage({ viewport: { width: 1200, height: 630 } });
await og.goto(BASE);
await og.evaluate(() => document.fonts.ready);
await writeFile('public/og.png', await og.screenshot());
await browser.close();
console.log('íconos y og.png generados');
