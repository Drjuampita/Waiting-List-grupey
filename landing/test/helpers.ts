import { readFileSync } from 'node:fs';
import pg from 'pg';
import { loadConfig, type Config } from '../lib/config';
import { createDatabase, type Database } from '../lib/db';
import type { Logger } from '../lib/log';
import { createPreRegisterHandler, type PreRegisterDeps } from '../lib/preRegister';
import { createMemoryLimiters, type RateLimiters } from '../lib/rateLimit';

// Postgres 16 real (Docker local o servicio de CI). Solo se aplica 0026_waitlist.sql.
export const ADMIN_URL = process.env.TEST_DATABASE_URL ?? 'postgresql://postgres:postgres@localhost:5432/waitlist_test';
export const WRITER_PASSWORD = 'writer_test_password_0123456789';
export const ORIGIN = 'http://localhost:3000';
export const PRIVACY_VERSION = '2026-10-15';

export function writerUrl(): string {
  const url = new URL(ADMIN_URL);
  url.username = 'waitlist_writer';
  url.password = WRITER_PASSWORD;
  return url.toString();
}

const MIGRATION = readFileSync(new URL('../../supabase/migrations/0026_waitlist.sql', import.meta.url), 'utf8');

export async function adminQuery<T extends pg.QueryResultRow = pg.QueryResultRow>(sql: string, values: unknown[] = []) {
  const client = new pg.Client({ connectionString: ADMIN_URL });
  await client.connect();
  try {
    return await client.query<T>(sql, values);
  } finally {
    await client.end();
  }
}

/** Esquema limpio: simula los roles de Supabase, aplica 0026 y activa el login del writer. */
export async function resetDatabase(): Promise<void> {
  const client = new pg.Client({ connectionString: ADMIN_URL });
  await client.connect();
  try {
    await client.query(`do $$ begin
      if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
      if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
      if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role nologin; end if;
    end $$;`);
    await client.query('drop schema if exists waitlist cascade');
    await client.query(MIGRATION);
    await client.query(`alter role waitlist_writer with login password '${WRITER_PASSWORD}'`);
  } finally {
    await client.end();
  }
}

export async function rows(email?: string) {
  const res = await adminQuery(
    email ? 'select * from waitlist.signups where email_normalized = $1' : 'select * from waitlist.signups',
    email ? [email] : [],
  );
  return res.rows;
}

export const BASE_ENV = {
  DATABASE_URL: '',
  ALLOWED_ORIGINS: ORIGIN,
  PRIVACY_POLICY_VERSION: PRIVACY_VERSION,
  LOG_HASH_SECRET: 'test-secret-that-is-at-least-32-characters-long',
};

export function testConfig(overrides: Record<string, string> = {}): Config {
  const result = loadConfig({ ...BASE_ENV, DATABASE_URL: writerUrl(), ...overrides });
  if (!result.ok) throw new Error(result.problems.join(', '));
  return result.config;
}

export interface LogLine {
  level: string;
  msg: string;
  [key: string]: unknown;
}

export function makeApp(opts: { config?: Config; db?: Database; limiters?: RateLimiters } = {}) {
  const config = opts.config ?? testConfig();
  const logs: LogLine[] = [];
  const log: Logger = (level, msg, fields = {}) => logs.push({ level, msg, ...fields });
  const deps: PreRegisterDeps = {
    config: { ok: true, config },
    db: opts.db ?? createDatabase(config),
    limiters: opts.limiters ?? createMemoryLimiters(config),
    log,
  };
  return { handle: createPreRegisterHandler(deps), logs, deps };
}

let ipCounter = 0;
/** IP distinta por request salvo que se indique: evita que el límite por IP interfiera. */
export function uniqueIp(): string {
  ipCounter += 1;
  return `10.0.${Math.floor(ipCounter / 250) % 250}.${(ipCounter % 250) + 1}`;
}

export function postJson(
  body: unknown,
  opts: { origin?: string | null; ip?: string; contentType?: string; raw?: string } = {},
): Request {
  const headers: Record<string, string> = {
    'content-type': opts.contentType ?? 'application/json',
    'x-real-ip': opts.ip ?? uniqueIp(),
    host: 'localhost:3000',
  };
  if (opts.origin !== null) headers.origin = opts.origin ?? ORIGIN;
  return new Request('http://localhost:3000/api/pre-register', {
    method: 'POST',
    headers,
    body: opts.raw ?? JSON.stringify(body),
  });
}

export async function call(handle: (r: Request) => Promise<Response>, req: Request) {
  const res = await handle(req);
  const text = await res.text();
  let json: Record<string, unknown> | null = null;
  try {
    json = JSON.parse(text);
  } catch {
    /* redirecciones o cuerpos vacíos */
  }
  return { res, status: res.status, json };
}
