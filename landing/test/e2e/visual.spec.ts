// 26. Visual: la landing conectada contra el boceto original, en 375 y 1440 px.
// Se ocultan en ambas versiones SOLO los cambios listados en la sección 3 (fecha, nota de
// consentimiento, footer); todo lo demás debe ser idéntico pixel a pixel.
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { expect, test, type Browser } from '@playwright/test';
import pixelmatch from 'pixelmatch';
import { PNG } from 'pngjs';

const BOCETO = new URL('../../design/boceto.html', import.meta.url).href;
const OUT = fileURLToPath(new URL('../../test-results/visual/', import.meta.url));

const MASK_CSS = `
  .eyebrow.warm { visibility: hidden !important; }
  .waitlist-note, footer { display: none !important; }
`;

async function shot(browser: Browser, url: string, width: number): Promise<PNG> {
  const context = await browser.newContext({ viewport: { width, height: 900 }, reducedMotion: 'reduce' });
  const page = await context.newPage();
  await page.goto(url);
  await page.addStyleTag({ content: MASK_CSS });
  await page.evaluate(() => document.fonts.ready);
  const png = PNG.sync.read(await page.screenshot({ fullPage: true }));
  await context.close();
  return png;
}

for (const width of [375, 1440]) {
  test(`26. visual ${width} px idéntico al boceto salvo los cambios listados`, async ({ browser, baseURL }) => {
    const before = await shot(browser, BOCETO, width);
    const after = await shot(browser, `${baseURL}/`, width);
    mkdirSync(OUT, { recursive: true });
    writeFileSync(`${OUT}boceto-${width}.png`, PNG.sync.write(before));
    writeFileSync(`${OUT}landing-${width}.png`, PNG.sync.write(after));

    expect.soft(after.height, 'alto de la página').toBe(before.height);
    const height = Math.min(before.height, after.height);
    const crop = (img: PNG) => {
      const out = new PNG({ width, height });
      PNG.bitblt(img, out, 0, 0, width, height, 0, 0);
      return out;
    };
    const diff = new PNG({ width, height });
    const changed = pixelmatch(crop(before).data, crop(after).data, diff.data, width, height, { threshold: 0.1 });
    writeFileSync(`${OUT}diff-${width}.png`, PNG.sync.write(diff));
    expect(changed, `pixeles distintos (ver test-results/visual/diff-${width}.png)`).toBe(0);
  });
}
