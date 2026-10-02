import pg from 'pg';
import type { Config } from './config';
import type { Attribution } from './validate';

export const CONNECT_TIMEOUT_MS = 3_000;
export const QUERY_TIMEOUT_MS = 4_000;

export interface PreRegisterParams extends Attribution {
  email: string;
  email_normalized: string;
  privacy_version: string;
}

export interface Database {
  /** true si creó la fila; false si ya existía. */
  preRegister(params: PreRegisterParams): Promise<boolean>;
  ping(timeoutMs: number): Promise<void>;
}

export type DbFailure = 'unavailable' | 'timeout' | 'unexpected';

// Errores de conexión o del servidor que significan "la base no está disponible".
const UNAVAILABLE_CODES = new Set([
  'ECONNREFUSED', 'ENOTFOUND', 'EAI_AGAIN', 'ECONNRESET', 'EHOSTUNREACH', 'ENETUNREACH', 'EPIPE',
  '28P01', '28000', '53300', '57P01', '57P02', '57P03', '08000', '08001', '08003', '08004', '08006',
  'XX000',
]);

/** Clasifica un error de pg sin leer message/detail para logs (solo para decidir el código HTTP). */
export function classifyDbError(err: unknown): DbFailure {
  const e = err as { code?: unknown; message?: unknown } | null;
  const code = typeof e?.code === 'string' ? e.code : '';
  const message = typeof e?.message === 'string' ? e.message : '';
  if (code === '57014' || code === 'ETIMEDOUT' || /timeout/i.test(message)) return 'timeout';
  if (UNAVAILABLE_CODES.has(code) || /Connection terminated|self[- ]signed|certificate/i.test(message)) {
    return 'unavailable';
  }
  return 'unexpected';
}

export function createDatabase(config: Pick<Config, 'databaseUrl' | 'databaseCa'>): Database {
  const pool = new pg.Pool({
    connectionString: config.databaseUrl,
    // Una conexión por instancia: Supavisor (modo transacción) hace el pooling real.
    max: 1,
    idleTimeoutMillis: 10_000,
    connectionTimeoutMillis: CONNECT_TIMEOUT_MS,
    query_timeout: QUERY_TIMEOUT_MS,
    ssl: config.databaseCa ? { ca: config.databaseCa, rejectUnauthorized: true } : false,
  });
  // Un cliente que muere estando inactivo no debe tumbar el proceso.
  pool.on('error', () => {});

  return {
    async preRegister(p) {
      // Query sin nombre (sin prepared statement con nombre): compatible con Supavisor en modo transacción.
      const { rows } = await pool.query<{ inserted: boolean }>({
        text: 'select waitlist.pre_register($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12) as inserted',
        values: [
          p.email, p.email_normalized, p.form,
          p.utm_source, p.utm_medium, p.utm_campaign, p.utm_content, p.utm_term,
          p.ref, p.referrer_host, p.landing_path, p.privacy_version,
        ],
      });
      return rows[0]?.inserted === true;
    },
    async ping(timeoutMs) {
      await pool.query({ text: 'select 1', query_timeout: timeoutMs } as pg.QueryConfig);
    },
  };
}
