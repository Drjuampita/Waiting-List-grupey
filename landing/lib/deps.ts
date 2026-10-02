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
    deps = { config, db: null, limiters: null, log: consoleLogger };
    return deps;
  }
  const c = config.config;
  deps = {
    config,
    db: createDatabase(c),
    // En memoria solo en desarrollo: loadConfig exige Upstash en preview y producción.
    limiters: c.upstash ? createUpstashLimiters(c) : createMemoryLimiters(c),
    log: consoleLogger,
  };
  return deps;
}
