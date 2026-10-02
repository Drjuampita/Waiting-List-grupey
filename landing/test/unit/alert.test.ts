import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createSentryAlerter, parseSentryDsn } from '../../lib/alert';

test('parseSentryDsn: DSN válido e inválidos', () => {
  assert.deepEqual(parseSentryDsn('https://abc123@o1.ingest.sentry.io/4507'), {
    envelopeUrl: 'https://o1.ingest.sentry.io/api/4507/envelope/',
    publicKey: 'abc123',
  });
  for (const bad of ['', 'nope', 'http://k@host/1', 'https://host/1', 'https://k@host/abc']) {
    assert.equal(parseSentryDsn(bad), null, bad);
  }
});

test('alerta: solo tags, sin datos personales, y máximo una por minuto', async () => {
  const sent: { url: string; body: string }[] = [];
  const fakeFetch = (async (url: string, init: RequestInit) => {
    sent.push({ url, body: String(init.body) });
    return new Response(null, { status: 200 });
  }) as unknown as typeof fetch;
  let t = 1_000_000;
  const alert = createSentryAlerter('https://key@o1.ingest.sentry.io/42', 'production', fakeFetch, () => t);
  alert({ message: 'pre_register service_unavailable', tags: { code: 'service_unavailable', err_code: 'ECONNREFUSED', request_id: 'r1' } });
  alert({ message: 'pre_register service_unavailable', tags: { code: 'service_unavailable', request_id: 'r2' } });
  t += 61_000;
  alert({ message: 'pre_register service_unavailable', tags: { code: 'service_unavailable', request_id: 'r3' } });
  await new Promise((r) => setImmediate(r));
  assert.equal(sent.length, 2);
  assert.equal(sent[0].url, 'https://o1.ingest.sentry.io/api/42/envelope/');
  const event = JSON.parse(sent[0].body.split('\n')[2]);
  assert.deepEqual(event.tags, { code: 'service_unavailable', err_code: 'ECONNREFUSED', request_id: 'r1' });
  assert.equal(event.environment, 'production');
  assert.deepEqual(Object.keys(event).sort(), ['environment', 'event_id', 'level', 'message', 'platform', 'tags', 'timestamp']);
});
