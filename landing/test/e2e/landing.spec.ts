import { readFileSync, readdirSync } from 'node:fs';
import { expect, test, type Page, type Route } from '@playwright/test';
import { adminQuery } from '../helpers';

const unique = (tag: string) => `e2e-${tag}-${Date.now()}-${Math.floor(Math.random() * 1e6)}@example.com`;
const rowsFor = async (email: string) =>
  (await adminQuery('select * from waitlist.signups where email_normalized = $1', [email.toLowerCase()])).rows;

const hero = (page: Page) => page.locator('form[data-waitlist="hero"]');
const cierre = (page: Page) => page.locator('form[data-waitlist="cierre"]');
const errorOf = (page: Page, which: 'hero' | 'cierre') =>
  page.locator(`form[data-waitlist="${which}"] ~ .waitlist-error`);

function mockApi(page: Page, status: number, code: string, headers: Record<string, string> = {}) {
  return page.route('**/api/pre-register', (route) =>
    route.fulfill({ status, contentType: 'application/json', headers, body: JSON.stringify({ ok: status === 200, code }) }),
  );
}

test.describe('19. éxito', () => {
  for (const which of ['hero', 'cierre'] as const) {
    test(`formulario ${which}`, async ({ page }) => {
      const email = unique(which);
      await page.goto('/?utm_source=instagram&utm_campaign=lanzamiento');
      let release!: () => void;
      const gate = new Promise<void>((r) => (release = r));
      await page.route('**/api/pre-register', async (route: Route) => {
        await gate;
        await route.continue();
      });
      const form = which === 'hero' ? hero(page) : cierre(page);
      await form.locator('input[name="email"]').fill(email);
      await form.locator('button[type="submit"]').click();

      // Enviando: botón deshabilitado, aria-busy y .is-sending; la etiqueta no cambia.
      const button = form.locator('button[type="submit"]');
      await expect(button).toBeDisabled();
      await expect(button).toHaveAttribute('aria-busy', 'true');
      await expect(button).toHaveText('Únete a la lista');
      await expect(form).toHaveClass(/is-sending/);
      release();

      // Ambos formularios pasan a la confirmación del boceto.
      await expect(page.locator('.waitlist-ok')).toHaveCount(2);
      for (const ok of await page.locator('.waitlist-ok').all()) {
        await expect(ok).toBeVisible();
        await expect(ok).toHaveText('✓ ¡Listo! Cuando Grupey abra, tú entras primero.');
      }
      await expect(hero(page)).toBeHidden();
      await expect(cierre(page)).toBeHidden();
      await expect(form.locator('xpath=following-sibling::div[contains(@class,"waitlist-ok")]')).toBeFocused();

      const [row] = await rowsFor(email);
      expect(row.form).toBe(which);
      expect(row.utm_source).toBe('instagram');
      expect(row.utm_campaign).toBe('lanzamiento');
      expect(row.landing_path).toBe('/');
    });
  }
});

