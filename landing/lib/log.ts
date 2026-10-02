import { createHmac } from 'node:crypto';

export type Level = 'info' | 'warn' | 'error';
export type Logger = (level: Level, msg: string, fields?: Record<string, unknown>) => void;

/** Un log JSON por línea. Nunca recibe correos, IPs en claro, cuerpos ni secretos. */
export const consoleLogger: Logger = (level, msg, fields = {}) => {
  const line = JSON.stringify({ ts: new Date().toISOString(), level, msg, ...fields });
  if (level === 'error') console.error(line);
  else if (level === 'warn') console.warn(line);
  else console.log(line);
};

export function hmacHex(secret: string, value: string): string {
  return createHmac('sha256', secret).update(value).digest('hex');
}

/** Primeros 16 hex del HMAC: suficiente para correlacionar, irreversible sin el secreto. */
export function hmac16(secret: string, value: string): string {
  return hmacHex(secret, value).slice(0, 16);
}

/** Datos seguros de un error: solo nombre y SQLSTATE/código, nunca message ni detail. */
export function errorFields(err: unknown): Record<string, unknown> {
  const e = err as { name?: unknown; code?: unknown } | null;
  return {
    err_name: typeof e?.name === 'string' ? e.name : typeof err,
    err_code: typeof e?.code === 'string' ? e.code : undefined,
  };
}
