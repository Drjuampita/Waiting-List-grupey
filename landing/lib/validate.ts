// Metadatos del registro (sección 4). Regla: nunca se pierde un registro por metadatos;
// lo raro se recorta o se descarta y el correo se guarda igual.

export type FormName = 'hero' | 'cierre';

export interface Attribution {
  form: FormName | null;
  utm_source: string | null;
  utm_medium: string | null;
  utm_campaign: string | null;
  utm_content: string | null;
  utm_term: string | null;
  ref: string | null;
  referrer_host: string | null;
  landing_path: string;
}

const CONTROL_CHARS = /[\u0000-\u001F\u007F-\u009F]/g;
const HOST = /^[a-z0-9.-]{1,253}$/;

function cleanText(value: unknown, max: number): string | null {
  if (typeof value !== 'string') return null;
  const cleaned = value.replace(CONTROL_CHARS, '').trim().slice(0, max).trim();
  return cleaned === '' ? null : cleaned;
}

function cleanHost(value: unknown, ownHosts: ReadonlySet<string>): string | null {
  if (typeof value !== 'string') return null;
  const host = value.trim().toLowerCase();
  if (!HOST.test(host) || ownHosts.has(host)) return null;
  return host;
}

function cleanPath(value: unknown): string {
  if (typeof value !== 'string') return '/';
  const path = value.replace(CONTROL_CHARS, '').trim().slice(0, 500);
  return path.startsWith('/') ? path : '/';
}

export function parseAttribution(body: Record<string, unknown>, ownHosts: ReadonlySet<string>): Attribution {
  return {
    form: body.form === 'hero' || body.form === 'cierre' ? body.form : null,
    utm_source: cleanText(body.utm_source, 200),
    utm_medium: cleanText(body.utm_medium, 200),
    utm_campaign: cleanText(body.utm_campaign, 200),
    utm_content: cleanText(body.utm_content, 200),
    utm_term: cleanText(body.utm_term, 200),
    ref: cleanText(body.ref, 100),
    referrer_host: cleanHost(body.referrer_host, ownHosts),
    landing_path: cleanPath(body.landing_path),
  };
}

/** Honeypot: cualquier valor no vacío en `website` delata a un bot. */
export function isHoneypotFilled(body: Record<string, unknown>): boolean {
  const value = body.website;
  if (value === undefined || value === null) return false;
  return String(value).trim() !== '';
}
