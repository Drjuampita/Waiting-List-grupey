import { Ratelimit } from '@upstash/ratelimit';
import { Redis } from '@upstash/redis';
import type { Config } from './config';

export interface LimitResult {
  success: boolean;
  /** Epoch en ms en que se libera el límite. */
  reset: number;
}

export interface Limiter {
  limit(key: string): Promise<LimitResult>;
}

export interface RateLimiters {
  ip: Limiter;
  email: Limiter;
}

export const UPSTASH_TIMEOUT_MS = 500;

/** Upstash (preview y producción). Las llaves ya llegan como HMAC: nunca IP ni correo en claro. */
export function createUpstashLimiters(config: Config): RateLimiters {
  const redis = new Redis({ url: config.upstash!.url, token: config.upstash!.token });
  const make = (name: string, tokens: number, window: '1 m' | '1 d'): Limiter => {
    const rl = new Ratelimit({
      redis,
      limiter: Ratelimit.slidingWindow(tokens, window),
      prefix: `${config.rateLimitPrefix}${name}`,
      analytics: true,
      timeout: UPSTASH_TIMEOUT_MS,
    });
    return {
      async limit(key) {
        const res = await rl.limit(key);
        // Un timeout interno de la librería deja pasar; lo convertimos en error para loguearlo.
        if (res.reason === 'timeout') throw new Error('upstash_timeout');
        return { success: res.success, reset: res.reset };
      },
    };
  };
  return {
    ip: make('ip', config.ipPerMinute, '1 m'),
    email: make('email', config.emailPerDay, '1 d'),
  };
}

/** Ventana deslizante en memoria. Solo para desarrollo local y pruebas. */
export function createMemoryLimiter(tokens: number, windowMs: number, now: () => number = Date.now): Limiter {
  const hits = new Map<string, number[]>();
  return {
    async limit(key) {
      const t = now();
      const recent = (hits.get(key) ?? []).filter((h) => h > t - windowMs);
      if (recent.length >= tokens) {
        hits.set(key, recent);
        return { success: false, reset: recent[0] + windowMs };
      }
      recent.push(t);
      hits.set(key, recent);
      return { success: true, reset: recent[0] + windowMs };
    },
  };
}

export function createMemoryLimiters(config: Pick<Config, 'ipPerMinute' | 'emailPerDay'>): RateLimiters {
  return {
    ip: createMemoryLimiter(config.ipPerMinute, 60_000),
    email: createMemoryLimiter(config.emailPerDay, 86_400_000),
  };
}

/**
 * Fail-open (sección 9): si el limitador falla o tarda más de 500 ms, se deja pasar.
 * Perder un registro real es peor que dejar pasar unos cuantos de más.
 */
export async function checkLimit(
  limiter: Limiter,
  key: string,
  timeoutMs = UPSTASH_TIMEOUT_MS,
): Promise<LimitResult & { failedOpen: boolean }> {
  let timer: NodeJS.Timeout | undefined;
  try {
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error('rate_limit_timeout')), timeoutMs);
    });
    const res = await Promise.race([limiter.limit(key), timeout]);
    return { ...res, failedOpen: false };
  } catch {
    return { success: true, reset: 0, failedOpen: true };
  } finally {
    clearTimeout(timer);
  }
}
