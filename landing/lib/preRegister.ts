import { ipAddress } from '@vercel/functions';
import type { Alerter } from './alert';
import type { Config, ConfigResult } from './config';
import { classifyDbError, type Database } from './db';
import { errorFields, hmac16, hmacHex, type Logger } from './log';
import { normalizeEmail } from './normalizeEmail';
import { checkLimit, type RateLimiters } from './rateLimit';
import { apiResponse, redirectResponse, requestIdOf, type ApiCode } from './responses';
import { isHoneypotFilled, parseAttribution } from './validate';

export const MAX_BODY_BYTES = 8 * 1024;

export interface PreRegisterDeps {
  config: ConfigResult;
  db: Database | null;
  limiters: RateLimiters | null;
  log: Logger;
  /** Alerta de errores 5xx (Sentry); opcional. */
  alert?: Alerter;
}

type Outcome = { status: number; code: ApiCode; headers?: Record<string, string> };

class BodyTooLarge extends Error {}

async function readBodyCapped(request: Request): Promise<string> {
  if (!request.body) return '';
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_BODY_BYTES) {
      await reader.cancel().catch(() => {});
      throw new BodyTooLarge();
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString('utf8');
}

function retryAfterSeconds(reset: number): string {
  return String(Math.max(1, Math.ceil((reset - Date.now()) / 1000)));
}

function hostsOf(origins: string[], request: Request): Set<string> {
  const hosts = new Set<string>();
  for (const o of origins) {
    try {
      hosts.add(new URL(o).hostname.toLowerCase());
    } catch {
      /* origen mal escrito: se ignora para este propósito */
    }
  }
  const host = request.headers.get('host');
  if (host) hosts.add(host.split(':')[0].toLowerCase());
  return hosts;
}

/**
 * POST /api/pre-register. Orden (sección 4): método → Content-Type → tamaño → Origin →
 * rate limit por IP → parseo → honeypot → correo → rate limit por correo → base.
 */
export function createPreRegisterHandler(deps: PreRegisterDeps) {
  return async function handle(request: Request): Promise<Response> {
    const started = Date.now();
    const requestId = requestIdOf(request);
    const fields: Record<string, unknown> = { request_id: requestId };
    let formEncoded = false;

    const finish = (outcome: Outcome, level: 'info' | 'warn' | 'error' = 'info'): Response => {
      deps.log(level, 'pre_register', {
        ...fields,
        status: outcome.status,
        code: outcome.code,
        duration_ms: Date.now() - started,
      });
      if (outcome.status >= 500) {
        deps.alert?.({
          message: `pre_register ${outcome.code}`,
          tags: { code: outcome.code, status: outcome.status, request_id: requestId, err_code: fields.err_code as string, err_name: fields.err_name as string },
        });
      }
      if (formEncoded) {
        return redirectResponse(outcome.status === 200 ? '/gracias' : '/registro-error', requestId);
      }
      return apiResponse(outcome.status, outcome.code, requestId, outcome.headers);
    };

    try {
      if (!deps.config.ok || !deps.db || !deps.limiters) {
        return finish({ status: 503, code: 'service_unavailable', headers: { 'Retry-After': '30' } }, 'error');
      }
      const config: Config = deps.config.config;

      if (request.method !== 'POST') {
        return finish({ status: 405, code: 'method_not_allowed', headers: { Allow: 'POST' } });
      }

      const mediaType = (request.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase();
      if (mediaType === 'application/x-www-form-urlencoded') formEncoded = true;
      else if (mediaType !== 'application/json') return finish({ status: 415, code: 'unsupported_media_type' });

      const declaredLength = Number(request.headers.get('content-length') ?? '0');
      if (Number.isFinite(declaredLength) && declaredLength > MAX_BODY_BYTES) {
        return finish({ status: 413, code: 'payload_too_large' });
      }

      const origin = request.headers.get('origin');
      if (!origin || !config.allowedOrigins.includes(origin)) {
        fields.origin_allowed = false;
        return finish({ status: 403, code: 'forbidden_origin' }, 'warn');
      }

      const ip = ipAddress(request) ?? 'unknown';
      const ipKey = hmacHex(config.logHashSecret, ip);
      fields.ip_hmac = ipKey.slice(0, 16);
      const ipLimit = await checkLimit(deps.limiters.ip, ipKey);
      if (ipLimit.failedOpen) deps.log('warn', 'rate_limit_fail_open', { request_id: requestId, limiter: 'ip' });
      if (!ipLimit.success) {
        fields.reason = 'ip';
        return finish({ status: 429, code: 'rate_limited', headers: { 'Retry-After': retryAfterSeconds(ipLimit.reset) } });
      }

      let raw: string;
      try {
        raw = await readBodyCapped(request);
      } catch (err) {
        if (err instanceof BodyTooLarge) return finish({ status: 413, code: 'payload_too_large' });
        throw err;
      }

      let body: Record<string, unknown>;
      if (formEncoded) {
        body = Object.fromEntries(new URLSearchParams(raw));
      } else {
        let parsed: unknown;
        try {
          parsed = JSON.parse(raw);
        } catch {
          return finish({ status: 400, code: 'invalid_request' });
        }
        if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
          return finish({ status: 400, code: 'invalid_request' });
        }
        body = parsed as Record<string, unknown>;
      }
      if (typeof body.email !== 'string') return finish({ status: 400, code: 'invalid_request' });

      const attribution = parseAttribution(body, hostsOf(config.allowedOrigins, request));
      fields.form = attribution.form;
      fields.utm_source = attribution.utm_source;

      fields.honeypot = isHoneypotFilled(body);
      if (fields.honeypot) return finish({ status: 200, code: 'registered' });

      const email = normalizeEmail(body.email);
      if (!email.ok) return finish({ status: 400, code: 'invalid_email' });

      // Límite por correo Y origen: un tercero que conoce un correo no puede bloquear su registro
      // desde otra red. El volumen total por IP ya lo frena el límite por IP.
      const emailKey = hmacHex(config.logHashSecret, `${email.normalized}|${ip}`);
      fields.email_hmac = hmac16(config.logHashSecret, email.normalized);
      const emailLimit = await checkLimit(deps.limiters.email, emailKey);
      if (emailLimit.failedOpen) deps.log('warn', 'rate_limit_fail_open', { request_id: requestId, limiter: 'email' });
      if (!emailLimit.success) {
        fields.reason = 'email';
        return finish({ status: 429, code: 'rate_limited', headers: { 'Retry-After': retryAfterSeconds(emailLimit.reset) } });
      }

      const dbStarted = Date.now();
      try {
        fields.inserted = await deps.db.preRegister({
          ...attribution,
          email: email.email,
          email_normalized: email.normalized,
          privacy_version: config.privacyVersion,
        });
      } catch (err) {
        fields.db_ms = Date.now() - dbStarted;
        Object.assign(fields, errorFields(err));
        const failure = classifyDbError(err);
        if (failure === 'timeout') return finish({ status: 504, code: 'timeout' }, 'error');
        if (failure === 'unavailable') {
          return finish({ status: 503, code: 'service_unavailable', headers: { 'Retry-After': '30' } }, 'error');
        }
        return finish({ status: 500, code: 'internal_error' }, 'error');
      }
      fields.db_ms = Date.now() - dbStarted;
      return finish({ status: 200, code: 'registered' });
    } catch (err) {
      Object.assign(fields, errorFields(err));
      return finish({ status: 500, code: 'internal_error' }, 'error');
    }
  };
}
