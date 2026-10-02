import { createSentryAlerter, noopAlerter } from './alert';
import { loadConfig } from './config';
import { createDatabase } from './db';
import { consoleLogger } from './log';
import type { PreRegisterDeps } from './preRegister';
import { createMemoryLimiters, createUpstashLimiters } from './rateLimit';

let deps: PreRegisterDeps | null = null;

/** Dependencias reales, creadas una vez por instancia al cargar el módulo. */
export function defaultDeps(): PreRegisterDeps {
  if (deps) return deps;
  const config = loadConfig(process.env);
  if (!config.ok) {
    consoleLogger('error', 'invalid_config', { problems: config.problems });
    // Sin configuración válida igual se intenta alertar si el DSN existe.
    const dsn = process.env.SENTRY_DSN?.trim();
    const alert = dsn ? createSentryAlerter(dsn, process.env.VERCEL_ENV ?? 'development') : noopAlerter;
    deps = { config, db: null, limiters: null, log: consoleLogger, alert };
    return deps;
  }
  const c = config.config;
  deps = {
    config,
    db: createDatabase(c),
    // En memoria solo en desarrollo: loadConfig exige Upstash en preview y producción.
    limiters: c.upstash ? createUpstashLimiters(c) : createMemoryLimiters(c),
    log: consoleLogger,
    alert: c.sentryDsn ? createSentryAlerter(c.sentryDsn, c.env) : noopAlerter,
  };
  return deps;
}
