import type { Database } from './db';
import { errorFields, type Logger } from './log';
import { jsonResponse, requestIdOf } from './responses';

export const HEALTH_TIMEOUT_MS = 2_000;
export const HEALTH_CACHE_MS = 15_000;

/** GET /api/health: `select 1` con tope de 2 s, cacheado 15 s por instancia. Sin detalles. */
export function createHealthHandler(db: Database | null, log: Logger, now: () => number = Date.now) {
  let cached: { ok: boolean; at: number } | null = null;

  return async function handle(request: Request): Promise<Response> {
    const requestId = requestIdOf(request);
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      return jsonResponse(405, { status: 'method_not_allowed' }, requestId, { Allow: 'GET' });
    }
    if (!cached || now() - cached.at > HEALTH_CACHE_MS) {
      let ok = false;
      if (db) {
        try {
          await db.ping(HEALTH_TIMEOUT_MS);
          ok = true;
        } catch (err) {
          log('error', 'health_check_failed', { request_id: requestId, ...errorFields(err) });
        }
      }
      cached = { ok, at: now() };
    }
    return cached.ok
      ? jsonResponse(200, { status: 'ok' }, requestId)
      : jsonResponse(503, { status: 'degraded' }, requestId, { 'Retry-After': '30' });
  };
}
