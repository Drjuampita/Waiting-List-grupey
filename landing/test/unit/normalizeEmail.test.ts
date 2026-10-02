import assert from 'node:assert/strict';
import { test } from 'node:test';
import { normalizeEmail } from '../../lib/normalizeEmail';

const norm = (s: unknown) => {
  const r = normalizeEmail(s);
  return r.ok ? r.normalized : null;
};

test('1. trim, minúsculas y conserva el original limpio', () => {
  const r = normalizeEmail(' Alice.Doe+test@EXAMPLE.COM ');
  assert.deepEqual(r, { ok: true, email: 'Alice.Doe+test@EXAMPLE.COM', normalized: 'alice.doe+test@example.com' });
});

test('1. espacios no separables y caracteres de ancho cero', () => {
  assert.equal(norm(' ana@gmail.com '), 'ana@gmail.com');
  assert.equal(norm('ana@gmail.com​'), 'ana@gmail.com');
  assert.equal(norm('﻿ana@gm‍ail.com⁠'), 'ana@gmail.com');
});

test('1. NFC e IDN a punycode', () => {
  assert.equal(norm('ana@münchen.de'), 'ana@xn--mnchen-3ya.de');
  assert.equal(norm('ana@münchen.de'), 'ana@xn--mnchen-3ya.de');
  assert.equal(norm('ana@xn--mnchen-3ya.de'), 'ana@xn--mnchen-3ya.de');
});

test('1. rechazos', () => {
  const invalid: unknown[] = [
    '', 'ana', 'ana@', '@gmail.com', 'ana@@gmail.com', 'ana@gmail', 'ana@gmail.c', 'ana@gmail.123',
    'ana\u0000@gmail.com', 'ana\n@gmail.com', 'an a@gmail.com', 'josé@gmail.com',
    '.ana@gmail.com', 'ana.@gmail.com', 'an..a@gmail.com', 'ana@-gmail.com', 'ana@gmail-.com',
    'ana@gmail..com', 'ana@gmail.com.', `ana@${'a'.repeat(64)}.com`, `${'a'.repeat(65)}@gmail.com`,
    `${'a'.repeat(64)}@${'b'.repeat(63)}.${'c'.repeat(63)}.${'d'.repeat(63)}.com`,
    'a'.repeat(321), '<script>alert(1)</script>', "'; DROP TABLE waitlist.signups; --",
    null, undefined, 42, {}, ['ana@gmail.com'],
  ];
  for (const value of invalid) assert.equal(norm(value), null, JSON.stringify(value));
});

test('1. límites exactos: parte local de 64 y total de 254', () => {
  assert.ok(norm(`${'a'.repeat(64)}@gmail.com`));
  const domain = `${'b'.repeat(63)}.${'c'.repeat(63)}.${'d'.repeat(57)}.com`;
  const email = `${'a'.repeat(64)}@${domain}`;
  assert.equal(email.length, 254);
  assert.equal(norm(email), email);
});

test('2. conserva puntos y +etiquetas', () => {
  assert.equal(norm('john.doe@gmail.com'), 'john.doe@gmail.com');
  assert.equal(norm('johndoe+viaje@gmail.com'), 'johndoe+viaje@gmail.com');
  assert.notEqual(norm('john.doe@gmail.com'), norm('johndoe@gmail.com'));
});