test.describe('20. errores', () => {
  test('400 invalid_email: mensaje, conserva el correo y foco al input', async ({ page }) => {
    await page.goto('/');
    await mockApi(page, 400, 'invalid_email');
    const input = hero(page).locator('input[name="email"]');
    await input.fill('ana@example.com');
    await hero(page).locator('button').click();
    await expect(errorOf(page, 'hero')).toHaveText('Revisa tu correo: parece que algo no está bien escrito.');
    await expect(errorOf(page, 'hero')).toHaveAttribute('role', 'alert');
    await expect(input).toHaveValue('ana@example.com');
    await expect(input).toBeFocused();
    await expect(hero(page).locator('button')).toBeEnabled();
  });

  test('429: mensaje y el botón vuelve al vencer Retry-After, sin reintento automático', async ({ page }) => {
    await page.goto('/');
    let calls = 0;
    await page.route('**/api/pre-register', (route) => {
      calls += 1;
      return route.fulfill({ status: 429, contentType: 'application/json', headers: { 'Retry-After': '1' }, body: '{"ok":false,"code":"rate_limited"}' });
    });
    await hero(page).locator('input[name="email"]').fill('ana@example.com');
    await hero(page).locator('button').click();
    await expect(errorOf(page, 'hero')).toHaveText('Demasiados intentos seguidos. Prueba de nuevo en un minuto.');
    await expect(hero(page).locator('button')).toBeDisabled();
    await expect(hero(page).locator('button')).toBeEnabled({ timeout: 3000 });
    expect(calls).toBe(1);
  });

  test('503 dos veces: mensaje, botón activo y contacto tras el 2.º fallo; luego el reintento funciona', async ({ page }) => {
    await page.goto('/');
    await mockApi(page, 503, 'service_unavailable', { 'Retry-After': '30' });
    const input = hero(page).locator('input[name="email"]');
    const email = unique('retry');
    await input.fill(email);
    await hero(page).locator('button').click();
    await expect(errorOf(page, 'hero')).toHaveText('No pudimos guardar tu correo. Intenta de nuevo.');
    await expect(hero(page).locator('button')).toBeEnabled();
    await hero(page).locator('button').click();
    await expect(errorOf(page, 'hero')).toContainText('Si sigue fallando, escríbenos a hola@grupey.com y te anotamos.');
    await expect(errorOf(page, 'hero').locator('a')).toHaveAttribute('href', 'mailto:hola@grupey.com');
    await expect(input).toHaveValue(email);

    await page.unroute('**/api/pre-register');
    await hero(page).locator('button').click();
    await expect(page.locator('.waitlist-ok').first()).toBeVisible();
    expect(await rowsFor(email)).toHaveLength(1);
  });

  test('respuesta que no es JSON se trata como 500', async ({ page }) => {
    await page.goto('/');
    await page.route('**/api/pre-register', (r) => r.fulfill({ status: 502, contentType: 'text/html', body: '<h1>Bad gateway</h1>' }));
    await hero(page).locator('input[name="email"]').fill('ana@example.com');
    await hero(page).locator('button').click();
    await expect(errorOf(page, 'hero')).toHaveText('No pudimos guardar tu correo. Intenta de nuevo.');
  });

  test('403/415: "Recarga la página"', async ({ page }) => {
    await page.goto('/');
    await mockApi(page, 403, 'forbidden_origin');
    await cierre(page).locator('input[name="email"]').fill('ana@example.com');
    await cierre(page).locator('button').click();
    await expect(errorOf(page, 'cierre')).toHaveText('Algo salió mal. Recarga la página e intenta de nuevo.');
  });

  test('red caída: un reintento automático a los 2 s y luego error', async ({ page }) => {
    await page.goto('/');
    const times: number[] = [];
    await page.route('**/api/pre-register', (route) => {
      times.push(Date.now());
      return route.abort('internetdisconnected');
    });
    await hero(page).locator('input[name="email"]').fill('ana@example.com');
    await hero(page).locator('button').click();
    await expect(errorOf(page, 'hero')).toHaveText('No pudimos guardar tu correo. Intenta de nuevo.', { timeout: 6000 });
    expect(times).toHaveLength(2);
    expect(times[1] - times[0]).toBeGreaterThanOrEqual(1900);
    await expect(hero(page).locator('input[name="email"]')).toHaveValue('ana@example.com');
  });

  test('timeout de 10 s: reintento y error', async ({ page }) => {
    test.setTimeout(45_000);
    await page.goto('/');
    let calls = 0;
    await page.route('**/api/pre-register', () => {
      calls += 1; // nunca responde
    });
    await hero(page).locator('input[name="email"]').fill('ana@example.com');
    await hero(page).locator('button').click();
    await expect(errorOf(page, 'hero')).toHaveText('No pudimos guardar tu correo. Intenta de nuevo.', { timeout: 30_000 });
    expect(calls).toBe(2);
    await expect(hero(page).locator('button')).toBeEnabled();
  });
});

test('21. refresh tras registrarse: el formulario vuelve y reenviar no duplica', async ({ page }) => {
  const email = unique('refresh');
  await page.goto('/');
  await hero(page).locator('input[name="email"]').fill(email);
  await hero(page).locator('button').click();
  await expect(page.locator('.waitlist-ok').first()).toBeVisible();
  await page.reload();
  await expect(hero(page)).toBeVisible();
  await hero(page).locator('input[name="email"]').fill(email.toUpperCase());
  await hero(page).locator('button').click();
  await expect(page.locator('.waitlist-ok').first()).toBeVisible();
  const rows = await rowsFor(email);
  expect(rows).toHaveLength(1);
  expect(rows[0].attempts).toBe(2);
});

