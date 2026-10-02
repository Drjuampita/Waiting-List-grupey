import { randomUUID } from 'node:crypto';
import { waitUntil } from '@vercel/functions';

// Alertas de errores 5xx a Sentry sin SDK: un evento mínimo por la API de envelopes.
// Solo viaja lo que está en `tags` (códigos y request_id). Nunca correo, IP, cuerpo ni err.message.

export interface AlertEvent {
  message: string;
  tags: Record<string, string | number | boolean | null | undefined>;
}

export type Alerter = (event: AlertEvent) => void;

export const noopAlerter: Alerter = () => {};

const THROTTLE_MS = 60_000;

export function parseSentryDsn(dsn: string): { envelopeUrl: string; publicKey: string } | null {
  try {
    const url = new URL(dsn);
    const segments = url.pathname.split('/').filter(Boolean);
    const projectId = segments.pop();
    if (url.protocol !== 'https:' || !url.username || !projectId || !/^\d+$/.test(projectId)) return null;
    const prefix = segments.length ? `/${segments.join('/')}` : '';
    return { envelopeUrl: `${url.origin}${prefix}/api/${projectId}/envelope/`, publicKey: url.username };
  } catch {
    return null;
  }
}

export function createSentryAlerter(
  dsn: string,
  environment: string,
  send: typeof fetch = fetch,
  now: () => number = Date.now,
): Alerter {
  const target = parseSentryDsn(dsn);
  if (!target) return noopAlerter;
  // Máximo un evento por mensaje y minuto por instancia: una base caída no inunda Sentry.
  const lastSent = new Map<string, number>();

  return (event) => {
    const key = `${event.message}:${event.tags.code ?? ''}`;
    const t = now();
    if (t - (lastSent.get(key) ?? -Infinity) < THROTTLE_MS) return;
    lastSent.set(key, t);

    const eventId = randomUUID().replace(/-/g, '');
    const tags = Object.fromEntries(
      Object.entries(event.tags).filter(([, v]) => v !== undefined && v !== null).map(([k, v]) => [k, String(v)]),
    );
    const payload = {
      event_id: eventId,
      timestamp: t / 1000,
      level: 'error',
      platform: 'node',
      environment,
      message: { formatted: event.message },
      tags,
    };
    const body = [
      JSON.stringify({ event_id: eventId, sent_at: new Date(t).toISOString() }),
      JSON.stringify({ type: 'event' }),
      JSON.stringify(payload),
    ].join('\n');

    const delivery = send(target.envelopeUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-sentry-envelope',
        'X-Sentry-Auth': `Sentry sentry_version=7, sentry_key=${target.publicKey}, sentry_client=grupey-landing/1.0`,
      },
      body,
      signal: AbortSignal.timeout(2_000),
    }).then(
      () => undefined,
      () => undefined, // una alerta perdida nunca debe romper la respuesta
    );
    // En Vercel mantiene viva la función hasta enviar la alerta, sin retrasar la respuesta.
    waitUntil(delivery);
  };
}
