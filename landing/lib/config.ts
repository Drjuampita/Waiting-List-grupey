import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseSentryDsn } from './alert';

export type AppEnv = 'production' | 'preview' | 'development';

export interface Config {
  env: AppEnv;
  databaseUrl: string;
  /** CA para verificar SSL; null solo cuando la base es local. */
  databaseCa: string | null;
  upstash: { url: string; token: string } | null;
  allowedOrigins: string[];
  privacyVersion: string;
  logHashSecret: string;
  ipPerMinute: number;
  emailPerDay: number;
  rateLimitPrefix: string;
  /** Alertas de 5xx; opcional (recomendado en producción). */
  sentryDsn: string | null;
}

export type ConfigResult = { ok: true; config: Config } | { ok: false; problems: string[] };

type Env = Record<string, string | undefined>;

const LOCAL_HOST = /localhost|127\.0\.0\.1|\[::1\]/i;
const DEFAULT_CA_PATH = fileURLToPath(new URL('../certs/supabase-ca.crt', import.meta.url));

function positiveInt(value: string | undefined, fallback: number): number | null {
  if (value === undefined || value.trim() === '') return fallback;
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : null;
}

function isLocalDatabase(url: string): boolean {
  try {
    return LOCAL_HOST.test(new URL(url).hostname);
  } catch {
    return false;
  }
}

/**
 * Valida la configuración una sola vez, al cargar el módulo (sección 12).
 * Si algo falta o es peligroso, la función responde 503 a toda request.
 * `problems` solo contiene nombres de variables, nunca sus valores.
 */
export function loadConfig(env: Env, readCa: (path: string) => string | null = readCaFile): ConfigResult {
  const problems: string[] = [];
  const appEnv: AppEnv =
    env.VERCEL_ENV === 'production' || env.VERCEL_ENV === 'preview' ? env.VERCEL_ENV : 'development';
  const deployed = appEnv !== 'development';

  const databaseUrl = env.DATABASE_URL?.trim() ?? '';
  if (!databaseUrl) problems.push('DATABASE_URL missing');
  else {
    try {
      new URL(databaseUrl);
    } catch {
      problems.push('DATABASE_URL invalid');
    }
  }

  const localDb = databaseUrl !== '' && isLocalDatabase(databaseUrl);
  if (appEnv === 'production' && (localDb || LOCAL_HOST.test(databaseUrl))) {
    problems.push('DATABASE_URL points to localhost in production');
  }
  let databaseCa: string | null = null;
  if (databaseUrl && !localDb) {
    databaseCa = readCa(env.DATABASE_CA_PATH?.trim() || DEFAULT_CA_PATH);
    if (!databaseCa) problems.push('Supabase CA certificate missing (certs/supabase-ca.crt)');
  }

  // KV_REST_API_* son los nombres que inyecta la integración de Upstash en el Marketplace de Vercel.
  const upstashUrl = (env.UPSTASH_REDIS_REST_URL || env.KV_REST_API_URL)?.trim();
  const upstashToken = (env.UPSTASH_REDIS_REST_TOKEN || env.KV_REST_API_TOKEN)?.trim();
  const upstash = upstashUrl && upstashToken ? { url: upstashUrl, token: upstashToken } : null;
  if (deployed && !upstash) problems.push('UPSTASH_REDIS_REST_URL/UPSTASH_REDIS_REST_TOKEN missing');

  const allowedOrigins = (env.ALLOWED_ORIGINS ?? '')
    .split(',')
    .map((o) => o.trim().replace(/\/+$/, ''))
    .filter(Boolean);
  if (appEnv === 'production' && allowedOrigins.some((o) => LOCAL_HOST.test(o) || o.endsWith('.vercel.app'))) {
    problems.push('ALLOWED_ORIGINS includes localhost or .vercel.app in production');
  }
  if (appEnv === 'preview') {
    for (const host of [env.VERCEL_URL, env.VERCEL_BRANCH_URL]) {
      if (host) allowedOrigins.push(`https://${host}`);
    }
  }
  if (allowedOrigins.length === 0) problems.push('ALLOWED_ORIGINS missing');

  const privacyVersion = env.PRIVACY_POLICY_VERSION?.trim() ?? '';
  if (!privacyVersion || privacyVersion.length > 40) problems.push('PRIVACY_POLICY_VERSION missing or too long');

  const logHashSecret = env.LOG_HASH_SECRET ?? '';
  if (logHashSecret.length < 32) problems.push('LOG_HASH_SECRET missing or shorter than 32 chars');

  const ipPerMinute = positiveInt(env.RATE_LIMIT_IP_PER_MINUTE, 20);
  const emailPerDay = positiveInt(env.RATE_LIMIT_EMAIL_PER_DAY, 10);
  if (ipPerMinute === null) problems.push('RATE_LIMIT_IP_PER_MINUTE invalid');
  if (emailPerDay === null) problems.push('RATE_LIMIT_EMAIL_PER_DAY invalid');

  const sentryDsn = env.SENTRY_DSN?.trim() || null;
  if (sentryDsn && !parseSentryDsn(sentryDsn)) problems.push('SENTRY_DSN invalid');

  if (problems.length > 0) return { ok: false, problems };
  return {
    ok: true,
    config: {
      env: appEnv,
      databaseUrl,
      databaseCa,
      upstash,
      allowedOrigins,
      privacyVersion,
      logHashSecret,
      ipPerMinute: ipPerMinute!,
      emailPerDay: emailPerDay!,
      rateLimitPrefix: appEnv === 'production' ? 'waitlist:' : 'waitlist-dev:',
      sentryDsn,
    },
  };
}

function readCaFile(path: string): string | null {
  try {
    return existsSync(path) ? readFileSync(path, 'utf8') : null;
  } catch {
    return null;
  }
}