for (const width of [375, 390]) {
  test(`22. mobile ${width} px`, async ({ browser }) => {
    const context = await browser.newContext({ viewport: { width, height: 800 }, isMobile: true, hasTouch: true });
    const page = await context.newPage();
    await page.goto('/');
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow).toBeLessThanOrEqual(0);
    for (const form of [hero(page), cierre(page)]) {
      const input = form.locator('input[name="email"]');
      await expect(input).toHaveAttribute('type', 'email');
      await expect(input).toHaveAttribute('autocomplete', 'email');
      await expect(input).toHaveAttribute('inputmode', 'email');
      const box = await form.locator('button').boundingBox();
      expect(box!.height).toBeGreaterThanOrEqual(44);
    }
    const smallest = await page.evaluate(() => {
      let min = Infinity;
      document.querySelectorAll('p, a, li, button, input, summary, h1, h2, h3').forEach((el) => {
        if ((el as HTMLElement).offsetParent === null) return;
        min = Math.min(min, parseFloat(getComputedStyle(el).fontSize));
      });
      return min;
    });
    expect(smallest).toBeGreaterThanOrEqual(10);
    await context.close();
  });
}

test('23. sin JavaScript: todo visible, envío a /gracias y el correo nunca en la URL', async ({ browser }) => {
  const context = await browser.newContext({ javaScriptEnabled: false });
  const page = await context.newPage();
  await page.goto('/');
  const hidden = await page.locator('.reveal').evaluateAll((els) => els.filter((e) => getComputedStyle(e).opacity !== '1').length);
  expect(hidden).toBe(0);
  const email = unique('nojs');
  const urls: string[] = [];
  page.on('framenavigated', (f) => urls.push(f.url()));
  await hero(page).locator('input[name="email"]').fill(email);
  await hero(page).locator('button').click();
  await page.waitForURL('**/gracias');
  await expect(page.locator('h1')).toHaveText('¡Listo!');
  expect(urls.some((u) => u.includes(encodeURIComponent(email)) || u.includes(email))).toBe(false);
  expect(await rowsFor(email)).toHaveLength(1);
  await context.close();
});

test('24. CSP de producción: sin violaciones, fuentes y textura presentes', async ({ page }) => {
  const violations: string[] = [];
  page.on('console', (m) => {
    if (/Content Security Policy|Refused to/i.test(m.text())) violations.push(m.text());
  });
  const res = await page.goto('/');
  expect(res!.headers()['content-security-policy']).toContain("script-src 'self'");
  await page.evaluate(() => document.fonts.ready);
  const loaded = await page.evaluate(async () => {
    await Promise.all([
      document.fonts.load('400 16px Fraunces'), document.fonts.load('400 16px Inter'), document.fonts.load('600 16px Poppins'),
    ]);
    return [...document.fonts].filter((f) => f.status === 'loaded').map((f) => f.family.replace(/["']/g, ''));
  });
  for (const family of ['Fraunces', 'Inter', 'Poppins']) expect(loaded).toContain(family);
  const texture = await page.evaluate(() => getComputedStyle(document.body, '::before').backgroundImage);
  expect(texture).toContain('data:image/svg+xml');
  await hero(page).locator('input[name="email"]').fill(unique('csp'));
  await hero(page).locator('button').click();
  await expect(page.locator('.waitlist-ok').first()).toBeVisible();
  expect(violations).toEqual([]);
});

test('25. links: sin "#" vacíos, anclas existentes, rutas internas 200 y sin URLs de otros ambientes', async ({ page, request }) => {
  await page.goto('/');
  const hrefs = await page.locator('a[href]').evaluateAll((as) => as.map((a) => a.getAttribute('href')!));
  expect(hrefs).not.toContain('#');
  for (const href of hrefs) {
    if (href.startsWith('#')) {
      expect(await page.locator(href).count(), href).toBe(1);
    } else if (href.startsWith('/')) {
      expect((await request.get(href)).status(), href).toBe(200);
    } else if (href.startsWith('mailto:')) {
      expect(href).toBe('mailto:hola@grupey.com');
    } else {
      expect(href).toMatch(/^https:\/\//);
      const rel = await page.locator(`a[href="${href}"]`).first().getAttribute('rel');
      expect(rel).toContain('noopener');
    }
  }
  for (const path of ['/gracias', '/registro-error', '/privacidad', '/robots.txt', '/sitemap.xml', '/favicon.ico', '/og.png']) {
    expect((await request.get(path)).status(), path).toBe(200);
  }
  const missing = await request.get('/no-existe');
  expect(missing.status()).toBe(404);
  expect(await missing.text()).toContain('href="/"');

  const publicDir = new URL('../../public/', import.meta.url);
  for (const file of readdirSync(publicDir).filter((f) => /\.(html|js|css|txt|xml)$/.test(f))) {
    const text = readFileSync(new URL(file, publicDir), 'utf8');
    expect(text, file).not.toMatch(/localhost|127\.0\.0\.1|\.vercel\.app/);
  }
});
