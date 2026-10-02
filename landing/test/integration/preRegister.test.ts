import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:net';
import { before, beforeEach, describe, test } from 'node:test';
import pg from 'pg';
import { loadConfig } from '../../lib/config';
import { createDatabase } from '../../lib/db';
import { createHealthHandler } from '../../lib/health';
import { createPreRegisterHandler } from '../../lib/preRegister';
import { createMemoryLimiters, type Limiter } from '../../lib/rateLimit';
import {
  ADMIN_URL, BASE_ENV, ORIGIN, PRIVACY_VERSION, WRITER_PASSWORD, adminQuery, call, makeApp, postJson,
  resetDatabase, rows, testConfig, writerUrl,
} from '../helpers';

const body = (email: string, extra: Record<string, unknown> = {}) => ({ email, form: 'hero', website: '', ...extra });

before(resetDatabase);
beforeEach(() => adminQuery('truncate waitlist.signups'));

describe('API + base', () => {
  test('3. camino feliz', async () => {
    const { handle, logs } = makeApp();
    const { status, json, res } = await call(handle, postJson(body('Ana@Example.com', {
      utm_source: 'instagram', referrer_host: 'l.instagram.com', landing_path: '/',
    })));
    assert.equal(status, 200);
    assert.equal(json?.ok, true);
    assert.equal(json?.code, 'registered');
    assert.equal(res.headers.get('cache-control'), 'no-store');
    assert.ok(res.headers.get('x-request-id'));
    const [row] = await rows('ana@example.com');
    assert.equal(row.email, 'Ana@Example.com');
    assert.equal(row.source, 'landing');
    assert.equal(row.form, 'hero');
    assert.equal(row.privacy_version, PRIVACY_VERSION);
    assert.equal(row.marketing_consent, false);
    assert.equal(row.utm_source, 'instagram');
    assert.equal(row.referrer_host, 'l.instagram.com');
    assert.ok(row.consented_at instanceof Date);
    const line = logs.find((l) => l.msg === 'pre_register')!;
    assert.equal(line.inserted, true);
    assert.match(String(line.email_hmac), /^[0-9a-f]{16}$/);
    assert.ok(!JSON.stringify(logs).includes('example.com'), 'el log no contiene el correo');
  });

  test('4. duplicado con mayúsculas y espacios: 1 fila, attempts = 2, UTM originales', async () => {
    const { handle } = makeApp();
    await call(handle, postJson(body('ana@example.com', { utm_source: 'instagram', form: 'hero' })));
    const second = await call(handle, postJson(body('  ANA@Example.COM ', { utm_source: 'tiktok', form: 'cierre' })));
    assert.equal(second.status, 200);
    assert.equal(second.json?.code, 'registered');
    const all = await rows();
    assert.equal(all.length, 1);
    assert.equal(all[0].attempts, 2);
    assert.equal(all[0].utm_source, 'instagram');
    assert.equal(all[0].form, 'hero');
    assert.equal(all[0].email, 'ana@example.com');
  });

  test('5. doble clic: dos requests casi simultáneas → 1 fila', async () => {
    const { handle } = makeApp();
    const results = await Promise.all([1, 2].map(() => call(handle, postJson(body('doble@example.com')))));
    assert.deepEqual(results.map((r) => r.status), [200, 200]);
    assert.equal((await rows()).length, 1);
  });

  test('6. concurrencia: 20 requests simultáneas → 1 fila, attempts = 20', async () => {
    const config = testConfig({ RATE_LIMIT_IP_PER_MINUTE: '1000', RATE_LIMIT_EMAIL_PER_DAY: '1000' });
    // Varias instancias (cada una con su propio pool), como en serverless.
    const apps = Array.from({ length: 5 }, () => makeApp({ config }));
    const results = await Promise.all(
      Array.from({ length: 20 }, (_, i) => call(apps[i % 5].handle, postJson(body('concurrente@example.com')))),
    );
    assert.ok(results.every((r) => r.status === 200));
    const all = await rows();
    assert.equal(all.length, 1);
    assert.equal(all[0].attempts, 20);
  });

  test('7. correos inválidos → 400 invalid_email y 0 filas', async () => {
    const { handle } = makeApp();
    for (const email of ['', 'ana', 'ana@', 'a'.repeat(300), '<script>alert(1)</script>', "'; DROP TABLE waitlist.signups; --"]) {
      const { status, json } = await call(handle, postJson(body(email)));
      assert.equal(status, 400, email);
      assert.equal(json?.code, 'invalid_email');
    }
    assert.equal((await rows()).length, 0);
  });

  test('8. requests malas', async () => {
    const { handle } = makeApp();
    let r = await call(handle, postJson(null, { raw: '{"email":' }));
    assert.deepEqual([r.status, r.json?.code], [400, 'invalid_request']);
    r = await call(handle, postJson({ form: 'hero' }));
    assert.deepEqual([r.status, r.json?.code], [400, 'invalid_request']);
    r = await call(handle, postJson(['ana@example.com']));
    assert.deepEqual([r.status, r.json?.code], [400, 'invalid_request']);
    r = await call(handle, postJson(body('ana@example.com'), { contentType: 'text/plain' }));
    assert.deepEqual([r.status, r.json?.code], [415, 'unsupported_media_type']);
    r = await call(handle, postJson(body('ana@example.com', { pad: 'x'.repeat(9000) })));
    assert.deepEqual([r.status, r.json?.code], [413, 'payload_too_large']);
    r = await call(handle, new Request('http://localhost:3000/api/pre-register', { method: 'GET' }));
    assert.deepEqual([r.status, r.json?.code], [405, 'method_not_allowed']);
    assert.equal(r.res.headers.get('allow'), 'POST');
    r = await call(handle, new Request('http://localhost:3000/api/pre-register', { method: 'OPTIONS', headers: { origin: ORIGIN } }));
    assert.equal(r.status, 405);
    assert.equal(r.res.headers.get('access-control-allow-origin'), null);
    assert.equal((await rows()).length, 0);

    r = await call(handle, postJson(body('form@example.com', { form: 'footer' })));
    assert.equal(r.status, 200);
    assert.equal((await rows('form@example.com'))[0].form, null);

    r = await call(handle, postJson(body('utm@example.com', {
      utm_source: 'x'.repeat(1000), ref: 'r'.repeat(500), landing_path: 'sin-slash', referrer_host: 'no valido!',
    })));
    assert.equal(r.status, 200);
    const [row] = await rows('utm@example.com');
    assert.equal(row.utm_source.length, 200);
    assert.equal(row.ref.length, 100);
    assert.equal(row.landing_path, '/');
    assert.equal(row.referrer_host, null);
  });

  test('9. Origin ausente o ajeno con configuración de producción → 403 y 0 filas', async () => {
    // Lista de orígenes de producción; la base sigue siendo la local de pruebas.
    const config = { ...testConfig({ ALLOWED_ORIGINS: 'https://grupey.com' }), env: 'production' as const };
    const { handle } = makeApp({ config, limiters: createMemoryLimiters(config) });
    for (const origin of [null, 'https://evil.example', 'https://grupey.com.evil.example']) {
      const { status, json } = await call(handle, postJson(body('origin@example.com'), { origin }));
      assert.deepEqual([status, json?.code], [403, 'forbidden_origin'], String(origin));
    }
    assert.equal((await rows()).length, 0);
    const ok = await call(handle, postJson(body('origin@example.com'), { origin: 'https://grupey.com' }));
    assert.equal(ok.status, 200);
  });

  test('10. honeypot lleno → 200 registered, 0 filas, log honeypot=true', async () => {
    const { handle, logs } = makeApp();
    const { status, json } = await call(handle, postJson(body('bot@example.com', { website: 'http://spam' })));
    assert.deepEqual([status, json?.code], [200, 'registered']);
    assert.equal((await rows()).length, 0);
    assert.equal(logs.find((l) => l.msg === 'pre_register')?.honeypot, true);
  });

  test('11. rate limit por IP (21/min) y por correo (11/día)', async () => {
    const { handle } = makeApp();
    for (let i = 0; i < 20; i++) {
      const r = await call(handle, postJson(body(`ip${i}@example.com`), { ip: '203.0.113.7' }));
      assert.equal(r.status, 200);
    }
    const blocked = await call(handle, postJson(body('ip20@example.com'), { ip: '203.0.113.7' }));
    assert.deepEqual([blocked.status, blocked.json?.code], [429, 'rate_limited']);
    assert.ok(Number(blocked.res.headers.get('retry-after')) >= 1);

    for (let i = 0; i < 10; i++) {
      assert.equal((await call(handle, postJson(body('mismo@example.com')))).status, 200);
    }
    const byEmail = await call(handle, postJson(body('MISMO@example.com')));
    assert.equal(byEmail.status, 429);
    assert.ok(byEmail.res.headers.get('retry-after'));
  });

  test('12. Upstash caído o lento → fail-open con log warn', async () => {
    const config = testConfig();
    const down: Limiter = { limit: () => Promise.reject(new Error('ECONNREFUSED')) };
    const slow: Limiter = { limit: () => new Promise((r) => setTimeout(() => r({ success: false, reset: 0 }), 2000)) };
    for (const limiter of [down, slow]) {
      const { handle, logs } = makeApp({ config, limiters: { ip: limiter, email: limiter } });
      const started = Date.now();
      const r = await call(handle, postJson(body(`failopen${Date.now()}@example.com`)));
      assert.equal(r.status, 200);
      assert.ok(Date.now() - started < 1500);
      assert.ok(logs.some((l) => l.level === 'warn' && l.msg === 'rate_limit_fail_open'));
    }
  });

  test('13. base caída → 503; base que no responde → 504 en menos de 6 s', async () => {
    const downConfig = testConfig({ DATABASE_URL: 'postgresql://waitlist_writer:x@127.0.0.1:1/postgres' });
    const down = makeApp({ config: downConfig });
    const r1 = await call(down.handle, postJson(body('down@example.com')));
    assert.deepEqual([r1.status, r1.json?.code], [503, 'service_unavailable']);
    assert.equal(r1.res.headers.get('retry-after'), '30');

    const sockets = new Set<import('node:net').Socket>();
    const silent: Server = createServer((s) => sockets.add(s));
    await new Promise<void>((r) => silent.listen(0, '127.0.0.1', r));
    const port = (silent.address() as { port: number }).port;
    try {
      const slowConfig = testConfig({ DATABASE_URL: `postgresql://waitlist_writer:x@127.0.0.1:${port}/postgres` });
      const slow = makeApp({ config: slowConfig });
      const started = Date.now();
      const r2 = await call(slow.handle, postJson(body('slow@example.com')));
      assert.deepEqual([r2.status, r2.json?.code], [504, 'timeout']);
      assert.ok(Date.now() - started < 6000);
      assert.ok(!JSON.stringify(slow.logs).includes('slow@example.com'));
    } finally {
      for (const s of sockets) s.destroy();
      silent.close();
    }
  });

  test('14. permisos: anon/authenticated sin acceso; writer solo ejecuta la función', async () => {
    const asRole = async (role: string, sql: string) => {
      const client = new pg.Client({ connectionString: ADMIN_URL });
      await client.connect();
      try {
        await client.query('begin');
        await client.query(`set local role ${role}`);
        await client.query(sql);
        return 'ok';
      } catch (err) {
        return (err as { code?: string }).code;
      } finally {
        await client.query('rollback').catch(() => {});
        await client.end();
      }
    };
    const call12 = "select waitlist.pre_register('a@b.co','a@b.co',null,null,null,null,null,null,null,null,'/','v')";
    for (const role of ['anon', 'authenticated', 'service_role']) {
      assert.equal(await asRole(role, 'select * from waitlist.signups'), '42501', role);
      assert.equal(await asRole(role, "insert into waitlist.signups (email, email_normalized, privacy_version) values ('a@b.co','a@b.co','v')"), '42501', role);
      assert.equal(await asRole(role, call12), '42501', role);
    }
    const writer = new pg.Client({ connectionString: writerUrl() });
    await writer.connect();
    try {
      for (const sql of [
        'select * from waitlist.signups',
        "insert into waitlist.signups (email, email_normalized, privacy_version) values ('a@b.co','a@b.co','v')",
        "update waitlist.signups set status = 'active'",
        'delete from waitlist.signups',
      ]) {
        await assert.rejects(writer.query(sql), (e: { code?: string }) => e.code === '42501', sql);
      }
      const { rows: r } = await writer.query(call12);
      assert.equal(r[0].pre_register, true);
    } finally {
      await writer.end();
    }
  });

  test('15. configuración de producción inválida → 503 en toda request', async () => {
    const cases = [
      { ...BASE_ENV, VERCEL_ENV: 'production', DATABASE_URL: writerUrl(), ALLOWED_ORIGINS: 'https://grupey.com' }, // sin Upstash
      { ...BASE_ENV, VERCEL_ENV: 'production', DATABASE_URL: writerUrl(), ALLOWED_ORIGINS: 'https://grupey.com', UPSTASH_REDIS_REST_URL: 'u', UPSTASH_REDIS_REST_TOKEN: 't' }, // base en localhost
      { ...BASE_ENV, VERCEL_ENV: 'production', DATABASE_URL: 'postgresql://u:p@db.example.com:6543/postgres', ALLOWED_ORIGINS: 'https://grupey.vercel.app', UPSTASH_REDIS_REST_URL: 'u', UPSTASH_REDIS_REST_TOKEN: 't' },
      { ...BASE_ENV, DATABASE_URL: writerUrl(), LOG_HASH_SECRET: 'corto' },
    ];
    for (const env of cases) {
      const config = loadConfig(env, () => 'CA');
      assert.equal(config.ok, false);
      const handle = createPreRegisterHandler({ config, db: null, limiters: null, log: () => {} });
      for (const req of [postJson(body('cfg@example.com')), new Request('http://localhost/api/pre-register')]) {
        const r = await call(handle, req);
        assert.deepEqual([r.status, r.json?.code], [503, 'service_unavailable']);
      }
    }
    assert.equal((await rows()).length, 0);
  });

  test('16. baja y re-registro: vuelve a active con consentimiento nuevo', async () => {
    const { handle } = makeApp();
    await call(handle, postJson(body('baja@example.com')));
    await adminQuery("update waitlist.signups set status = 'unsubscribed', consented_at = now() - interval '1 day', privacy_version = 'vieja' where email_normalized = 'baja@example.com'");
    const before = (await rows('baja@example.com'))[0];
    await call(handle, postJson(body('baja@example.com')));
    const [row] = await rows('baja@example.com');
    assert.equal(row.status, 'active');
    assert.ok(row.consented_at > before.consented_at);
    assert.equal(row.privacy_version, PRIVACY_VERSION);
    assert.ok(row.updated_at >= before.updated_at);
  });

  test('17. ARCO: el delete documentado borra y el correo se puede volver a registrar', async () => {
    const { handle } = makeApp();
    await call(handle, postJson(body('arco@example.com')));
    await adminQuery("delete from waitlist.signups where email_normalized = 'arco@example.com'");
    assert.equal((await rows('arco@example.com')).length, 0);
    await call(handle, postJson(body('arco@example.com')));
    const [row] = await rows('arco@example.com');
    assert.equal(row.attempts, 1);
  });

  test('18. sin JS (form-encoded): éxito → 303 /gracias; error → 303 /registro-error', async () => {
    const { handle } = makeApp();
    const form = (fields: Record<string, string>) => postJson(null, {
      contentType: 'application/x-www-form-urlencoded',
      raw: new URLSearchParams(fields).toString(),
    });
    let r = await call(handle, form({ email: 'nojs@example.com', website: '' }));
    assert.equal(r.status, 303);
    assert.equal(r.res.headers.get('location'), '/gracias');
    assert.equal((await rows('nojs@example.com')).length, 1);
    r = await call(handle, form({ email: 'mal', website: '' }));
    assert.equal(r.status, 303);
    assert.equal(r.res.headers.get('location'), '/registro-error');
  });
});

describe('health', () => {
  test('ok con base viva, degraded con base caída', async () => {
    const ok = createHealthHandler(createDatabase(testConfig()), () => {});
    assert.equal((await ok(new Request('http://localhost/api/health'))).status, 200);
    const downDb = createDatabase(testConfig({ DATABASE_URL: `postgresql://waitlist_writer:${WRITER_PASSWORD}@127.0.0.1:1/x` }));
    const down = await createHealthHandler(downDb, () => {})(new Request('http://localhost/api/health'));
    assert.equal(down.status, 503);
    assert.deepEqual(await down.json(), { status: 'degraded' });
  });
});
